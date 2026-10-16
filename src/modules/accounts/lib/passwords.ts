/**
 * @file Accounts password engine — the `scrypt$…` hash format the accounts
 * store uses.
 *
 * Format: `scrypt$n=<N>,r=<r>,p=<p>$<salt base64>$<key base64>` — params ride
 * inside the hash, so verification always uses the params the hash was made
 * with and the cost can be raised later without migrating stored hashes.
 *
 * ASYNC `crypto.scrypt` only, never `scryptSync` — sync scrypt on the serving
 * thread once froze GizmoX's whole gateway loop. Compares are timing-safe,
 * and `verifyPassword` runs a real scrypt even for a malformed hash so an
 * unknown-user probe costs the same as a wrong password.
 *
 * Server-only (node:crypto).
 */

import crypto from "node:crypto";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32;

interface ScryptParts {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  key: Buffer;
}

function scryptAsync(password: string, salt: Buffer, keyLen: number, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      keyLen,
      { N, r, p, maxmem: 256 * N * r },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

function parseHash(stored: string): ScryptParts | null {
  const [scheme, params, saltB64, keyB64] = stored.split("$");
  if (scheme !== "scrypt" || !params || !saltB64 || !keyB64) return null;
  const dict: Record<string, number> = {};
  for (const pair of params.split(",")) {
    const [k, v] = pair.split("=");
    dict[k] = Number(v);
  }
  const { n: N, r, p } = { n: dict.n, r: dict.r, p: dict.p };
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  try {
    const salt = Buffer.from(saltB64, "base64");
    const key = Buffer.from(keyB64, "base64");
    if (salt.length === 0 || key.length === 0) return null;
    return { N, r, p, salt, key };
  } catch {
    return null;
  }
}

/** Hash a password into the `scrypt$…` format (fresh random salt). */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LEN, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  const params = `n=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P}`;
  return `scrypt$${params}$${salt.toString("base64")}$${key.toString("base64")}`;
}

/**
 * Timing-safe verify. A malformed/absent hash still burns one scrypt against
 * a dummy salt before returning false, so callers can pass whatever they
 * loaded (or {@link DUMMY_HASH} for an unknown user) without leaking timing.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = parseHash(stored);
  if (!parts) {
    await scryptAsync(password, Buffer.alloc(16), KEY_LEN, SCRYPT_N, SCRYPT_R, SCRYPT_P);
    return false;
  }
  try {
    const key = await scryptAsync(password, parts.salt, parts.key.length, parts.N, parts.r, parts.p);
    return key.length === parts.key.length && crypto.timingSafeEqual(key, parts.key);
  } catch {
    return false;
  }
}

/** A syntactically valid hash that matches no password — the unknown-user
 *  stand-in `verifyLogin` burns its scrypt against. */
export const DUMMY_HASH = `scrypt$n=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P}$${Buffer.alloc(16).toString("base64")}$${Buffer.alloc(KEY_LEN).toString("base64")}`;
