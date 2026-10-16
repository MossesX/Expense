/**
 * @file `/api/accounts/users` — the member directory and the account roster's
 * administrator half.
 *
 * GET → the directory every signed-in surface reads (the messenger's recipient
 * picker, the profile browser, the presence list). Public shapes only —
 * `toPublic()` strips the hash and the entry-flow flags — and it is member-only
 * information, so a signed-out caller gets a 401 rather than an empty list.
 * A member sees the accounts they can actually interact with: enabled ones,
 * plus their own row whatever its state. An administrator sees every row,
 * disabled included and MARKED, because managing them is the job.
 *
 * POST `{ action, … }`:
 *   - `add-user`       { username, tempPassword, role? }
 *   - `update-user`    { username, role?, disabled? }
 *   - `remove-user`    { username }
 *   - `reset-password` { username, tempPassword }
 *
 * None of the four is gated here beyond "some valid session". That is
 * deliberate: the P1 store functions are `requireAdmin`-backed — each one
 * re-reads the acting account from disk and returns a 403 refusal itself, so
 * the check cannot drift from the mutation it protects, and a demotion binds
 * on the very next request. The route's only job is to map the refusal onto
 * its status code, which `refuse()` does verbatim.
 *
 * `remove-user` takes the account ROW only. The stored-data cascade (profile,
 * grants, presence) is an explicit admin action — `/api/accounts/admin` with
 * `remove-user-data` — because a best-effort cleanup must never be able to
 * fail an account removal that already succeeded.
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  addUser,
  listAccounts,
  removeUser,
  resetPassword,
  toPublic,
  updateUser,
} from "@axs/modules/accounts/lib/accounts";
import {
  bool,
  fail,
  readJsonBody,
  refuse,
  requireSession,
  str,
} from "@axs/modules/accounts/lib/http";
import type { AccountRole } from "@axs/modules/accounts/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const norm = (v: string): string => v.trim().toLowerCase();

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = requireSession(req);
  if ("deny" in gate) return gate.deny;

  const accounts = await listAccounts();
  const mine = accounts.find((a) => norm(a.username) === norm(gate.user));
  if (!mine || mine.disabled === true) {
    // Same rule the session route applies: a cookie for an account that is
    // gone or switched off is not a session.
    return fail(401, "sign in first");
  }
  const administrator = mine.role === "administrator";
  const visible = administrator
    ? accounts
    : accounts.filter((a) => a.disabled !== true || norm(a.username) === norm(gate.user));

  return NextResponse.json({
    ok: true,
    me: mine.username,
    administrator,
    users: visible.map(toPublic),
  });
}

/** `"member"` / `"administrator"`, or undefined when the field was absent —
 *  an unknown string is passed through so the STORE names the refusal. */
function roleField(body: Record<string, unknown>): AccountRole | undefined {
  const raw = body["role"];
  return typeof raw === "string" ? (raw as AccountRole) : undefined;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = requireSession(req);
  if ("deny" in gate) return gate.deny;

  const read = await readJsonBody(req);
  if (!read.ok) return read.deny;
  const body = read.body;
  const action = str(body, "action");

  switch (action) {
    case "add-user": {
      const result = await addUser(
        gate.user,
        str(body, "username"),
        str(body, "tempPassword"),
        roleField(body) ?? "member",
      );
      return result.ok
        ? NextResponse.json({ ok: true, user: toPublic(result.account) })
        : refuse(result);
    }

    case "update-user": {
      const role = roleField(body);
      const disabled = bool(body, "disabled");
      if (role === undefined && disabled === null) {
        return fail(400, "update-user needs a role and/or a disabled flag");
      }
      const result = await updateUser(gate.user, str(body, "username"), {
        ...(role !== undefined ? { role } : {}),
        ...(disabled !== null ? { disabled } : {}),
      });
      return result.ok
        ? NextResponse.json({ ok: true, user: toPublic(result.account) })
        : refuse(result);
    }

    case "remove-user": {
      const result = await removeUser(gate.user, str(body, "username"));
      return result.ok
        ? NextResponse.json({ ok: true, removed: toPublic(result.account) })
        : refuse(result);
    }

    case "reset-password": {
      const result = await resetPassword(gate.user, str(body, "username"), str(body, "tempPassword"));
      return result.ok
        ? NextResponse.json({ ok: true, user: toPublic(result.account) })
        : refuse(result);
    }

    default:
      return fail(400, `unknown action "${action}"`);
  }
}
