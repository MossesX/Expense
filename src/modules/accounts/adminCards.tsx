/**
 * @file The admin dashboard's CARDS — seven gauges, each reading a real source.
 *
 * ## The rule this file is written under
 *
 * **No invented numbers.** Every figure below comes from
 * `/api/accounts/admin/dashboard` (which reads the roster, P1's storage ledger,
 * the policy cascade, the presence registry and the process itself) or from
 * `/api/accounts/admin/audit`. Where a source cannot answer, the card says so in
 * words — "never scanned", "not configured", "nobody right now" — and shows no
 * number at all. A plausible zero is worse than a blank, because a zero is read
 * as a measurement.
 *
 * ## Two compositions, and an honest refusal
 *
 * Each card declares `shapes`. A `"both"` card renders a **wide** composition
 * when the slot it is in runs horizontal and a **tall** one when it runs
 * vertical — the flip the canvas answers through the dock engine's `decide()`
 * (`./adminCanvas`). A card that genuinely has only one shape declares it
 * (`"wide"` / `"tall"`) and keeps that composition whatever slot it is dropped
 * in, with the header saying which — the "refuses the flip honestly" case.
 *
 * The signups chart is the one that has to: a bar-per-month series squeezed into
 * a one-cell column is not a smaller chart, it is an unreadable one. Declaring
 * that is better than shipping a second composition that technically renders.
 *
 * ## The cards do not fetch — except the one that must
 *
 * The canvas fetches once and hands every card the same snapshot, so six cards
 * are one request and they all agree with each other. The audit tail is the
 * exception: `/api/accounts/admin/audit` already answers that query with paging
 * and facets, and copying it into the dashboard route would have been a second
 * place to keep the verb set in step with. So that one card calls the real route
 * directly.
 */
"use client";

import * as React from "react";

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Glyph, token, type DockOrientation } from "@axf/core";

import { fetchAudit, fmtBytes, fmtWhen, type AuditEntryWire } from "./adminApi";
import { fmtMonth, fmtUptime, type DashboardFacts } from "./adminDashboardApi";
import RemoveDataDialog from "./RemoveDataDialog";

/* ================================ the contract ================================ */

/** What every card is handed. One snapshot, shared, so no two cards can be
 *  showing figures from different seconds. */
export interface CardContext {
  facts: DashboardFacts | null;
  /** What the slot says — `horizontal` for a wide slot, `vertical` for a tall
   *  one. A single-shape card is told anyway, and ignores it. */
  orientation: DockOrientation;
  /** Re-read the whole snapshot. */
  reload: () => void;
}

export interface AdminCardSpec {
  id: string;
  title: string;
  glyph: string;
  description: string;
  /** Which compositions this card genuinely has. */
  shapes: "both" | "wide" | "tall";
  /** Where it sits before anybody moves it, in canvas cells. */
  place: { col: number; row: number; w: number; h: number };
  render: (ctx: CardContext) => React.ReactNode;
}

/* ================================== the kit =================================== */

const LABEL = {
  fontFamily: token("mono"),
  fontSize: 10,
  letterSpacing: "0.08em",
  textTransform: "uppercase" as const,
  color: token("dim"),
};

/** One headline number with its label. `value` may be a word — "never", "not
 *  configured" — which is the whole point: the honest absence renders in the
 *  same slot the number would have. */
function Figure({
  value,
  label,
  tone,
  size = 26,
}: {
  value: React.ReactNode;
  label: string;
  tone?: string;
  size?: number;
}) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography
        sx={{
          fontFamily: token("mono"),
          fontSize: size,
          fontWeight: 700,
          lineHeight: 1.1,
          color: tone ?? token("ink"),
        }}
      >
        {value}
      </Typography>
      <Typography sx={LABEL}>{label}</Typography>
    </Box>
  );
}

/** A label/value line — the readout voice the whole canvas shares. */
function Row({ k, v, tone }: { k: string; v: React.ReactNode; tone?: string }) {
  return (
    <Stack direction="row" sx={{ alignItems: "baseline", gap: 1, minWidth: 0 }}>
      <Typography sx={{ ...LABEL, flexShrink: 0 }}>{k}</Typography>
      <Box sx={{ flex: 1, borderBottom: `1px dotted ${token("edge")}`, opacity: 0.5 }} />
      <Typography
        sx={{
          fontFamily: token("mono"),
          fontSize: 12,
          color: tone ?? token("ink"),
          whiteSpace: "nowrap",
        }}
      >
        {v}
      </Typography>
    </Stack>
  );
}

/** What a card shows before the snapshot lands, and while it is being re-read. */
function Waiting() {
  return (
    <Stack sx={{ alignItems: "center", justifyContent: "center", flex: 1, py: 2 }}>
      <CircularProgress size={18} />
    </Stack>
  );
}

/** The honest empty state. Never a zero — see the file's docblock. */
function Nothing({ children }: { children: React.ReactNode }) {
  return (
    <Typography sx={{ fontSize: 11.5, color: token("dim"), fontStyle: "italic" }}>
      {children}
    </Typography>
  );
}

const scroll = { flex: 1, minHeight: 0, overflow: "auto" } as const;

/* ============================== 1 · users online ============================== */

function OnlineCard({ facts, orientation }: CardContext) {
  if (!facts) return <Waiting />;
  const { online, onlineCount, members, connections } = facts.presence;
  const wide = orientation === "horizontal";

  const roster =
    online.length === 0 ? (
      <Nothing>Nobody is signed in right now.</Nothing>
    ) : (
      <Stack
        direction={wide ? "row" : "column"}
        sx={{ gap: 0.5, flexWrap: wide ? "wrap" : "nowrap", alignItems: wide ? "center" : "stretch" }}
      >
        {online.map((p) => (
          <Chip
            key={p.username}
            size="small"
            variant="outlined"
            label={p.connections > 1 ? `${p.username} ×${p.connections}` : p.username}
            sx={{
              fontSize: 11,
              height: 20,
              justifyContent: "flex-start",
              color: p.away ? token("warn") : token("ok"),
              borderColor: p.away ? token("warn") : token("ok"),
            }}
          />
        ))}
      </Stack>
    );

  return (
    <Stack sx={{ gap: 1, flex: 1, minHeight: 0 }}>
      <Stack direction={wide ? "row" : "column"} sx={{ gap: wide ? 2.5 : 0.75 }}>
        <Figure value={onlineCount} label="online now" tone={onlineCount ? token("ok") : undefined} />
        <Figure value={members} label="members" size={wide ? 26 : 18} />
        <Figure value={connections} label="streams" size={wide ? 26 : 18} />
      </Stack>
      <Box sx={scroll}>{roster}</Box>
    </Stack>
  );
}

/* ============================== 2 · signups over time ========================= */

/**
 * Signups per month. **Wide only** — declared, not worked around.
 *
 * The bars are `Box`es rather than an SVG or a charting dependency: the studio
 * has no chart library and is not gaining one for six rectangles, and a
 * `LinearProgress` per month would be a control standing in for a mark. Colour
 * comes from `token("accent")` so the series follows the theme like everything
 * else on the canvas.
 */
function SignupsCard({ facts }: CardContext) {
  if (!facts) return <Waiting />;
  const { buckets, recent, total } = facts.signups;
  if (buckets.length === 0) {
    return (
      <Stack sx={{ gap: 1 }}>
        <Figure value={total} label="accounts" />
        <Nothing>No account carries a usable creation date yet.</Nothing>
      </Stack>
    );
  }

  const peak = Math.max(...buckets.map((b) => b.count), 1);
  // The tail is what a person actually reads; a series of forty months squeezed
  // into a card is a texture, not a chart.
  const shown = buckets.slice(-14);

  return (
    <Stack sx={{ gap: 1, flex: 1, minHeight: 0 }}>
      <Stack direction="row" sx={{ gap: 2.5, alignItems: "flex-end" }}>
        <Figure value={total} label="accounts" />
        <Figure value={shown[shown.length - 1]?.count ?? 0} label={fmtMonth(shown[shown.length - 1]?.month ?? "")} size={18} />
      </Stack>

      <Stack
        direction="row"
        sx={{ gap: "3px", alignItems: "flex-end", height: 48, flexShrink: 0 }}
      >
        {shown.map((b) => (
          <Tooltip key={b.month} title={`${fmtMonth(b.month)} — ${b.count} signup(s)`}>
            <Box
              sx={{
                flex: 1,
                minWidth: 4,
                height: `${Math.max(3, (b.count / peak) * 100)}%`,
                background: b.count === 0 ? token("edge") : token("accent"),
                opacity: b.count === 0 ? 0.5 : 0.85,
                borderRadius: "2px 2px 0 0",
              }}
            />
          </Tooltip>
        ))}
      </Stack>
      <Typography sx={{ ...LABEL, flexShrink: 0 }}>
        {fmtMonth(shown[0].month)} → {fmtMonth(shown[shown.length - 1].month)}
      </Typography>

      <Box sx={scroll}>
        {recent.length === 0 ? (
          <Nothing>No recent signups.</Nothing>
        ) : (
          recent
            .slice(0, 4)
            .map((r) => <Row key={r.username} k={r.username} v={fmtWhen(r.createdAt)} />)
        )}
      </Box>
    </Stack>
  );
}

/* ============================== 3 · storage =================================== */

function StorageCard({ facts, orientation, reload }: CardContext) {
  const [removeFor, setRemoveFor] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);

  if (!facts) return <Waiting />;
  const s = facts.storage;
  const wide = orientation === "horizontal";

  return (
    <Stack sx={{ gap: 1, flex: 1, minHeight: 0 }}>
      <Stack direction={wide ? "row" : "column"} sx={{ gap: wide ? 2.5 : 0.75 }}>
        <Figure value={fmtBytes(s.totalBytes)} label="owned" size={wide ? 24 : 20} />
        <Figure value={fmtBytes(s.sharedBytes)} label="shared" size={wide ? 24 : 18} tone={token("dim")} />
        <Figure value={s.scannedUsers} label="scanned" size={wide ? 24 : 18} />
      </Stack>

      {s.unscannedCount > 0 && (
        <Typography sx={{ fontSize: 11, color: token("warn") }}>
          {s.unscannedCount} member{s.unscannedCount === 1 ? "" : "s"} never scanned — not counted,
          not assumed empty.
        </Typography>
      )}
      {note && (
        <Typography sx={{ fontSize: 11, color: token("ok") }}>{note}</Typography>
      )}

      <Box sx={scroll}>
        <Typography sx={{ ...LABEL, mb: 0.5 }}>Top consumers</Typography>
        {s.top.length === 0 ? (
          <Nothing>Nothing has been scanned yet — run a rescan from the Storage tab.</Nothing>
        ) : (
          s.top.map((c) => (
            <Stack key={c.username} direction="row" sx={{ alignItems: "center", gap: 0.75 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Row k={c.username} v={fmtBytes(c.totalBytes)} />
              </Box>
              <Tooltip title={`Remove ${c.username}'s stored data`}>
                <IconButton size="small" onClick={() => setRemoveFor(c.username)}>
                  <Glyph id="icon-trash" size={12} />
                </IconButton>
              </Tooltip>
            </Stack>
          ))
        )}
      </Box>

      <Typography sx={{ ...LABEL, flexShrink: 0 }}>
        oldest scan · {s.oldestScanAt ? fmtWhen(s.oldestScanAt) : "never"}
      </Typography>

      {removeFor && (
        <RemoveDataDialog
          username={removeFor}
          onClose={() => setRemoveFor(null)}
          onDone={(removed) => {
            setNote(
              removed.length
                ? `Removed for ${removeFor}: ${removed.join(", ")}.`
                : `Nothing stored for ${removeFor} — nothing removed.`
            );
            setRemoveFor(null);
            reload();
          }}
        />
      )}
    </Stack>
  );
}

/* ============================== 4 · audit tail ================================ */

/** How many records the tail holds. A tail, not a page — the Audit tab is where
 *  a query lives. */
const TAIL = 25;

function AuditCard({ orientation }: CardContext) {
  const [entries, setEntries] = React.useState<AuditEntryWire[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const wide = orientation === "horizontal";

  const load = React.useCallback(async () => {
    const answer = await fetchAudit({ limit: TAIL });
    if (answer.ok) {
      setEntries(answer.data.entries);
      setError(null);
    } else {
      setError(answer.error);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return <Typography sx={{ fontSize: 11.5, color: token("err") }}>{error}</Typography>;
  }
  if (!entries) return <Waiting />;
  if (entries.length === 0) return <Nothing>No administrative acts recorded yet.</Nothing>;

  return (
    <Box sx={scroll}>
      {entries.map((e) => (
        <Stack
          key={e.id}
          direction={wide ? "row" : "column"}
          sx={{
            gap: wide ? 1 : 0,
            alignItems: wide ? "baseline" : "flex-start",
            py: 0.35,
            borderBottom: `1px solid ${token("edge")}`,
          }}
        >
          <Typography
            sx={{ fontFamily: token("mono"), fontSize: 11, color: token("accent"), flexShrink: 0 }}
          >
            {e.verb}
          </Typography>
          <Typography sx={{ fontSize: 11.5, flex: wide ? 1 : undefined, minWidth: 0 }}>
            {e.actor} → {e.subject}
            {e.path ? ` · ${e.path}` : e.field ? ` · ${e.field}` : ""}
          </Typography>
          <Typography sx={{ fontSize: 10.5, color: token("dim"), flexShrink: 0 }}>
            {fmtWhen(e.at)}
          </Typography>
        </Stack>
      ))}
    </Box>
  );
}

/* ============================== 5 · active sessions =========================== */

/**
 * Sessions, defined as **open presence streams**.
 *
 * That is not an approximation. `axs_session` is a signed stateless cookie, so
 * there is no session table to count; a live SSE stream is what being signed in
 * actually costs the server, and it is the same thing the `maxSessions` policy
 * row is enforced against. Counting anything else here would put a second
 * definition of "session" in the app beside the one that refuses logins.
 */
function SessionsCard({ facts, orientation }: CardContext) {
  if (!facts) return <Waiting />;
  const { online, connections, onlineCount } = facts.presence;
  const multi = online.filter((p) => p.connections > 1);
  const wide = orientation === "horizontal";

  return (
    <Stack sx={{ gap: 1, flex: 1, minHeight: 0 }}>
      <Stack direction={wide ? "row" : "column"} sx={{ gap: wide ? 2.5 : 0.75 }}>
        <Figure value={connections} label="open streams" />
        <Figure value={onlineCount} label="members holding" size={wide ? 26 : 18} />
      </Stack>
      <Box sx={scroll}>
        {online.length === 0 ? (
          <Nothing>No streams open.</Nothing>
        ) : (
          online.map((p) => (
            <Row
              key={p.username}
              k={p.username}
              v={`${p.connections}${p.away ? " · away" : ""}`}
              tone={p.away ? token("warn") : undefined}
            />
          ))
        )}
      </Box>
      {multi.length > 0 && (
        <Typography sx={{ ...LABEL, flexShrink: 0 }}>
          {multi.length} member{multi.length === 1 ? "" : "s"} on more than one connection
        </Typography>
      )}
    </Stack>
  );
}

/* ============================== 6 · policy alerts ============================= */

function PolicyCard({ facts, orientation }: CardContext) {
  if (!facts) return <Waiting />;
  const p = facts.policy;
  const wide = orientation === "horizontal";
  const quiet =
    p.overQuotaCount === 0 && p.suspendedCount === 0 && p.loginDisabled === 0;

  return (
    <Stack sx={{ gap: 1, flex: 1, minHeight: 0 }}>
      <Stack direction={wide ? "row" : "column"} sx={{ gap: wide ? 2.5 : 0.75 }}>
        <Figure
          value={p.overQuotaCount}
          label="over quota"
          tone={p.overQuotaCount ? token("err") : undefined}
        />
        <Figure
          value={p.suspendedCount}
          label="suspended"
          size={wide ? 26 : 18}
          tone={p.suspendedCount ? token("warn") : undefined}
        />
        <Figure value={p.loginDisabled} label="sign-in off" size={wide ? 26 : 18} />
      </Stack>

      <Box sx={scroll}>
        {quiet ? (
          <Nothing>No member is over quota, suspended or locked out.</Nothing>
        ) : (
          <>
            {p.overQuota.map((o) => (
              <Row
                key={`q-${o.username}`}
                k={o.username}
                v={`${fmtBytes(o.usedBytes)} / ${fmtBytes(o.limitBytes)}`}
                tone={token("err")}
              />
            ))}
            {p.suspended.map((s) => (
              <Row
                key={`s-${s.username}`}
                k={s.username}
                v={s.lapsed ? "suspension lapsed" : s.until ? `until ${fmtWhen(s.until)}` : "suspended"}
                tone={s.lapsed ? token("dim") : token("warn")}
              />
            ))}
          </>
        )}
      </Box>

      <Typography sx={{ ...LABEL, flexShrink: 0 }}>
        pins · {p.pins.keys} on {p.pins.subjects} member{p.pins.subjects === 1 ? "" : "s"} ·{" "}
        {p.pins.site} site-wide
      </Typography>
    </Stack>
  );
}

/* ============================== 7 · system health ============================= */

/**
 * The app process, and the media sidecar **only when it was promised**.
 *
 * `configured: false` renders as "not configured" in the dim voice, never as an
 * error and never as a red dot. A studio that has no media server is not a
 * studio with a broken media server, and a health card that cannot tell those
 * apart is one an administrator learns to ignore.
 */
function HealthCard({ facts, orientation }: CardContext) {
  if (!facts) return <Waiting />;
  const { process: proc, media } = facts.health;
  const wide = orientation === "horizontal";
  const heapPct = proc.heapTotalBytes > 0 ? (proc.heapUsedBytes / proc.heapTotalBytes) * 100 : 0;

  const mediaTone = !media.configured ? token("dim") : media.ok ? token("ok") : token("err");
  const mediaText = !media.configured
    ? "not configured"
    : media.ok
      ? `ok · ${media.latencyMs}ms`
      : (media.error ?? `HTTP ${media.status ?? "?"}`);

  return (
    <Stack sx={{ gap: 1, flex: 1, minHeight: 0 }}>
      <Stack direction={wide ? "row" : "column"} sx={{ gap: wide ? 2.5 : 0.75 }}>
        <Figure value={fmtUptime(proc.uptimeSec)} label="uptime" />
        <Figure value={fmtBytes(proc.rssBytes)} label="resident" size={wide ? 26 : 18} />
      </Stack>

      <Box sx={{ flexShrink: 0 }}>
        <Typography sx={LABEL}>
          heap {fmtBytes(proc.heapUsedBytes)} / {fmtBytes(proc.heapTotalBytes)}
        </Typography>
        <LinearProgress
          variant="determinate"
          value={Math.min(100, heapPct)}
          sx={{ height: 5, borderRadius: 3, mt: 0.5 }}
        />
      </Box>

      <Box sx={scroll}>
        <Row k="node" v={proc.nodeVersion} />
        <Row k="platform" v={proc.platform} />
        <Row k="pid" v={proc.pid} />
        <Row k="started" v={fmtWhen(proc.startedAt)} />
        <Row k="media server" v={mediaText} tone={mediaTone} />
        {media.configured && media.url && (
          <Typography
            sx={{ fontSize: 10, color: token("dim"), fontFamily: token("mono"), mt: 0.25 }}
          >
            {media.url}
          </Typography>
        )}
      </Box>
    </Stack>
  );
}

/* ================================ the registry ================================ */

/**
 * Every card, with the arrangement a fresh administrator sees.
 *
 * The default places are chosen so the FLIP is visible on arrival rather than
 * something you have to go looking for: `online` and `sessions` ship in tall
 * one-column slots (their compositions run vertical), the rest in wide ones. Drag
 * one into the other's slot and it re-composes — which is the point of the
 * canvas and would be invisible if everything shipped the same shape.
 */
export const ADMIN_CARDS: AdminCardSpec[] = [
  {
    id: "online",
    title: "Online now",
    glyph: "icon-account",
    description: "Who is signed in, from the presence registry",
    shapes: "both",
    place: { col: 1, row: 1, w: 1, h: 2 },
    render: (ctx) => <OnlineCard {...ctx} />,
  },
  {
    id: "signups",
    title: "Signups",
    glyph: "icon-plus",
    description: "Accounts created per month, from the roster",
    shapes: "wide",
    place: { col: 2, row: 1, w: 3, h: 2 },
    render: (ctx) => <SignupsCard {...ctx} />,
  },
  {
    id: "health",
    title: "System health",
    glyph: "icon-bolt",
    description: "The app process, and the media server when one is configured",
    shapes: "both",
    place: { col: 5, row: 1, w: 2, h: 2 },
    render: (ctx) => <HealthCard {...ctx} />,
  },
  {
    id: "storage",
    title: "Storage",
    glyph: "icon-layers",
    description: "Totals and top consumers, from the storage ledger",
    shapes: "both",
    place: { col: 1, row: 3, w: 3, h: 2 },
    render: (ctx) => <StorageCard {...ctx} />,
  },
  {
    id: "policy",
    title: "Policy alerts",
    glyph: "icon-gear",
    description: "Over quota, suspended, locked out, and how much is pinned",
    shapes: "both",
    place: { col: 4, row: 3, w: 2, h: 2 },
    render: (ctx) => <PolicyCard {...ctx} />,
  },
  {
    id: "sessions",
    title: "Active sessions",
    glyph: "icon-globe",
    description: "Open presence streams — what the maxSessions policy counts",
    shapes: "both",
    place: { col: 6, row: 3, w: 1, h: 2 },
    render: (ctx) => <SessionsCard {...ctx} />,
  },
  {
    id: "audit",
    title: "Audit tail",
    glyph: "icon-history",
    description: "The newest administrative acts, from the audit route",
    shapes: "both",
    place: { col: 1, row: 5, w: 6, h: 2 },
    render: (ctx) => <AuditCard {...ctx} />,
  },
];
