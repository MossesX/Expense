/**
 * @file `/api/accounts/credits` — the AI credit ledger over HTTP (P18).
 *
 * GET                       → the CALLER's own statement (balance + history)
 * GET `?user=<name>`        → another member's, **administrators only**
 * POST `{ action: "grant", username, delta, reason }` → grant (or revoke, with
 *                             a negative `delta`), **administrators only**
 *
 * Two gates, and which one applies depends on whose money is being looked at:
 *
 *   - **Reading your own balance needs a session and nothing else.** A member
 *     has to be able to see what they hold; that is not an administrative act.
 *   - **Reading somebody else's, or moving anybody's, needs a LIVE
 *     administrator** — `requireAdmin`, which re-reads the accounts file on
 *     every request rather than trusting the role baked into the 24-hour
 *     session token. A demotion binds here immediately, which for the one route
 *     in this module that moves currency is the whole point.
 *
 * There is deliberately **no spend action on this route.** A spend is a charge
 * for work a feature did, and it belongs to that feature's own path where the
 * work is (`/api/amberxvid/credits` meters, the assistant turn charge). An HTTP
 * verb any signed-in member could POST to decrement their own balance would be
 * a self-service way to burn credits with nothing delivered, and — worse — a
 * self-service way to test whether somebody else's balance exists.
 *
 * The BUY half is not here either, for the ownership reason written out in
 * `accounts/lib/credits.ts`: `canBuyCredits` is an amberxvid policy row and it
 * bites at amberxvid's checkout, which then calls `recordPurchase` on the
 * return leg.
 */

import { NextResponse, type NextRequest } from "next/server";

import { requireAdmin } from "@axs/modules/accounts/lib/accounts";
import { creditStatement, grantCredits } from "@axs/modules/accounts/lib/credits";
import { fail, readJsonBody, refuse, requireSession, str } from "@axs/modules/accounts/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Session + a live administrator role, re-read from disk. */
async function requireLiveAdmin(
  req: NextRequest
): Promise<{ actor: string } | { deny: NextResponse }> {
  const session = requireSession(req);
  if ("deny" in session) return { deny: session.deny };
  const admin = await requireAdmin(session.user);
  if (!admin.ok) return { deny: refuse(admin) };
  return { actor: admin.account.username };
}

/** How many entries a statement returns. Bounded so a long history cannot make
 *  a banner chip's fetch expensive; the response says how many there really are. */
const LIMIT_MAX = 500;

function limitFrom(req: NextRequest): number {
  const raw = Number(req.nextUrl.searchParams.get("limit"));
  if (!Number.isFinite(raw) || raw <= 0) return 100;
  return Math.min(LIMIT_MAX, Math.round(raw));
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = requireSession(req);
  if ("deny" in session) return session.deny;

  const asked = (req.nextUrl.searchParams.get("user") ?? "").trim().toLowerCase();
  const me = session.user.trim().toLowerCase();

  // Somebody else's ledger is an administrative read. Same-name is not — asking
  // for your own by name must not demand a role you do not have.
  if (asked && asked !== me) {
    const gate = await requireLiveAdmin(req);
    if ("deny" in gate) return gate.deny;
    return NextResponse.json({
      ok: true,
      statement: await creditStatement(asked, limitFrom(req)),
    });
  }

  return NextResponse.json({ ok: true, statement: await creditStatement(me, limitFrom(req)) });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await requireLiveAdmin(req);
  if ("deny" in gate) return gate.deny;

  const read = await readJsonBody(req);
  if (!read.ok) return read.deny;
  const action = str(read.body, "action");

  switch (action) {
    case "grant": {
      const username = str(read.body, "username").trim();
      if (!username) return fail(400, "grant needs a username");
      const delta = Number(read.body.delta);
      if (!Number.isFinite(delta) || Math.round(delta) === 0) {
        return fail(400, "grant needs a non-zero delta (negative revokes)");
      }
      const result = await grantCredits(gate.actor, username, delta, str(read.body, "reason"));
      if (!result.ok) return NextResponse.json(result, { status: 409 });
      return NextResponse.json({
        ok: true,
        balance: result.balance,
        entry: result.entry,
        statement: await creditStatement(username),
      });
    }

    default:
      return fail(400, `unknown action "${action}"`);
  }
}
