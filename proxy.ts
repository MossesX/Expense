/**
 * @file The peeled Expense Tracker's front door — no page renders without a
 * session. Deploy OVERLAY, not generated: `deploy/expenses/build.sh` copies it
 * onto `peeled/expenses/` after every peel (the peel wipes the tree), because
 * the generated app ships the accounts companion's session routes but no gate
 * over its pages, and `/expenses` against a signed-out browser is a screen whose
 * every fetch answers 401.
 *
 * Same shape as `packages/studio/proxy.ts`, minus the two things a peel has
 * no use for: the `x_landing` login landing (the peel carries no landing
 * assets, so the gate is `/login`, the bare sign-in card) and the dev
 * auto-login (there is no dev tree here). The account is re-read on every
 * navigation for the reason the studio's gate gives: a disabled account must
 * bind on the next page, not at cookie expiry.
 */
import { NextResponse, type NextRequest } from "next/server";

import { findAccount } from "@axs/modules/accounts/lib/accounts";
import { LOGIN_PATH, isPublicPath } from "@axs/modules/accounts/lib/publicPaths";
import { AXS_SESSION_COOKIE, verifyAxsSession } from "@axs/modules/accounts/lib/session";

/** Send them to the sign-in card, remembering where they were headed. */
function toLogin(req: NextRequest, dropCookie: boolean): NextResponse {
  const url = req.nextUrl.clone();
  url.pathname = LOGIN_PATH;
  url.search = "";
  const from = `${req.nextUrl.pathname}${req.nextUrl.search}`;
  if (from !== "/") url.searchParams.set("next", from);
  const res = NextResponse.redirect(url);
  if (dropCookie) res.cookies.set(AXS_SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}

export async function proxy(req: NextRequest): Promise<NextResponse> {
  if (isPublicPath(req.nextUrl.pathname)) return NextResponse.next();

  const payload = verifyAxsSession(req.cookies.get(AXS_SESSION_COOKIE)?.value);
  if (!payload) return toLogin(req, false);

  const account = await findAccount(payload.u);
  if (!account || account.disabled === true) return toLogin(req, true);

  return NextResponse.next();
}

export const config = {
  // Pages only. `/api/*` routes carry their own gate (`kvUser`, `requireSession`).
  matcher: ["/((?!api/|_next/|.*\\.[^/]*$).*)"],
};
