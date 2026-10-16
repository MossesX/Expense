/**
 * @file Per-user storage accounting — how many bytes a member actually
 * occupies, across every per-user data root this install has.
 *
 * ## The accounting contract (read this before adding a caller)
 *
 * Two operations, and they are deliberately unequal:
 *
 * - **{@link charge} is ADVISORY and FAST.** A write path that already knows
 *   its own delta (it just wrote a 40 KB document over a 12 KB one) hands that
 *   delta over and the index moves by it. No walk, no stat, no directory read.
 *   It is advisory because it can be wrong: a crash between the write and the
 *   charge, a delete nobody charged, a file written by a tool outside this
 *   process. Drift is not a bug to be designed out — it is the price of not
 *   walking a filesystem on every save, and it is paid back by the reconciler.
 * - **{@link rescan} is AUTHORITATIVE and SLOW.** It walks the registered roots
 *   and rebuilds the index from what is on disk. Its answer replaces whatever
 *   the charges had accumulated to; it is the truth-maker, and the only reason
 *   charge is allowed to be sloppy.
 *
 * **A consumer that cannot know its delta calls NEITHER.** Not `rescan` — a
 * write path that rescans has made every save O(the user's whole footprint),
 * which is the exact cost this file exists to avoid — and not a guessed
 * `charge`, because a wrong number that looks measured is worse than no number
 * at all. It writes its bytes and relies on the next rescan. That is the whole
 * rule, and it is why {@link charge} refuses to invent an index it has never
 * measured (see {@link ChargeOutcome}).
 *
 * ## "How much does this user use" is a READ
 *
 * {@link readUsage} opens one JSON document. It never walks. Every surface that
 * shows a number — the admin table, a quota check on the hot path, a member's
 * own profile — goes through it. If the index is absent the honest answer is
 * `null`, never a walk smuggled in behind a getter.
 *
 * ## Policy-blind, on purpose
 *
 * This file knows how many bytes exist and nothing about how many are allowed.
 * {@link checkQuota} takes the limit as a PARAMETER; the per-user policy
 * cascade that decides that limit is P2's, and it will import this, not the
 * other way round. Nothing here reads a policy document, and nothing here
 * should ever start to.
 *
 * ## Not journaled, deliberately
 *
 * The index is derived data — rebuildable from the filesystem at any moment, at
 * the cost of a rescan and no facts. Journaling metering writes would spend the
 * journal's 2000-entry cap (`./fsCore`) on bookkeeping, and that cap belongs to
 * the real mutations an audit surface has to be able to show.
 *
 * Server-only (node imports) — imported by lib files and API routes only.
 */

import type { Dirent } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { KV_ROOT } from "@axs/server/axfKv";
import { claudeConversationsUserDir, claudeProjectsUserDir } from "@axs/server/claudePaths";
import { expensesUserDir } from "@axs/server/expensesPaths";
import { TASKMAN_ARCHIVE_ROOT } from "@axs/server/taskmanArchive";

import { readJsonFile, withStoreLock, writeJsonAtomic } from "./fsCore";
import {
  creditsDir,
  messagesDir,
  profilesDir,
  statesDir,
  storageIndexFile,
} from "./paths";

/* ------------------------------- the registry --------------------------------- */

/**
 * One place bytes accumulate for one user.
 *
 * `resolve` answers an ABSOLUTE directory, or `null` when the username cannot
 * be a path segment — same belt-and-braces posture as `FACTORY_RESET_SUBTREES`
 * in `./states`, whose resolvers these deliberately are where they overlap. A
 * root that resolves to a shared directory (profiles, credits, messages — flat
 * directories holding every user's documents side by side) narrows itself with
 * {@link UserDataRoot.owns}; without one, the whole subtree is the user's.
 */
export interface UserDataRoot {
  /** Stable id — it is the key of the per-root breakdown and of `charge`. */
  readonly id: string;
  /** Human label for the admin's breakdown; the only string a surface renders. */
  readonly title: string;
  /** The absolute directory holding this root's bytes for `username`. */
  resolve(username: string): string | null;
  /**
   * Which entries of a SHARED directory belong to `username`. Absent means the
   * whole resolved subtree does. `absPath` is passed so a root whose ownership
   * is inside the file (a group conversation's member list) can look, rather
   * than being forced to encode ownership in a filename.
   */
  owns?: (fileName: string, username: string, absPath: string) => boolean | Promise<boolean>;
  /**
   * These bytes are counted for OTHER users too. See the note on messages
   * below — a shared root's bytes are reported separately and never summed
   * into a site total, because summing them would count one file N times.
   */
  readonly shared?: boolean;
}

const USER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,31}$/;

/** The username's own subdirectory of a root that keeps one per user. */
const subdirOf =
  (root: () => string) =>
  (username: string): string | null =>
    USER_RE.test(username) ? path.join(root(), username) : null;

/** `<user>.json` in a flat, shared directory. */
const docNamed = (fileName: string, username: string): boolean =>
  fileName.toLowerCase() === `${username.trim().toLowerCase()}.json`;

/**
 * Does a thread document list `username` among its participants?
 *
 * A DM's id is the sorted pair joined by `--`, so its filename would have been
 * enough; a GROUP thread's is not, and its members live inside the document.
 * Answering both from the file rather than from the name is what stops group
 * conversations becoming a silent hole in every member's number.
 */
async function threadHasMember(
  fileName: string,
  username: string,
  absPath: string
): Promise<boolean> {
  if (!fileName.endsWith(".json")) return false;
  const want = username.trim().toLowerCase();
  const doc = readJsonFile<{ participants?: unknown }>(absPath);
  const participants = Array.isArray(doc?.participants) ? doc.participants : [];
  return participants.some((p) => typeof p === "string" && p.toLowerCase() === want);
}

/**
 * Every per-user data root on this install, keyed by id.
 *
 * **Data only, and it imports no module.** The entries below are seeded from
 * the P0 inventory's walk of what is actually on disk; anything a later module
 * adds arrives through {@link registerUserDataRoot}, which is a plain write
 * into this map. That direction is the whole point: this file must never grow
 * an `import` of amberxvid (or of anything else that owns storage), or the
 * accounts module cannot be peeled without dragging half the studio with it.
 *
 * ### What is deliberately NOT here
 *
 * - `accounts.json`, `permissions.json`, `relations.json`, `journal.json` —
 *   one shared document each, keyed BY user but not one user's bytes. A row in
 *   a map is an attribute, not storage.
 * - `locks/` and `.auth-secret` — machine state; counting them would charge a
 *   member for the install's plumbing.
 * - `avatars/` — **there is no such directory.** An avatar is a `data:` URL
 *   inside `profiles/<user>.json` (capped by `AVATAR_IMAGE_MAX` in
 *   `./profiles`), so its bytes are the profile document's bytes and are
 *   already counted by the `profiles` root. A large avatar is exactly why a
 *   profile document is large.
 * - `data/amberxvid/*` — platform stores, not per-user. Its vaults ARE per-user
 *   and will register themselves here when that work runs.
 *
 * ### The messages decision, stated as the inventory demanded
 *
 * A thread belongs to N members and its bytes cannot be split without lying
 * about one of them. The choice here is **attribute the whole thread to every
 * participant, and mark the root `shared`** — the same attribution
 * `AdminPane`'s `statsFor` already makes, except that here it is declared. So:
 * a member's shared bytes answer "what would I be freeing if this conversation
 * vanished", the site total never adds them up, and the double-count is a
 * visible field rather than a discrepancy somebody rediscovers later.
 */
const ROOTS = new Map<string, UserDataRoot>();

/** Register a per-user data root. Idempotent by id; a re-registration REPLACES,
 *  so a module reloaded by HMR does not end up counted twice. */
export function registerUserDataRoot(root: UserDataRoot): void {
  ROOTS.set(root.id, root);
}

/** The registry, read-only, in registration order. */
export const USER_DATA_ROOTS = {
  /** Every registered root. */
  all: (): UserDataRoot[] => [...ROOTS.values()],
  /** One root by id, or undefined — `charge` uses this to refuse an unknown id. */
  get: (id: string): UserDataRoot | undefined => ROOTS.get(id),
  /** Ids only, for a caller that just wants to name them. */
  ids: (): string[] => [...ROOTS.keys()],
} as const;

for (const root of [
  {
    id: "kv",
    title: "Settings & preferences",
    // `data/axf/kv/<user>/*.json` — every module's settings document, the
    // namespace from its decl. Resolved from KV_ROOT itself so this and the
    // store cannot drift.
    resolve: subdirOf(() => KV_ROOT),
  },
  {
    id: "profile",
    title: "Profile",
    resolve: () => profilesDir(),
    owns: docNamed,
  },
  {
    id: "states",
    title: "Saved appearance states",
    resolve: subdirOf(statesDir),
  },
  {
    id: "credits",
    title: "AI credit ledger",
    resolve: () => creditsDir(),
    owns: docNamed,
  },
  {
    id: "messages",
    title: "Conversations",
    resolve: () => messagesDir(),
    owns: threadHasMember,
    shared: true,
  },
  {
    id: "expenses",
    title: "Expense vault",
    resolve: expensesUserDir,
  },
  {
    id: "claude-conversations",
    title: "Claude conversations",
    resolve: claudeConversationsUserDir,
  },
  {
    id: "claude-projects",
    title: "Claude projects",
    resolve: claudeProjectsUserDir,
  },
  {
    id: "taskman-archive",
    title: "Task Manager archive",
    resolve: subdirOf(() => TASKMAN_ARCHIVE_ROOT),
  },
] satisfies UserDataRoot[]) {
  registerUserDataRoot(root);
}

/* --------------------------------- the index ---------------------------------- */

/** One root's contribution to a user's footprint. */
export interface RootUsage {
  rootId: string;
  bytes: number;
  files: number;
}

/** The cached answer to "how much does this user use". */
export interface UserStorageIndex {
  version: 1;
  user: string;
  /** OWNED bytes — shared roots excluded, so site totals may sum these. */
  totalBytes: number;
  /** Bytes attributed to this user but also to others (see the messages note). */
  sharedBytes: number;
  /** Per-root breakdown, registration order, including zeroed roots so a
   *  surface can render a stable set of rows rather than a shifting one. */
  roots: RootUsage[];
  /** Last change of any kind — a charge or a rescan. ISO 8601. */
  updatedAt: string;
  /** Last AUTHORITATIVE rebuild. The distance from `updatedAt` is exactly how
   *  much unreconciled advisory drift the number could be carrying. */
  scannedAt: string;
}

const nowIso = (): string => new Date().toISOString();

const emptyIndex = (user: string): UserStorageIndex => ({
  version: 1,
  user,
  totalBytes: 0,
  sharedBytes: 0,
  roots: [],
  updatedAt: nowIso(),
  scannedAt: nowIso(),
});

/** A parsed index, or null — junk on disk reads as absent and the next rescan
 *  re-seeds, exactly as every other store in this module degrades. */
function parseIndex(raw: unknown, user: string): UserStorageIndex | null {
  const doc = raw as Partial<UserStorageIndex> | null;
  if (!doc || typeof doc.totalBytes !== "number" || !Array.isArray(doc.roots)) return null;
  return {
    version: 1,
    user,
    totalBytes: Math.max(0, doc.totalBytes),
    sharedBytes: Math.max(0, typeof doc.sharedBytes === "number" ? doc.sharedBytes : 0),
    roots: doc.roots
      .filter((r): r is RootUsage => !!r && typeof r.rootId === "string")
      .map((r) => ({
        rootId: r.rootId,
        bytes: Math.max(0, Number(r.bytes) || 0),
        files: Math.max(0, Number(r.files) || 0),
      })),
    updatedAt: typeof doc.updatedAt === "string" ? doc.updatedAt : nowIso(),
    scannedAt: typeof doc.scannedAt === "string" ? doc.scannedAt : nowIso(),
  };
}

/**
 * THE read. One file open, no walk, `null` when the user has never been
 * scanned. Every "how much does this user use" surface goes through here.
 */
export async function readUsage(username: string): Promise<UserStorageIndex | null> {
  const user = username.trim().toLowerCase();
  if (!USER_RE.test(user)) return null;
  return parseIndex(readJsonFile<unknown>(storageIndexFile(user)), user);
}

/** Totals recomputed from the breakdown — the two can never disagree because
 *  nothing else is allowed to set them. */
function totalled(user: string, roots: RootUsage[], scannedAt: string): UserStorageIndex {
  let totalBytes = 0;
  let sharedBytes = 0;
  for (const row of roots) {
    if (USER_DATA_ROOTS.get(row.rootId)?.shared) sharedBytes += row.bytes;
    else totalBytes += row.bytes;
  }
  return { version: 1, user, totalBytes, sharedBytes, roots, updatedAt: nowIso(), scannedAt };
}

/* ---------------------------------- charge ------------------------------------ */

/** What a charge did — never a throw, because a metering failure must not fail
 *  the save that was being metered. */
export type ChargeOutcome =
  | { applied: true; index: UserStorageIndex }
  | { applied: false; reason: "no-index" | "unknown-root" | "invalid-user" | "no-delta" };

/**
 * Move a user's accounting by a delta the caller already knows. Advisory and
 * fast — see the contract at the head of this file.
 *
 * **A charge against a user who has never been scanned is DROPPED**, and says
 * so. The alternative is to seed an index from one delta, which would report a
 * member with a 900 MB vault as using 40 KB — a number that looks measured, is
 * wrong, and no surface can tell apart from a real one. The next
 * {@link rescan} is what makes them real, which is the whole reason the
 * reconciler exists.
 */
export async function charge(
  username: string,
  rootId: string,
  deltaBytes: number,
  deltaFiles = 0
): Promise<ChargeOutcome> {
  const user = username.trim().toLowerCase();
  if (!USER_RE.test(user)) return { applied: false, reason: "invalid-user" };
  if (!USER_DATA_ROOTS.get(rootId)) return { applied: false, reason: "unknown-root" };
  if (!Number.isFinite(deltaBytes) || (deltaBytes === 0 && deltaFiles === 0)) {
    return { applied: false, reason: "no-delta" };
  }

  return withStoreLock(`storage-${user}`, async () => {
    const current = parseIndex(readJsonFile<unknown>(storageIndexFile(user)), user);
    if (!current) return { applied: false, reason: "no-index" } as const;

    const roots = current.roots.some((r) => r.rootId === rootId)
      ? current.roots
      : [...current.roots, { rootId, bytes: 0, files: 0 }];

    const next = totalled(
      user,
      roots.map((r) =>
        r.rootId === rootId
          ? {
              rootId,
              // Clamped at zero: an over-charge is drift, and drift must never
              // become a negative total the UI has to defend against.
              bytes: Math.max(0, r.bytes + Math.round(deltaBytes)),
              files: Math.max(0, r.files + Math.round(deltaFiles)),
            }
          : r
      ),
      current.scannedAt
    );
    await writeJsonAtomic(storageIndexFile(user), next);
    return { applied: true, index: next } as const;
  });
}

/* ---------------------------------- rescan ------------------------------------ */

/** Depth a walk will follow. Every root here is one or two levels deep; the
 *  cap is what stops a symlink loop or a pathological tree hanging a request. */
const MAX_DEPTH = 12;

/** Bytes and file count under `dir`, recursively. A directory that is absent
 *  or unreadable contributes zero — an unscannable root is not a fatal rescan,
 *  and "0" is the honest answer for a root the user has never written to. */
async function walk(dir: string, depth = 0): Promise<{ bytes: number; files: number }> {
  if (depth > MAX_DEPTH) return { bytes: 0, files: 0 };
  let bytes = 0;
  let files = 0;
  let entries: Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return { bytes: 0, files: 0 };
  }
  for (const entry of entries) {
    // Symlinks are skipped rather than followed: a link out of a user's tree
    // would charge them for bytes that are not theirs, and a link back into it
    // would charge them twice.
    if (entry.isSymbolicLink()) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await walk(abs, depth + 1);
      bytes += sub.bytes;
      files += sub.files;
    } else if (entry.isFile()) {
      try {
        bytes += (await fsp.stat(abs)).size;
        files += 1;
      } catch {
        /* stat raced a delete — skipping it is more honest than guessing */
      }
    }
  }
  return { bytes, files };
}

/** One root's bytes for one user, honouring a shared root's `owns` filter. */
async function measure(root: UserDataRoot, user: string): Promise<RootUsage> {
  const dir = root.resolve(user);
  if (!dir) return { rootId: root.id, bytes: 0, files: 0 };

  if (!root.owns) {
    const { bytes, files } = await walk(dir);
    return { rootId: root.id, bytes, files };
  }

  // A shared directory: read it FLAT and ask the root which entries are this
  // user's. Never recursed — a shared root's ownership rule is per entry, and
  // descending past it would count somebody else's subtree.
  let names: string[] = [];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return { rootId: root.id, bytes: 0, files: 0 };
  }
  let bytes = 0;
  let files = 0;
  for (const name of names) {
    const abs = path.join(dir, name);
    try {
      const stat = await fsp.lstat(abs);
      if (!stat.isFile()) continue;
      if (!(await root.owns(name, user, abs))) continue;
      bytes += stat.size;
      files += 1;
    } catch {
      /* raced a delete */
    }
  }
  return { rootId: root.id, bytes, files };
}

/**
 * Rebuild one user's index from what is on disk. Authoritative and slow — the
 * reconciler that makes {@link charge}'s drift a temporary condition rather
 * than a permanent one.
 *
 * The walk happens INSIDE the lock, not just the write. A rescan that measured
 * outside the lock and saved inside it would happily overwrite charges made
 * while it was walking, which is the read-modify-write lesson
 * `.claude/rules/concurrent-builds.md` records — locking the save alone still
 * loses updates.
 */
export async function rescan(username: string): Promise<UserStorageIndex | null> {
  const user = username.trim().toLowerCase();
  if (!USER_RE.test(user)) return null;

  return withStoreLock(`storage-${user}`, async () => {
    const roots: RootUsage[] = [];
    for (const root of USER_DATA_ROOTS.all()) roots.push(await measure(root, user));
    const next = totalled(user, roots, nowIso());
    await writeJsonAtomic(storageIndexFile(user), next);
    return next;
  });
}

/**
 * Rescan a roster, one user at a time — the admin's reconcile button.
 *
 * The usernames are a PARAMETER rather than a `listAccounts()` call, so this
 * file stays blind to the roster exactly as it stays blind to policy: the
 * route composes the two, and a test can reconcile three temp users without an
 * accounts store existing. Sequential on purpose — a parallel rescan of forty
 * members is forty concurrent filesystem walks competing for the same disk,
 * and this is an admin action nobody is waiting on a spinner for.
 */
export async function rescanAll(
  usernames: readonly string[]
): Promise<{ scanned: number; skipped: string[]; indexes: UserStorageIndex[] }> {
  const indexes: UserStorageIndex[] = [];
  const skipped: string[] = [];
  for (const name of usernames) {
    const index = await rescan(name);
    if (index) indexes.push(index);
    else skipped.push(name);
  }
  return { scanned: indexes.length, skipped, indexes };
}

/* --------------------------------- quota -------------------------------------- */

/**
 * The closed verdict a write path acts on. Three cases and no fourth, so a
 * consumer's switch is exhaustive and a new case cannot be added without every
 * caller being made to handle it.
 *
 * `no-index` is a real answer, not an error: the user has never been scanned,
 * so nothing here can honestly say whether they are over. The caller decides
 * what an unmeasured user is allowed to do — this file will not decide it for
 * them by guessing zero.
 */
export type StorageVerdict =
  | { kind: "ok"; usedBytes: number; wantBytes: number; limitBytes: number | null; remainingBytes: number | null }
  | { kind: "over-quota"; usedBytes: number; wantBytes: number; limitBytes: number; overBy: number }
  | { kind: "no-index"; wantBytes: number };

/**
 * Would `wantBytes` more fit?
 *
 * **The limit is a parameter.** The per-user policy cascade that decides it is
 * P2's and lives elsewhere; this file counts bytes and is not allowed an
 * opinion about how many are permitted. `limitBytes: null` means unlimited and
 * is always `ok` — an absent policy must not read as a zero-byte quota.
 */
export async function checkQuota(
  username: string,
  wantBytes: number,
  limitBytes: number | null
): Promise<StorageVerdict> {
  const want = Math.max(0, Math.round(Number(wantBytes) || 0));
  const index = await readUsage(username);
  if (!index) return { kind: "no-index", wantBytes: want };

  const used = index.totalBytes;
  if (limitBytes === null || !Number.isFinite(limitBytes)) {
    return { kind: "ok", usedBytes: used, wantBytes: want, limitBytes: null, remainingBytes: null };
  }
  const projected = used + want;
  if (projected > limitBytes) {
    return {
      kind: "over-quota",
      usedBytes: used,
      wantBytes: want,
      limitBytes,
      overBy: projected - limitBytes,
    };
  }
  return {
    kind: "ok",
    usedBytes: used,
    wantBytes: want,
    limitBytes,
    remainingBytes: limitBytes - projected,
  };
}

/** An index shaped for a user who has never been scanned — for a surface that
 *  would rather render zeroes than a null, and says which it got. Never
 *  written to disk: only {@link rescan} may create the document. */
export const unscannedIndex = emptyIndex;
