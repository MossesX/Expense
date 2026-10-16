/**
 * @file Accounts store — studio accounts under the env-driven root
 * (`./paths`), scrypt hashes only, seeded administrator.
 *
 * House store posture (`./fsCore`): degrade never crash (junk file → honest
 * empty + a fresh bootstrap), atomic writes, every mutation in the journal —
 * and journaling can never fail a save. First read of an empty store seeds
 * `admin` / `Administrator` with the password `amberx` hashed and
 * `mustChangePassword: true`: the forced entry flow makes the seed provable
 * live without shipping a usable default credential.
 *
 * Every caller-facing operation only ever touches the account whose username
 * the verified session names. Admin operations additionally require the
 * acting account to be an administrator who has completed the entry flow —
 * re-read from disk per call, never trusted from a token (a 24 h session
 * outlives a demotion; the store must not).
 *
 * Server-only.
 */

import fs from "node:fs";
import path from "node:path";
import { appendJournal, readJsonFile, writeJsonAtomic } from "./fsCore";
import { accountsFile, ensureStoreDirs } from "./paths";
import { DUMMY_HASH, hashPassword, verifyPassword } from "./passwords";
import type { Account, AccountMe, AccountPublic, AccountResult, AccountRole } from "./types";

interface AccountsFile {
  version: 1;
  accounts: Account[];
}

/* --------------------------------- plumbing ---------------------------------- */

const fwd = (p: string): string => p.replace(/\\/g, "/");

/** Ledger path — repo-relative in dev; an env-rooted store logs its absolute
 *  path (still a truthful record of what was touched). */
function ledgerPath(abs: string): string {
  const rel = path.relative(process.cwd(), abs);
  return fwd(rel.startsWith("..") ? abs : rel);
}

async function journal(op: "create" | "edit", summary: string): Promise<void> {
  await appendJournal(op, ledgerPath(accountsFile()), { summary });
}

/** The seeded administrator — hashed at seed time; no plaintext is stored. */
async function seedAdmin(): Promise<Account> {
  const now = new Date().toISOString();
  return {
    username: "admin",
    role: "administrator",
    passwordHash: await hashPassword("amberx"),
    // The seed credential is a temp password by design: first login is forced
    // through change-password, so the known default never survives real use.
    mustChangePassword: true,
    screenname: "Administrator",
    createdAt: now,
    updatedAt: now,
    createdBy: "seed",
  };
}

function readFileRaw(): AccountsFile | null {
  const raw = readJsonFile<AccountsFile>(accountsFile());
  if (raw?.version !== 1 || !Array.isArray(raw.accounts)) return null;
  return raw;
}

/**
 * Read the store, bootstrapping the seed administrator on first boot (or
 * after a mangled file — the degrade path re-seeds rather than locking
 * everyone out, and says so in the ledger).
 */
async function readStore(): Promise<AccountsFile> {
  const existing = readFileRaw();
  if (existing) return existing;
  ensureStoreDirs();
  const wasOnDisk = fs.existsSync(accountsFile());
  const store: AccountsFile = { version: 1, accounts: [await seedAdmin()] };
  await writeStore(store);
  await journal(
    "create",
    wasOnDisk
      ? "accounts: store was unreadable — re-seeded the administrator"
      : "accounts: first boot — seeded the administrator account",
  );
  return store;
}

/** The single write chokepoint — every add/edit/remove/password change lands
 *  here. */
async function writeStore(store: AccountsFile): Promise<void> {
  await writeJsonAtomic(accountsFile(), store);
}

const norm = (u: string): string => u.trim().toLowerCase();

function findIn(store: AccountsFile, username: string): Account | undefined {
  const key = norm(username);
  return store.accounts.find((a) => norm(a.username) === key);
}

/* -------------------------------- validation --------------------------------- */

const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,31}$/;
const SCREENNAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._'-]{2,23}$/;
const MIN_PASSWORD = 6;

export function isValidUsername(v: string): boolean {
  return USERNAME_RE.test(v);
}

export function isValidScreenname(v: string): boolean {
  return SCREENNAME_RE.test(v.trim());
}

/* ---------------------------------- reads ------------------------------------ */

/** Bootstrap + full list (with hashes) — store-internal and admin surfaces. */
export async function listAccounts(): Promise<Account[]> {
  return (await readStore()).accounts;
}

export async function findAccount(username: string): Promise<Account | null> {
  return findIn(await readStore(), username) ?? null;
}

export function toPublic(a: Account): AccountPublic {
  return {
    username: a.username,
    role: a.role,
    screenname: a.screenname,
    createdAt: a.createdAt,
    disabled: a.disabled === true,
  };
}

export function toMe(a: Account): AccountMe {
  return {
    ...toPublic(a),
    mustChangePassword: a.mustChangePassword,
    needsScreenname: !a.mustChangePassword && !a.screenname,
    lastLoginAt: a.lastLoginAt ?? null,
  };
}

/* ---------------------------------- login ------------------------------------ */

/**
 * Verify a typed username + password — the studio's own sign-in, the only
 * credential check in this module. An unknown or disabled username still
 * burns one scrypt (against {@link DUMMY_HASH}) so probing for real accounts
 * costs exactly what a wrong password costs.
 */
export async function verifyLogin(username: string, password: string): Promise<AccountResult> {
  const store = await readStore();
  const account = findIn(store, username);
  const usable = account && account.disabled !== true;
  const good = await verifyPassword(password, usable ? account.passwordHash : DUMMY_HASH);
  if (!usable || !good) {
    // 403, NOT 401 — deliberately, and the reason is not pedantry about verbs.
    // A 401 carries a standing meaning to the BROWSER: "the HTTP credentials
    // you sent were rejected, ask the user again". When anything sits in front
    // of this app that speaks HTTP auth — as Traefik basic auth does on
    // studio.amberxai.com — Chrome cannot tell our 401 from the proxy's, and
    // answers a wrong password by re-showing its own grey credential box. The
    // sign-in screen never gets to say what went wrong, and the user loops
    // between two gates with no error text anywhere (measured 2026-08-16).
    // 403 says "heard you, no", which browsers pass straight through to us.
    return { ok: false, error: "invalid password", status: 403 };
  }
  account.lastLoginAt = new Date().toISOString();
  await writeStore(store);
  return { ok: true, account };
}

/* ------------------------------ the forced flow ------------------------------- */

/**
 * Change the caller's own password — the forced step while a temp password is
 * in force, and the normal self-service change afterwards. Requires the
 * current (temp) password again: possession of a session alone never rewrites
 * a credential.
 */
export async function changePassword(
  sessionUser: string,
  currentPassword: string,
  newPassword: string,
): Promise<AccountResult> {
  if (typeof newPassword !== "string" || newPassword.length < MIN_PASSWORD) {
    return { ok: false, error: `new password must be at least ${MIN_PASSWORD} characters`, status: 400 };
  }
  if (newPassword === currentPassword) {
    return { ok: false, error: "new password must differ from the current one", status: 400 };
  }
  const store = await readStore();
  const account = findIn(store, sessionUser);
  const usable = account && account.disabled !== true;
  const good = await verifyPassword(currentPassword, usable ? account.passwordHash : DUMMY_HASH);
  if (!usable || !good) {
    // 403 for the same reason as `verifyLogin` above — a rejected credential
    // in the BODY is not a missing credential in the HEADER, and only the
    // latter is the browser's business. Doubly so here: this is the forced
    // flow, so a temp-password typo would bounce the member out to a proxy's
    // credential box at the exact moment they are trying to leave it.
    return { ok: false, error: "current password is wrong", status: 403 };
  }
  account.passwordHash = await hashPassword(newPassword);
  account.mustChangePassword = false;
  account.updatedAt = new Date().toISOString();
  await writeStore(store);
  await journal("edit", `accounts: ${account.username} changed their password`);
  return { ok: true, account };
}

/**
 * Choose the caller's screenname — the last gate of first entry. Only after
 * the (temp) password step; unique across accounts, case-insensitively.
 */
export async function setScreenname(sessionUser: string, screenname: string): Promise<AccountResult> {
  const clean = screenname.trim();
  if (!isValidScreenname(clean)) {
    return {
      ok: false,
      error: "screenname must be 3–24 characters: letters, digits, spaces, . _ ' -",
      status: 400,
    };
  }
  const store = await readStore();
  const account = findIn(store, sessionUser);
  if (!account || account.disabled === true) {
    return { ok: false, error: "no account for this session", status: 404 };
  }
  if (account.mustChangePassword) {
    return { ok: false, error: "change the temp password before choosing a screenname", status: 409 };
  }
  const taken = store.accounts.some(
    (a) => norm(a.username) !== norm(account.username) && a.screenname?.toLowerCase() === clean.toLowerCase(),
  );
  if (taken) {
    return { ok: false, error: "that screenname is already taken", status: 409 };
  }
  account.screenname = clean;
  account.updatedAt = new Date().toISOString();
  await writeStore(store);
  await journal("edit", `accounts: ${account.username} chose the screenname "${clean}"`);
  return { ok: true, account };
}

/* ------------------------------- admin operations ----------------------------- */

/** The acting account must be an administrator who has completed entry —
 *  gated against the store the mutation is about to edit. */
function gateAdmin(store: AccountsFile, sessionUser: string): AccountResult {
  const admin = findIn(store, sessionUser);
  if (!admin || admin.disabled === true || admin.role !== "administrator") {
    return { ok: false, error: "administrator access required", status: 403 };
  }
  if (admin.mustChangePassword) {
    return { ok: false, error: "complete your own entry flow first", status: 409 };
  }
  return { ok: true, account: admin };
}

/**
 * Is this session an administrator, RIGHT NOW? Re-reads the store per call —
 * the session token's role claim is advisory only, so a demotion binds on the
 * very next request. Routes outside this file gate on this.
 */
export async function requireAdmin(sessionUser: string): Promise<AccountResult> {
  return gateAdmin(await readStore(), sessionUser);
}

/**
 * Admin adds a user with a temp password — the ONLY way an account is born.
 * The temp password is hashed immediately and marked `mustChangePassword`, so
 * the member's first login is forced through change-then-screenname.
 */
export async function addUser(
  adminSessionUser: string,
  username: string,
  tempPassword: string,
  role: AccountRole = "member",
): Promise<AccountResult> {
  const clean = username.trim();
  if (!isValidUsername(clean)) {
    return { ok: false, error: "username must be 2–32 characters: letters, digits, . _ -", status: 400 };
  }
  if (typeof tempPassword !== "string" || tempPassword.length < MIN_PASSWORD) {
    return { ok: false, error: `temp password must be at least ${MIN_PASSWORD} characters`, status: 400 };
  }
  if (role !== "member" && role !== "administrator") {
    return { ok: false, error: "role must be member or administrator", status: 400 };
  }
  const store = await readStore();
  const gate = gateAdmin(store, adminSessionUser);
  if (!gate.ok) return gate;
  if (findIn(store, clean)) {
    return { ok: false, error: "that username already has an account", status: 409 };
  }
  const now = new Date().toISOString();
  const account: Account = {
    username: clean,
    role,
    passwordHash: await hashPassword(tempPassword),
    mustChangePassword: true,
    screenname: null,
    createdAt: now,
    updatedAt: now,
    createdBy: gate.account.username,
  };
  store.accounts.push(account);
  await writeStore(store);
  await journal(
    "edit",
    `accounts: ${gate.account.username} added ${role} "${clean}" with a temp password`,
  );
  return { ok: true, account };
}

/**
 * **The sponsored door** — an account born from an INVITATION rather than from
 * an administrator (added for `axf-amberxvid-social` P7, 2026-08-15).
 *
 * ## Why this exists rather than opening `addUser`
 *
 * `addUser` says "the ONLY way an account is born" and it stays true in
 * spirit: an account is still born from an authority the store can name and
 * re-read from disk. What changes is WHICH authority. An invite landing is
 * reached by somebody with no session at all, so `addUser`'s admin gate cannot
 * open for it — and the alternative the invite module would otherwise be
 * pushed to (writing `accounts.json` itself, or opening
 * `POST /api/accounts/users` to anonymous callers) is exactly the second
 * identity system the amberxvid P1 phase spent itself abolishing.
 *
 * So the authority is the SPONSOR: a live, enabled account that the caller has
 * proved possession of an unexpired single-use token from. This function does
 * not check the token — it cannot, the token family belongs to the inviting
 * module — but it does re-read the sponsor from disk per call, so an invite
 * from an account that has since been deleted or disabled creates nothing.
 *
 * ## Four differences from `addUser`, each deliberate
 *
 * 1. **Role is always `member`.** No parameter. An invitation cannot mint an
 *    administrator, whoever sent it, so there is no argument to get wrong.
 * 2. **The password is the newcomer's own**, so `mustChangePassword` is
 *    `false`. There is no temp credential in this path to force a change away
 *    from — forcing one would make the newcomer type a password they chose
 *    thirty seconds earlier, then choose another.
 * 3. **`createdBy` names the sponsor**, so the roster shows who let them in.
 * 4. **The journal line says it was an invitation**, and names the sponsor —
 *    which is what makes an invite-sourced account distinguishable in the
 *    audit from an administrator-created one, forever, in the file that owns
 *    the audit.
 *
 * A sponsor who is themselves mid-entry-flow (`mustChangePassword`) is refused
 * exactly as `gateAdmin` refuses one: an account that has not finished being
 * set up cannot vouch for a second account.
 */
export async function createAccountByInvitation(
  sponsor: string,
  username: string,
  password: string,
): Promise<AccountResult> {
  const clean = username.trim();
  if (!isValidUsername(clean)) {
    return { ok: false, error: "username must be 2–32 characters: letters, digits, . _ -", status: 400 };
  }
  if (typeof password !== "string" || password.length < MIN_PASSWORD) {
    return { ok: false, error: `password must be at least ${MIN_PASSWORD} characters`, status: 400 };
  }
  const store = await readStore();
  const host = findIn(store, sponsor);
  if (!host || host.disabled === true) {
    return { ok: false, error: "the account that sent this invitation is gone", status: 404 };
  }
  if (host.mustChangePassword) {
    return { ok: false, error: "the account that sent this invitation has not finished its own setup", status: 409 };
  }
  if (findIn(store, clean)) {
    return { ok: false, error: "that username already has an account", status: 409 };
  }
  const now = new Date().toISOString();
  const account: Account = {
    username: clean,
    role: "member",
    passwordHash: await hashPassword(password),
    mustChangePassword: false,
    screenname: null,
    createdAt: now,
    updatedAt: now,
    createdBy: host.username,
  };
  store.accounts.push(account);
  await writeStore(store);
  await journal(
    "edit",
    `accounts: "${clean}" joined by INVITATION from ${host.username} (sponsored signup, role member)`,
  );
  return { ok: true, account };
}

/**
 * Admin edits another member's account flags — role and/or disabled. The
 * lock-out guard: you can never demote or disable YOURSELF (that would strand
 * the store, since only administrators can undo it) — another administrator
 * has to. Every other combination is allowed, and a no-op patch is a clean
 * success rather than an error.
 */
export async function updateUser(
  adminSessionUser: string,
  username: string,
  patch: { role?: AccountRole; disabled?: boolean },
): Promise<AccountResult> {
  if (patch.role !== undefined && patch.role !== "member" && patch.role !== "administrator") {
    return { ok: false, error: "role must be member or administrator", status: 400 };
  }
  const store = await readStore();
  const gate = gateAdmin(store, adminSessionUser);
  if (!gate.ok) return gate;
  const account = findIn(store, username);
  if (!account) return { ok: false, error: "no such account", status: 404 };
  const self = norm(account.username) === norm(gate.account.username);
  if (self && ((patch.role !== undefined && patch.role !== "administrator") || patch.disabled === true)) {
    return {
      ok: false,
      error: "you cannot demote or disable your own account — another administrator must",
      status: 409,
    };
  }
  const changes: string[] = [];
  if (patch.role !== undefined && patch.role !== account.role) {
    account.role = patch.role;
    changes.push(`role → ${patch.role}`);
  }
  if (patch.disabled !== undefined && patch.disabled !== (account.disabled === true)) {
    account.disabled = patch.disabled;
    changes.push(patch.disabled ? "disabled" : "re-enabled");
  }
  if (changes.length === 0) return { ok: true, account };
  account.updatedAt = new Date().toISOString();
  await writeStore(store);
  await journal(
    "edit",
    `accounts: ${gate.account.username} updated "${account.username}" (${changes.join(", ")})`,
  );
  return { ok: true, account };
}

/**
 * Admin removes an account outright — the row only; the member's stored data
 * (profile, threads, grants) is cascaded by the admin surface that calls
 * this. Self-removal refuses for the same lock-out reason as
 * {@link updateUser}.
 */
export async function removeUser(adminSessionUser: string, username: string): Promise<AccountResult> {
  const store = await readStore();
  const gate = gateAdmin(store, adminSessionUser);
  if (!gate.ok) return gate;
  const account = findIn(store, username);
  if (!account) return { ok: false, error: "no such account", status: 404 };
  if (norm(account.username) === norm(gate.account.username)) {
    return {
      ok: false,
      error: "you cannot remove your own account — another administrator must",
      status: 409,
    };
  }
  store.accounts = store.accounts.filter((a) => norm(a.username) !== norm(account.username));
  await writeStore(store);
  await journal("edit", `accounts: ${gate.account.username} removed the account "${account.username}"`);
  return { ok: true, account };
}

/** Admin re-issues a temp password — same forced-change flow as a fresh add. */
export async function resetPassword(
  adminSessionUser: string,
  username: string,
  tempPassword: string,
): Promise<AccountResult> {
  if (typeof tempPassword !== "string" || tempPassword.length < MIN_PASSWORD) {
    return { ok: false, error: `temp password must be at least ${MIN_PASSWORD} characters`, status: 400 };
  }
  const store = await readStore();
  const gate = gateAdmin(store, adminSessionUser);
  if (!gate.ok) return gate;
  const account = findIn(store, username);
  if (!account) {
    return { ok: false, error: "no such account", status: 404 };
  }
  account.passwordHash = await hashPassword(tempPassword);
  account.mustChangePassword = true;
  // A migrated account had no password at all; issuing one is exactly the act
  // that resolves the flag, so it is cleared HERE rather than left for the
  // member's next sign-in to tidy up.
  delete account.forcePasswordReset;
  account.updatedAt = new Date().toISOString();
  await writeStore(store);
  await journal(
    "edit",
    `accounts: ${gate.account.username} issued a temp password for "${account.username}"`,
  );
  return { ok: true, account };
}

/**
 * How many accounts are waiting on an administrator to issue their first
 * password — migrated members, in practice.
 *
 * A COUNT, deliberately, not a list and not a per-username lookup: the login
 * card shows this so a migrated member understands why their password does not
 * work, and a per-username answer on an unauthenticated screen would be an
 * account-enumeration oracle. One number tells the person what they need and
 * tells an attacker nothing about any particular name.
 */
export async function countForcedResets(): Promise<number> {
  return (await listAccounts()).filter((a) => a.forcePasswordReset === true).length;
}
