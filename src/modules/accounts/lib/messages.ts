/**
 * @file Accounts message store — the internal messenger's persistence: one
 * JSON per conversation under `<root>/messages/<threadId>.json`. The offline
 * queue IS the thread file — an undelivered message is simply one nobody's
 * cursor has reached yet (exactly the proven amberxvid model).
 *
 * ## GROUPS, AND WHY A DM IS JUST THE TWO-MEMBER CASE (P5, 2026-08-14)
 *
 * There is ONE thread model. A DM is a thread with two members, `kind: "dm"`
 * and no title; a group is the same document with more members and a name.
 * There is no second store, no second id space rule, no second send path and no
 * migration — a thread file written before groups existed is READ as a
 * two-member group and rewritten in the new shape the next time it is touched,
 * which is what `test/accounts-groups.test.ts` round-trips a hand-staged legacy
 * document to prove. "Generalised in place" is a claim until a pre-existing
 * thread comes back out unchanged, so that test stages the old bytes literally.
 *
 * The two id spaces are DISJOINT and the id is authoritative about the kind: a
 * DM's id is `threadIdFor()` of the pair and always contains `--`; a group's is
 * `g-<32 hex>` and never does. So a hand-edited `kind` field cannot disagree
 * with the file it is sitting in — the id decides, and nothing asks the file.
 *
 * ## Delivery: cursors, not per-message stamps
 *
 * Per-member truth lives on {@link ThreadMember} as two cursors,
 * `deliveredThrough` and `readThrough`, each the message `seq` that member has
 * been carried up to. The alternative — a delivery record per member per
 * message — would put 25 000 stamp objects in a 500-message, 50-member thread
 * to say what two integers say.
 *
 * `Message.deliveredAt` / `readAt` survive as the AGGREGATE: stamped when
 * EVERY member other than the sender has passed that seq. On a DM there is
 * exactly one such member, so both fields mean precisely what they meant
 * before, byte for byte, and the client's "still queued" tick is unchanged.
 *
 * Offline delivery is a STAMP, NOT A PUSH. `sendMessage` advances an online
 * recipient's cursor in the same write that stores the message (they are
 * getting it over SSE in that same request); an offline member's cursor moves
 * on their next fetch — which their client fires right after login, making
 * "offline messages deliver at next login" literally true for the third member
 * of a group exactly as it already was for the second of a pair.
 *
 * ## History is paged, and the page is SOUGHT, not walked
 *
 * {@link getThreadById} takes `{ cursor, limit }` and binary-searches the seq
 * it was handed, so reading page 7 of a conversation costs a `log n` seek and a
 * slice rather than a scan. Retention is untouched: {@link THREAD_MESSAGES_MAX}
 * still caps every thread, sends still trim inline and `pruneMessages` still
 * re-asserts it. Trimming can never corrupt a cursor because `seq` comes from
 * the thread's own `nextSeq` counter and is never renumbered.
 *
 * ## Permission and social seams
 *
 * `sendMessage` checks the sender's `canMessage` capability through
 * `effectivePermissions` per call — a revocation refuses the very next send.
 *
 * SOCIAL SEAM (P4/P5): the DM send path asks `canInteract` from `./relations`
 * — the ONE guard, never a second opinion about who may talk to whom. A
 * `blocked` verdict is refused with the EXACT refusal an absent or disabled
 * recipient gets, byte for byte, so a blocked sender cannot tell the two apart.
 *
 * **The group DOOR is gated by the same guard, in both directions, across every
 * pair.** Creating a group or inviting into one runs `canInteract` between the
 * newcomer and every member already inside — because otherwise a group is a
 * side door: A blocks B, C invites both, and A is in a room with B without
 * anybody overriding A's block. Pairwise is O(n²) reads of one small document
 * and the member cap bounds it; correctness on a rare path beats a cheaper
 * gate with a hole in it.
 *
 * What the door deliberately does NOT do is police a room after it exists.
 * Blocking somebody you are already in a group with does not eject either of
 * you and does not stop their messages: consent was given at the door, and a
 * unilateral action that silently broke a shared room for four other people is
 * a moderation decision, not a block. Ejection belongs to P17's moderation
 * wing. This is the same posture reading an existing DM already has — a block
 * stops the next invitation, it does not retroactively unsay the room.
 *
 * House store posture (`./fsCore`): degrade never crash (junk file →
 * synthesized empty thread), atomic writes, member-only access enforced HERE.
 * The journal gets thread creation, deletion and pruning; individual message
 * appends are deliberately not journaled — a live conversation would flood the
 * ledger with an entry per line. Server-only.
 */

import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { appendJournal, readJsonFile, writeJsonAtomic } from "./fsCore";
import { findAccount, requireAdmin } from "./accounts";
import { effectivePermissions } from "./permissions";
import { canInteract } from "./relations";
import { messagesDir } from "./paths";
import {
  MESSAGE_MAX,
  THREAD_MEMBERS_CEILING,
  THREAD_MEMBERS_MAX,
  THREAD_MESSAGES_MAX,
  THREAD_TITLE_MAX,
  threadIdFor,
  type Account,
  type AdminThreadInfo,
  type Message,
  type MessagePage,
  type Thread,
  type ThreadMember,
  type ThreadSummary,
} from "./types";

/** Every store refusal in this file, in the house shape. */
export interface StoreRefusal {
  ok: false;
  error: string;
  status: number;
}

export type MessageResult =
  | {
      ok: true;
      message: Message;
      created: boolean;
      /** Everyone whose stream should be handed this message — the route's
       *  `notifyUsers` list, so a group send does not have to re-open the file
       *  to find out who is in the room. */
      members: string[];
    }
  | StoreRefusal;

export type ThreadResult = { ok: true; thread: Thread } | StoreRefusal;

/* --------------------------------- plumbing ----------------------------------- */

const fwd = (p: string): string => p.replace(/\\/g, "/");

function ledgerPath(abs: string): string {
  const rel = path.relative(process.cwd(), abs);
  return fwd(rel.startsWith("..") ? abs : rel);
}

async function journal(op: "create" | "edit" | "delete", abs: string, summary: string): Promise<void> {
  await appendJournal(op, ledgerPath(abs), { summary });
}

// Thread ids come from validated usernames or from `crypto`, but an id is also
// a filename — belt and braces before it ever joins a path. The two spaces are
// disjoint: a DM id always carries `--`, a group id never does.
const DM_ID_RE = /^[a-z0-9][a-z0-9._-]*--[a-z0-9][a-z0-9._-]*$/;
const GROUP_ID_RE = /^g-[0-9a-f]{32}$/;

const isGroupId = (id: string): boolean => GROUP_ID_RE.test(id);
const validThreadId = (id: string): boolean => DM_ID_RE.test(id) || GROUP_ID_RE.test(id);
const newGroupId = (): string => `g-${crypto.randomBytes(16).toString("hex")}`;

const threadFile = (id: string): string => path.join(messagesDir(), `${id}.json`);

const norm = (u: string): string => u.trim().toLowerCase();

/** In-memory shape after normalisation: every message HAS a seq. The wire type
 *  keeps it optional because a legacy file and the client's optimistic phantom
 *  both arrive without one. */
type StoredMessage = Message & { seq: number };
interface StoredThread extends Thread {
  messages: StoredMessage[];
}

/* ------------------------------ the member cap -------------------------------- */

/**
 * Where the group member cap comes from. The accounts module declares the seam
 * and owns the default; a policy catalog installs itself here and answers with
 * the effective number for one member.
 *
 * This module never re-implements the cascade's precedence — it asks, clamps
 * the answer to `[2, THREAD_MEMBERS_CEILING]` (a cap below two is not a group,
 * and the ceiling is structural: one thread is one document rewritten per
 * send), and falls back to {@link THREAD_MEMBERS_MAX} when nothing has
 * installed itself or the source throws.
 */
export type ThreadMemberCapSource = (user: string) => number | Promise<number>;

let memberCapSource: ThreadMemberCapSource | null = null;

/** Install the cap source. Last call wins; `null` restores the site default. */
export function setThreadMemberCapSource(next: ThreadMemberCapSource | null): void {
  memberCapSource = next;
}

export type ThreadMemberCapStatus = { installed: true } | { installed: false; why: string };

/** Where the integration stands. `installed: false` is a stated fact, not a
 *  pass — a catalog with no cascade behind it looks exactly like a cascade that
 *  answered with the default, and only one of those is configured. */
export function threadMemberCapStatus(): ThreadMemberCapStatus {
  if (memberCapSource) return { installed: true };
  return {
    installed: false,
    why:
      `no policy cascade has installed a group member cap, so every member's cap is the ` +
      `site default of ${THREAD_MEMBERS_MAX}. A catalog installs itself through ` +
      `setThreadMemberCapSource() and nothing in this file changes when it does.`,
  };
}

/** The effective cap for one member, always a usable number. */
export async function threadMemberCap(user: string): Promise<number> {
  if (!memberCapSource) return THREAD_MEMBERS_MAX;
  let answered: number;
  try {
    answered = await memberCapSource(user);
  } catch {
    // A cascade that throws must not take group chat down with it.
    return THREAD_MEMBERS_MAX;
  }
  if (typeof answered !== "number" || !Number.isFinite(answered)) return THREAD_MEMBERS_MAX;
  return Math.min(THREAD_MEMBERS_CEILING, Math.max(2, Math.round(answered)));
}

/* -------------------------------- normalising ---------------------------------- */

function emptyMember(username: string, role: ThreadMember["role"], joinedAt: string, at: number): ThreadMember {
  return { username, role, joinedAt, deliveredThrough: at, readThrough: at, deliveredAt: null };
}

/**
 * The conservative legacy cursor: the newest seq up to which EVERY message this
 * member had to receive carries a stamp. It stops at the first gap rather than
 * taking the highest stamped seq, so a hand-edited store can only ever make a
 * message look unread — never make an unread one disappear, which is the only
 * direction of error worth having.
 *
 * In practice the two agree exactly, because `markThreadRead` has always
 * stamped in bulk; the round-trip test pins that.
 */
function legacyCursor(
  messages: StoredMessage[],
  key: string,
  stamp: (m: StoredMessage) => string | null,
): number {
  let cursor = 0;
  for (const m of messages) {
    if (norm(m.from) === key || stamp(m) !== null) cursor = m.seq;
    else break;
  }
  return cursor;
}

/**
 * Read whatever is on disk as a {@link StoredThread}, or null if it is not a
 * thread at all. Loose input by design — the file is whatever is there, and
 * typing it as the document it is supposed to be would let a hand-edited list
 * of numbers through the very normalisation written to catch it.
 */
function normalizeThread(raw: unknown, id: string): StoredThread | null {
  if (!validThreadId(id)) return null;
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1 || r.id !== id || !Array.isArray(r.messages)) return null;

  // Messages first: the cursors are expressed in seqs, so they need them.
  // A declared seq is honoured while it ascends; anything else is assigned by
  // position, which is exactly what a pre-groups file gets.
  let seq = 0;
  const messages: StoredMessage[] = [];
  for (const entry of r.messages as unknown[]) {
    if (entry === null || typeof entry !== "object") continue;
    const m = entry as Partial<Message> & Record<string, unknown>;
    if (typeof m.id !== "string" || typeof m.from !== "string" || typeof m.text !== "string") continue;
    const declared = typeof m.seq === "number" && Number.isFinite(m.seq) ? Math.floor(m.seq) : 0;
    seq = declared > seq ? declared : seq + 1;
    messages.push({
      id: m.id,
      threadId: id,
      from: m.from,
      to: typeof m.to === "string" ? m.to : "",
      text: m.text,
      sentAt: typeof m.sentAt === "string" ? m.sentAt : new Date(0).toISOString(),
      seq,
      deliveredAt: typeof m.deliveredAt === "string" ? m.deliveredAt : null,
      readAt: typeof m.readAt === "string" ? m.readAt : null,
    });
  }
  const highest = messages.length > 0 ? messages[messages.length - 1].seq : 0;
  const declaredNext = typeof r.nextSeq === "number" && Number.isFinite(r.nextSeq) ? Math.floor(r.nextSeq) : 0;
  const nextSeq = Math.max(declaredNext, highest + 1, 1);

  const kind: Thread["kind"] = isGroupId(id) ? "group" : "dm";
  const createdAt = typeof r.createdAt === "string" ? r.createdAt : new Date(0).toISOString();
  const updatedAt = typeof r.updatedAt === "string" ? r.updatedAt : createdAt;

  // Members: the new field if it is there, else derived from the pre-groups
  // `participants` (and, failing even that, from a DM id's own two halves).
  const members: ThreadMember[] = [];
  const seen = new Set<string>();
  const add = (username: string, role: ThreadMember["role"], joinedAt: string, at: number): ThreadMember | null => {
    const key = norm(username);
    if (!key || seen.has(key)) return null;
    seen.add(key);
    const rec = emptyMember(key, role, joinedAt, at);
    members.push(rec);
    return rec;
  };

  const rawMembers = Array.isArray(r.members) ? (r.members as unknown[]) : [];
  for (const entry of rawMembers) {
    if (entry === null || typeof entry !== "object") continue;
    const m = entry as Record<string, unknown>;
    if (typeof m.username !== "string") continue;
    const rec = add(
      m.username,
      m.role === "owner" ? "owner" : "member",
      typeof m.joinedAt === "string" ? m.joinedAt : createdAt,
      0,
    );
    if (!rec) continue;
    const d = typeof m.deliveredThrough === "number" && Number.isFinite(m.deliveredThrough)
      ? Math.max(0, Math.floor(m.deliveredThrough))
      : 0;
    const rd = typeof m.readThrough === "number" && Number.isFinite(m.readThrough)
      ? Math.max(0, Math.floor(m.readThrough))
      : 0;
    rec.readThrough = rd;
    // Reading implies delivery — a cursor pair that says otherwise is a
    // hand-edit, and honouring it would report a read message as still queued.
    rec.deliveredThrough = Math.max(d, rd);
    rec.deliveredAt = typeof m.deliveredAt === "string" ? m.deliveredAt : null;
  }

  if (members.length === 0) {
    const legacy = Array.isArray(r.participants)
      ? (r.participants as unknown[]).filter((p): p is string => typeof p === "string")
      : [];
    const names = legacy.length >= 2 || kind === "group" ? legacy : id.split("--");
    for (const name of names) add(name, "member", createdAt, 0);
    // Cursors reconstructed from the per-message stamps the old shape carried.
    for (const rec of members) {
      const key = norm(rec.username);
      rec.readThrough = legacyCursor(messages, key, (m) => m.readAt);
      rec.deliveredThrough = Math.max(
        rec.readThrough,
        legacyCursor(messages, key, (m) => m.deliveredAt),
      );
      const last = messages.filter((m) => m.seq <= rec.deliveredThrough && norm(m.from) !== key).pop();
      rec.deliveredAt = last?.deliveredAt ?? null;
    }
  }

  // A thread nobody is in is not a thread. A DM needs both halves; a group
  // needs at least one member left to own it.
  if (members.length === 0) return null;
  if (kind === "dm" && members.length !== 2) return null;
  if (kind === "group" && !members.some((m) => m.role === "owner")) members[0].role = "owner";

  const title =
    kind === "group" && typeof r.title === "string" && r.title.trim()
      ? r.title.trim().slice(0, THREAD_TITLE_MAX)
      : null;

  return {
    version: 1,
    id,
    kind,
    title,
    members,
    participants: members.map((m) => m.username),
    messages,
    nextSeq,
    createdAt,
    createdBy:
      typeof r.createdBy === "string" && r.createdBy.trim()
        ? norm(r.createdBy)
        : (messages[0]?.from ?? members[0].username),
    updatedAt,
  };
}

function readThreadFile(id: string): StoredThread | null {
  if (!validThreadId(id)) return null;
  return normalizeThread(readJsonFile<unknown>(threadFile(id)), id);
}

/** Persist. `participants` is re-derived here and nowhere else, so the mirror
 *  and its source cannot drift. */
async function saveThread(thread: StoredThread): Promise<void> {
  thread.participants = thread.members.map((m) => m.username);
  await writeJsonAtomic(threadFile(thread.id), thread);
}

function emptyDmThread(a: string, b: string): StoredThread {
  const now = new Date().toISOString();
  const [p1, p2] = [norm(a), norm(b)].sort() as [string, string];
  return {
    version: 1,
    id: threadIdFor(a, b),
    kind: "dm",
    title: null,
    members: [emptyMember(p1, "member", now, 0), emptyMember(p2, "member", now, 0)],
    participants: [p1, p2],
    messages: [],
    nextSeq: 1,
    createdAt: now,
    createdBy: norm(a),
    updatedAt: now,
  };
}

/* ---------------------------------- members ------------------------------------ */

function memberOf(thread: StoredThread, user: string): ThreadMember | null {
  const key = norm(user);
  return thread.members.find((m) => norm(m.username) === key) ?? null;
}

const participantOf = (thread: StoredThread, user: string): boolean => memberOf(thread, user) !== null;

/** Trim the thread to its newest {@link THREAD_MESSAGES_MAX} messages.
 *  Returns how many rolled off the front. Seqs are NEVER renumbered — that is
 *  what keeps a cursor pointing at what it pointed at. */
function capThread(thread: StoredThread): number {
  const over = thread.messages.length - THREAD_MESSAGES_MAX;
  if (over <= 0) return 0;
  thread.messages = thread.messages.slice(over);
  return over;
}

/**
 * The two smallest cursors across the members, so "everyone EXCEPT the sender"
 * is an O(1) question per message instead of an O(members) scan.
 */
interface Floor {
  low: number;
  lowUser: string | null;
  second: number;
}

function floorOf(members: ThreadMember[], pick: (m: ThreadMember) => number): Floor {
  let low = Number.POSITIVE_INFINITY;
  let lowUser: string | null = null;
  let second = Number.POSITIVE_INFINITY;
  for (const m of members) {
    const v = pick(m);
    if (v < low) {
      second = low;
      low = v;
      lowUser = norm(m.username);
    } else if (v < second) {
      second = v;
    }
  }
  return { low, lowUser, second };
}

const floorExcept = (f: Floor, user: string): number => (f.lowUser === user ? f.second : f.low);

/**
 * Recompute the two AGGREGATE stamps from the member cursors: a message is
 * `deliveredAt` once every member but its sender has passed it, and `readAt`
 * likewise. Returns how many stamps were newly written.
 *
 * Called after any cursor moves AND after a member leaves — a departure can
 * complete a delivery, and a thread that kept saying "queued" because of
 * somebody who is no longer in the room would be lying about a live one.
 */
function recomputeStamps(thread: StoredThread): number {
  if (thread.messages.length === 0) return 0;
  const now = new Date().toISOString();
  const delivered = floorOf(thread.members, (m) => m.deliveredThrough);
  const read = floorOf(thread.members, (m) => m.readThrough);
  let changed = 0;
  for (const m of thread.messages) {
    const from = norm(m.from);
    if (m.deliveredAt === null && floorExcept(delivered, from) >= m.seq) {
      m.deliveredAt = now;
      changed += 1;
    }
    if (m.readAt === null && floorExcept(read, from) >= m.seq) {
      m.readAt = now;
      changed += 1;
    }
  }
  return changed;
}

/**
 * Carry `user` up to the newest message — the "delivered at next login"
 * moment. Returns how many messages that actually handed them; the caller
 * persists only when something moved.
 */
function stampDelivered(thread: StoredThread, user: string): number {
  const rec = memberOf(thread, user);
  if (!rec) return 0;
  const key = norm(user);
  const newest = thread.nextSeq - 1;
  if (rec.deliveredThrough >= newest) return 0;
  const n = thread.messages.filter((m) => m.seq > rec.deliveredThrough && norm(m.from) !== key).length;
  rec.deliveredThrough = newest;
  if (n > 0) rec.deliveredAt = new Date().toISOString();
  return n;
}

/** Carry `user`'s READ cursor to the newest message. Returns how many that
 *  covered. Delivery follows reading — you cannot read what you were not
 *  handed. */
function stampRead(thread: StoredThread, user: string): number {
  const rec = memberOf(thread, user);
  if (!rec) return 0;
  const key = norm(user);
  const newest = thread.nextSeq - 1;
  if (rec.readThrough >= newest) return 0;
  const n = thread.messages.filter((m) => m.seq > rec.readThrough && norm(m.from) !== key).length;
  rec.readThrough = newest;
  rec.deliveredThrough = Math.max(rec.deliveredThrough, newest);
  return n;
}

/** Unread FOR one member, from their own cursor — never from a scan of who
 *  each message was addressed to, which only ever worked for a pair. */
function unreadIn(thread: StoredThread, user: string): number {
  const rec = memberOf(thread, user);
  if (!rec) return 0;
  const key = norm(user);
  return thread.messages.filter((m) => m.seq > rec.readThrough && norm(m.from) !== key).length;
}

function summarize(thread: StoredThread, user: string): ThreadSummary {
  const key = norm(user);
  const other =
    thread.kind === "dm"
      ? (thread.members.find((m) => norm(m.username) !== key)?.username ?? thread.members[0].username)
      : "";
  return {
    id: thread.id,
    kind: thread.kind,
    with: other,
    title: thread.title,
    members: thread.members.map((m) => m.username),
    lastMessage: thread.messages.length > 0 ? thread.messages[thread.messages.length - 1] : null,
    unread: unreadIn(thread, user),
    updatedAt: thread.updatedAt,
  };
}

/* --------------------------------- the guards ---------------------------------- */

/**
 * ONE refusal for "this member is not reachable to you", used by the absent
 * case, the disabled case and the blocked case alike. Kept as a single
 * expression precisely so the three can never drift apart.
 */
const unreachable: StoreRefusal = {
  ok: false,
  error: "that member cannot receive messages",
  status: 404,
};

/**
 * THE social gate between two people, in both directions. `canInteract` already
 * refuses a block from either side; asking it twice is what catches the
 * `buddiesOnly` half, which is deliberately one-directional (it is a statement
 * about who may reach the SUBJECT).
 *
 * Returns the refusal to hand back, or null. A `blocked` verdict comes back as
 * {@link unreachable} — byte-identical to what an absent member gets, because a
 * probe that can tell the two apart has defeated the silence.
 */
function pairGate(a: Account, b: Account): StoreRefusal | null {
  for (const [actor, subject] of [
    [a, b],
    [b, a],
  ] as Array<[Account, Account]>) {
    const verdict = canInteract(actor.username, subject.username);
    if (verdict.ok) continue;
    if (verdict.reason === "blocked") return unreachable;
    // A buddies-only policy is a stated one, so it may name itself.
    return {
      ok: false,
      error: `${subject.screenname ?? subject.username} only accepts messages from buddies`,
      status: 403,
    };
  }
  return null;
}

/** Every pair among a proposed membership. O(n²) small reads, bounded by the
 *  member cap — a group with two members who blocked each other is the side
 *  door this exists to shut, and it cannot be seen one pair at a time. */
function pairwiseGate(accounts: Account[]): StoreRefusal | null {
  for (let i = 0; i < accounts.length; i += 1) {
    for (let j = i + 1; j < accounts.length; j += 1) {
      const refusal = pairGate(accounts[i], accounts[j]);
      if (refusal) return refusal;
    }
  }
  return null;
}

/** The acting member: a live account that still holds `canMessage`. */
async function resolveSender(from: string): Promise<{ ok: true; account: Account } | StoreRefusal> {
  const sender = await findAccount(from);
  if (!sender || sender.disabled === true) {
    return { ok: false, error: "no account for this session", status: 404 };
  }
  const perms = await effectivePermissions(sender.username);
  if (!perms.canMessage) {
    return { ok: false, error: "messaging has been disabled by an administrator", status: 403 };
  }
  return { ok: true, account: sender };
}

function validateBody(text: string): { ok: true; body: string } | StoreRefusal {
  const body = text.trim();
  if (!body) return { ok: false, error: "message is empty", status: 400 };
  if (body.length > MESSAGE_MAX) {
    return { ok: false, error: `messages are capped at ${MESSAGE_MAX} characters`, status: 400 };
  }
  return { ok: true, body };
}

/* ---------------------------------- sending ------------------------------------ */

/**
 * Append a message to a loaded thread, stamping the cursors of everyone who is
 * online right now. The one place a message is ever created — both send paths
 * come through it, so the DM and group wires cannot drift.
 */
function appendMessage(
  thread: StoredThread,
  from: string,
  to: string,
  body: string,
  online: Set<string>,
): StoredMessage {
  const now = new Date().toISOString();
  const seq = thread.nextSeq;
  thread.nextSeq += 1;
  const message: StoredMessage = {
    id: crypto.randomUUID(),
    threadId: thread.id,
    from,
    to,
    text: body,
    sentAt: now,
    seq,
    deliveredAt: null,
    readAt: null,
  };
  thread.messages.push(message);
  const sender = norm(from);
  // ONLY the online recipients' cursors move. The sender's is deliberately left
  // alone: a cursor says "carried up to", so advancing it here would silently
  // claim they had received every earlier message they never fetched — and
  // their own message needs no cursor, because a member is never counted as a
  // recipient of what they sent (see `floorExcept` and `unreadIn`).
  for (const rec of thread.members) {
    const key = norm(rec.username);
    if (key === sender) continue;
    // An online member is getting this over SSE in the same request, which is
    // what makes the stamp true rather than optimistic.
    if (online.has(key)) {
      rec.deliveredThrough = seq;
      rec.deliveredAt = now;
    }
  }
  capThread(thread);
  recomputeStamps(thread);
  thread.updatedAt = now;
  return message;
}

/**
 * Send a DM. `recipientOnline` comes from the presence registry: a live
 * recipient gets `deliveredAt` stamped now (SSE hands it to their client in
 * the same request); an offline one queues for their next fetch.
 *
 * Signature and refusals unchanged from the pre-groups store on purpose — this
 * is the two-member case of {@link sendToThread}, and the wire it speaks is the
 * one the messenger already speaks.
 */
export async function sendMessage(
  from: string,
  to: string,
  text: string,
  recipientOnline: boolean,
): Promise<MessageResult> {
  const body = validateBody(text);
  if (!body.ok) return body;
  if (norm(from) === norm(to)) {
    return { ok: false, error: "message someone else — that's you", status: 400 };
  }
  const sender = await resolveSender(from);
  if (!sender.ok) return sender;
  const recipient = await findAccount(to);
  if (!recipient || recipient.disabled === true) return unreachable;

  const refusal = pairGate(sender.account, recipient);
  if (refusal) return refusal;

  const id = threadIdFor(sender.account.username, recipient.username);
  const existing = readThreadFile(id);
  const thread = existing ?? emptyDmThread(sender.account.username, recipient.username);
  const online = new Set<string>();
  if (recipientOnline) online.add(norm(recipient.username));
  const message = appendMessage(thread, sender.account.username, recipient.username, body.body, online);
  await saveThread(thread);
  if (!existing) {
    await journal(
      "create",
      threadFile(id),
      `accounts messenger: ${sender.account.username} started a conversation with ${recipient.username}`,
    );
  }
  return { ok: true, message, created: !existing, members: thread.participants };
}

/**
 * Send into any thread by id — the group path, and the one a group-aware client
 * uses for a DM too. `onlineMembers` is the presence registry's answer for the
 * room, read by the route and passed in for exactly the reason the DM path
 * takes a boolean: the store makes no presence lookups.
 */
export async function sendToThread(
  from: string,
  threadId: string,
  text: string,
  onlineMembers: readonly string[] | ((user: string) => boolean) = [],
): Promise<MessageResult> {
  const body = validateBody(text);
  if (!body.ok) return body;
  const sender = await resolveSender(from);
  if (!sender.ok) return sender;

  const thread = readThreadFile(threadId);
  if (!thread || !participantOf(thread, sender.account.username)) {
    return { ok: false, error: "no such conversation", status: 404 };
  }

  // A DM by id is still a DM: the pair guard applies, exactly as it does on the
  // `to`-addressed path, or this would be the side door around a block.
  if (thread.kind === "dm") {
    const other = thread.members.find((m) => norm(m.username) !== norm(sender.account.username));
    const account = other ? await findAccount(other.username) : null;
    if (!account || account.disabled === true) return unreachable;
    const refusal = pairGate(sender.account, account);
    if (refusal) return refusal;
  }

  // A PREDICATE is accepted as well as a list precisely so a caller that does
  // not yet know the room does not have to READ the thread to find out — a
  // read is a delivery here, and a caller must not stamp itself as having
  // received messages merely because it is about to send one.
  const online = new Set(
    typeof onlineMembers === "function"
      ? thread.participants.filter((u) => onlineMembers(u)).map(norm)
      : onlineMembers.map(norm),
  );
  // A group message is addressed to the ROOM, not to a person — see the `to`
  // field's own contract in ./types.
  const to = thread.kind === "dm"
    ? (thread.members.find((m) => norm(m.username) !== norm(sender.account.username))?.username ?? "")
    : "";
  const message = appendMessage(thread, sender.account.username, to, body.body, online);
  await saveThread(thread);
  return { ok: true, message, created: false, members: thread.participants };
}

/* ---------------------------------- reading ------------------------------------ */

/** Page defaults. Absent `limit` means the WHOLE thread, which is what the
 *  pre-groups wire returned and therefore what it keeps returning. */
const HISTORY_LIMIT_DEFAULT = THREAD_MESSAGES_MAX;

export interface ReadOptions {
  markRead?: boolean;
  /** Newest-first paging: return the messages BEFORE this seq. */
  cursor?: number | null;
  /** How many messages this page holds. Absent = the whole thread. */
  limit?: number;
}

export type ThreadReadResult =
  | { ok: true; thread: Thread; deliveredNow: number; page: MessagePage }
  | StoreRefusal;

/** First index whose seq is >= `seq`. Binary search — the reason a page read
 *  is a seek and not a walk. */
function lowerBound(messages: StoredMessage[], seq: number): number {
  let lo = 0;
  let hi = messages.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (messages[mid].seq < seq) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function pageOf(thread: StoredThread, opts: ReadOptions): MessagePage {
  const total = thread.messages.length;
  const limit = Math.max(
    1,
    Math.min(HISTORY_LIMIT_DEFAULT, Math.floor(opts.limit ?? HISTORY_LIMIT_DEFAULT)),
  );
  const end =
    typeof opts.cursor === "number" && Number.isFinite(opts.cursor)
      ? lowerBound(thread.messages, Math.floor(opts.cursor))
      : total;
  const start = Math.max(0, end - limit);
  const messages = thread.messages.slice(start, end);
  return {
    messages,
    // The seq to ask for next, or null once the page reaches the beginning.
    nextCursor: start > 0 ? thread.messages[start].seq : null,
    total,
  };
}

/** Apply the read side-effects and hand back the result both readers return. */
async function readThread(
  thread: StoredThread,
  user: string,
  opts: ReadOptions,
  persistEmpty: boolean,
): Promise<ThreadReadResult> {
  const deliveredNow = stampDelivered(thread, user);
  let dirty = deliveredNow;
  if (opts.markRead) dirty += stampRead(thread, user);
  if (dirty > 0) dirty += recomputeStamps(thread);
  if (dirty > 0 && (persistEmpty || thread.messages.length > 0)) await saveThread(thread);
  const page = pageOf(thread, opts);
  // The thread carries the PAGE, so a caller that asked for one gets one and a
  // caller that did not gets every message exactly as before.
  return { ok: true, thread: { ...thread, messages: page.messages }, deliveredNow, page };
}

/**
 * One DM, as `user` — synthesizes an empty thread for a pair that has never
 * spoken (the chat window opens honest, not 404). Fetching IS receiving.
 */
export async function getThread(
  user: string,
  other: string,
  opts: ReadOptions = {},
): Promise<ThreadReadResult> {
  const account = await findAccount(other);
  if ((!account || account.disabled === true) && norm(user) !== norm(other)) {
    return { ok: false, error: "no such member", status: 404 };
  }
  const id = threadIdFor(user, other);
  const thread = readThreadFile(id) ?? emptyDmThread(user, other);
  if (!participantOf(thread, user)) {
    return { ok: false, error: "not your conversation", status: 403 };
  }
  return readThread(thread, user, opts, false);
}

/** One thread by id — the group reader, and the paged one. Never synthesizes:
 *  an id that is not on disk is not a conversation somebody has yet to start. */
export async function getThreadById(
  user: string,
  threadId: string,
  opts: ReadOptions = {},
): Promise<ThreadReadResult> {
  const thread = readThreadFile(threadId);
  // An outsider and an absent thread get the SAME refusal: otherwise thread ids
  // become a directory of which rooms exist.
  if (!thread || !participantOf(thread, user)) {
    return { ok: false, error: "no such conversation", status: 404 };
  }
  return readThread(thread, user, opts, true);
}

/**
 * Every conversation `user` is part of, newest first, with unread counts —
 * the buddy list's truth. Stamps delivery on everything queued for `user`
 * (this runs on the first fetch after login: the offline queue lands here)
 * and reports how many messages just arrived that way.
 */
export async function listThreads(
  user: string,
): Promise<{ threads: ThreadSummary[]; unread: number; deliveredNow: number }> {
  const key = norm(user);
  const summaries: ThreadSummary[] = [];
  let unread = 0;
  let deliveredNow = 0;
  for (const id of await allThreadIds()) {
    // A DM id embeds both usernames, so the cheap check still skips the parse.
    // A group id embeds nothing — there is no membership index, so a group file
    // is read to answer the question. That is the cost of not keeping a second
    // index that could disagree with the threads themselves.
    if (!isGroupId(id) && !id.split("--").includes(key)) continue;
    const thread = readThreadFile(id);
    if (!thread || !participantOf(thread, user)) continue;
    const stamped = stampDelivered(thread, user);
    if (stamped > 0) {
      deliveredNow += stamped;
      recomputeStamps(thread);
      await saveThread(thread);
    }
    const summary = summarize(thread, user);
    unread += summary.unread;
    summaries.push(summary);
  }
  summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { threads: summaries, unread, deliveredNow };
}

/** Mark the pair's conversation read as `user`. Returns how many stamped. */
export async function markThreadRead(user: string, other: string): Promise<number> {
  return markThreadReadById(user, threadIdFor(user, other));
}

/** Mark any thread read as `user`, by id. Returns how many messages that
 *  covered. */
export async function markThreadReadById(user: string, threadId: string): Promise<number> {
  const thread = readThreadFile(threadId);
  if (!thread || !participantOf(thread, user)) return 0;
  const n = stampRead(thread, user);
  if (n === 0) return 0;
  recomputeStamps(thread);
  await saveThread(thread);
  return n;
}

/* ------------------------------- group lifecycle -------------------------------- */

const GROUPS_ONLY: StoreRefusal = {
  ok: false,
  error: "that is a direct conversation, not a group",
  status: 400,
};

function cleanTitle(raw: string): string | null {
  const title = raw.trim().slice(0, THREAD_TITLE_MAX).trim();
  return title.length > 0 ? title : null;
}

/**
 * Resolve a proposed membership into live accounts, refusing the whole set on
 * the first name that is not reachable. The order is deliberate: existence
 * before the social gate, so an absent member and a blocked one arrive at
 * {@link unreachable} by the same route.
 */
async function resolveMembers(
  names: string[],
  already: Set<string>,
): Promise<{ ok: true; accounts: Account[] } | StoreRefusal> {
  const accounts: Account[] = [];
  const seen = new Set(already);
  for (const name of names) {
    const key = norm(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const account = await findAccount(key);
    if (!account || account.disabled === true) return unreachable;
    accounts.push(account);
  }
  return { ok: true, accounts };
}

/**
 * Open a group. The creator is its owner; everybody named is a member from the
 * first message. Gated by `canMessage`, by the member cap, and by the pairwise
 * social guard across the WHOLE proposed room.
 */
export async function createGroup(
  actor: string,
  title: string,
  members: string[],
): Promise<ThreadResult> {
  const sender = await resolveSender(actor);
  if (!sender.ok) return sender;

  const resolved = await resolveMembers(members, new Set([norm(sender.account.username)]));
  if (!resolved.ok) return resolved;
  const room = [sender.account, ...resolved.accounts];
  if (room.length < 2) {
    return { ok: false, error: "a group needs somebody else in it", status: 400 };
  }
  const cap = await threadMemberCap(sender.account.username);
  if (room.length > cap) {
    return {
      ok: false,
      error: `a group holds at most ${cap} member${cap === 1 ? "" : "s"} — that is ${room.length}`,
      status: 409,
    };
  }
  const refusal = pairwiseGate(room);
  if (refusal) return refusal;

  const now = new Date().toISOString();
  const id = newGroupId();
  const thread: StoredThread = {
    version: 1,
    id,
    kind: "group",
    title: cleanTitle(title),
    members: room.map((a, i) => emptyMember(norm(a.username), i === 0 ? "owner" : "member", now, 0)),
    participants: room.map((a) => norm(a.username)),
    messages: [],
    nextSeq: 1,
    createdAt: now,
    createdBy: norm(sender.account.username),
    updatedAt: now,
  };
  await saveThread(thread);
  await journal(
    "create",
    threadFile(id),
    `accounts messenger: ${sender.account.username} opened the group "${thread.title ?? id}" with ${room.length} member(s)`,
  );
  return { ok: true, thread };
}

/**
 * Pull somebody into a group. Idempotent for a member who is already in it.
 *
 * The gate is the point: `canInteract` between the newcomer and EVERY member
 * already inside, not merely between them and whoever pressed the button. A
 * check against the inviter alone is exactly the side door — C invites A and B
 * into a room A blocked B out of, and neither of them chose it.
 */
export async function inviteToThread(
  actor: string,
  threadId: string,
  username: string,
): Promise<ThreadResult> {
  const sender = await resolveSender(actor);
  if (!sender.ok) return sender;
  const thread = readThreadFile(threadId);
  if (!thread || !participantOf(thread, sender.account.username)) {
    return { ok: false, error: "no such conversation", status: 404 };
  }
  if (thread.kind !== "group") {
    return {
      ok: false,
      error: "a direct conversation cannot take a third member — open a group instead",
      status: 400,
    };
  }
  const key = norm(username);
  if (memberOf(thread, key)) return { ok: true, thread };

  const invitee = await findAccount(key);
  if (!invitee || invitee.disabled === true) return unreachable;

  const cap = await threadMemberCap(sender.account.username);
  if (thread.members.length + 1 > cap) {
    return {
      ok: false,
      error: `this group is full — it holds at most ${cap} member${cap === 1 ? "" : "s"}`,
      status: 409,
    };
  }

  const insiders = await resolveMembers(
    thread.members.map((m) => m.username),
    new Set([key]),
  );
  if (!insiders.ok) return insiders;
  for (const inside of insiders.accounts) {
    const refusal = pairGate(inside, invitee);
    if (refusal) return refusal;
  }

  const now = new Date().toISOString();
  // Joining shows the history but starts at zero unread: a newcomer owes
  // nobody a backlog, and a badge of 400 on arrival is a badge nobody reads.
  thread.members.push(emptyMember(norm(invitee.username), "member", now, thread.nextSeq - 1));
  thread.updatedAt = now;
  await saveThread(thread);
  await journal(
    "edit",
    threadFile(thread.id),
    `accounts messenger: ${sender.account.username} added ${invitee.username} to the group "${thread.title ?? thread.id}"`,
  );
  return { ok: true, thread };
}

export type LeaveResult =
  | { ok: true; thread: Thread | null; deleted: boolean; members: string[] }
  | StoreRefusal;

/**
 * Leave a group. The last member out deletes it — an empty room is a file
 * nobody can ever open again. An owner leaving hands ownership to the
 * longest-standing member left, because a group with no owner cannot be
 * renamed and would need an admin to unstick.
 *
 * `members` is the list BEFORE the departure, so the route can tell everyone
 * who was in the room, including the person who left.
 */
export async function leaveThread(actor: string, threadId: string): Promise<LeaveResult> {
  const account = await findAccount(actor);
  if (!account || account.disabled === true) {
    return { ok: false, error: "no account for this session", status: 404 };
  }
  const thread = readThreadFile(threadId);
  if (!thread || !participantOf(thread, account.username)) {
    return { ok: false, error: "no such conversation", status: 404 };
  }
  if (thread.kind !== "group") return GROUPS_ONLY;

  const before = thread.participants.slice();
  const key = norm(account.username);
  const leaver = memberOf(thread, key);
  thread.members = thread.members.filter((m) => norm(m.username) !== key);

  if (thread.members.length === 0) {
    await fsp.rm(threadFile(thread.id), { force: true });
    await journal(
      "delete",
      threadFile(thread.id),
      `accounts messenger: ${account.username} left the group "${thread.title ?? thread.id}" and it is now empty`,
    );
    return { ok: true, thread: null, deleted: true, members: before };
  }

  if (leaver?.role === "owner" && !thread.members.some((m) => m.role === "owner")) {
    // Longest-standing first; the member list is append-ordered, so index 0 is
    // exactly that without a sort that could reorder equal stamps differently.
    thread.members[0].role = "owner";
  }
  thread.updatedAt = new Date().toISOString();
  // One fewer member can COMPLETE a delivery that was waiting on them.
  recomputeStamps(thread);
  await saveThread(thread);
  await journal(
    "edit",
    threadFile(thread.id),
    `accounts messenger: ${account.username} left the group "${thread.title ?? thread.id}"`,
  );
  return { ok: true, thread, deleted: false, members: before };
}

/** Rename a group. Owner only — a shared room's name is the one thing the role
 *  exists to decide. An empty title clears it back to unnamed. */
export async function renameThread(
  actor: string,
  threadId: string,
  title: string,
): Promise<ThreadResult> {
  const account = await findAccount(actor);
  if (!account || account.disabled === true) {
    return { ok: false, error: "no account for this session", status: 404 };
  }
  const thread = readThreadFile(threadId);
  const rec = thread ? memberOf(thread, account.username) : null;
  if (!thread || !rec) return { ok: false, error: "no such conversation", status: 404 };
  if (thread.kind !== "group") return GROUPS_ONLY;
  if (rec.role !== "owner") {
    return { ok: false, error: "only the group's owner can rename it", status: 403 };
  }
  const next = cleanTitle(title);
  if (next === thread.title) return { ok: true, thread };
  thread.title = next;
  thread.updatedAt = new Date().toISOString();
  await saveThread(thread);
  await journal(
    "edit",
    threadFile(thread.id),
    `accounts messenger: ${account.username} renamed a group to "${next ?? "(unnamed)"}"`,
  );
  return { ok: true, thread };
}

/* ------------------------------ admin operations -------------------------------- */

/** Every thread file that parses, listed for the readdir helpers below. */
async function allThreadIds(): Promise<string[]> {
  try {
    return (await fsp.readdir(messagesDir()))
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -".json".length))
      .filter(validThreadId);
  } catch {
    return [];
  }
}

/**
 * Stats for every conversation in the store — the admin overview's messaging
 * view. Counts and sizes only, deliberately never message text: the admin
 * manages the DATA, the conversations stay between their participants.
 */
export async function adminListThreads(): Promise<AdminThreadInfo[]> {
  const out: AdminThreadInfo[] = [];
  for (const id of await allThreadIds()) {
    const thread = readThreadFile(id);
    if (!thread) continue;
    let sizeBytes = 0;
    try {
      sizeBytes = (await fsp.stat(threadFile(id))).size;
    } catch {
      /* stat raced a delete — 0 is honest enough */
    }
    out.push({
      id,
      kind: thread.kind,
      title: thread.title,
      participants: thread.participants,
      messages: thread.messages.length,
      // "Queued" is now a room-wide question: a message somebody in it has
      // still not been handed. On a DM that is the same number it always was.
      queued: thread.messages.filter((m) => m.deliveredAt === null).length,
      firstAt: thread.messages[0]?.sentAt ?? thread.createdAt,
      lastAt: thread.messages[thread.messages.length - 1]?.sentAt ?? thread.updatedAt,
      sizeBytes,
    });
  }
  return out.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

/** Admin deletes one whole conversation, history and offline queue included. */
export async function deleteThread(
  actor: string,
  id: string,
): Promise<{ ok: true; messagesRemoved: number } | StoreRefusal> {
  const gate = await requireAdmin(actor);
  if (!gate.ok) return { ok: false, error: gate.error, status: gate.status };
  const thread = readThreadFile(id);
  if (!thread) return { ok: false, error: "no such conversation", status: 404 };
  await fsp.rm(threadFile(id), { force: true });
  await journal(
    "delete",
    threadFile(id),
    `accounts messenger: admin ${actor} deleted the ${thread.participants.join(" ↔ ")} conversation (${thread.messages.length} message(s))`,
  );
  return { ok: true, messagesRemoved: thread.messages.length };
}

/**
 * Admin wipes every conversation a member is part of — the EXPLICIT half of
 * the remove-user story; the automatic cascade leaves threads alone
 * (see `./admin`).
 *
 * A DM is deleted outright, as it always was: it belongs to the two of them.
 * A GROUP is only deleted if they were its last member — otherwise they are
 * REMOVED from it and the room survives, because four other people's history is
 * not this member's to take with them.
 */
export async function deleteUserThreads(
  actor: string,
  user: string,
): Promise<
  | { ok: true; threadsDeleted: number; threadsLeft: number; messagesRemoved: number }
  | StoreRefusal
> {
  const gate = await requireAdmin(actor);
  if (!gate.ok) return { ok: false, error: gate.error, status: gate.status };
  const key = norm(user);
  let threadsDeleted = 0;
  let threadsLeft = 0;
  let messagesRemoved = 0;
  for (const id of await allThreadIds()) {
    if (!isGroupId(id) && !id.split("--").includes(key)) continue;
    const thread = readThreadFile(id);
    if (!thread || !participantOf(thread, key)) continue;
    if (thread.kind === "group" && thread.members.length > 1) {
      thread.members = thread.members.filter((m) => norm(m.username) !== key);
      if (!thread.members.some((m) => m.role === "owner")) thread.members[0].role = "owner";
      thread.updatedAt = new Date().toISOString();
      recomputeStamps(thread);
      await saveThread(thread);
      threadsLeft += 1;
      continue;
    }
    await fsp.rm(threadFile(id), { force: true });
    threadsDeleted += 1;
    messagesRemoved += thread.messages.length;
  }
  if (threadsDeleted > 0 || threadsLeft > 0) {
    await journal(
      "delete",
      messagesDir(),
      `accounts messenger: admin ${actor} deleted ${threadsDeleted} conversation(s) involving "${user}" (${messagesRemoved} message(s)) and removed them from ${threadsLeft} group(s)`,
    );
  }
  return { ok: true, threadsDeleted, threadsLeft, messagesRemoved };
}

/**
 * Admin sweep across every thread. Two independent reasons a message rolls
 * off, and a run applies both:
 *
 *  - the {@link THREAD_MESSAGES_MAX} cap, re-asserted — sends already trim
 *    inline, so this only finds work after a cap change or a hand-edited store;
 *  - **RETENTION BY AGE**, when `olderThanDays` is given: everything sent
 *    before the cutoff, `0` meaning every message there is.
 *
 * The age half arrived with P6 of `axf-amberxvid-social` (2026-08-15), when
 * amberxvid's parallel message store retired into this one. Its admin window
 * has always offered prune-older-than-N-days, and dropping the capability
 * because the store moved would have been a silent regression in a surface
 * nobody was asked about. It lives here because this is where the messages
 * live now — not in a second sweep that could disagree with this one.
 *
 * **A thread is never DELETED by pruning**, including one pruned empty. That
 * is this store's own posture rather than the retiring store's (which removed
 * emptied threads): a group is a shared room, and deleting it would evict
 * members who never asked for a retention policy. An emptied DM re-opens with
 * its history gone, which is what the administrator asked for.
 *
 * One ledger entry summarises the sweep.
 */
export async function pruneMessages(
  actor: string,
  opts: { olderThanDays?: number | null } = {},
): Promise<
  { ok: true; threadsTouched: number; messagesRemoved: number; cutoff: string | null } | StoreRefusal
> {
  const gate = await requireAdmin(actor);
  if (!gate.ok) return { ok: false, error: gate.error, status: gate.status };
  const days =
    typeof opts.olderThanDays === "number" && Number.isFinite(opts.olderThanDays)
      ? Math.max(0, opts.olderThanDays)
      : null;
  const cutoff = days === null ? null : new Date(Date.now() - days * 86_400_000).toISOString();
  let threadsTouched = 0;
  let messagesRemoved = 0;
  for (const id of await allThreadIds()) {
    const thread = readThreadFile(id);
    if (!thread) continue;
    let removed = capThread(thread);
    if (cutoff !== null) {
      const keep = thread.messages.filter((m) => m.sentAt >= cutoff);
      removed += thread.messages.length - keep.length;
      thread.messages = keep;
    }
    if (removed === 0) continue;
    threadsTouched += 1;
    messagesRemoved += removed;
    thread.updatedAt = new Date().toISOString();
    await saveThread(thread);
  }
  if (messagesRemoved > 0) {
    await journal(
      "delete",
      messagesDir(),
      cutoff === null
        ? `accounts messenger: admin ${actor} pruned ${messagesRemoved} message(s) over the ${THREAD_MESSAGES_MAX}-per-thread cap across ${threadsTouched} conversation(s)`
        : `accounts messenger: admin ${actor} pruned ${messagesRemoved} message(s) older than ${days} day(s) across ${threadsTouched} conversation(s)`,
    );
  }
  return { ok: true, threadsTouched, messagesRemoved, cutoff };
}
