/**
 * @file Accounts social graph — buddies, blocks, and THE interaction guard.
 *
 * Identity lives in accounts, so the social graph lives here too: blocking
 * someone in the messenger blocks them in a call, a room, on the wall and in
 * an invite, because all six ask {@link canInteract} rather than each keeping
 * its own idea of who may talk to whom.
 *
 * ONE FILE, not one per member (`<root>/relations.json`, the `permissions.json`
 * shape). A buddy edge is MUTUAL and therefore lives in two records at once;
 * two files would mean two writes and a window where A is B's buddy but B is
 * not A's. The whole document is rewritten atomically per mutation, so the
 * graph is never half-applied. A studio roster is tens to hundreds of members
 * — the file is small and the consistency is free.
 *
 * ## The three states, and the one that is silent
 *
 * - **Buddy** — mutual and consented: A requests, B accepts. Requesting
 *   somebody who has already requested you completes the pair immediately
 *   (AIM crossed those two requests too).
 * - **Pending** — `outgoing` on the asker, `incoming` on the asked. One
 *   severing verb, {@link removeRelation}, performs decline, cancel AND
 *   unfriend: the caller does not have to know which edge it is severing, and
 *   the answer to "may I still see this person" never depends on which one it
 *   was.
 * - **Blocked** — UNILATERAL, immediate, and **silent to the blocked party**.
 *   A block that announces itself invites retaliation, so nothing anywhere
 *   tells the blocked user a block exists: `notify` never includes them, and
 *   every surface renders a `blocked` verdict as ITS OWN "no such subject"
 *   refusal (see the consumer registry below). What they DO see is that the
 *   buddy edge is gone — which is indistinguishable from an ordinary
 *   unfriending, and that is the point.
 *
 * Blocking severs every edge in both directions. Unblocking does NOT restore
 * them: consent is not resumed by revoking a refusal, and a buddy list that
 * silently repopulated would be a surprise in the wrong direction.
 *
 * ## The guard, and its registry of consumers
 *
 * {@link canInteract} is the ONE answer. A consumer asks it and maps the
 * verdict onto its own surface; a consumer that re-implements the answer is
 * the defect this file exists to prevent — the moment two copies of the rule
 * exist, one of them is the one that gets forgotten when blocking changes.
 *
 * | Consumer | Phase | State |
 * |---|---|---|
 * | accounts DM send (`./messages` → `sendMessage`) | P4 | **wired** |
 * | accounts profile reads (`./profiles` → `getProfile`/`listProfiles`) | P4 | **wired** |
 * | amberxvid 1:1 calls | P5 | must join |
 * | amberxvid group rooms + invites | P6/P7 | must join |
 * | the wall (posts, comments, reactions) | P8 | must join |
 * | ring alerts | P9 | must join |
 *
 * A new interaction path joins that table on the day it is built. The two
 * mapping rules it inherits:
 *
 * 1. **`blocked` is rendered byte-identical to that surface's own refusal for
 *    a subject that does not exist.** Never a distinct error, never a distinct
 *    status — a probe that can tell "blocked" from "gone" has defeated the
 *    silence.
 * 2. **`not-buddy-required` is a stated policy, so it may say so.** It comes
 *    from the SUBJECT's `buddiesOnly` switch and nothing else; a consumer that
 *    wants buddies-only behaviour turns that switch on rather than inventing
 *    its own requirement.
 *
 * ## What the guard deliberately does NOT cover
 *
 * - **The presence roster stays unfiltered.** It is a membership list — the
 *   same information `/api/accounts/users` already gives every signed-in
 *   member — and it is broadcast once to every stream rather than resolved per
 *   viewer. Blocks hide the profile and refuse every interaction; they do not
 *   claim the account was never created.
 * - **Administrators do not bypass it.** An admin who needs a member's data
 *   uses the admin surfaces, which are audited; a member-facing route is a
 *   member-facing route whoever is signed into it.
 * - **Reading an existing conversation is not an interaction.** The guard is
 *   wired into the DM SEND path; a block stops the next message, it does not
 *   retroactively delete the history both people already have.
 *
 * House store posture (`./fsCore`): degrade never crash (a junk file reads as
 * an empty graph, which refuses nothing rather than locking everyone out),
 * atomic writes, every mutation journaled. Server-only.
 */

import path from "node:path";
import { appendJournal, readJsonFile, writeJsonAtomic } from "./fsCore";
import { findAccount, listAccounts } from "./accounts";
import { relationsFile } from "./paths";
import type { Account, BuddyRow, RelationsView } from "./types";

/* --------------------------------- the guard ---------------------------------- */

/** Why an interaction was refused. See the mapping rules in the header. */
export type InteractionReason = "blocked" | "not-buddy-required";

/** The one verdict. `{ ok: true }` or a reason — consumers map, never rethink. */
export type Interaction = { ok: true } | { ok: false; reason: InteractionReason };

/**
 * MAY `actor` interact with `subject`? Every consumer asks this and nobody
 * re-implements its answer (registry in the file header).
 *
 * Synchronous by design — it reads one small document, exactly as `grantsFor`
 * does, so a call site has no excuse to skip it "because it is async here".
 *
 * A block refuses in BOTH directions: the blocked cannot reach the blocker,
 * and the blocker does not get a one-way channel into someone they refused.
 */
export function canInteract(actor: string, subject: string): Interaction {
  const a = norm(actor);
  const b = norm(subject);
  // An empty name is not a member; refusing it as "blocked" keeps the caller
  // on the cover-story path rather than inventing a third answer.
  if (!a || !b) return { ok: false, reason: "blocked" };
  if (a === b) return { ok: true };

  const doc = readDoc();
  const mine = doc.users[a];
  const theirs = doc.users[b];
  if (mine?.blocked.includes(b) === true || theirs?.blocked.includes(a) === true) {
    return { ok: false, reason: "blocked" };
  }
  if (theirs?.buddiesOnly === true && !theirs.buddies.includes(a)) {
    return { ok: false, reason: "not-buddy-required" };
  }
  return { ok: true };
}

/* -------------------------------- persistence --------------------------------- */

/** One member's record, as `relations.json` stores it (all names lowercased). */
export interface UserRelations {
  /** Mutual, accepted. Mirrored in the other member's `buddies`. */
  buddies: string[];
  /** Requests this member SENT, awaiting the other's accept. */
  outgoing: string[];
  /** Requests sent TO this member, awaiting their accept. */
  incoming: string[];
  /** Members this member blocked. Unilateral — never mirrored, never exposed
   *  to anyone but the owner. */
  blocked: string[];
  /** When true, only buddies may interact — the sole source of the
   *  `not-buddy-required` verdict. Default false: a studio stays open until a
   *  member says otherwise, the same default-allow posture as permissions. */
  buddiesOnly: boolean;
}

interface RelationsDoc {
  version: 1;
  /** username (lowercased) → record. An absent member has no relations. */
  users: Record<string, UserRelations>;
  updatedAt: string;
}

export type RelationResult =
  | { ok: true; relations: RelationsView; notify: string[] }
  | { ok: false; error: string; status: number };

const norm = (u: string): string => u.trim().toLowerCase();

const fwd = (p: string): string => p.replace(/\\/g, "/");

function ledgerPath(abs: string): string {
  const rel = path.relative(process.cwd(), abs);
  return fwd(rel.startsWith("..") ? abs : rel);
}

function emptyRecord(): UserRelations {
  return { buddies: [], outgoing: [], incoming: [], blocked: [], buddiesOnly: false };
}

/** Normalize a stored list: strings only, lowercased, de-duplicated, never
 *  containing the owner themselves. */
function normList(raw: unknown, owner: string): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const key = norm(v);
    if (key && key !== owner && !out.includes(key)) out.push(key);
  }
  return out;
}

/** The whole graph, normalized. Junk reads as empty — an unreadable relations
 *  file must not refuse interactions nobody blocked. */
function readDoc(): RelationsDoc {
  // Read LOOSE, not as a `RelationsDoc`: the file is whatever is on disk, and
  // typing it as the document it is supposed to be would let a hand-edited
  // list of numbers through the very normalisation written to catch it.
  const raw = readJsonFile<{ version?: unknown; users?: unknown; updatedAt?: unknown }>(
    relationsFile(),
  );
  const users: Record<string, UserRelations> = {};
  if (raw?.version === 1 && typeof raw.users === "object" && raw.users !== null) {
    for (const [name, rec] of Object.entries(raw.users as Record<string, unknown>)) {
      const key = norm(name);
      if (!key || typeof rec !== "object" || rec === null) continue;
      const r = rec as Record<string, unknown>;
      users[key] = {
        buddies: normList(r.buddies, key),
        outgoing: normList(r.outgoing, key),
        incoming: normList(r.incoming, key),
        blocked: normList(r.blocked, key),
        buddiesOnly: r.buddiesOnly === true,
      };
    }
  }
  return {
    version: 1,
    users,
    updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString(),
  };
}

/** The member's record inside `doc`, created empty if this is their first edge. */
function recordIn(doc: RelationsDoc, key: string): UserRelations {
  const existing = doc.users[key];
  if (existing) return existing;
  const fresh = emptyRecord();
  doc.users[key] = fresh;
  return fresh;
}

/** Read-only view of a member's record — the guard's cheap accessor and what
 *  a consumer uses when it needs the raw lists rather than a verdict. */
export function relationsFor(username: string): UserRelations {
  return readDoc().users[norm(username)] ?? emptyRecord();
}

async function writeDoc(doc: RelationsDoc, summary: string): Promise<void> {
  // Empty records are dropped on the way out: a member who blocked and then
  // unblocked leaves no row behind, so the file stays a record of real edges.
  const users: Record<string, UserRelations> = {};
  for (const [key, rec] of Object.entries(doc.users)) {
    const empty =
      rec.buddies.length === 0 &&
      rec.outgoing.length === 0 &&
      rec.incoming.length === 0 &&
      rec.blocked.length === 0 &&
      rec.buddiesOnly === false;
    if (!empty) users[key] = rec;
  }
  const next: RelationsDoc = { version: 1, users, updatedAt: new Date().toISOString() };
  await writeJsonAtomic(relationsFile(), next);
  await appendJournal("edit", ledgerPath(relationsFile()), { summary });
}

/* ---------------------------------- edge ops ----------------------------------- */

function addTo(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
}

function dropFrom(list: string[], value: string): void {
  const i = list.indexOf(value);
  if (i >= 0) list.splice(i, 1);
}

/** Remove every buddy/pending edge between the pair, both directions. Blocks
 *  are deliberately untouched — severing is not unblocking. */
function severEdges(doc: RelationsDoc, a: string, b: string): void {
  const ra = recordIn(doc, a);
  const rb = recordIn(doc, b);
  for (const list of [ra.buddies, ra.outgoing, ra.incoming]) dropFrom(list, b);
  for (const list of [rb.buddies, rb.outgoing, rb.incoming]) dropFrom(list, a);
}

/* ---------------------------------- the view ----------------------------------- */

const rowFor = (a: Account): BuddyRow => ({
  username: a.username,
  screenname: a.screenname,
});

/**
 * A member's own relations, resolved against the roster: usernames become
 * rows carrying screennames, and members whose accounts are gone or disabled
 * drop out (a dangling edge is not shown, and is cleaned up by the next
 * mutation that rewrites the document).
 *
 * PRESENCE IS NOT JOINED HERE. Exactly as the messages store leaves `online`
 * to its route, the online/away/last-seen decoration is the relations route's
 * job — which is what keeps this file free of the presence registry, and the
 * presence registry free of this one.
 */
export async function listRelations(username: string): Promise<RelationsView> {
  const key = norm(username);
  const rec = readDoc().users[key] ?? emptyRecord();
  const accounts = await listAccounts();
  const live = new Map<string, Account>();
  for (const a of accounts) {
    if (a.disabled !== true) live.set(norm(a.username), a);
  }
  const rows = (names: string[]): BuddyRow[] =>
    names
      .map((n) => live.get(n))
      .filter((a): a is Account => a !== undefined)
      .map(rowFor)
      .sort((x, y) =>
        (x.screenname ?? x.username).localeCompare(y.screenname ?? y.username, undefined, {
          sensitivity: "base",
        }),
      );
  return {
    username: live.get(key)?.username ?? username,
    buddies: rows(rec.buddies),
    incoming: rows(rec.incoming),
    outgoing: rows(rec.outgoing),
    // The blocked list is the owner's alone — it is returned to THEM and to
    // nobody else, and no other view of any member ever includes it.
    blocked: rows(rec.blocked),
    buddiesOnly: rec.buddiesOnly,
  };
}

/* --------------------------------- mutations ------------------------------------ */

/** The refusal a blocked actor gets from every relations mutation: the same
 *  404 a member who does not exist gets. Rule 1 of the header. */
const COVER = { ok: false as const, error: "no such member", status: 404 };

interface Pair {
  actor: Account;
  subject: Account;
  a: string;
  b: string;
}

/**
 * Resolve both ends of a mutation: the actor must be a live account, the
 * subject must be a live account, and they must not be the same person.
 * Returns the refusal to hand back, or the pair.
 */
async function resolvePair(
  actor: string,
  subject: string,
): Promise<{ ok: true; pair: Pair } | { ok: false; error: string; status: number }> {
  const a = norm(actor);
  const b = norm(subject);
  if (!b) return { ok: false, error: "which member?", status: 400 };
  if (a === b) return { ok: false, error: "that's you", status: 400 };
  const [actorAccount, subjectAccount] = await Promise.all([findAccount(a), findAccount(b)]);
  if (!actorAccount || actorAccount.disabled === true) {
    return { ok: false, error: "no account for this session", status: 404 };
  }
  if (!subjectAccount || subjectAccount.disabled === true) return COVER;
  return { ok: true, pair: { actor: actorAccount, subject: subjectAccount, a, b } };
}

/** Ask the guard's block half for a mutation. Blocking somebody who blocked
 *  you must still work, so `blockUser` skips this. */
function blockedEither(doc: RelationsDoc, a: string, b: string): boolean {
  return doc.users[a]?.blocked.includes(b) === true || doc.users[b]?.blocked.includes(a) === true;
}

async function done(actor: string, notify: string[]): Promise<RelationResult> {
  return { ok: true, relations: await listRelations(actor), notify };
}

/**
 * Send a buddy request. Idempotent: asking an existing buddy, or asking twice,
 * changes nothing and succeeds. Asking somebody whose request is already
 * waiting for you ACCEPTS it — two people who ask each other are buddies, and
 * making one of them ask twice would be theatre.
 *
 * A blocked pair gets {@link COVER}: from the blocked side this member simply
 * does not exist.
 */
export async function requestBuddy(actor: string, subject: string): Promise<RelationResult> {
  const gate = await resolvePair(actor, subject);
  if (!gate.ok) return gate;
  const { a, b } = gate.pair;

  const doc = readDoc();
  if (blockedEither(doc, a, b)) return COVER;
  const ra = recordIn(doc, a);
  const rb = recordIn(doc, b);

  if (ra.buddies.includes(b)) return done(actor, []);

  if (ra.incoming.includes(b)) {
    // They asked first — this request is an acceptance.
    dropFrom(ra.incoming, b);
    dropFrom(rb.outgoing, a);
    addTo(ra.buddies, b);
    addTo(rb.buddies, a);
    await writeDoc(doc, `accounts relations: ${gate.pair.actor.username} and ${gate.pair.subject.username} are buddies`);
    return done(actor, [gate.pair.actor.username, gate.pair.subject.username]);
  }

  if (ra.outgoing.includes(b)) return done(actor, []);
  addTo(ra.outgoing, b);
  addTo(rb.incoming, a);
  await writeDoc(
    doc,
    `accounts relations: ${gate.pair.actor.username} asked ${gate.pair.subject.username} to be buddies`,
  );
  return done(actor, [gate.pair.actor.username, gate.pair.subject.username]);
}

/**
 * Accept a waiting request. No request → 404 with the same wording a blocked
 * pair gets, so declining-then-retrying and being-blocked are one answer.
 */
export async function acceptBuddy(actor: string, requester: string): Promise<RelationResult> {
  const gate = await resolvePair(actor, requester);
  if (!gate.ok) return gate;
  const { a, b } = gate.pair;

  const doc = readDoc();
  if (blockedEither(doc, a, b)) return COVER;
  const ra = recordIn(doc, a);
  const rb = recordIn(doc, b);
  if (ra.buddies.includes(b)) return done(actor, []);
  if (!ra.incoming.includes(b)) {
    return { ok: false, error: "there is no request from that member", status: 404 };
  }
  dropFrom(ra.incoming, b);
  dropFrom(rb.outgoing, a);
  addTo(ra.buddies, b);
  addTo(rb.buddies, a);
  await writeDoc(
    doc,
    `accounts relations: ${gate.pair.actor.username} and ${gate.pair.subject.username} are buddies`,
  );
  return done(actor, [gate.pair.actor.username, gate.pair.subject.username]);
}

/**
 * Sever whatever edge the pair has — the one verb behind DECLINE (an incoming
 * request), CANCEL (an outgoing one) and UNFRIEND (a buddy). Idempotent, and
 * deliberately indifferent to which of the three it was: a caller that had to
 * choose would be a caller that can be told which state it was in.
 *
 * A block is NOT removed by this; see {@link unblockUser}.
 */
export async function removeRelation(actor: string, subject: string): Promise<RelationResult> {
  const gate = await resolvePair(actor, subject);
  if (!gate.ok) return gate;
  const { a, b } = gate.pair;

  const doc = readDoc();
  const had =
    doc.users[a]?.buddies.includes(b) === true ||
    doc.users[a]?.outgoing.includes(b) === true ||
    doc.users[a]?.incoming.includes(b) === true;
  if (!had) return done(actor, []);
  severEdges(doc, a, b);
  await writeDoc(
    doc,
    `accounts relations: ${gate.pair.actor.username} removed their relation with ${gate.pair.subject.username}`,
  );
  // The other side IS told — an ordinary unfriending is not a secret, and this
  // is the same event a block deliberately withholds.
  return done(actor, [gate.pair.actor.username, gate.pair.subject.username]);
}

/**
 * Block a member: unilateral, immediate, silent. Every buddy and pending edge
 * between the pair is severed in the same write, so a blocked member cannot
 * linger on the blocker's list.
 *
 * `notify` carries ONLY the blocker. The blocked member's client learns
 * nothing in the moment; the next thing they see is an absent buddy, which is
 * what an ordinary removal looks like.
 *
 * Being blocked does not stop you blocking back — the guard is not consulted
 * here, or a mutual block would be unreachable from the second side.
 */
export async function blockUser(actor: string, subject: string): Promise<RelationResult> {
  const gate = await resolvePair(actor, subject);
  if (!gate.ok) return gate;
  const { a, b } = gate.pair;

  const doc = readDoc();
  const ra = recordIn(doc, a);
  if (ra.blocked.includes(b)) return done(actor, []);
  addTo(ra.blocked, b);
  severEdges(doc, a, b);
  await writeDoc(
    doc,
    `accounts relations: ${gate.pair.actor.username} blocked ${gate.pair.subject.username}`,
  );
  return done(actor, [gate.pair.actor.username]);
}

/**
 * Unblock. The pair can interact again; their old buddy edge does NOT come
 * back — it was severed by the block, and consent is re-given by asking, not
 * by the absence of a refusal.
 */
export async function unblockUser(actor: string, subject: string): Promise<RelationResult> {
  const gate = await resolvePair(actor, subject);
  if (!gate.ok) return gate;
  const { a, b } = gate.pair;

  const doc = readDoc();
  if (doc.users[a]?.blocked.includes(b) !== true) return done(actor, []);
  dropFrom(recordIn(doc, a).blocked, b);
  await writeDoc(
    doc,
    `accounts relations: ${gate.pair.actor.username} unblocked ${gate.pair.subject.username}`,
  );
  // Still only the actor: telling someone they have been unblocked would tell
  // them they were blocked.
  return done(actor, [gate.pair.actor.username]);
}

/**
 * Turn "only my buddies may interact with me" on or off — the ONE source of
 * the `not-buddy-required` verdict. Off by default (default-allow, as
 * permissions are); a consumer that wants buddies-only behaviour asks the
 * member to turn this on rather than inventing its own requirement.
 */
export async function setBuddiesOnly(actor: string, value: boolean): Promise<RelationResult> {
  const key = norm(actor);
  const account = await findAccount(key);
  if (!account || account.disabled === true) {
    return { ok: false, error: "no account for this session", status: 404 };
  }
  const doc = readDoc();
  const rec = recordIn(doc, key);
  if (rec.buddiesOnly === value) return done(actor, []);
  rec.buddiesOnly = value;
  await writeDoc(
    doc,
    `accounts relations: ${account.username} ${value ? "restricted interaction to buddies" : "opened interaction to every member"}`,
  );
  return done(actor, [account.username]);
}

/**
 * Forget a member entirely — the admin remove-user cascade's relations step.
 * Their record goes, and so does every edge pointing AT them (including other
 * members' blocks of them, which have nothing left to refuse).
 */
export async function forgetRelations(username: string): Promise<number> {
  const key = norm(username);
  const doc = readDoc();
  let touched = 0;
  if (doc.users[key]) {
    delete doc.users[key];
    touched += 1;
  }
  for (const rec of Object.values(doc.users)) {
    for (const list of [rec.buddies, rec.outgoing, rec.incoming, rec.blocked]) {
      if (list.includes(key)) {
        dropFrom(list, key);
        touched += 1;
      }
    }
  }
  if (touched > 0) {
    await writeDoc(doc, `accounts relations: removed every relation involving "${username}"`);
  }
  return touched;
}
