/**
 * @file Accounts route guards — the three things every `/api/accounts/*`
 * handler would otherwise repeat seven times: the session gate, the JSON body
 * read with a hard byte cap, and the stores' shared
 * `{ ok } | { ok: false, error, status }` union mapped straight onto a
 * response.
 *
 * It lives in `lib/` rather than beside the routes because it is the module's
 * own code and the routes import from exactly one place. It is the only file
 * here that imports `next/server` at runtime — everything below it in the
 * stack is transport-agnostic, which is what lets P1's stores be exercised by
 * a test with no HTTP in sight.
 *
 * BODY CAPS. Every write reads the body through {@link readJsonBody}, which
 * refuses over-sized payloads with **413** BEFORE parsing — a cap applied
 * after `JSON.parse` has already paid for the attack it was meant to stop.
 * Two caps exist because one of them has to carry a 256 KB avatar data-URL;
 * every other route takes the small one.
 *
 * Server-only.
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "./accounts";
import { axsUser } from "./session";

/** Ordinary writes: an action word, a username, a 4 000-character message. */
export const BODY_MAX = 64 * 1024;

/** Profile writes only — an `AVATAR_IMAGE_MAX` (256 KB) data-URL plus the
 *  base64 and JSON overhead that rides with it, with room to spare so the
 *  refusal comes from the avatar check (a precise error) rather than from the
 *  byte cap (a blunt one). */
export const PROFILE_BODY_MAX = 512 * 1024;

/** The store refusal shape — every P1 store returns it, verbatim. */
export interface StoreRefusal {
  ok: false;
  error: string;
  status: number;
}

/** Map a store refusal onto its response. The store chose the status code;
 *  the route never second-guesses it, which is what keeps 401/403/404/409
 *  meaning the same thing on every route. */
export function refuse(result: StoreRefusal): NextResponse {
  return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
}

export function fail(status: number, error: string): NextResponse {
  return NextResponse.json({ ok: false, error }, { status });
}

export function unauthorized(): NextResponse {
  return fail(401, "sign in first");
}

/**
 * THE session gate for the mutating half of every route: the signed-in
 * username, or the 401 to return. Reads only the `axs_session` cookie —
 * identity is P1's `verifyAxsSession`, never a header a caller can choose.
 */
export function requireSession(req: NextRequest): { user: string } | { deny: NextResponse } {
  const user = axsUser(req);
  return user ? { user } : { deny: unauthorized() };
}

/**
 * **THE admin gate**, both tiers, for every handler that needs one.
 *
 * 1. a valid `axs_session` cookie → 401 without one;
 * 2. a LIVE `administrator` role, re-read from the accounts file on every
 *    single request → 403 without it.
 *
 * The second tier never trusts the session token's role claim. The token is
 * signed and carries a role, but it was minted at login and says what was true
 * THEN — so a demotion, or a disable, binds immediately here rather than at the
 * cookie's 24-hour expiry.
 *
 * It lives beside {@link requireSession} rather than being written per route
 * for the reason this whole file exists: it was already spelled twice
 * identically (`/api/accounts/admin`, `/api/accounts/storage`) before the admin
 * suite needed four more copies, and a gate that is copied is a gate that will
 * eventually be copied wrong. `requireAdmin` still chooses the status code and
 * the routes never second-guess it, so 401/403/404/409 keep meaning the same
 * thing everywhere.
 *
 * The acting administrator's username comes back CANONICALISED from the store,
 * not from the cookie — an audit record naming `Admin` for one act and `admin`
 * for the next is a trail that cannot be grouped.
 */
export async function requireLiveAdmin(
  req: NextRequest,
): Promise<{ actor: string } | { deny: NextResponse }> {
  const session = requireSession(req);
  if ("deny" in session) return { deny: session.deny };
  const admin = await requireAdmin(session.user);
  if (!admin.ok) return { deny: refuse(admin) };
  return { actor: admin.account.username };
}

export type BodyRead =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; deny: NextResponse };

/**
 * Read a JSON object body under a hard cap. `Content-Length` is checked first
 * (the cheap refusal), then the decoded length (a chunked or mis-declared body
 * cannot slip past the header check), then the parse itself. A body that is
 * valid JSON but not an object is refused too — every handler indexes it.
 */
export async function readJsonBody(req: NextRequest, cap: number = BODY_MAX): Promise<BodyRead> {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > cap) {
    return { ok: false, deny: fail(413, `that body is too large (cap ${Math.floor(cap / 1024)} KB)`) };
  }
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false, deny: fail(400, "could not read the request body") };
  }
  if (text.length > cap) {
    return { ok: false, deny: fail(413, `that body is too large (cap ${Math.floor(cap / 1024)} KB)`) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, deny: fail(400, "body must be JSON") };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, deny: fail(400, "body must be a JSON object") };
  }
  return { ok: true, body: parsed as Record<string, unknown> };
}

/** A string field, or "" — the reference's `str(k)`, shared. */
export function str(body: Record<string, unknown>, key: string): string {
  return typeof body[key] === "string" ? (body[key] as string) : "";
}

/** A boolean field, or null when it was absent or the wrong type — the
 *  difference matters for every `allowed` flag, where a missing value must be
 *  a 400 rather than a silent `false` that revokes something. */
export function bool(body: Record<string, unknown>, key: string): boolean | null {
  return typeof body[key] === "boolean" ? (body[key] as boolean) : null;
}

/** Failed-credential delay — the same 400 ms the reference charges, so probing
 *  this door costs what probing that one costs. */
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
