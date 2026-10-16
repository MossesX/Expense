/**
 * @file Accounts admin composition — the store-side half of the admin control
 * surface: the overview snapshot the P2 admin route serves, and the
 * remove-user data cascade that follows a successful account removal.
 *
 * Composition only: account mutation lives in `./accounts`
 * (`updateUser`/`removeUser`, with the lock-out guards), grant flips in
 * `./permissions`, thread deletion and pruning in `./messages`. The cascade
 * here is deliberately NOT part of `removeUser` itself — the accounts store
 * cannot import the other stores without a cycle, and a best-effort cleanup
 * must never be able to fail the account removal.
 *
 * `adminOverview()` gates nothing itself — the route in front of it holds the
 * `requireAdmin` check, exactly like the reference. Server-only.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { appendJournal } from "./fsCore";
import { recordAudit } from "./audit";
import { listAccounts } from "./accounts";
import { adminListThreads } from "./messages";
import { readGrants, writeGrants } from "./permissions";
import { evictPresence, presenceSnapshot } from "./presence";
import { forgetRelations } from "./relations";
import { profilesDir } from "./paths";
import type { Account, AdminAccountRow, AdminOverview } from "./types";

/* --------------------------------- overview ----------------------------------- */

function toAdminRow(a: Account): AdminAccountRow {
  return {
    username: a.username,
    role: a.role,
    screenname: a.screenname,
    createdAt: a.createdAt,
    disabled: a.disabled === true,
    mustChangePassword: a.mustChangePassword,
    createdBy: a.createdBy,
    lastLoginAt: a.lastLoginAt ?? null,
    updatedAt: a.updatedAt,
  };
}

/** Everything the admin control surface shows, in one snapshot. */
export async function adminOverview(): Promise<AdminOverview> {
  const accounts = await listAccounts();
  const [presence, threads] = await Promise.all([presenceSnapshot(), adminListThreads()]);
  return {
    accounts: accounts.map(toAdminRow),
    grants: readGrants(),
    threads,
    presence,
    generatedAt: new Date().toISOString(),
  };
}

/* ------------------------------ remove-user cascade ---------------------------- */

const fwd = (p: string): string => p.replace(/\\/g, "/");

function ledgerPath(abs: string): string {
  const rel = path.relative(process.cwd(), abs);
  return fwd(rel.startsWith("..") ? abs : rel);
}

/* --------------------------------- the audit ----------------------------------- */

/**
 * One administrative field change, in the shape every audit surface needs:
 * **who** did it, **to whom**, **which field**, and **old → new**.
 *
 * The four together are what makes an entry answerable. A line saying "policy
 * changed" is a line that generates a question rather than settling one, and
 * the old value is the half that gets left out — it is the only thing that
 * says whether an administrator raised a quota or discovered somebody had
 * already lowered it.
 */
export interface AdminFieldChange {
  /** The administrator who made the change. */
  actor: string;
  /** Whose setting moved — a username, or a pseudo-subject like the site tier. */
  subject: string;
  /** The catalog key / column that moved. */
  field: string;
  /** What it was. `undefined` means the field was ABSENT (following a default),
   *  which is a different statement from having held a value — see the
   *  absent-vs-pinned note in `./policy`. */
  from?: unknown;
  /** What it became; `undefined` means it was un-pinned back to following. */
  to?: unknown;
  /** The document the change landed in, absolute — the ledger path is derived
   *  from it so a reader can go and look. */
  file: string;
}

/** How a value reads in the ledger. `undefined` is the absent case and must
 *  not render as the string "undefined" — that would be indistinguishable from
 *  a field genuinely holding that text. */
function shown(v: unknown): string {
  if (v === undefined) return "(following the default)";
  if (typeof v === "string") return v === "" ? '""' : v;
  return JSON.stringify(v) ?? String(v);
}

/**
 * **THE audit chokepoint for administrative field changes.**
 *
 * It lives here rather than in the store that happens to need it first for the
 * reason `withStoreLock` lives in `./fsCore`: the next store that has to record
 * an admin change must FIND this, not discover that policy grew a private
 * audit format nothing else matches. `./policy` routes every one of its writes
 * through it, which is what makes "no policy write is unaudited" a property of
 * one function instead of a rule each call site has to remember.
 *
 * Inherits `appendJournal`'s posture wholesale — it swallows every fault, so an
 * audit failure can never fail the write it was recording. That is the right
 * trade for this module (a lost audit line is bad; a member locked out of their
 * own settings because the journal file is held open is worse) and it is the
 * posture the whole store already has.
 *
 * ## Two records, one call, and why they are not the same record
 *
 * It writes the journal SENTENCE it always wrote, and now also a structured
 * record through `./audit`. The two answer different questions and neither can
 * be derived from the other: the journal answers "what happened to this
 * document" and is read as prose by the activity surfaces; the audit trail
 * answers "show me everything `admin` did to `dana` last Tuesday" and needs its
 * fields kept apart to do it. Both are written HERE, at the one chokepoint, so
 * "no policy write is unaudited" stays a property of a single function.
 *
 * The structured outcome is deliberately ignored: this records a write that has
 * ALREADY landed on disk. Where the record is a PRECONDITION rather than a
 * receipt — an administrator about to read a member's file — the caller checks
 * `recordAudit`'s outcome and refuses. See `./audit`'s header.
 */
export async function auditFieldChange(change: AdminFieldChange): Promise<void> {
  await appendJournal("edit", ledgerPath(change.file), {
    summary:
      `accounts: ${change.actor} set ${change.field} for "${change.subject}" — ` +
      `${shown(change.from)} → ${shown(change.to)}`,
  });
  await recordAudit({
    actor: change.actor,
    subject: change.subject,
    // Un-pinning is its own verb rather than a set-to-nothing: "went back to
    // following the default" and "was pinned to the default's current value"
    // are the distinction `./policy` is built around, and an audit trail that
    // spelled both as `policy-set` would lose it at exactly the moment somebody
    // is trying to work out which one happened.
    verb: change.to === undefined ? "policy-clear" : "policy-set",
    field: change.field,
    from: shown(change.from),
    to: shown(change.to),
  });
}

/**
 * Best-effort cleanup of a removed member's stored data — their profile
 * (which carries the last-seen stamp), their grants record, and any live
 * presence connections. Threads are deliberately NOT touched: a conversation
 * belongs to BOTH participants, so the survivor keeps their history — the
 * admin surface wipes them explicitly (`deleteUserThreads`) when that is
 * really wanted. Returns what was actually removed; failures skip silently —
 * the account row is already gone, and an orphaned file can never resurrect
 * it.
 */
export async function removeUserData(actor: string, username: string): Promise<string[]> {
  const u = username.trim().toLowerCase();
  const removed: string[] = [];

  const profile = path.join(profilesDir(), `${u}.json`);
  try {
    if (fs.existsSync(profile)) {
      await fsp.rm(profile, { force: true });
      removed.push("profile");
    }
  } catch {
    /* best-effort — never fail the removal over a stuck file */
  }

  try {
    const grants = readGrants();
    if (grants[u]) {
      delete grants[u];
      await writeGrants(grants);
      removed.push("permission grants");
    }
  } catch {
    /* best-effort */
  }

  try {
    if (evictPresence(u)) removed.push("live presence");
  } catch {
    /* best-effort */
  }

  // Relations are cleaned up rather than left dangling, and this one is not
  // cosmetic: usernames are re-usable, so a graph that remembered the removed
  // member would hand a NEW account with the same name the old one's buddies
  // — and the old one's blocks, silently refusing people they never met.
  try {
    const edges = await forgetRelations(u);
    if (edges > 0) removed.push("social relations");
  } catch {
    /* best-effort */
  }

  if (removed.length > 0) {
    await appendJournal("delete", ledgerPath(profile), {
      summary: `accounts: admin ${actor} removed "${username}" and their ${removed.join(", ")}`,
    });
  }
  return removed;
}
