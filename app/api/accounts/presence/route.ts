/**
 * @file `/api/accounts/presence` — the module's one live channel: a
 * `text/event-stream` carrying roster flips, message delivery and a keep-alive.
 *
 * GET → SSE. Holding this stream open IS being online: `connect()` registers
 * the push, and the FIRST stream a member opens flips them online for everyone
 * while the LAST one closing flips them offline and stamps `lastSeenAt` on
 * their profile. There is no separate "I am here" call to forget to make, and
 * no heartbeat to miss — presence is the connection itself, which is why a
 * closed laptop shows offline without anything having to notice.
 *
 * Frames are `AccountsEvent`, one JSON object per `data:` line, terminated by
 * the blank line SSE requires:
 *   - `roster`  — the full roster, on open and on every online/offline flip
 *   - `message` — pushed by the messages route in the request that stored it
 *   - `relations` — pushed by the relations route: "your graph moved, ask again"
 *   - `ping`    — every 15 s, so no intermediary reaps an idle connection
 *
 * POST `{ away: boolean }` — the ONE door for self-declared away (P4). It is a
 * write against presence, so it lives on the presence route rather than on the
 * buddy list that displays it. `setAway` refuses a member with no live stream
 * (you cannot be away from somewhere you are not) and broadcasts the roster
 * itself when the state really changed, so nothing here has to remember to.
 *
 * ANTI-BUFFERING is by construction, not by luck: `X-Accel-Buffering: no` plus
 * `no-cache, no-transform`, and the opening roster is flushed inside `start()`
 * so a first byte leaves immediately. A proxy that holds the first chunk turns
 * this stream into a connection that "works" and delivers nothing.
 *
 * ORDER MATTERS IN `start()`: register BEFORE sending the opening roster, or
 * the roster the caller receives is missing the caller. Teardown is idempotent
 * and runs on all three exits — client abort, `cancel()`, and an enqueue on a
 * closed controller — because a leaked registration is a member who is online
 * forever.
 */

import { NextResponse, type NextRequest } from "next/server";
import { axsUser } from "@axs/modules/accounts/lib/session";
import { findAccount } from "@axs/modules/accounts/lib/accounts";
import {
  connect,
  connectionCount,
  isAway,
  presenceSnapshot,
  setAway,
} from "@axs/modules/accounts/lib/presence";
import { assertSessionSlot } from "@axs/modules/accounts/lib/policy";
import { bool, readJsonBody, fail, requireSession } from "@axs/modules/accounts/lib/http";
import type { AccountsEvent } from "@axs/modules/accounts/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PING_MS = 15_000;

export async function GET(req: NextRequest): Promise<Response> {
  const me = axsUser(req);
  if (!me) return NextResponse.json({ ok: false, error: "sign in first" }, { status: 401 });
  // A cookie can outlive its account, and an evicted or disabled member must not
  // be able to hold a stream open — which would keep them on everyone's roster.
  const account = await findAccount(me);
  if (!account || account.disabled === true) {
    return NextResponse.json({ ok: false, error: "sign in first" }, { status: 401 });
  }

  // THE `maxSessions` POLICY. Holding this stream open IS being signed in, so
  // the count of open streams is what "concurrent sessions" actually means
  // here, and this is the one place a new one is created. Checked BEFORE
  // `connect()` registers the push — a refusal that had already registered
  // would leave the member online on a stream nobody is reading.
  const room = await assertSessionSlot(account.username, connectionCount(account.username));
  if (!room.ok) {
    return NextResponse.json(
      { ok: false, error: room.error, policyRow: room.row, limit: room.value },
      { status: room.status },
    );
  }

  const enc = new TextEncoder();
  let closed = false;
  let disconnect: (() => void) | null = null;
  let pinger: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AccountsEvent) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // The socket went away between the abort and our next write.
          closed = true;
          if (pinger) clearInterval(pinger);
          disconnect?.();
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (pinger) clearInterval(pinger);
        disconnect?.();
        try {
          controller.close();
        } catch {
          /* already gone */
        }
      };

      disconnect = connect(account.username, send);
      send({ type: "roster", roster: await presenceSnapshot() });
      pinger = setInterval(() => send({ type: "ping", at: new Date().toISOString() }), PING_MS);
      req.signal.addEventListener("abort", close);
    },
    cancel() {
      closed = true;
      if (pinger) clearInterval(pinger);
      disconnect?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = requireSession(req);
  if ("deny" in gate) return gate.deny;

  const read = await readJsonBody(req);
  if (!read.ok) return read.deny;
  const away = bool(read.body, "away");
  if (away === null) return fail(400, "presence needs { away: true | false }");

  // `changed` is false both when the state already matched AND when the member
  // has no live stream — the answer reports the state that actually holds, so
  // a client asking to be away with no connection is told "online: false"
  // rather than being left to believe it took.
  const changed = setAway(gate.user, away);
  return NextResponse.json({ ok: true, changed, away: isAway(gate.user) });
}
