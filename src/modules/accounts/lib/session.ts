/**
 * @file **The studio session** — the accounts module's own login cookie.
 *
 *   cookie   `axs_session`
 *   payload  `{ k: "axss", u: <username>, r: <role>, exp }`
 *   store    `accounts.json` (`./accounts`) — the store of record
 *
 * ## Why a derived key, not the machine secret itself
 *
 * The token format (`base64url(payload).base64url(sig)`) is shared with other
 * token families in this codebase's lineage, so signing with the raw secret
 * would make tokens interchangeable across systems: paste one family's value
 * into another family's cookie and the HMAC would verify. Deriving a distinct
 * key under a fixed label makes that structurally impossible rather than
 * merely unlikely — an `axs_session` signature is valid nowhere else, in
 * either direction, no matter what the payload says. The payload's `k` tag is
 * the belt to that braces.
 *
 * ## The secret
 *
 * Self-contained (the amberxvid reference resolves its secret through a
 * bridge file; this module owns the whole ladder): the `ACCOUNTS_AUTH_SECRET`
 * env var (>= 16 chars), else `<dataRoot>/.auth-secret`, else a fresh 32-byte
 * secret generated and persisted on first use. The chmod tightening is
 * best-effort — Windows has no POSIX modes and must not fail the ladder.
 *
 * ## The two verify doors
 *
 * `axsUser(req)` is THE identity function for every `/api/accounts/*` route.
 * `axsUserFromCookieHeader(header)` is the same verdict from a raw `Cookie`
 * header, fully synchronous with no `NextRequest` in sight — it exists for
 * `kvUser()` in `src/server/axfKv.ts`, which P3 wires through it so every kv
 * consumer becomes per-user the moment someone signs in.
 *
 * Server-only (`node:crypto`).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { NextRequest } from "next/server";
import { dataRoot } from "./paths";
import type { AccountRole } from "./types";

export const AXS_SESSION_COOKIE = "axs_session";

/** A session lasts a day — long enough to stay signed in through an evening
 *  of use, short enough that a shared machine forgets by morning. */
export const AXS_SESSION_HOURS = 24;

export interface AxsSessionPayload {
  /** Payload kind tag — no other token family carries `axss`. */
  k: "axss";
  /** Studio account username — `accounts.json` is the store of record. */
  u: string;
  /** Role at issue time. Advisory only: every admin surface re-reads the live
   *  account, because a 24 h token outlives a demotion. */
  r: AccountRole;
  /** unix seconds */
  exp: number;
}

/* --------------------------------- the secret -------------------------------- */

const secretFile = (): string => path.join(dataRoot(), ".auth-secret");

/**
 * The machine secret the session key is derived from. Env override
 * (`ACCOUNTS_AUTH_SECRET`, >= 16 chars), else the persisted secret file, else
 * a fresh 32-byte secret generated and persisted.
 */
function authSecret(): string {
  const env = process.env.ACCOUNTS_AUTH_SECRET;
  if (env && env.length >= 16) return env;
  try {
    const onDisk = fs.readFileSync(secretFile(), "utf8").trim();
    if (onDisk.length >= 16) return onDisk;
  } catch {
    /* generate below */
  }
  const fresh = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(dataRoot(), { recursive: true });
  fs.writeFileSync(secretFile(), fresh, "utf8");
  try {
    fs.chmodSync(secretFile(), 0o600);
  } catch {
    /* Windows has no POSIX modes — best-effort */
  }
  return fresh;
}

/* ------------------------------- sign + verify ------------------------------- */

const b64url = (b: Buffer): string => b.toString("base64url");

/** The module's signing key: HMAC of the machine secret under a fixed label. */
function axsKey(): Buffer {
  return crypto.createHmac("sha256", authSecret()).update("accounts/axs_session/v1").digest();
}

const sign = (body: string): string => b64url(crypto.createHmac("sha256", axsKey()).update(body).digest());

export function issueAxsSession(account: { username: string; role: AccountRole }): string {
  const payload: AxsSessionPayload = {
    k: "axss",
    u: account.username,
    r: account.role,
    exp: Math.floor(Date.now() / 1000) + AXS_SESSION_HOURS * 3600,
  };
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  return `${body}.${sign(body)}`;
}

/** Verify a session token. Null on anything short of a live, well-formed,
 *  accounts-signed token — expired, tampered, or another family replayed here. */
export function verifyAxsSession(token: string | undefined): AxsSessionPayload | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expect = sign(body);
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AxsSessionPayload;
    if (payload.k !== "axss") return null;
    if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;
    if (typeof payload.u !== "string" || !payload.u) return null;
    if (payload.r !== "administrator" && payload.r !== "member") return null;
    return payload;
  } catch {
    return null;
  }
}

/* -------------------------------- identity doors ------------------------------ */

/**
 * THE identity function for every `/api/accounts/*` route: the signed-in
 * username, or null → 401.
 */
export function axsUser(req: NextRequest): string | null {
  return verifyAxsSession(req.cookies.get(AXS_SESSION_COOKIE)?.value)?.u ?? null;
}

/**
 * The same verdict from a raw `Cookie` header — synchronous, no `NextRequest`.
 * This is the seam `kvUser()` hangs on: absent header, absent cookie, or an
 * invalid token all answer null, and the caller keeps its signed-out default.
 */
export function axsUserFromCookieHeader(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== AXS_SESSION_COOKIE) continue;
    let value = part.slice(eq + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch {
      /* verify the raw value */
    }
    return verifyAxsSession(value)?.u ?? null;
  }
  return null;
}
