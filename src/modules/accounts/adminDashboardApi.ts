/**
 * @file The admin dashboard's wire layer — the client half of
 * `/api/accounts/admin/dashboard`.
 *
 * Separate from `./adminApi` on purpose. That file is the suite's stable client
 * for the four routes P1–P3 left behind, consumed by five tabs; this is one
 * screen's feed and will move with that screen. Folding a dashboard-shaped
 * payload into the suite's client would make every tab's module graph depend on
 * the shape of a card nobody but the canvas renders.
 *
 * The same two rules `./adminApi` states apply here and for the same reasons:
 * the shapes describe **the wire**, not the server's own types (every one of
 * those files reaches `node:fs` one import down, and this file is loaded by a
 * `"use client"` surface — an `import type` would compile right up until
 * somebody widened it), and every call answers one refusal shape with the
 * SERVER'S error text verbatim.
 */
"use client";

import type { Answer } from "./adminApi";

/* ================================== the wire ================================== */

export interface DashPresence {
  online: { username: string; away: boolean; connections: number }[];
  onlineCount: number;
  /** Open presence streams, not members — two browsers is two. */
  connections: number;
  /** Enabled members. */
  members: number;
  /** Every account, disabled included. */
  total: number;
}

export interface DashSignups {
  /** Oldest first, quiet months INCLUDED as zeroes (the route fills them, and
   *  its docblock says why a sparse series would lie). */
  buckets: { month: string; count: number }[];
  recent: { username: string; createdAt: string }[];
  total: number;
}

export interface DashConsumer {
  username: string;
  totalBytes: number;
  sharedBytes: number;
  scannedAt: string;
}

export interface DashStorage {
  /** OWNED bytes across the install. Shared roots are excluded — see P1. */
  totalBytes: number;
  /** Attributed to more than one member, so never summed into the total. */
  sharedBytes: number;
  files: number;
  scannedUsers: number;
  unscanned: string[];
  unscannedCount: number;
  /** The stalest member's scan — the staleness of the whole picture. */
  oldestScanAt: string | null;
  top: DashConsumer[];
}

export interface DashPolicy {
  overQuota: { username: string; usedBytes: number; limitBytes: number }[];
  overQuotaCount: number;
  suspended: { username: string; reason: string; until: string | null; lapsed: boolean }[];
  suspendedCount: number;
  loginDisabled: number;
  pins: {
    /** Members with at least one pin of their own. */
    subjects: number;
    /** Pinned fields across those members. */
    keys: number;
    /** Fields pinned on the SITE tier. */
    site: number;
  };
}

export interface DashProcess {
  pid: number;
  nodeVersion: string;
  platform: string;
  uptimeSec: number;
  startedAt: string;
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
}

/**
 * The media sidecar's state. **`configured: false` is neutral, not a fault** —
 * it means `AMBERXVID_MEDIA_URL` is unset, and a service that was never
 * promised must not be drawn red. The card renders three states from these two
 * booleans and nothing infers a fourth.
 */
export interface DashMedia {
  configured: boolean;
  url?: string;
  ok?: boolean;
  status?: number;
  latencyMs?: number;
  error?: string;
}

export interface DashboardFacts {
  generatedAt: string;
  presence: DashPresence;
  signups: DashSignups;
  storage: DashStorage;
  policy: DashPolicy;
  health: { process: DashProcess; media: DashMedia };
}

/* =================================== the call ================================= */

/**
 * One request for every card that is not the audit tail (which calls
 * `fetchAudit` directly — the route that already answers it stays the only
 * place that query lives).
 *
 * Read defensively field by field rather than cast whole: the compiler cannot
 * see across a `fetch`, so a route that changed its payload would otherwise
 * become a runtime crash in a card instead of a missing number.
 */
export async function fetchDashboardFacts(): Promise<Answer<DashboardFacts>> {
  try {
    const res = await fetch("/api/accounts/admin/dashboard", { cache: "no-store" });
    const body = (await res.json()) as Record<string, unknown> & { ok?: boolean; error?: string };
    if (!res.ok || body.ok !== true) {
      return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    }
    return {
      ok: true,
      data: {
        generatedAt: String(body["generatedAt"] ?? ""),
        presence: (body["presence"] as DashPresence) ?? {
          online: [],
          onlineCount: 0,
          connections: 0,
          members: 0,
          total: 0,
        },
        signups: (body["signups"] as DashSignups) ?? { buckets: [], recent: [], total: 0 },
        storage: (body["storage"] as DashStorage) ?? {
          totalBytes: 0,
          sharedBytes: 0,
          files: 0,
          scannedUsers: 0,
          unscanned: [],
          unscannedCount: 0,
          oldestScanAt: null,
          top: [],
        },
        policy: (body["policy"] as DashPolicy) ?? {
          overQuota: [],
          overQuotaCount: 0,
          suspended: [],
          suspendedCount: 0,
          loginDisabled: 0,
          pins: { subjects: 0, keys: 0, site: 0 },
        },
        health: (body["health"] as DashboardFacts["health"]) ?? {
          process: {
            pid: 0,
            nodeVersion: "",
            platform: "",
            uptimeSec: 0,
            startedAt: "",
            rssBytes: 0,
            heapUsedBytes: 0,
            heapTotalBytes: 0,
          },
          media: { configured: false },
        },
      },
    };
  } catch (err) {
    return { ok: false, error: `could not reach the server: ${String(err)}` };
  }
}

/* ================================== formatting ================================ */

/** An uptime a person reads. Seconds only below a minute, because "0h 0m" for a
 *  server that started nine seconds ago reads as broken. */
export function fmtUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600) % 24;
  const d = Math.floor(seconds / 86400);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** `2026-08` → `Aug 2026`. The bucket key is sortable; this is the label. */
export function fmtMonth(key: string): string {
  const [y, m] = key.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return key;
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1] ?? m} ${y}`;
}
