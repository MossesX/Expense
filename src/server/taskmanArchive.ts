/**
 * @file The Task Manager's ARCHIVE — where a deleted list actually goes.
 *
 * Owner, 2026-08-14: *"any and all deleted lists are not deleted they are
 * stored in archive in the users data location not the system so each
 * individual user has their own lists."*
 *
 * Two requirements in one sentence, and they pull in different directions:
 *
 *   1. **Per USER.** `localStorage` cannot meet this and never could — it is
 *      per browser profile, which is the failure `persist/kv.ts` opens with.
 *      The archive has to be server-side, keyed by the same identity every
 *      other per-user document is keyed by (`kvUser` → the verified
 *      `axs_session` cookie, or "local" for the signed-out owner).
 *   2. **Not in the system's data.** The lists themselves live in the browser;
 *      what lands here is the person's, scoped to them, and a second user on
 *      the same install must not see it. That is exactly `KvStore`'s
 *      `<user>/<ns>.json` layout, so the layout is reused rather than reinvented.
 *
 * ── why a SECOND store rather than a kv namespace ────────────────────────────
 *
 * `/api/axf/kv/<ns>` was the obvious home and is the wrong one: that route caps
 * a document at 256KB and its docblock states what it is — *"a preferences/latch
 * store, not a blob store"*. An archived `.bmpx` list carries a ninety-item tree
 * and the archive holds many of them, so the first real use would hit the cap
 * and the failure would be a silent 413 during a delete the person was told was
 * safe.
 *
 * `nodeKvIo` is exported for precisely this — its own docblock says so: *"a
 * second store over a second root needs the same ten and must not get its own
 * copy of them"*. So this is the same smart half (`KvStore`: scoping, name
 * guards, the envelope, atomic writes, per-user write chains) over a second
 * root, the same shape the conversation store already takes. Nothing here
 * re-implements persistence; it supplies a root, a namespace and a trim policy.
 *
 * **Node-only** — never import from a client component.
 */
import path from "node:path";

import { KvStore } from "@axf/core";

import { nodeKvIo } from "./axfKv";
import { dataPath } from "./dataRoot";

/** Beside `data/axf/kv/` and `data/claude/conversations/`: one install, one
 *  directory of "what this install knows". */
export const TASKMAN_ARCHIVE_ROOT = dataPath("taskman", "archive");

/** One namespace — the person's archive is one document, read whole. */
export const TASKMAN_ARCHIVE_NS = "lists";

/**
 * How many archived lists a user keeps.
 *
 * An archive nothing ever trims is a disk leak with a friendly name: the delete
 * path is the ONLY writer and it is meant to be used freely, so "deleted lists
 * are never really deleted" has to mean "the last N are recoverable", not "this
 * file grows without bound". The oldest go first and the trim is REPORTED
 * (`trimmed` on the write result), because a silent truncation is a promise
 * quietly broken.
 */
export const ARCHIVE_MAX_ENTRIES = 200;

/** One archived list: the list verbatim, plus when and why it was archived. */
export interface ArchiveEntry {
  /** Archive-scoped id — a list can be archived, restored and archived again. */
  id: string;
  /** The id the list had when it was archived; restoring re-uses it. */
  listId: string;
  name: string;
  archivedAt: number;
  /** What deleted it: "list" or "delete-all". Shown in the dialog's By column. */
  reason: string;
  /** Total items in the tree, so the dialog can count without walking. */
  itemCount: number;
  /** The list itself, verbatim — this is what a restore puts back. */
  list: unknown;
}

/** The store id names the root, so this chains separately from `axfKv`. */
export const taskmanArchive = new KvStore(
  nodeKvIo(TASKMAN_ARCHIVE_ROOT),
  `file:${TASKMAN_ARCHIVE_ROOT}`
);

/* ─────────────────────────── the pure half ─────────────────────────────────
 *
 * Separated from the store calls so the rules that matter — what a well-formed
 * entry is, what the trim drops, what a purge keeps — are testable without a
 * filesystem, a user or a route. The store operations below are then four lines
 * each, which is the amount of them worth reading.
 */

/** Well-formed entries out of whatever the document held, newest first. */
export function readEntries(doc: unknown): ArchiveEntry[] {
  const entries = (doc as { entries?: unknown })?.entries;
  if (!Array.isArray(entries)) return [];
  return (entries as ArchiveEntry[])
    .filter((e) => e && typeof e.id === "string" && typeof e.listId === "string")
    .sort((a, b) => b.archivedAt - a.archivedAt);
}

/** Newest first, capped. `trimmed` is what fell off the end — never silent. */
export function mergeEntries(
  existing: readonly ArchiveEntry[],
  additions: readonly ArchiveEntry[],
  max = ARCHIVE_MAX_ENTRIES
): { entries: ArchiveEntry[]; trimmed: number } {
  const merged = [...additions, ...existing].sort((a, b) => b.archivedAt - a.archivedAt);
  return { entries: merged.slice(0, max), trimmed: Math.max(0, merged.length - max) };
}

/** Items in a `TaskItem[]` tree — the count the dialog shows without walking. */
export function countTree(items: unknown): number {
  if (!Array.isArray(items)) return 0;
  let n = 0;
  for (const it of items) {
    n += 1;
    n += countTree((it as { children?: unknown })?.children);
  }
  return n;
}

/* ─────────────────────────── the store half ──────────────────────────────── */

/** Read a user's archive, newest first. Never throws on a missing document. */
export async function readArchive(user: string, store = taskmanArchive): Promise<ArchiveEntry[]> {
  return readEntries(await store.read(user, TASKMAN_ARCHIVE_NS));
}

/**
 * Add entries, newest first, trimming to {@link ARCHIVE_MAX_ENTRIES}.
 *
 * The read-modify-write is inside `KvStore.mutate`'s chain — locking only the
 * save loses updates, which is the lesson `kv.ts` records from the registry and
 * repeats for the conversation store. Two tabs archiving at once is not
 * hypothetical here: the rail's × button and a delete-all can both be in flight.
 */
export async function appendArchive(
  user: string,
  additions: readonly ArchiveEntry[],
  store = taskmanArchive
): Promise<{ total: number; trimmed: number }> {
  let trimmed = 0;
  const doc = await store.mutate(user, TASKMAN_ARCHIVE_NS, (current) => {
    const merged = mergeEntries(readEntries(current), additions);
    trimmed = merged.trimmed;
    return { entries: merged.entries };
  });
  return { total: ((doc as { entries?: ArchiveEntry[] }).entries ?? []).length, trimmed };
}

/** Drop entries by archive id. `null` ids means the whole archive. */
export async function purgeArchive(
  user: string,
  ids: readonly string[] | null,
  store = taskmanArchive
): Promise<number> {
  let removed = 0;
  await store.mutate(user, TASKMAN_ARCHIVE_NS, (current) => {
    const existing = readEntries(current);
    if (ids === null) {
      removed = existing.length;
      return { entries: [] };
    }
    const drop = new Set(ids);
    const kept = existing.filter((e) => !drop.has(e.id));
    removed = existing.length - kept.length;
    return { entries: kept };
  });
  return removed;
}
