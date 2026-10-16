/**
 * @file `/api/accounts/storage` — per-user storage accounting over the wire.
 *
 * GATED IN THREE TIERS, and the middle one is the whole point of the route:
 *
 *   1. a valid `axs_session` cookie (`requireSession`) → 401 without one;
 *   2. **your OWN usage needs nothing more.** A member may see what they use;
 *      that is their number and hiding it from them serves nobody.
 *   3. `?user=<somebody else>` and every POST need a LIVE `administrator` role,
 *      re-read from the accounts file per request (`requireAdmin`) → 403. Same
 *      reasoning the admin route records: the session token's role claim was
 *      minted at login and says what was true THEN, so a demotion binds here
 *      immediately rather than at the cookie's 24-hour expiry.
 *
 * `?user=` naming YOURSELF is not an escalation and is answered as tier 2 — a
 * client that always sends the parameter should not need to know whether it is
 * talking about the signed-in member.
 *
 * GET  → `{ ok, usage }`. `usage` is `null` when the user has never been
 *        scanned; that is an honest answer, not an error, and it is NOT quietly
 *        turned into a walk. A rescan is slow and admin-only precisely so that
 *        a page load can never trigger one.
 * POST `{ action, … }` — administrators only:
 *   - `rescan`     { username }  → rebuild one user's index from disk;
 *   - `rescan-all` {}            → reconcile the whole roster, sequentially.
 *
 * The roster comes from `listAccounts()` HERE rather than inside
 * `lib/storage.ts`: the ledger is deliberately blind to the roster the same way
 * it is blind to policy, and this route is where the two are composed.
 */

import { NextResponse, type NextRequest } from "next/server";

import { listAccounts } from "@axs/modules/accounts/lib/accounts";
import { fail, readJsonBody, requireLiveAdmin, requireSession, str } from "@axs/modules/accounts/lib/http";
import {
  USER_DATA_ROOTS,
  readUsage,
  rescan,
  rescanAll,
} from "@axs/modules/accounts/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tier 3 is `requireLiveAdmin` in `lib/http.ts` — one gate, shared with
// `/api/accounts/admin` and the admin suite's four routes, so 401/403/404 mean
// the same thing here as on every other route because it is the same code
// rather than the same intention spelled six times.

/** The root ids and titles a surface needs to label a breakdown, sent with
 *  every answer so a client never hard-codes a root's name. */
const rootLabels = (): Array<{ id: string; title: string; shared: boolean }> =>
  USER_DATA_ROOTS.all().map((r) => ({ id: r.id, title: r.title, shared: r.shared === true }));

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = requireSession(req);
  if ("deny" in session) return session.deny;

  const asked = (req.nextUrl.searchParams.get("user") ?? "").trim();
  const self = session.user.trim().toLowerCase();
  const target = asked ? asked.toLowerCase() : self;

  if (target !== self) {
    const gate = await requireLiveAdmin(req);
    if ("deny" in gate) return gate.deny;
  }

  return NextResponse.json({
    ok: true,
    user: target,
    usage: await readUsage(target),
    roots: rootLabels(),
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await requireLiveAdmin(req);
  if ("deny" in gate) return gate.deny;

  const read = await readJsonBody(req);
  if (!read.ok) return read.deny;
  const action = str(read.body, "action");

  switch (action) {
    case "rescan": {
      const username = str(read.body, "username").trim();
      if (!username) return fail(400, "rescan needs a username");
      const usage = await rescan(username);
      // `rescan` answers null only when the name cannot be a path segment —
      // a 400, not a 404: nothing was looked up, the name was refused.
      if (!usage) return fail(400, `"${username}" is not a usable username`);
      return NextResponse.json({ ok: true, user: usage.user, usage, roots: rootLabels() });
    }

    case "rescan-all": {
      const usernames = (await listAccounts()).map((a) => a.username);
      const result = await rescanAll(usernames);
      return NextResponse.json({
        ok: true,
        scanned: result.scanned,
        skipped: result.skipped,
        usages: result.indexes,
        roots: rootLabels(),
      });
    }

    default:
      return fail(400, `unknown action "${action}"`);
  }
}
