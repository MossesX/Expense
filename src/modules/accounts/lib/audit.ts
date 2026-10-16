/**
 * @file **The administrative audit trail** — who did what, to whom, when, as a
 * queryable record rather than as prose in a ledger.
 *
 * ## Why this exists beside `journal.json` rather than inside it
 *
 * `appendJournal` (`./fsCore`) is a FILE ledger: an op, a path, and a sentence.
 * It answers "what happened to this document" and it answers it well — the
 * activity surfaces read it and nothing here replaces them. What it cannot
 * answer is the question the admin suite is built around: *show me everything
 * `admin` did to `dana` last Tuesday*. Its fields are a path and a free-text
 * summary, so every such query would be a substring search over prose that was
 * written to be read, not parsed.
 *
 * So this is the same events with their **fields kept apart**: `actor`,
 * `subject`, `verb`, and the verb's own details. The posture in `./admin` is
 * EXTENDED, not replaced — `auditFieldChange` still writes its journal line and
 * now records here too, so the ledger keeps its sentence and the suite gets its
 * columns from one call site.
 *
 * ## NDJSON, appended, and why the format is load-bearing
 *
 * An administrator listing a member's directory writes an audit record BEFORE
 * the listing goes out (`app/api/accounts/admin/files/route.ts`), so a write is
 * on the hot path of every read. A JSON array document would mean re-reading and
 * re-writing the whole trail per listing — at a few thousand records that is
 * hundreds of kilobytes of rewrite to record one `ls`, which is exactly the
 * pressure that gets an audit call quietly moved to "after the response" and
 * then dropped. One appended line costs the same whatever the trail holds.
 *
 * The whole trail is read back on a QUERY, which is an administrator pressing a
 * button, not a page load. That asymmetry is the trade: cheap writes, honest
 * reads, and a rotation cap so the read stays bounded.
 *
 * ## {@link recordAudit} REPORTS failure — it does not swallow it
 *
 * This is the one place in the module that departs from the house "journaling
 * never fails a save" posture, and the departure is the point.
 * `appendJournal` records something that has ALREADY happened, so swallowing a
 * fault loses a line and nothing else. Here the record is a PRECONDITION: the
 * file browser must not hand an administrator a member's bytes if the act of
 * reading them could not be written down. So the outcome is returned, and that
 * route refuses when it is not `ok`.
 *
 * `auditFieldChange` keeps the old posture deliberately — it records a write
 * that already landed on disk, and failing it afterwards would be a lie in the
 * other direction.
 *
 * Server-only (node imports) — imported by lib files and API routes only.
 */

import fsp from "node:fs/promises";

import { withStoreLock } from "./fsCore";
import { auditLogFile, auditRotatedFile, dataRoot } from "./paths";

/* ================================ the record ================================== */

/**
 * What was done. A closed union rather than a free string, so a typo in a
 * caller is a compile error and the audit filter can offer the real set instead
 * of whatever has been spelled so far.
 *
 * Grouped by prefix on purpose — a surface filtering `file-` gets every way an
 * administrator has looked at somebody's data, without listing the verbs.
 */
export type AuditVerb =
  /** A directory (or the root index) was listed. */
  | "file-list"
  /** A file's contents were rendered for preview. */
  | "file-view"
  /** A file's bytes were sent to the administrator's browser. */
  | "file-download"
  /** A policy field was pinned. */
  | "policy-set"
  /** A policy field was un-pinned, back to following the tier above. */
  | "policy-clear"
  /** An account was created. */
  | "user-create"
  /** An account's role moved. */
  | "user-role"
  /** A temp password was issued. */
  | "password-reset"
  /** An administrator edited somebody else's profile. */
  | "profile-edit";

/** Every declared verb, for a filter UI that must not hard-code the list. */
export const AUDIT_VERBS: readonly AuditVerb[] = [
  "file-list",
  "file-view",
  "file-download",
  "policy-set",
  "policy-clear",
  "user-create",
  "user-role",
  "password-reset",
  "profile-edit",
];

const VERB_SET = new Set<string>(AUDIT_VERBS);

/** Is this string one of the declared verbs? The query route's filter parser
 *  uses it so an unknown verb is refused by name rather than silently matching
 *  nothing. */
export function isAuditVerb(v: string): v is AuditVerb {
  return VERB_SET.has(v);
}

/** What a caller hands over. `at`/`ts`/`id` are stamped here — a caller that
 *  could choose its own timestamp could write a record into the past. */
export interface AuditDraft {
  /** The administrator who acted. */
  actor: string;
  /** Whose data or settings it was — a username, or the `_site` pseudo-subject. */
  subject: string;
  verb: AuditVerb;
  /** File verbs: the data-root id from `./storage`'s registry. */
  root?: string;
  /** File verbs: the path INSIDE that root, forward-slashed and relative. Never
   *  an absolute path — the root id says where, and an absolute path in an
   *  audit record is a machine detail that changes when the store is rehomed. */
  path?: string;
  /** Policy verbs: the catalog key that moved. */
  field?: string;
  /** Policy verbs: rendered old → new. Strings, so the record is readable
   *  without the catalog that produced it. */
  from?: string;
  to?: string;
  /** Bytes that moved, for a view or a download. */
  bytes?: number;
  /** Anything the verb needs that the fields above do not carry. */
  detail?: string;
}

/** One record, as it sits on disk and as the query returns it. */
export interface AuditEntry extends AuditDraft {
  readonly id: string;
  /** ISO 8601 — what a surface renders. */
  readonly at: string;
  /** Epoch ms — what a time-range query compares, with no parsing per record. */
  readonly ts: number;
}

/* ================================== writing =================================== */

/** Rotate once the live log passes this. Two generations are kept, so a query
 *  always sees at least this much history and never more than twice it. */
export const AUDIT_ROTATE_BYTES = 4 * 1024 * 1024;

/** Free-text fields are clamped so one enormous path cannot make a record
 *  unreadable — or make the log rotate on a single line. */
const FIELD_MAX = 1024;

const clamp = (v: string | undefined): string | undefined =>
  v === undefined ? undefined : v.length > FIELD_MAX ? `${v.slice(0, FIELD_MAX)}…` : v;

const norm = (v: string): string => v.trim().toLowerCase();

export type AuditOutcome =
  | { ok: true; entry: AuditEntry }
  | { ok: false; error: string };

/**
 * **Write one record.** Returns the outcome — see the header for why this one
 * does not swallow.
 *
 * The append is a single `appendFile`, which is the whole write: no lock, no
 * read-modify-write, nothing another process can interleave a partial record
 * into. The ONLY locked operation is rotation, which moves the file wholesale.
 */
export async function recordAudit(draft: AuditDraft): Promise<AuditOutcome> {
  const entry: AuditEntry = {
    id: `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    ts: Date.now(),
    actor: norm(draft.actor),
    subject: norm(draft.subject),
    verb: draft.verb,
    ...(draft.root !== undefined ? { root: clamp(draft.root) } : {}),
    ...(draft.path !== undefined ? { path: clamp(draft.path) } : {}),
    ...(draft.field !== undefined ? { field: clamp(draft.field) } : {}),
    ...(draft.from !== undefined ? { from: clamp(draft.from) } : {}),
    ...(draft.to !== undefined ? { to: clamp(draft.to) } : {}),
    ...(typeof draft.bytes === "number" && Number.isFinite(draft.bytes)
      ? { bytes: Math.max(0, Math.round(draft.bytes)) }
      : {}),
    ...(draft.detail !== undefined ? { detail: clamp(draft.detail) } : {}),
  };

  try {
    await fsp.mkdir(dataRoot(), { recursive: true });
    await fsp.appendFile(auditLogFile(), `${JSON.stringify(entry)}\n`, "utf8");
  } catch (err) {
    return { ok: false, error: (err as Error).message || "could not write the audit record" };
  }

  // Rotation is checked AFTER the append, never before: a record must never be
  // delayed behind housekeeping, and a log one line over the cap is harmless.
  // A failure here is swallowed on purpose — the record is already on disk, and
  // refusing the caller because the log could not be rotated would throw away a
  // read that was properly audited.
  try {
    const size = (await fsp.stat(auditLogFile())).size;
    if (size > AUDIT_ROTATE_BYTES) await rotate();
  } catch {
    /* the record landed; rotation is best-effort */
  }

  return { ok: true, entry };
}

/** Move the live log aside, replacing the single previous generation. Locked,
 *  and re-checked inside the lock so two processes crossing the cap at once
 *  rotate once rather than discarding a whole generation twice. */
async function rotate(): Promise<void> {
  await withStoreLock("audit-rotate", async () => {
    let size = 0;
    try {
      size = (await fsp.stat(auditLogFile())).size;
    } catch {
      return;
    }
    if (size <= AUDIT_ROTATE_BYTES) return;
    await fsp.rm(auditRotatedFile(), { force: true });
    await fsp.rename(auditLogFile(), auditRotatedFile());
  });
}

/* ================================== reading =================================== */

export interface AuditQuery {
  /** Exact username, case-insensitive. */
  actor?: string;
  subject?: string;
  /** Any of these verbs. Empty or absent means every verb. */
  verbs?: readonly AuditVerb[];
  /** Inclusive epoch-ms bounds. */
  since?: number;
  until?: number;
  /** Substring match over the free-text half (path, field, detail) — the
   *  "find the record about THAT file" case a column filter cannot serve. */
  q?: string;
  offset?: number;
  limit?: number;
}

export interface AuditPage {
  /** Newest first. */
  entries: AuditEntry[];
  /** Matches BEFORE paging — what "1–50 of 312" reads from. */
  total: number;
  offset: number;
  limit: number;
  /**
   * A previous generation exists, so the trail MAY reach further back than this
   * window. Immediately after the FIRST rotation it does not — both generations
   * are still on disk and nothing has been lost — and the log genuinely cannot
   * tell that case from the second rotation, which does drop the oldest
   * generation. It errs toward saying so: a surface that reports "no earlier
   * activity" when the log has quietly rolled over is lying cheaply and
   * invisibly, and that is the failure worth over-warning about.
   */
  truncated: boolean;
}

export const AUDIT_PAGE_DEFAULT = 100;
export const AUDIT_PAGE_MAX = 1000;

/** Parse one NDJSON line, or null. A torn final line (a crash mid-append) is
 *  skipped rather than failing the whole query — the same degrade-never-crash
 *  posture every store in this module has. */
function parseLine(line: string): AuditEntry | null {
  if (!line) return null;
  try {
    const raw = JSON.parse(line) as Partial<AuditEntry>;
    if (typeof raw.ts !== "number" || typeof raw.verb !== "string") return null;
    if (typeof raw.actor !== "string" || typeof raw.subject !== "string") return null;
    return raw as AuditEntry;
  } catch {
    return null;
  }
}

async function readLog(file: string): Promise<AuditEntry[]> {
  let text: string;
  try {
    text = await fsp.readFile(file, "utf8");
  } catch {
    return [];
  }
  const out: AuditEntry[] = [];
  for (const line of text.split("\n")) {
    const entry = parseLine(line.trim());
    if (entry) out.push(entry);
  }
  return out;
}

/**
 * **Query the trail.** Every filter is an AND; an absent filter matches
 * everything.
 *
 * Both generations are read and merged, oldest file first, so the answer spans
 * a rotation. The whole window is held in memory for the length of one request
 * — bounded by {@link AUDIT_ROTATE_BYTES} × 2 by construction, which is the
 * reason the cap exists at all.
 */
export async function queryAudit(query: AuditQuery = {}): Promise<AuditPage> {
  const rotated = await readLog(auditRotatedFile());
  const live = await readLog(auditLogFile());
  const all = [...rotated, ...live];

  const actor = query.actor ? norm(query.actor) : "";
  const subject = query.subject ? norm(query.subject) : "";
  const verbs = query.verbs && query.verbs.length > 0 ? new Set<string>(query.verbs) : null;
  const since = typeof query.since === "number" && Number.isFinite(query.since) ? query.since : null;
  const until = typeof query.until === "number" && Number.isFinite(query.until) ? query.until : null;
  const needle = query.q?.trim().toLowerCase() ?? "";

  const matched = all.filter((e) => {
    if (actor && e.actor !== actor) return false;
    if (subject && e.subject !== subject) return false;
    if (verbs && !verbs.has(e.verb)) return false;
    if (since !== null && e.ts < since) return false;
    if (until !== null && e.ts > until) return false;
    if (needle) {
      const hay = `${e.path ?? ""} ${e.root ?? ""} ${e.field ?? ""} ${e.detail ?? ""}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  // Newest first, and by id when two records share a millisecond — a stable
  // order is what stops a page boundary showing the same record twice.
  matched.sort((a, b) => (b.ts - a.ts) || (b.id < a.id ? -1 : b.id > a.id ? 1 : 0));

  const limit = Math.min(AUDIT_PAGE_MAX, Math.max(1, Math.round(query.limit ?? AUDIT_PAGE_DEFAULT)));
  const offset = Math.max(0, Math.round(query.offset ?? 0));

  return {
    entries: matched.slice(offset, offset + limit),
    total: matched.length,
    offset,
    limit,
    truncated: rotated.length > 0,
  };
}

/**
 * The distinct actors and subjects the window holds — what a filter's two
 * pickers are populated from, so they offer names that actually appear rather
 * than the whole roster.
 *
 * Reads the logs itself rather than folding a {@link queryAudit} page: a page is
 * capped, and facets computed from the newest N records would silently stop
 * offering an administrator who has not acted lately — a filter that cannot
 * name somebody is a filter that says they did nothing.
 */
export async function auditFacets(): Promise<{ actors: string[]; subjects: string[] }> {
  const all = [...(await readLog(auditRotatedFile())), ...(await readLog(auditLogFile()))];
  const actors = new Set<string>();
  const subjects = new Set<string>();
  for (const e of all) {
    actors.add(e.actor);
    subjects.add(e.subject);
  }
  return { actors: [...actors].sort(), subjects: [...subjects].sort() };
}
