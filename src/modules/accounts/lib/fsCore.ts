/**
 * @file Accounts filesystem core — the house persistence posture in three
 * functions, shared by every store in this module:
 *
 * - `readJsonFile` — degrade never crash: a missing, unreadable or junk file
 *   reads as an honest null and the caller re-seeds, rather than locking
 *   anyone out of their own store.
 * - `writeJsonAtomic` — same-dir tmp + rename, so a crash mid-write leaves
 *   the previous document intact and never a half-written one.
 * - `appendJournal` — the module's audit trail (`journal.json`, capped at
 *   {@link JOURNAL_KEEP} entries). Journaling can NEVER fail a save: every
 *   fault is swallowed here, at the chokepoint, instead of at each of the
 *   call sites that would have to remember to.
 * - `withStoreLock` — cross-process exclusion around a whole read-modify-write.
 *   Added by P18 (the credit ledger); see its own note below for why it is
 *   here, once, rather than in the one store that needed it.
 *
 * Server-only (node imports) — imported by lib files and API routes only.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { dataRoot, journalFile, locksDir } from "./paths";

/* ---------------------------------- reads ------------------------------------ */

/**
 * Read + parse a JSON document, or null on ANY failure (absent file, IO
 * error, junk bytes). Callers treat null as "honest empty" and re-seed.
 */
export function readJsonFile<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/* ---------------------------------- writes ----------------------------------- */

/**
 * Atomic write: same-dir `.${pid}.${Date.now()}.tmp` + rename. The tmp file
 * sits beside its target so the rename never crosses a filesystem boundary.
 */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fsp.rename(tmp, file);
}

/* ----------------------------------- lock ------------------------------------ */

/**
 * A lock older than this was left by a process that died holding it. Breaking
 * it is the only alternative to wedging every later writer forever.
 */
const LOCK_STALE_MS = 10_000;
/** Give up rather than hang a request indefinitely. */
const LOCK_TIMEOUT_MS = 5_000;

const lockPath = (name: string): string =>
  path.join(locksDir(), `${name.replace(/[^a-z0-9._-]+/gi, "_")}.lock`);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn` with the named store lock held, across processes.
 *
 * ## Why this exists here rather than only in the ledger that wanted it
 *
 * Every other store in this module is a read-modify-write of one JSON document
 * with no lock at all, and that is a **deliberate, surviving** decision: those
 * documents hold state whose worst concurrent outcome is a lost profile edit —
 * annoying, visible, and re-doable by the person who made it. A CREDIT ledger
 * is not that. Two spends racing under last-writer-wins do not lose an edit,
 * they lose a *charge*, silently, in the customer's favour or against it, and
 * nobody ever finds out. So P18 brought the primitive in.
 *
 * It is in `fsCore` rather than in `credits.ts` because "do not invent a second
 * store core" is the rule this file exists to satisfy — the next store that
 * needs exclusion must find it here, not discover that the ledger has a private
 * one. **Nothing existing changed**: no current caller takes a lock, and adding
 * one is opt-in per store.
 *
 * The discipline is the registry lock's, verbatim in shape (`wx` create, spin,
 * break a lock older than {@link LOCK_STALE_MS}, give up after
 * {@link LOCK_TIMEOUT_MS}) — see `.claude/rules/concurrent-builds.md`, which
 * documents why exclusion must wrap the WHOLE read-modify-write and never just
 * the save. Locking only the write still loses updates.
 *
 * Async, unlike amberxvid's synchronous sibling, because every write in this
 * module is already async (`writeJsonAtomic` returns a promise) and a
 * synchronous lock cannot span an awaited body.
 */
export async function withStoreLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  await fsp.mkdir(locksDir(), { recursive: true });
  const lock = lockPath(name);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  for (;;) {
    try {
      await fsp.writeFile(lock, `${process.pid} ${new Date().toISOString()}\n`, { flag: "wx" });
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // EPERM/EACCES: Windows reports access-denied rather than EEXIST while a
      // lock file is in a delete-pending state. That is contention, so retry.
      if (code !== "EEXIST" && code !== "EPERM" && code !== "EACCES") throw err;

      let heldMs = 0;
      try {
        heldMs = Date.now() - (await fsp.stat(lock)).mtimeMs;
      } catch {
        heldMs = 0; // vanished underneath us — retry immediately
      }
      if (heldMs > LOCK_STALE_MS) {
        try {
          await fsp.rm(lock, { force: true });
        } catch {
          /* somebody else broke it first */
        }
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `accounts store lock "${name}" is held by another process (${lock}, held ` +
            `${(heldMs / 1000).toFixed(1)}s) — gave up after ${LOCK_TIMEOUT_MS / 1000}s`
        );
      }
      await sleep(15);
    }
  }

  try {
    return await fn();
  } finally {
    try {
      await fsp.rm(lock, { force: true });
    } catch {
      /* already gone */
    }
  }
}

/* ---------------------------------- journal ---------------------------------- */

export type FileOp = "create" | "edit" | "open" | "delete" | "restore";

export interface JournalEntry {
  id: string;
  ts: number;
  op: FileOp;
  path: string;
  summary: string;
  added: number;
  removed: number;
}

/** Entries the journal keeps — older ones roll off the front. */
export const JOURNAL_KEEP = 2000;

interface JournalFile {
  entries: JournalEntry[];
}

/**
 * Append one entry to the module's journal. Swallows every fault and honours
 * `ACCOUNTS_SILENT_JOURNAL=1` (set only by test runs, whose temp-store
 * activity is not user activity) — a save that journaled nothing still saved.
 */
export async function appendJournal(
  op: FileOp,
  relPath: string,
  extra: Partial<JournalEntry> = {}
): Promise<void> {
  if (process.env.ACCOUNTS_SILENT_JOURNAL === "1") return;
  try {
    await fsp.mkdir(dataRoot(), { recursive: true });
    const parsed = readJsonFile<JournalFile>(journalFile());
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    entries.push({
      id: `j_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      ts: Date.now(),
      op,
      path: relPath,
      summary: extra.summary ?? op,
      added: extra.added ?? 0,
      removed: extra.removed ?? 0,
    });
    const kept = entries.length > JOURNAL_KEEP ? entries.slice(-JOURNAL_KEEP) : entries;
    await fsp.writeFile(journalFile(), JSON.stringify({ entries: kept }, null, 2), "utf8");
  } catch {
    /* journaling never fails a save */
  }
}
