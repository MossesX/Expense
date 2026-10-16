/**
 * @file `/api/accounts/relations` — the social graph's door: your buddy list
 * with live presence, the pending requests either way, your own block list,
 * and every mutation that moves an edge.
 *
 * GET → your relations, and ONLY yours. There is no `?user=` here on purpose:
 * a member's buddy list is theirs, and an endpoint that served somebody else's
 * would hand out the graph a block exists to keep quiet.
 *
 * POST `{ action, user? }`
 *   - `request`      { user }  → ask to be buddies (accepts a waiting request)
 *   - `accept`       { user }  → accept theirs
 *   - `remove`       { user }  → decline / cancel / unfriend, one verb
 *   - `block`        { user }  → unilateral, immediate, silent
 *   - `unblock`      { user }  → lets them reach you again; restores nothing
 *   - `buddies-only` { on }    → the switch behind the guard's
 *                                `not-buddy-required` verdict
 *
 * PRESENCE IS JOINED HERE, NOT IN THE STORE — the same rule the messages route
 * follows for `online`. `lib/relations` stays a pure graph over the
 * filesystem and `lib/presence` stays a pure connection registry; this route
 * is where the two meet. That is not tidiness: relations must read presence
 * and presence's own store must read profiles, so a join inside either file
 * would close an import cycle between the three.
 *
 * LIVE FLIPS ride the presence channel: every mutation returns the usernames
 * it may tell, and this route pushes a payload-free `relations` nudge to their
 * streams. A blocked member is never in that list — the store decides who may
 * be told, so no route can leak a block by being generous with `notifyUsers`.
 *
 * Every mutation is journaled inside the store, through the module's existing
 * audit posture (`lib/fsCore`), so a route that forgets cannot exist.
 */

import { NextResponse, type NextRequest } from "next/server";
import { bool, fail, readJsonBody, refuse, requireSession, str } from "@axs/modules/accounts/lib/http";
import {
  acceptBuddy,
  blockUser,
  listRelations,
  removeRelation,
  requestBuddy,
  setBuddiesOnly,
  unblockUser,
  type RelationResult,
} from "@axs/modules/accounts/lib/relations";
import { isAway, isOnline, notifyUsers } from "@axs/modules/accounts/lib/presence";
import { readLastSeen } from "@axs/modules/accounts/lib/profiles";
import type { BuddyPresence, BuddyRow, RelationsView } from "@axs/modules/accounts/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Decorate a row with the presence registry's live truth. `away` only ever
 *  outranks `online` for a member who is actually connected — `isAway` will
 *  not report a signed-out member as away. */
function withPresence(row: BuddyRow): BuddyPresence {
  const online = isOnline(row.username);
  return {
    ...row,
    status: online ? (isAway(row.username) ? "away" : "online") : "offline",
    lastSeenAt: online ? new Date().toISOString() : readLastSeen(row.username),
  };
}

/** The wire shape: buddies carry presence, the request lists carry it too (a
 *  request from somebody who is online right now is worth showing as such). */
function decorate(view: RelationsView): Record<string, unknown> {
  return {
    ...view,
    buddies: view.buddies.map(withPresence),
    incoming: view.incoming.map(withPresence),
    outgoing: view.outgoing.map(withPresence),
    // The block list is deliberately NOT decorated: a blocker has no business
    // watching whether the person they blocked is online.
    blocked: view.blocked,
  };
}

/** Finish a mutation: nudge whoever the STORE said may be told, then answer. */
function settle(result: RelationResult): NextResponse {
  if (!result.ok) return refuse(result);
  if (result.notify.length > 0) {
    notifyUsers(result.notify, { type: "relations", at: new Date().toISOString() });
  }
  return NextResponse.json({ ok: true, relations: decorate(result.relations) });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = requireSession(req);
  if ("deny" in gate) return gate.deny;
  const view = await listRelations(gate.user);
  return NextResponse.json({ ok: true, relations: decorate(view) });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = requireSession(req);
  if ("deny" in gate) return gate.deny;

  const read = await readJsonBody(req);
  if (!read.ok) return read.deny;
  const action = str(read.body, "action");

  if (action === "buddies-only") {
    const on = bool(read.body, "on");
    if (on === null) return fail(400, "buddies-only needs { on: true | false }");
    return settle(await setBuddiesOnly(gate.user, on));
  }

  const who = str(read.body, "user").trim();
  if (!who) return fail(400, "which member?");

  switch (action) {
    case "request":
      return settle(await requestBuddy(gate.user, who));
    case "accept":
      return settle(await acceptBuddy(gate.user, who));
    case "remove":
      return settle(await removeRelation(gate.user, who));
    case "block":
      return settle(await blockUser(gate.user, who));
    case "unblock":
      return settle(await unblockUser(gate.user, who));
    default:
      return fail(400, `unknown action "${action}"`);
  }
}
