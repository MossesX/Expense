/**
 * @file `/api/accounts/admin/users` — the roster, paged and sorted SERVER-SIDE,
 * plus the four non-destructive account operations the admin suite needs.
 *
 * ```
 * GET  ?q=&role=&state=&sort=&dir=&offset=&limit=&withStorage=1&withPolicy=1
 * POST { action: "create"         , username, tempPassword, role? }
 * POST { action: "role"           , username, role }
 * POST { action: "reset-password" , username, tempPassword }
 * POST { action: "profile"        , username, bio?, avatar?, customFields? }
 * ```
 *
 * ## Why a second users route rather than a wider `/api/accounts/users`
 *
 * That one is the MEMBER directory: every signed-in surface reads it, it answers
 * in `toPublic()` shapes, and it must stay cheap and un-paged for the recipient
 * pickers that consume it. This one is the administrator's table — it returns
 * admin-only flags, joins storage and policy, and pages. Widening the directory
 * to carry both would have made every message composer's picker pay for the
 * admin suite's columns.
 *
 * ## Paging is the point, not a nicety
 *
 * The suite's table has to page thousands of members without shipping
 * thousands, so filtering, sorting and slicing all happen HERE and the client
 * receives one page plus a total. Two joins are opt-in because they cost a file
 * read per row: `withStorage=1` reads each row's usage index, `withPolicy=1`
 * resolves each row's cascade. Both are scoped to the PAGE — the whole reason
 * for paging would be lost if a join walked the roster.
 *
 * The single exception is `sort=storage`, which cannot rank a page it has not
 * measured and therefore reads every member's index. It is opt-in by being a
 * sort nobody applies by accident, and each index is one small document, so the
 * cost is a roster-sized number of small reads rather than a walk.
 *
 * ## The role ceiling
 *
 * An administrator may not grant a role above their own. With the two roles the
 * split project established (`member`, `administrator`) and an admin-only
 * route, that is inert today — and it is written down anyway, as a rank
 * comparison rather than as a comment, so the day a third role lands the
 * refusal already exists instead of being a hole somebody has to remember.
 * `updateUser` keeps its own lock-out guard underneath: nobody demotes
 * themselves, whatever this route allows.
 *
 * ## No destructive endpoint here
 *
 * No remove, no disable, no suspend. Removal stays at `/api/accounts/users`
 * with its cascade at `/api/accounts/admin`; suspension is a policy row at
 * `/api/accounts/admin/policy`. This phase widens an administrator's reach, and
 * the confirm surfaces stay the door — one door per destructive act, not two.
 */

import { NextResponse, type NextRequest } from "next/server";

import {
  addUser,
  listAccounts,
  resetPassword,
  toPublic,
  updateUser,
} from "@axs/modules/accounts/lib/accounts";
import { recordAudit } from "@axs/modules/accounts/lib/audit";
import {
  fail,
  readJsonBody,
  refuse,
  requireLiveAdmin,
  str,
  PROFILE_BODY_MAX,
} from "@axs/modules/accounts/lib/http";
import { effectivePolicy, suspensionOf } from "@axs/modules/accounts/lib/policy";
import { isOnline } from "@axs/modules/accounts/lib/presence";
import { updateProfile } from "@axs/modules/accounts/lib/profiles";
import { readUsage, type UserStorageIndex } from "@axs/modules/accounts/lib/storage";
import type { Account, AccountRole } from "@axs/modules/accounts/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ================================== the read ================================== */

/** Page size ceiling. A caller asking for everything gets 200 rows and a total
 *  that tells them there are more — never a 5 000-row response that times out
 *  the table it was meant to fill. */
const LIMIT_MAX = 200;
const LIMIT_DEFAULT = 50;

type SortKey = "username" | "screenname" | "role" | "createdAt" | "lastLoginAt" | "updatedAt" | "storage";

const SORTS = new Set<string>([
  "username",
  "screenname",
  "role",
  "createdAt",
  "lastLoginAt",
  "updatedAt",
  "storage",
]);

/** One row of the administrator's table. The account's admin-only flags always;
 *  the two joins only when they were asked for, and `undefined` rather than a
 *  zero when they were not — a surface must be able to tell "not measured" from
 *  "measured, and it is nothing". */
interface AdminUserRow {
  username: string;
  role: AccountRole;
  screenname: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  disabled: boolean;
  mustChangePassword: boolean;
  /** Migrated account with no usable password — see `Account.forcePasswordReset`. */
  awaitingFirstPassword: boolean;
  lastLoginAt: string | null;
  online: boolean;
  storage?: {
    totalBytes: number;
    sharedBytes: number;
    scannedAt: string;
  } | null;
  policy?: {
    suspended: boolean;
    suspendedReason: string;
    suspendedUntil: string | null;
    lapsed: boolean;
    loginDisabled: boolean;
    storageQuotaMB: number;
  };
}

const norm = (v: string): string => v.trim().toLowerCase();

function baseRow(a: Account): AdminUserRow {
  return {
    username: a.username,
    role: a.role,
    screenname: a.screenname,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    createdBy: a.createdBy,
    disabled: a.disabled === true,
    mustChangePassword: a.mustChangePassword,
    awaitingFirstPassword: a.forcePasswordReset === true,
    lastLoginAt: a.lastLoginAt ?? null,
    online: isOnline(a.username),
  };
}

const usageOf = (u: UserStorageIndex | null): AdminUserRow["storage"] =>
  u ? { totalBytes: u.totalBytes, sharedBytes: u.sharedBytes, scannedAt: u.scannedAt } : null;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await requireLiveAdmin(req);
  if ("deny" in gate) return gate.deny;

  const params = req.nextUrl.searchParams;
  const q = norm(params.get("q") ?? "");
  const role = (params.get("role") ?? "").trim();
  const state = (params.get("state") ?? "all").trim();
  const sortRaw = (params.get("sort") ?? "username").trim();
  const sort: SortKey = (SORTS.has(sortRaw) ? sortRaw : "username") as SortKey;
  const dir = (params.get("dir") ?? "asc").trim() === "desc" ? -1 : 1;
  const offset = Math.max(0, Math.round(Number(params.get("offset") ?? 0) || 0));
  const limit = Math.min(
    LIMIT_MAX,
    Math.max(1, Math.round(Number(params.get("limit") ?? LIMIT_DEFAULT) || LIMIT_DEFAULT)),
  );
  const withStorage = params.get("withStorage") === "1";
  const withPolicy = params.get("withPolicy") === "1";

  let accounts = await listAccounts();

  if (q) {
    accounts = accounts.filter(
      (a) => norm(a.username).includes(q) || norm(a.screenname ?? "").includes(q),
    );
  }
  if (role === "member" || role === "administrator") {
    accounts = accounts.filter((a) => a.role === role);
  }
  switch (state) {
    case "enabled":
      accounts = accounts.filter((a) => a.disabled !== true);
      break;
    case "disabled":
      accounts = accounts.filter((a) => a.disabled === true);
      break;
    // An account that has never completed its entry flow — the queue an
    // administrator actually works through after a migration or a batch add.
    case "pending":
      accounts = accounts.filter((a) => a.mustChangePassword || a.forcePasswordReset === true);
      break;
    case "online":
      accounts = accounts.filter((a) => isOnline(a.username));
      break;
    default:
      break;
  }

  const total = accounts.length;

  // Sorting by footprint is the one sort that must measure everything before it
  // can rank a page — see the header. Every other sort reads a field the roster
  // already carries.
  const usage = new Map<string, UserStorageIndex | null>();
  if (sort === "storage") {
    for (const a of accounts) usage.set(norm(a.username), await readUsage(a.username));
  }

  const key = (a: Account): string | number => {
    switch (sort) {
      case "role":
        return a.role;
      case "screenname":
        return norm(a.screenname ?? a.username);
      case "createdAt":
        return Date.parse(a.createdAt) || 0;
      case "updatedAt":
        return Date.parse(a.updatedAt) || 0;
      case "lastLoginAt":
        // Never signed in sorts as the beginning of time, so ascending puts the
        // members an administrator is looking for at the top rather than
        // scattering them.
        return a.lastLoginAt ? Date.parse(a.lastLoginAt) || 0 : 0;
      case "storage":
        return usage.get(norm(a.username))?.totalBytes ?? -1;
      default:
        return norm(a.username);
    }
  };

  const sorted = [...accounts].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === kb) return norm(a.username).localeCompare(norm(b.username));
    return (typeof ka === "number" && typeof kb === "number"
      ? ka - kb
      : String(ka).localeCompare(String(kb))) * dir;
  });

  const page = sorted.slice(offset, offset + limit);
  const rows: AdminUserRow[] = [];
  for (const a of page) {
    const row = baseRow(a);
    if (withStorage || sort === "storage") {
      const measured = usage.has(norm(a.username))
        ? (usage.get(norm(a.username)) ?? null)
        : await readUsage(a.username);
      row.storage = usageOf(measured);
    }
    if (withPolicy) {
      const values = await effectivePolicy(a.username);
      const suspension = suspensionOf(values);
      row.policy = {
        suspended: suspension.on,
        suspendedReason: suspension.reason,
        suspendedUntil: suspension.until,
        lapsed: suspension.lapsed,
        loginDisabled: values.loginDisabled,
        storageQuotaMB: values.storageQuotaMB,
      };
    }
    rows.push(row);
  }

  return NextResponse.json({
    ok: true,
    total,
    offset,
    limit,
    sort,
    dir: dir === -1 ? "desc" : "asc",
    rows,
  });
}

/* ================================= the writes ================================= */

/** The role ladder. A rank rather than a set, so "not above your own" is a
 *  comparison the day a third role exists rather than an `if` nobody wrote. */
const ROLE_RANK: Record<AccountRole, number> = { member: 0, administrator: 1 };

function roleField(body: Record<string, unknown>): AccountRole | undefined {
  const raw = body["role"];
  return typeof raw === "string" ? (raw as AccountRole) : undefined;
}

/** Is `wanted` within `actorRole`'s ceiling? An unknown string is NOT refused
 *  here — it is passed to the store, which names the refusal, so there is one
 *  sentence for "that is not a role" in the whole module. */
function aboveCeiling(actorRole: AccountRole, wanted: AccountRole | undefined): boolean {
  if (wanted === undefined) return false;
  const want = ROLE_RANK[wanted];
  if (want === undefined) return false;
  return want > ROLE_RANK[actorRole];
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await requireLiveAdmin(req);
  if ("deny" in gate) return gate.deny;

  // The profile action can carry a 256 KB avatar data-URL; the other three are
  // a word and a name. One cap per route would either refuse the avatar or
  // raise the ceiling for actions that have no business near it, so the body is
  // read at the larger cap only when the action needs it.
  const peek = await readJsonBody(req, PROFILE_BODY_MAX);
  if (!peek.ok) return peek.deny;
  const body = peek.body;
  const action = str(body, "action");
  const username = str(body, "username").trim();

  switch (action) {
    case "create": {
      const wanted = roleField(body) ?? "member";
      if (aboveCeiling("administrator", wanted)) {
        return fail(403, "you cannot create an account with a role above your own");
      }
      const result = await addUser(gate.actor, username, str(body, "tempPassword"), wanted);
      if (!result.ok) return refuse(result);
      await recordAudit({
        actor: gate.actor,
        subject: result.account.username,
        verb: "user-create",
        detail: `role ${result.account.role}, temp password issued`,
      });
      return NextResponse.json({ ok: true, user: toPublic(result.account) });
    }

    case "role": {
      const wanted = roleField(body);
      if (wanted === undefined) return fail(400, "role needs a role");
      // The acting administrator's own rank is `administrator` by the gate
      // above; naming it rather than assuming it is what makes this a ceiling
      // check instead of a formality.
      if (aboveCeiling("administrator", wanted)) {
        return fail(403, "you cannot grant a role above your own");
      }
      const result = await updateUser(gate.actor, username, { role: wanted });
      if (!result.ok) return refuse(result);
      await recordAudit({
        actor: gate.actor,
        subject: result.account.username,
        verb: "user-role",
        field: "role",
        to: result.account.role,
      });
      return NextResponse.json({ ok: true, user: toPublic(result.account) });
    }

    case "reset-password": {
      const result = await resetPassword(gate.actor, username, str(body, "tempPassword"));
      if (!result.ok) return refuse(result);
      await recordAudit({
        actor: gate.actor,
        subject: result.account.username,
        verb: "password-reset",
        // The password itself is never recorded, and there is nothing here that
        // could be mistaken for it — the trail says a credential was issued and
        // by whom, which is the whole of what an audit needs to know.
        detail: "temp password issued; the member's next sign-in is forced through change-password",
      });
      return NextResponse.json({ ok: true, user: toPublic(result.account) });
    }

    case "profile": {
      if (!username) return fail(400, "profile needs a username");
      const patch = {
        ...("bio" in body ? { bio: str(body, "bio") } : {}),
        ...("avatar" in body ? { avatar: body["avatar"] } : {}),
        ...("customFields" in body ? { customFields: body["customFields"] } : {}),
      };
      if (Object.keys(patch).length === 0) {
        return fail(400, "profile needs a bio, an avatar and/or customFields");
      }
      const result = await updateProfile(gate.actor, username, patch);
      if (!result.ok) return refuse(result);
      await recordAudit({
        actor: gate.actor,
        subject: result.profile.username,
        verb: "profile-edit",
        detail: `fields: ${Object.keys(patch).join(", ")}`,
      });
      return NextResponse.json({ ok: true, profile: result.profile });
    }

    default:
      return fail(
        400,
        `unknown action "${action}" — create, role, reset-password or profile. ` +
          "Removing or disabling an account stays at /api/accounts/users; suspending is a policy row.",
      );
  }
}
