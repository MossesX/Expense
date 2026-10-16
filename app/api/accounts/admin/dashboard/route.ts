/**
 * @file `/api/accounts/admin/dashboard` — the admin dashboard's own facts: the
 * handful of numbers its cards need that **no existing route already serves**.
 *
 * ```
 * GET → { presence, signups, storage, policy, health }
 * ```
 *
 * ## What is deliberately NOT here
 *
 * The audit tail. `/api/accounts/admin/audit` already answers it, paged,
 * filtered and faceted, and the dashboard's tail card calls it directly with
 * `limit=N`. A second copy of that query living here would be a second thing to
 * keep in step with the verb set, and the first time they disagreed the card
 * would be showing a trail the Audit tab does not have.
 *
 * The roster table, likewise: `/api/accounts/admin/users` pages it. This route
 * never sends rows a table would render — it sends TOTALS and the short heads
 * of a couple of lists, which is what a card is.
 *
 * ## Why the whole roster is read here when the users route pages
 *
 * Because a total is not a page. "Storage across the install" and "signups per
 * month" are questions about every member by definition, and answering them
 * from a 50-row page would produce a number that is confidently wrong. The cost
 * is the one the users route already accepts for `sort=storage`: one small
 * document read per member, not a filesystem walk — `readUsage` never walks
 * (see `lib/storage.ts`), and a member who has never been scanned is reported
 * as unscanned rather than as zero.
 *
 * ## The media server is PROBED, never assumed
 *
 * `AMBERXVID_MEDIA_URL` is read from the environment and nothing else. Unset
 * means **not configured**, which is a state and not a fault: the card says so
 * and stays neutral. A service that was never promised must never be drawn red,
 * or the health card teaches an administrator to ignore it. The env var is read
 * literally rather than through `modules/amberxvid/lib/mediaBridge` — accounts
 * imports no other module by rule (`lib/storage.ts` says why), and one
 * `process.env` lookup is not worth breaking that for.
 *
 * ## Read-only, admin-gated, unaudited
 *
 * Same posture as the audit route's own GET: this records nobody's data, only
 * counts, and a dashboard somebody leaves open would fill the trail with its
 * own polling. Nothing here is a write.
 */

import { NextResponse, type NextRequest } from "next/server";

import { listAccounts } from "@axs/modules/accounts/lib/accounts";
import { fail, requireLiveAdmin } from "@axs/modules/accounts/lib/http";
import { policyDir, SITE_POLICY_SUBJECT } from "@axs/modules/accounts/lib/paths";
import { effectivePolicy, readOverrides, suspensionOf } from "@axs/modules/accounts/lib/policy";
import { connectionCount, isAway, isOnline } from "@axs/modules/accounts/lib/presence";
import { readUsage } from "@axs/modules/accounts/lib/storage";

import fsp from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How many rows the two "head of a list" fields carry. A card shows a handful
 *  and links to the tab that shows the rest; shipping fifty would make this
 *  route the roster it deliberately is not. */
const HEAD = 8;

/** How long the media probe may take before it is reported as unreachable. A
 *  health check that hangs is a dashboard that never renders, so the timeout is
 *  short and its expiry is an ANSWER (`ok: false`) rather than a thrown request. */
const MEDIA_PROBE_MS = 2_500;

const MB = 1024 * 1024;

/* ================================== presence ================================== */

/**
 * Who is here and how many connections they are holding.
 *
 * "Active sessions" in this studio means **open presence streams**, and that is
 * not a simplification — `axs_session` is a signed stateless cookie, so there is
 * no session table to count. A live SSE stream is what being signed in actually
 * costs the server, which is exactly why the `maxSessions` policy row is written
 * against `connectionCount` too. Counting anything else here would put a second
 * definition of "session" in the app beside the one the policy enforces.
 */
function presenceOf(accounts: { username: string; disabled?: boolean }[]) {
  const live = accounts
    .filter((a) => a.disabled !== true && isOnline(a.username))
    .map((a) => ({
      username: a.username,
      away: isAway(a.username),
      connections: connectionCount(a.username),
    }))
    .sort((a, b) => b.connections - a.connections || a.username.localeCompare(b.username));

  return {
    online: live,
    onlineCount: live.length,
    /** Every open stream, not every member — two browsers is two. */
    connections: live.reduce((n, p) => n + p.connections, 0),
    members: accounts.filter((a) => a.disabled !== true).length,
    total: accounts.length,
  };
}

/* =================================== signups ================================== */

/** `YYYY-MM` for a stamp, or null when the account carries no usable one. */
function monthOf(iso: string | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Signups per month, oldest first, with **empty months filled in**.
 *
 * The gaps matter: a sparse series drawn as a bar per row turns three signups
 * in January and three in June into two adjacent equal bars, which reads as
 * steady growth. Filling the quiet months is the difference between a chart and
 * a chart that lies.
 */
function signupsOf(accounts: { username: string; createdAt?: string }[]) {
  const counts = new Map<string, number>();
  for (const a of accounts) {
    const m = monthOf(a.createdAt);
    if (m) counts.set(m, (counts.get(m) ?? 0) + 1);
  }

  const keys = [...counts.keys()].sort();
  const buckets: { month: string; count: number }[] = [];
  if (keys.length > 0) {
    const [firstY, firstM] = keys[0].split("-").map(Number);
    const [lastY, lastM] = keys[keys.length - 1].split("-").map(Number);
    for (let y = firstY, m = firstM; y < lastY || (y === lastY && m <= lastM); ) {
      const key = `${y}-${String(m).padStart(2, "0")}`;
      buckets.push({ month: key, count: counts.get(key) ?? 0 });
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
  }

  const recent = accounts
    .filter((a) => a.createdAt)
    .sort((a, b) => Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? ""))
    .slice(0, HEAD)
    .map((a) => ({ username: a.username, createdAt: a.createdAt ?? "" }));

  return { buckets, recent, total: accounts.length };
}

/* =================================== storage ================================== */

/** One member's footprint, as the top-consumers list carries it. */
interface Consumer {
  username: string;
  totalBytes: number;
  sharedBytes: number;
  scannedAt: string;
}

/**
 * The site's storage picture, from P1's ledger.
 *
 * **`totalBytes` sums OWNED bytes only.** `lib/storage.ts` marks a shared root
 * (conversations) `shared` precisely so a site total never adds one thread's
 * bytes once per participant; `sharedBytes` is reported beside it as its own
 * number, double-counted and labelled as such, because the honest answer to
 * "how much would this free" is not the honest answer to "how much is stored".
 *
 * A member with no index is counted as UNSCANNED, never as zero. That is the
 * whole reason the ledger answers `null` — see the read contract in P1.
 */
async function storageOf(usernames: string[]) {
  let totalBytes = 0;
  let sharedBytes = 0;
  let files = 0;
  const consumers: Consumer[] = [];
  const unscanned: string[] = [];
  let oldestScan: string | null = null;

  for (const username of usernames) {
    const index = await readUsage(username);
    if (!index) {
      unscanned.push(username);
      continue;
    }
    totalBytes += index.totalBytes;
    sharedBytes += index.sharedBytes;
    files += index.roots.reduce((n, r) => n + r.files, 0);
    consumers.push({
      username,
      totalBytes: index.totalBytes,
      sharedBytes: index.sharedBytes,
      scannedAt: index.scannedAt,
    });
    if (!oldestScan || index.scannedAt < oldestScan) oldestScan = index.scannedAt;
  }

  return {
    totalBytes,
    sharedBytes,
    files,
    scannedUsers: consumers.length,
    unscanned: unscanned.slice(0, HEAD),
    unscannedCount: unscanned.length,
    /** The staleness of the WHOLE picture is its stalest member — an average
     *  would hide the one nobody has rescanned since March. */
    oldestScanAt: oldestScan,
    top: consumers.sort((a, b) => b.totalBytes - a.totalBytes).slice(0, HEAD),
  };
}

/* ==================================== policy ================================== */

/**
 * How many subjects have PINNED anything, counted by reading the policy
 * directory rather than by asking per member.
 *
 * A pin document exists only for a subject somebody has pinned something on, so
 * this walk is the size of the answer and not the size of the roster. Junk and
 * undeclared keys are dropped by `readOverrides` itself, which is why a subject
 * whose only pin belongs to an unloaded module counts as zero here rather than
 * as a phantom override an administrator cannot find.
 */
async function pinsOf(): Promise<{ subjects: number; keys: number; site: number }> {
  let names: string[] = [];
  try {
    names = await fsp.readdir(policyDir());
  } catch {
    // No policy directory: nothing has ever been pinned. Not an error — it is
    // what a fresh install looks like.
    return { subjects: 0, keys: 0, site: 0 };
  }

  let subjects = 0;
  let keys = 0;
  let site = 0;
  for (const name of names) {
    if (!name.toLowerCase().endsWith(".json")) continue;
    const subject = path.basename(name, path.extname(name));
    const count = Object.keys(readOverrides(subject).values).length;
    if (count === 0) continue;
    if (subject === SITE_POLICY_SUBJECT) site = count;
    else {
      subjects += 1;
      keys += count;
    }
  }
  return { subjects, keys, site };
}

/**
 * The alerts an administrator would want to be told rather than to go looking
 * for: who is over quota, who is suspended, who cannot sign in, and how much of
 * the cascade has been pinned away from its defaults.
 *
 * Over-quota is computed against the RESOLVED quota per member, because a quota
 * is a cascade value and a site-wide number would be wrong for anyone pinned.
 * A member with no index is not listed: nothing can honestly say an unmeasured
 * member is over, which is the `no-index` verdict P1 refuses to guess past.
 */
async function alertsOf(usernames: string[]) {
  const overQuota: { username: string; usedBytes: number; limitBytes: number }[] = [];
  const suspended: { username: string; reason: string; until: string | null; lapsed: boolean }[] = [];
  let loginDisabled = 0;

  for (const username of usernames) {
    const values = await effectivePolicy(username);
    const state = suspensionOf(values);
    if (state.on) {
      suspended.push({
        username,
        reason: state.reason,
        until: state.until,
        lapsed: state.lapsed,
      });
    }
    if (values.loginDisabled === true) loginDisabled += 1;

    const quotaMB = Number(values.storageQuotaMB ?? 0);
    if (!(quotaMB > 0)) continue;
    const index = await readUsage(username);
    if (!index) continue;
    const limitBytes = quotaMB * MB;
    if (index.totalBytes > limitBytes) {
      overQuota.push({ username, usedBytes: index.totalBytes, limitBytes });
    }
  }

  return {
    overQuota: overQuota.sort((a, b) => b.usedBytes - a.usedBytes).slice(0, HEAD),
    overQuotaCount: overQuota.length,
    suspended: suspended.slice(0, HEAD),
    suspendedCount: suspended.length,
    loginDisabled,
    pins: await pinsOf(),
  };
}

/* ==================================== health ================================== */

/** The app process, from the process itself. Nothing here is sampled or
 *  averaged — every field is what Node says at the moment of the request. */
function processHealth() {
  const mem = process.memoryUsage();
  return {
    pid: process.pid,
    nodeVersion: process.version,
    platform: `${process.platform}/${process.arch}`,
    uptimeSec: Math.round(process.uptime()),
    startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    rssBytes: mem.rss,
    heapUsedBytes: mem.heapUsed,
    heapTotalBytes: mem.heapTotal,
  };
}

/** What the media card renders. `configured: false` is the neutral state — see
 *  the docblock; it is not a failure and must never be drawn as one. */
interface MediaHealth {
  configured: boolean;
  url?: string;
  ok?: boolean;
  status?: number;
  latencyMs?: number;
  error?: string;
}

async function mediaHealth(): Promise<MediaHealth> {
  const url = process.env.AMBERXVID_MEDIA_URL?.trim();
  if (!url) return { configured: false };

  const target = `${url.replace(/\/+$/, "")}/health`;
  const began = Date.now();
  try {
    const res = await fetch(target, {
      cache: "no-store",
      signal: AbortSignal.timeout(MEDIA_PROBE_MS),
    });
    return {
      configured: true,
      url: target,
      ok: res.ok,
      status: res.status,
      latencyMs: Date.now() - began,
    };
  } catch (err) {
    // A timeout and a refused connection are both "cannot reach it" as far as
    // the card is concerned, and both are reported with the reason rather than
    // as a 500 — the dashboard must still render when the sidecar is down.
    return {
      configured: true,
      url: target,
      ok: false,
      latencyMs: Date.now() - began,
      error: String(err instanceof Error ? err.message : err),
    };
  }
}

/* ===================================== GET ==================================== */

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await requireLiveAdmin(req);
  if ("deny" in gate) return gate.deny;

  try {
    const accounts = await listAccounts();
    const names = accounts.map((a) => a.username);

    // The media probe is the only slow part and it is independent of every
    // other answer, so it runs alongside the disk reads instead of after them.
    const [media, storage, policy] = await Promise.all([
      mediaHealth(),
      storageOf(names),
      alertsOf(names),
    ]);

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      presence: presenceOf(accounts),
      signups: signupsOf(accounts),
      storage,
      policy,
      health: { process: processHealth(), media },
    });
  } catch (err) {
    return fail(500, `dashboard read failed: ${String(err instanceof Error ? err.message : err)}`);
  }
}
