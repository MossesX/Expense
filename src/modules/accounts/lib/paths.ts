/**
 * @file Accounts store layout — every path under ONE env-driven root.
 *
 * Dev root: `data/accounts/` in the studio package. Set `ACCOUNTS_DATA_DIR`
 * to rehome the whole store (tests point it at a temp dir; a deployment
 * points it at mounted storage). The env var is read per call, never latched
 * at import, so tests and a deploy env both take effect without ordering
 * games.
 *
 * ```
 * <root>/
 *   accounts.json          studio accounts (scrypt hashes only)
 *   permissions.json       per-username permission grants
 *   relations.json         the social graph — buddies, requests, blocks
 *   profiles/<user>.json   profile engine documents
 *   messages/<pair>.json   messenger threads (offline queue included)
 *   states/<user>/<slug>.json  named appearance states (`./states`)
 *   credits/<user>.json    the append-only AI credit ledger (`./credits`)
 *   storage/<user>.json    the cached storage usage index (`./storage`)
 *   policy/_site.json      the SITE policy posture   (`./policy`)
 *   policy/<user>.json     that member's overrides   (`./policy`)
 *   locks/<name>.lock      cross-process store locks (`./fsCore`)
 *   journal.json           the module's file ledger  (`./fsCore`)
 *   audit.log              the administrative audit trail, NDJSON (`./audit`)
 *   audit.1.log            its single previous generation
 *   .auth-secret           machine secret the session key derives from
 * ```
 *
 * Server-only (node imports) — client code never touches these.
 */

import fs from "node:fs";
import path from "node:path";

import { dataRoot as persistedRoot } from "@axs/server/dataRoot";

/**
 * The store root — `ACCOUNTS_DATA_DIR` env override, else `accounts/` under the
 * install's one persisted directory.
 *
 * Two tiers on purpose, and the order matters: `ACCOUNTS_DATA_DIR` moves THIS
 * store (what the tests and the proof servers do), `AXS_DATA_ROOT` moves the
 * whole install (what a deployment does, once, for every store at once — see
 * `src/server/dataRoot.ts` and §2.2). The default is unchanged: with neither set
 * this is still `<cwd>/data/accounts`.
 */
export function dataRoot(): string {
  const env = process.env.ACCOUNTS_DATA_DIR?.trim();
  return env ? path.resolve(env) : path.join(persistedRoot(), "accounts");
}

export const accountsFile = (): string => path.join(dataRoot(), "accounts.json");
export const permissionsFile = (): string => path.join(dataRoot(), "permissions.json");
/** The whole social graph in ONE document — a buddy edge is mutual, so the
 *  pair's two records must move in a single atomic write (`./relations`). */
export const relationsFile = (): string => path.join(dataRoot(), "relations.json");
export const profilesDir = (): string => path.join(dataRoot(), "profiles");
export const messagesDir = (): string => path.join(dataRoot(), "messages");
export const statesDir = (): string => path.join(dataRoot(), "states");
/** One append-only credit ledger per user — see `./credits` for why a document
 *  per member rather than one platform-wide file: a fold is O(that member's
 *  history), and two members spending at once contend on nothing. */
export const creditsDir = (): string => path.join(dataRoot(), "credits");
export const creditsFile = (username: string): string =>
  path.join(creditsDir(), `${username.trim().toLowerCase()}.json`);
/** The cached storage usage index, one document per user (`./storage`). Its own
 *  directory for the same reason `credits/` is one: the index is rebuilt per
 *  user and two users being rescanned at once must contend on nothing. It is
 *  DERIVED data — deleting the whole directory costs a rescan, never a fact. */
export const storageDir = (): string => path.join(dataRoot(), "storage");
export const storageIndexFile = (username: string): string =>
  path.join(storageDir(), `${username.trim().toLowerCase()}.json`);
/**
 * The policy cascade's override documents, one per subject (`./policy`).
 *
 * A directory rather than one map file for the reason `credits/` and `storage/`
 * are directories: a write touches ONE subject, so two administrators editing
 * two members contend on nothing, and a corrupt document costs one member's
 * overrides instead of the whole site's posture.
 */
export const policyDir = (): string => path.join(dataRoot(), "policy");

/**
 * The SITE tier's document. `_site` is a deliberately IMPOSSIBLE username —
 * `USERNAME_RE` in `./accounts` requires a leading letter or digit — so the
 * site posture can share the directory with the per-user documents without a
 * member ever being able to claim the name and overwrite it.
 */
export const SITE_POLICY_SUBJECT = "_site";

export const policyFile = (subject: string): string =>
  path.join(policyDir(), `${subject.trim().toLowerCase()}.json`);

/** Cross-process lock files (`withStoreLock` in `./fsCore`). Its own directory
 *  so a lock can never be mistaken for a store document by a reader walking the
 *  root, and so the whole set can be cleared without touching data. */
export const locksDir = (): string => path.join(dataRoot(), "locks");
export const journalFile = (): string => path.join(dataRoot(), "journal.json");

/**
 * **The administrative audit trail** (`./audit`) — NDJSON, one record per line,
 * appended.
 *
 * A `.log` rather than a `.json` document, and that is the whole design: an
 * administrator listing a directory writes an audit record BEFORE the listing
 * goes out, so the write is on the hot path of every read. A JSON array would
 * mean re-reading and re-writing the entire trail per listing; an append is one
 * syscall whatever the trail has grown to.
 *
 * {@link auditRotatedFile} is the single previous generation, so the queryable
 * window survives a rotation instead of starting empty the moment the log
 * fills.
 */
export const auditLogFile = (): string => path.join(dataRoot(), "audit.log");
export const auditRotatedFile = (): string => path.join(dataRoot(), "audit.1.log");

/** Scaffold the whole layout (idempotent). */
export function ensureStoreDirs(): void {
  for (const dir of [dataRoot(), profilesDir(), messagesDir(), creditsDir()]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
