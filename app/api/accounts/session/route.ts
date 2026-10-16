/**
 * @file `/api/accounts/session` — the accounts module's authentication door.
 *
 * Three actions and a whoami, and nothing else lives here: this route is the
 * ONLY place `axs_session` is minted or cleared. Identity everywhere else in
 * the module comes from `requireSession()` reading that cookie, never from a
 * header or a body field a caller can choose.
 *
 * GET → whoami. `{ signedIn: false }` is a valid answer, because the login
 * screen renders from it. A session whose account was removed or disabled
 * since the cookie was issued is NOT signed in, whatever the cookie says —
 * the account row is re-read from disk on every call, so a disable binds
 * immediately.
 *
 * POST `{ action, … }`:
 *   - `login`           { username, password }                → sets `axs_session`
 *   - `change-password` { currentPassword, newPassword }       → clears the temp flag
 *   - `set-screenname`  { screenname }                         → names the caller
 *   - `logout`                                                 → clears the cookie
 *
 * `set-screenname` lives HERE rather than on the profile route because a
 * screenname is an ACCOUNT field, not a profile one: the profile engine
 * re-syncs it from the account on every read, so writing it anywhere else
 * would produce a value the next read throws away. It is also why the store
 * function takes the session user alone and there is no admin setter — the
 * name is the member's own (`P5`, the profile pane's identity row).
 *
 * `login` is the only action that does not need a session. It carries the
 * shared 400 ms failure delay, and the store burns a scrypt for an unknown
 * username too, so "no such account" and "wrong password" cost the same from
 * the outside.
 *
 * THE FORCED ENTRY FLOW. A login that succeeds against an admin-issued temp
 * password still succeeds — it returns a real session — but `mustChangePassword`
 * comes back on `me` AND as a top-level flag, which is what the UI turns into
 * the forced change-password screen. Returning a 4xx instead would leave the
 * client with no session to change the password WITH.
 *
 * THE POLICY DOOR (P2). Two policy checks sit on `login`, and WHERE each one
 * sits is the whole of its design:
 *
 *   - `assertLoginRate` runs FIRST, before the password is even looked at,
 *     because a limiter that only counts attempts it has already paid for is
 *     not a limiter. It reads the SITE tier only — there is no member yet whose
 *     document could honestly be consulted (`lib/policy.ts`, `siteOnly`).
 *   - `loginGate` runs LAST, after the password has verified, because a
 *     suspension notice handed to somebody who has not proved they own the
 *     account is an enumeration oracle — it would distinguish "exists and is
 *     suspended" from "no such name", which the shared 400 ms delay and the
 *     dummy-hash burn in `verifyLogin` exist to make indistinguishable.
 *
 * A refusal from `loginGate` is **never a generic 403**: it carries the row
 * that refused, the reason an administrator wrote, and the until-date, and no
 * session cookie is set. Its third outcome, `force-password-change`, deliberately
 * does NOT refuse — it lands the member in the same forced flow a temp password
 * does, for the same reason that flow exists.
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  changePassword,
  findAccount,
  setScreenname,
  toMe,
  verifyLogin,
} from "@axs/modules/accounts/lib/accounts";
import {
  fail,
  readJsonBody,
  refuse,
  requireSession,
  sleep,
  str,
} from "@axs/modules/accounts/lib/http";
import { effectivePermissions } from "@axs/modules/accounts/lib/permissions";
import {
  assertLoginRate,
  clearForcedPasswordReset,
  loginGate,
} from "@axs/modules/accounts/lib/policy";
import {
  AXS_SESSION_COOKIE,
  AXS_SESSION_HOURS,
  axsUser,
  issueAxsSession,
} from "@axs/modules/accounts/lib/session";
import type { Account } from "@axs/modules/accounts/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function setSessionCookie(res: NextResponse, req: NextRequest, token: string): void {
  res.cookies.set(AXS_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
    path: "/",
    maxAge: AXS_SESSION_HOURS * 3600,
  });
}

function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(AXS_SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

/**
 * The signed-in payload every successful call returns: who you are, what the
 * permission engine says you may do, and the flag that drives forced entry.
 *
 * `forcedReason` is the policy cascade's `force-password-change` outcome. It
 * raises `mustChangePassword` even though the ACCOUNT does not carry the flag,
 * so the client's existing entry gate handles a policy-forced reset with no
 * client change — and the reason rides alongside it, because "change your
 * password" with no explanation, from an account that was fine yesterday, reads
 * as a bug rather than as an instruction.
 */
async function signedIn(
  account: Account,
  forcedReason?: string,
): Promise<Record<string, unknown>> {
  const me = toMe(account);
  const mustChangePassword = me.mustChangePassword || forcedReason !== undefined;
  return {
    ok: true,
    signedIn: true,
    me: { ...me, mustChangePassword },
    permissions: await effectivePermissions(account.username),
    // Surfaced at the top level as well as on `me` so the client's entry
    // gate never has to reach into the account shape to find it.
    mustChangePassword,
    needsScreenname: me.needsScreenname,
    ...(forcedReason ? { policyNotice: forcedReason } : {}),
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const user = axsUser(req);
  if (!user) return NextResponse.json({ ok: true, signedIn: false });
  const account = await findAccount(user);
  if (!account || account.disabled === true) {
    // The cookie outlived the account. Answer as anonymous AND drop it, so the
    // next request does not pay for the same lookup again.
    const res = NextResponse.json({ ok: true, signedIn: false });
    clearSessionCookie(res);
    return res;
  }
  return NextResponse.json(await signedIn(account));
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const read = await readJsonBody(req);
  if (!read.ok) return read.deny;
  const action = str(read.body, "action");

  if (action === "login") {
    const asked = str(read.body, "username").trim();

    // Before the password, and keyed by the name that was typed — see the
    // header. A refusal here costs no scrypt, which is the point.
    const rate = assertLoginRate(asked);
    if (!rate.ok) {
      return NextResponse.json(
        { ok: false, error: rate.error, policyRow: rate.row, limit: rate.value },
        { status: rate.status },
      );
    }

    const result = await verifyLogin(asked, str(read.body, "password"));
    if (!result.ok) {
      await sleep(400);
      return refuse(result);
    }

    // After the password, so the reason can be stated without the sentence
    // itself becoming an oracle.
    const gate = await loginGate(result.account.username);
    if (gate.verdict === "refuse") {
      return NextResponse.json(
        { ok: false, error: gate.error, policyRow: gate.row, until: gate.until },
        { status: gate.status },
      );
    }

    const res = NextResponse.json(
      await signedIn(result.account, gate.verdict === "force-password-change" ? gate.reason : undefined),
    );
    setSessionCookie(res, req, issueAxsSession(result.account));
    return res;
  }

  if (action === "logout") {
    const res = NextResponse.json({ ok: true, signedIn: false });
    clearSessionCookie(res);
    return res;
  }

  const gate = requireSession(req);
  if ("deny" in gate) return gate.deny;

  if (action === "change-password") {
    const result = await changePassword(
      gate.user,
      str(read.body, "currentPassword"),
      str(read.body, "newPassword"),
    );
    if (!result.ok) {
      // 403 is what a rejected current password now returns (see
      // `verifyLogin`'s note on why it is not 401). The delay must follow the
      // status, not the number that used to carry it — an unpaid 400 ms here
      // is a timing oracle, not a cosmetic drift.
      if (result.status === 403) await sleep(400);
      return refuse(result);
    }
    // The store cleared `mustChangePassword`; the payload carries the fresh
    // account, so the UI leaves the forced flow on this response alone — and
    // the policy pin that may ALSO have been holding them there is satisfied
    // here, or the next sign-in would send them straight back (`lib/policy.ts`).
    await clearForcedPasswordReset(result.account.username);
    return NextResponse.json(await signedIn(result.account));
  }

  if (action === "set-screenname") {
    const result = await setScreenname(gate.user, str(read.body, "screenname"));
    if (!result.ok) return refuse(result);
    // Same payload as every other success: the client replaces `me` wholesale
    // rather than patching one field, so a rename cannot leave the two halves
    // of the session disagreeing.
    return NextResponse.json(await signedIn(result.account));
  }

  return fail(400, `unknown action "${action}"`);
}
