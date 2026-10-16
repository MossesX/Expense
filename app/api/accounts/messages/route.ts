/**
 * @file `/api/accounts/messages` — internal messaging: the thread list with
 * unread counts, one conversation, the two mutations, and (P5) the four group
 * verbs. One route, because a group IS a thread — a second endpoint would be a
 * second idea of what a conversation is.
 *
 * GET
 *   - no query          → every conversation you are in, newest first, each
 *                         with its own unread count plus a total.
 *   - `?with=<name>`    → one DM. `&markRead=1` stamps it read in the same call
 *                         (the window is open on it).
 *   - `?thread=<id>`    → one thread by id — the group reader, and the only way
 *                         to reach a group. Same `markRead` flag.
 *   - `&limit=&cursor=` → one PAGE of history, newest-first, on either reader.
 *                         `cursor` is the `nextCursor` of the previous page;
 *                         omitting `limit` returns the whole thread, which is
 *                         what the pre-groups wire returned and still does.
 *
 * FETCHING IS RECEIVING. Both reads stamp delivery on messages that were queued
 * while you were offline, and report `deliveredNow` — that is how the offline
 * queue drains, and it is why the list route is a write. Marking READ is
 * separate and deliberate: delivery is a fact about the transport, reading is a
 * claim about a person, and conflating them would mark a thread read for anyone
 * who merely opened the app.
 *
 * POST `{ action, … }`
 *   - `send`         { to | threadId, text } → capability- and existence-gated
 *                      inside the store: `canMessage` for the sender, a live
 *                      non-disabled account for BOTH ends of a DM, the social
 *                      guard, `MESSAGE_MAX` on the body, and no self-DMs.
 *   - `mark-read`    { with | threadId }     → stamps and returns the new unread.
 *   - `create-group` { title, members[] }    → gated pairwise by `canInteract`.
 *   - `invite`       { threadId, username }  → same guard, against every member
 *                      already in the room.
 *   - `leave`        { threadId }
 *   - `rename`       { threadId, title }     → owner only.
 *
 * PRESENCE IS AN ARGUMENT, NOT A LOOKUP the store makes. `isOnline` is read
 * here and passed in, so the message is stamped delivered in the same write that
 * stores it for whoever has a stream open — and `notifyUsers` hands the stored
 * message to every member's stream in this same request. That is the whole
 * live-delivery path: no poller, no queue drain, no second write.
 *
 * The four group verbs push a payload-free `threads` nudge instead of a diff,
 * for the reason the `relations` nudge exists: a push would have to be computed
 * per recipient to avoid telling one member what another's list looks like, and
 * a refetch is already scoped to the asker by this route.
 */

import { NextResponse, type NextRequest } from "next/server";
import { fail, readJsonBody, refuse, requireSession, str } from "@axs/modules/accounts/lib/http";
import {
  assertCapability,
  assertMessageRate,
  type PolicyVerdict,
} from "@axs/modules/accounts/lib/policy";
import {
  createGroup,
  getThread,
  getThreadById,
  inviteToThread,
  leaveThread,
  listThreads,
  markThreadRead,
  markThreadReadById,
  renameThread,
  sendMessage,
  sendToThread,
} from "@axs/modules/accounts/lib/messages";
import { isOnline, notifyUsers } from "@axs/modules/accounts/lib/presence";
import { MESSAGE_MAX, THREAD_TITLE_MAX } from "@axs/modules/accounts/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A policy refusal as a response. The row and the effective value travel
 * alongside the sentence, so a member can quote a key to their administrator
 * rather than describing what the screen said.
 */
const denyPolicy = (v: Extract<PolicyVerdict, { ok: false }>): NextResponse =>
  NextResponse.json(
    { ok: false, error: v.error, policyRow: v.row, limit: v.value },
    { status: v.status },
  );

/** A string-array field, trimmed and de-junked — `members` is the only one. */
function strList(body: Record<string, unknown>, key: string): string[] {
  const raw = body[key];
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean);
}

/** The two paging arguments, or undefined so the store's own defaults bite. */
function paging(req: NextRequest): { cursor?: number; limit?: number } {
  const out: { cursor?: number; limit?: number } = {};
  const cursor = Number(req.nextUrl.searchParams.get("cursor") ?? "");
  if (Number.isFinite(cursor) && cursor > 0) out.cursor = Math.floor(cursor);
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "");
  if (Number.isFinite(limit) && limit > 0) out.limit = Math.floor(limit);
  return out;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = requireSession(req);
  if ("deny" in gate) return gate.deny;

  const markRead = req.nextUrl.searchParams.get("markRead") === "1";
  const opts = { markRead, ...paging(req) };

  const threadId = (req.nextUrl.searchParams.get("thread") ?? "").trim();
  if (threadId) {
    const result = await getThreadById(gate.user, threadId, opts);
    if (!result.ok) return refuse(result);
    return NextResponse.json({
      ok: true,
      thread: result.thread,
      page: result.page,
      deliveredNow: result.deliveredNow,
      // Who in the room is reachable right now — the group's answer to the
      // DM route's single `online` flag.
      online: result.thread.participants.filter(isOnline),
    });
  }

  const peer = (req.nextUrl.searchParams.get("with") ?? "").trim();
  if (peer) {
    const result = await getThread(gate.user, peer, opts);
    if (!result.ok) return refuse(result);
    return NextResponse.json({
      ok: true,
      thread: result.thread,
      page: result.page,
      deliveredNow: result.deliveredNow,
      online: isOnline(peer),
    });
  }

  const { threads, unread, deliveredNow } = await listThreads(gate.user);
  return NextResponse.json({
    ok: true,
    threads: threads.map((t) => ({ ...t, online: t.kind === "dm" ? isOnline(t.with) : undefined })),
    unread,
    deliveredNow,
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = requireSession(req);
  if ("deny" in gate) return gate.deny;

  const read = await readJsonBody(req);
  if (!read.ok) return read.deny;
  const action = str(read.body, "action");
  const threadId = str(read.body, "threadId").trim();

  /** Tell a set of members their conversation list moved. */
  const nudge = (members: string[]): void => {
    notifyUsers(members, { type: "threads", at: new Date().toISOString() });
  };

  if (action === "send") {
    const text = str(read.body, "text");
    // The store enforces this too; refusing here saves a disk read on a body
    // that can never be stored, and names the cap the client should have used.
    if (text.length > MESSAGE_MAX) {
      return fail(400, `messages are capped at ${MESSAGE_MAX} characters`);
    }

    // THE POLICY GATE, in this order on purpose. `canMessage` is the standing
    // decision and is checked first, so a member who may not message at all is
    // never told they are merely going too fast. The store re-checks the
    // capability from the grants record and cannot disagree — `effectivePolicy`
    // composes that same record in (`lib/policy.ts`), so both reads have one
    // source; what the store cannot see is the site tier, which is why the gate
    // is here and not only there.
    const may = await assertCapability(gate.user, "canMessage");
    if (!may.ok) return denyPolicy(may);
    // Counted only when it ALLOWS, so a client that keeps retrying cannot
    // extend its own lock-out.
    const rate = await assertMessageRate(gate.user);
    if (!rate.ok) return denyPolicy(rate);
    if (threadId) {
      // `isOnline` goes in as a PREDICATE, not a pre-read list: reading a
      // thread is a delivery, so fetching the room first to find out who is in
      // it would stamp the SENDER as having received everything in it. The
      // store already refuses an outsider without this route knowing the room.
      const result = await sendToThread(gate.user, threadId, text, isOnline);
      if (!result.ok) return refuse(result);
      notifyUsers(result.members, { type: "message", message: result.message });
      return NextResponse.json({
        ok: true,
        message: result.message,
        created: result.created,
        delivered: result.message.deliveredAt !== null,
      });
    }
    const to = str(read.body, "to").trim();
    if (!to) return fail(400, "who to?");
    const result = await sendMessage(gate.user, to, text, isOnline(to));
    if (!result.ok) return refuse(result);
    // Both ends, in this request: the recipient's open window gets the message
    // and the sender's other tabs stay in step.
    notifyUsers(result.members, { type: "message", message: result.message });
    return NextResponse.json({
      ok: true,
      message: result.message,
      created: result.created,
      delivered: result.message.deliveredAt !== null,
    });
  }

  if (action === "mark-read") {
    if (threadId) {
      const stamped = await markThreadReadById(gate.user, threadId);
      return NextResponse.json({ ok: true, stamped, unread: 0 });
    }
    const peer = str(read.body, "with").trim();
    if (!peer) return fail(400, "which conversation?");
    const stamped = await markThreadRead(gate.user, peer);
    return NextResponse.json({ ok: true, stamped, unread: 0 });
  }

  if (action === "create-group") {
    const title = str(read.body, "title");
    if (title.length > THREAD_TITLE_MAX) {
      return fail(400, `a group name is capped at ${THREAD_TITLE_MAX} characters`);
    }
    const members = strList(read.body, "members");
    if (members.length === 0) return fail(400, "who is in it?");
    const result = await createGroup(gate.user, title, members);
    if (!result.ok) return refuse(result);
    nudge(result.thread.participants);
    return NextResponse.json({ ok: true, thread: result.thread });
  }

  if (action === "invite") {
    if (!threadId) return fail(400, "which group?");
    const username = str(read.body, "username").trim();
    if (!username) return fail(400, "invite who?");
    const result = await inviteToThread(gate.user, threadId, username);
    if (!result.ok) return refuse(result);
    nudge(result.thread.participants);
    return NextResponse.json({ ok: true, thread: result.thread });
  }

  if (action === "leave") {
    if (!threadId) return fail(400, "which group?");
    const result = await leaveThread(gate.user, threadId);
    if (!result.ok) return refuse(result);
    // Everybody who WAS in the room, the leaver included — their own list lost
    // a thread and needs to say so.
    nudge(result.members);
    return NextResponse.json({ ok: true, thread: result.thread, deleted: result.deleted });
  }

  if (action === "rename") {
    if (!threadId) return fail(400, "which group?");
    const title = str(read.body, "title");
    if (title.length > THREAD_TITLE_MAX) {
      return fail(400, `a group name is capped at ${THREAD_TITLE_MAX} characters`);
    }
    const result = await renameThread(gate.user, threadId, title);
    if (!result.ok) return refuse(result);
    nudge(result.thread.participants);
    return NextResponse.json({ ok: true, thread: result.thread });
  }

  return fail(400, `unknown action "${action}"`);
}
