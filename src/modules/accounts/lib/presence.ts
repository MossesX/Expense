/**
 * @file Accounts presence registry — who is online RIGHT NOW, and the push
 * channel live messages ride.
 *
 * Online is defined by connection, not polling: a member is online while at
 * least one of their SSE streams (`/api/accounts/presence`, P2) is open. The
 * registry lives in process memory, pinned to `globalThis` so dev-server HMR
 * re-attaches instead of orphaning connections (the proven amberxvid /
 * polorec pattern); the only part that persists is the member's `lastSeenAt`,
 * stamped into their profile document when their last connection closes — so
 * "last seen" survives a restart while live state honestly resets.
 *
 * PING DISCIPLINE (for the P2 route to implement — the registry owns no
 * timer): the SSE route sends `{ type: "ping", at }` on each of its streams
 * every 15 seconds. That keeps proxies from reaping an idle connection AND
 * makes a dead socket throw on write, which runs the route's disposer — the
 * registry only ever learns about a vanished client from that write failure,
 * so a route that skips the ping leaves ghosts on the roster.
 *
 * Every roster flip broadcasts to every open stream (buddy lists flip live),
 * and `notifyUsers` is how the messages route hands a fresh message to both
 * participants' clients in the same request that stored it.
 *
 * AWAY (P4) is self-declared and lives here, beside the connection it
 * describes: the registry has no activity signal, so an idle timer would be
 * inventing one. It is memory-only and clears when the member's last stream
 * closes — signing off always lands at offline, never at "away since
 * Tuesday". `setAway` broadcasts, so a buddy list flips on it the same way it
 * flips on a sign-in.
 *
 * THE ROSTER IS NOT FILTERED BY BLOCKS, deliberately: it is a membership list
 * broadcast once to every stream, carrying what `/api/accounts/users` already
 * gives every signed-in member. Blocks hide the PROFILE and refuse every
 * interaction (`./relations`) — which is also why nothing here imports that
 * file, and why it imports nothing from here. Server-only.
 */

import { listAccounts } from "./accounts";
import { readLastSeen, touchLastSeen } from "./profiles";
import type { AccountsEvent, Presence } from "./types";

type Push = (event: AccountsEvent) => void;

interface Registry {
  /** username (lowercased) → the live pushes of every open stream. */
  conns: Map<string, Set<Push>>;
  /** Members who declared themselves away. Never persisted. */
  away: Set<string>;
}

const REGISTRY_KEY = "__axsAccountsPresence";

function registry(): Registry {
  const g = globalThis as unknown as Record<string, Registry | undefined>;
  const existing = g[REGISTRY_KEY];
  if (!existing) {
    const fresh: Registry = { conns: new Map(), away: new Set() };
    g[REGISTRY_KEY] = fresh;
    return fresh;
  }
  // An HMR generation from before `away` existed is still pinned to
  // globalThis with its connections live — adopt it rather than orphan them.
  if (!existing.away) existing.away = new Set();
  return existing;
}

const norm = (u: string): string => u.trim().toLowerCase();

/* ---------------------------------- roster ------------------------------------- */

export function isOnline(user: string): boolean {
  return connectionCount(user) > 0;
}

/**
 * How many live streams this member holds right now.
 *
 * `isOnline` is the boolean over the top of it; the NUMBER exists because the
 * `maxSessions` policy row needs to know how many, and a caller that had to
 * reach into the registry to count would be a second reader of a structure
 * that is deliberately private to this file.
 */
export function connectionCount(user: string): number {
  return registry().conns.get(norm(user))?.size ?? 0;
}

/** Self-declared away — only ever true for a member who is also online, so a
 *  stale flag can never make a signed-out member look present. */
export function isAway(user: string): boolean {
  const key = norm(user);
  return registry().away.has(key) && isOnline(key);
}

/**
 * Declare yourself away (or back). Only a member with a live stream can be
 * away — setting it while signed out would be a status nobody is holding.
 * Returns whether the roster actually changed; the caller broadcasts nothing
 * itself, this does it.
 */
export function setAway(user: string, away: boolean): boolean {
  const key = norm(user);
  if (!isOnline(key)) return false;
  const reg = registry();
  const had = reg.away.has(key);
  if (had === away) return false;
  if (away) reg.away.add(key);
  else reg.away.delete(key);
  void broadcastRoster();
  return true;
}

/** The full roster: every enabled member, online = has a live stream. */
export async function presenceSnapshot(): Promise<Presence[]> {
  const accounts = await listAccounts();
  return accounts
    .filter((a) => a.disabled !== true)
    .map((a) => {
      const online = isOnline(a.username);
      return {
        username: a.username,
        online,
        away: online && registry().away.has(norm(a.username)),
        lastSeenAt: online
          ? new Date().toISOString()
          : (readLastSeen(a.username) ?? a.lastLoginAt ?? a.updatedAt),
      };
    });
}

/* -------------------------------- broadcasting ---------------------------------- */

/** Push an event to every open stream (roster flips). */
export function broadcastAll(event: AccountsEvent): void {
  for (const pushes of registry().conns.values()) {
    for (const push of pushes) push(event);
  }
}

/** Push an event to specific members' streams (live message delivery). */
export function notifyUsers(usernames: string[], event: AccountsEvent): void {
  const reg = registry();
  for (const user of usernames) {
    const pushes = reg.conns.get(norm(user));
    if (pushes) for (const push of pushes) push(event);
  }
}

async function broadcastRoster(): Promise<void> {
  broadcastAll({ type: "roster", roster: await presenceSnapshot() });
}

/* -------------------------------- connections ----------------------------------- */

/**
 * Register a member's stream. When it is their FIRST open stream the roster
 * flips online for everyone; the returned disposer un-registers, and the last
 * stream closing flips them offline + stamps `lastSeenAt` on their profile.
 */
export function connect(username: string, send: Push): () => void {
  const reg = registry();
  const key = norm(username);
  let pushes = reg.conns.get(key);
  const cameOnline = !pushes || pushes.size === 0;
  if (!pushes) {
    pushes = new Set();
    reg.conns.set(key, pushes);
  }
  pushes.add(send);
  if (cameOnline) void broadcastRoster();

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    const set = reg.conns.get(key);
    set?.delete(send);
    if (set && set.size === 0) {
      reg.conns.delete(key);
      // Away is a state you hold while connected; signing off ends it rather
      // than leaving the member "away" on every buddy list until next time.
      reg.away.delete(key);
      void touchLastSeen(key);
      void broadcastRoster();
    }
  };
}

/**
 * Drop every live connection a member holds — the admin cascade's presence
 * step (a removed account must not keep a live stream). The registry forgets
 * them and the roster catches up; the client's dangling socket dies on the
 * route's next ping write.
 */
export function evictPresence(username: string): boolean {
  const reg = registry();
  const key = norm(username);
  const had = reg.conns.delete(key);
  reg.away.delete(key);
  if (had) void broadcastRoster();
  return had;
}
