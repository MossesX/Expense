/**
 * @file `/api/accounts/admin` — the administrator control surface.
 *
 * DOUBLE-GATED, and both gates are load-bearing:
 *
 *   1. a valid `axs_session` cookie (`requireSession`) → 401 without one;
 *   2. a LIVE `administrator` role, re-read from the accounts file on every
 *      single request (`requireAdmin`) → 403 without it.
 *
 * The second gate never trusts the session token's role claim. The token is
 * signed and carries a role, but it was minted at login and says what was true
 * THEN — so a demotion, or a disable, binds immediately here rather than at the
 * cookie's 24-hour expiry. That is the whole reason the check re-reads disk
 * instead of reading the payload it already has in hand.
 *
 * GET → `adminOverview()`: the roster with admin-only flags, the stored grant
 * records, per-thread counts and sizes (never message TEXT — the admin manages
 * the data, the conversation stays between its members), and live presence.
 *
 * POST `{ action, … }`:
 *   - `remove-user-data` { username } → the cascade that follows an account
 *     removal: profile, grant record, live presence connections. Best-effort
 *     by design; it reports what it actually removed.
 *   - `delete-thread`    { id }       → one whole conversation, history and
 *     offline queue included.
 *
 * `deleteThread` holds its own `requireAdmin` in the store, so that action is
 * gated twice over. Kept anyway — the route-level gate is what makes the 403
 * uniform across every action here, including the ones whose store does not
 * check.
 */

import { NextResponse, type NextRequest } from "next/server";
import { adminOverview, removeUserData } from "@axs/modules/accounts/lib/admin";
import {
  fail,
  readJsonBody,
  refuse,
  requireLiveAdmin,
  str,
} from "@axs/modules/accounts/lib/http";
import { deleteThread } from "@axs/modules/accounts/lib/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Gate 1 + gate 2 are `requireLiveAdmin` in `lib/http.ts` — it was spelled
// identically here and in `/api/accounts/storage` before the admin suite needed
// four more copies, and a gate that is copied is a gate that will eventually be
// copied wrong. `requireAdmin` still chooses the status code (403 for a member,
// 401/404 for an account that is gone) and no route second-guesses it.

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await requireLiveAdmin(req);
  if ("deny" in gate) return gate.deny;
  return NextResponse.json({ ok: true, overview: await adminOverview() });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await requireLiveAdmin(req);
  if ("deny" in gate) return gate.deny;

  const read = await readJsonBody(req);
  if (!read.ok) return read.deny;
  const action = str(read.body, "action");

  switch (action) {
    case "remove-user-data": {
      const username = str(read.body, "username").trim();
      if (!username) return fail(400, "remove-user-data needs a username");
      const removed = await removeUserData(gate.actor, username);
      return NextResponse.json({ ok: true, username, removed });
    }

    case "delete-thread": {
      const id = str(read.body, "id").trim();
      if (!id) return fail(400, "delete-thread needs a thread id");
      const result = await deleteThread(gate.actor, id);
      return result.ok
        ? NextResponse.json({ ok: true, id, messagesRemoved: result.messagesRemoved })
        : refuse(result);
    }

    default:
      return fail(400, `unknown action "${action}"`);
  }
}
