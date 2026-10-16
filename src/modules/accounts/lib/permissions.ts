/**
 * @file Accounts permission engine — the administrator-controlled grants in
 * `permissions.json`, and the flat verdict BootedHost and the routes consult.
 *
 * The model (decided at plan time): per-username grants
 * `{ modules: { [moduleId]: boolean }, capabilities: { canMessage, canEditProfile } }`.
 * An ABSENT key means allowed — default-allow, so a single-operator studio
 * stays fully open until an administrator says otherwise — and administrators
 * always pass every check regardless of what the file says.
 *
 * NOTHING here is cached: `effectivePermissions()` re-reads the account role
 * and the grants file per call, so a revocation (or a demotion) binds on the
 * very next read — a session token's role claim is advisory only.
 *
 * House store posture (`./fsCore`): degrade never crash (a junk grants file
 * reads as "no grants recorded", i.e. everything allowed — the same verdict a
 * fresh studio gives), atomic writes, every mutation journaled. Server-only.
 */

import path from "node:path";
import { appendJournal, readJsonFile, writeJsonAtomic } from "./fsCore";
import { findAccount, requireAdmin } from "./accounts";
import { permissionsFile } from "./paths";
import type { EffectivePermissions, PermissionGrants } from "./types";

export type PermissionResult =
  | { ok: true; username: string; grants: PermissionGrants }
  | { ok: false; error: string; status: number };

const fail = (status: number, error: string): PermissionResult => ({ ok: false, error, status });

/* --------------------------------- plumbing ----------------------------------- */

const fwd = (p: string): string => p.replace(/\\/g, "/");

function ledgerPath(abs: string): string {
  const rel = path.relative(process.cwd(), abs);
  return fwd(rel.startsWith("..") ? abs : rel);
}

async function journal(summary: string): Promise<void> {
  await appendJournal("edit", ledgerPath(permissionsFile()), { summary });
}

const norm = (u: string): string => u.trim().toLowerCase();

/* ----------------------------------- store ------------------------------------- */

interface PermissionsFile {
  version: 1;
  /** username (lowercased) → grants. Sparse on purpose: absent = default. */
  grants: Record<string, PermissionGrants>;
}

/** The default-allow record an unlisted username resolves to. */
export function defaultGrants(): PermissionGrants {
  return { modules: {}, capabilities: { canMessage: true, canEditProfile: true } };
}

/** Coerce whatever is on disk into a well-formed grants record. */
function normalizeGrants(raw: unknown): PermissionGrants {
  const base = defaultGrants();
  if (typeof raw !== "object" || raw === null) return base;
  const r = raw as Record<string, unknown>;
  const modules: Record<string, boolean> = {};
  if (typeof r.modules === "object" && r.modules !== null) {
    for (const [id, v] of Object.entries(r.modules as Record<string, unknown>)) {
      if (typeof v === "boolean") modules[id] = v;
    }
  }
  const caps = (typeof r.capabilities === "object" && r.capabilities !== null
    ? r.capabilities
    : {}) as Record<string, unknown>;
  return {
    modules,
    capabilities: {
      canMessage: typeof caps.canMessage === "boolean" ? caps.canMessage : base.capabilities.canMessage,
      canEditProfile:
        typeof caps.canEditProfile === "boolean" ? caps.canEditProfile : base.capabilities.canEditProfile,
    },
  };
}

/** The whole grants map — junk or absent file reads as "nothing recorded". */
export function readGrants(): Record<string, PermissionGrants> {
  const raw = readJsonFile<PermissionsFile>(permissionsFile());
  if (raw?.version !== 1 || typeof raw.grants !== "object" || raw.grants === null) return {};
  const out: Record<string, PermissionGrants> = {};
  for (const [user, grants] of Object.entries(raw.grants)) {
    out[norm(user)] = normalizeGrants(grants);
  }
  return out;
}

/** The single write chokepoint for `permissions.json`. */
export async function writeGrants(grants: Record<string, PermissionGrants>): Promise<void> {
  const doc: PermissionsFile = { version: 1, grants };
  await writeJsonAtomic(permissionsFile(), doc);
}

/** One username's stored grants (never null — absent resolves to defaults). */
export function grantsFor(username: string): PermissionGrants {
  return readGrants()[norm(username)] ?? defaultGrants();
}

/* --------------------------------- mutation ------------------------------------ */

const MODULE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Shared gate for both setters: acting admin + existing target account. */
async function gateMutation(actor: string, username: string): Promise<PermissionResult> {
  const gate = await requireAdmin(actor);
  if (!gate.ok) return fail(gate.status, gate.error);
  const target = await findAccount(username);
  if (!target) return fail(404, "no such account");
  return { ok: true, username: target.username, grants: grantsFor(target.username) };
}

/**
 * Admin allows or revokes one module for one user. Allowing DELETES the key
 * rather than storing `true` — absent-means-allowed is the contract, and a
 * sparse file keeps "what has an administrator actually decided" readable.
 */
export async function setModuleGrant(
  actor: string,
  username: string,
  moduleId: string,
  allowed: boolean,
): Promise<PermissionResult> {
  const id = moduleId.trim();
  if (!MODULE_ID_RE.test(id)) return fail(400, "that is not a module id");
  const gate = await gateMutation(actor, username);
  if (!gate.ok) return gate;
  const all = readGrants();
  const key = norm(gate.username);
  const grants = all[key] ?? defaultGrants();
  if (allowed) delete grants.modules[id];
  else grants.modules[id] = false;
  all[key] = grants;
  await writeGrants(all);
  await journal(
    `accounts: ${actor} ${allowed ? "allowed" : "revoked"} the module "${id}" for "${gate.username}"`,
  );
  return { ok: true, username: gate.username, grants };
}

/**
 * **Self-serve join** — a signed-in user asks for one module themselves. Not
 * an admin operation, and the only mutation in this file that is not.
 *
 * Three things make it safe to expose:
 *
 * 1. **It cannot overturn an administrator.** An explicit `false` is a
 *    decision; this refuses with 403 rather than deleting it. That is the
 *    privilege-escalation hole the obvious implementation has, and the whole
 *    reason this is a separate function instead of `setModuleGrant(self, …)`.
 * 2. **It only ever writes the CALLER's own row.** There is no `username`
 *    parameter to get wrong.
 * 3. **It records the join explicitly** — `modules[id] = true`, the first
 *    positive value this file stores. Absent-means-allowed stays the default
 *    for everyone who never asked, so the admin matrix can still read the
 *    file as "what has anybody actually decided": a `true` now means "this
 *    member joined", where absent means "nobody decided" and `false` means
 *    "an administrator said no". `effectivePermissions` filters on `=== false`
 *    and `normalizeGrants` accepts either boolean, so no existing consumer
 *    changes behaviour.
 *
 * Whether a module is open to self-serve joining is the MODULE's policy, not
 * the matrix's — the caller decides that before calling (amberxvid's is
 * `AMBERXVID_OPEN_MEMBERSHIP`). This function's job is only to make the join a
 * grant the admin suite sees and can revoke like any other.
 *
 * `source` (added for `axf-amberxvid-social` P7, 2026-08-15) names WHAT
 * authorised the join, in the journal only — e.g. `an invitation from brett`.
 * It changes no verdict and no stored value; the point is that the audit can
 * afterwards tell an invite-sourced membership from somebody who found the
 * join button, which the grant record itself (a bare `true`) cannot express.
 * Absent, the line reads exactly as it always did.
 */
export async function requestModuleGrant(
  selfUser: string,
  moduleId: string,
  source?: string,
): Promise<PermissionResult> {
  const id = moduleId.trim();
  if (!MODULE_ID_RE.test(id)) return fail(400, "that is not a module id");
  const account = await findAccount(selfUser);
  if (!account) return fail(404, "no such account");
  if (account.disabled === true) return fail(403, "this account is disabled");

  const all = readGrants();
  const key = norm(account.username);
  const grants = all[key] ?? defaultGrants();
  if (grants.modules[id] === false) {
    return fail(403, `an administrator has revoked "${id}" for this account`);
  }
  if (grants.modules[id] === true) return { ok: true, username: account.username, grants };

  grants.modules[id] = true;
  all[key] = grants;
  await writeGrants(all);
  const why = source?.trim();
  await journal(
    `accounts: "${account.username}" joined the module "${id}" (${why ? why : "self-serve"})`,
  );
  return { ok: true, username: account.username, grants };
}

/** Admin flips one capability for one user (messaging / profile editing). */
export async function setCapability(
  actor: string,
  username: string,
  cap: keyof PermissionGrants["capabilities"],
  allowed: boolean,
): Promise<PermissionResult> {
  if (cap !== "canMessage" && cap !== "canEditProfile") {
    return fail(400, "unknown capability");
  }
  const gate = await gateMutation(actor, username);
  if (!gate.ok) return gate;
  const all = readGrants();
  const key = norm(gate.username);
  const grants = all[key] ?? defaultGrants();
  grants.capabilities[cap] = allowed;
  all[key] = grants;
  await writeGrants(all);
  await journal(
    `accounts: ${actor} ${allowed ? "granted" : "revoked"} ${cap} for "${gate.username}"`,
  );
  return { ok: true, username: gate.username, grants };
}

/* --------------------------------- the verdict ---------------------------------- */

/**
 * Resolve role + grants into the flat verdict consumers hold. Administrators
 * get everything; everyone else default-allows with the explicit revocations
 * listed. Re-reads both stores per call — nothing is cached, which is exactly
 * why a revocation binds on the next read.
 */
export async function effectivePermissions(username: string): Promise<EffectivePermissions> {
  const account = await findAccount(username);
  const administrator = !!account && account.disabled !== true && account.role === "administrator";
  const grants = grantsFor(username);
  return {
    username: account?.username ?? username.trim(),
    role: account?.role ?? "member",
    administrator,
    deniedModules: administrator
      ? []
      : Object.entries(grants.modules)
          .filter(([, allowed]) => allowed === false)
          .map(([id]) => id)
          .sort(),
    canMessage: administrator || grants.capabilities.canMessage !== false,
    canEditProfile: administrator || grants.capabilities.canEditProfile !== false,
  };
}
