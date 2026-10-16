/**
 * @file The Storage tab — **the platform's accounting**, as opposed to the
 * Users tab's per-member gauge.
 *
 * ## Three questions, and each is answered by a different read
 *
 * 1. *How much is stored here, and where?* — the roster join
 *    (`/api/accounts/admin/users?withStorage=1&withPolicy=1`) carries every
 *    member's TOTAL and their quota in one request, which is what the headline
 *    tiles and the top-consumers table are drawn from. It does not carry the
 *    per-root breakdown, so the by-root aggregate is a second, EXPLICIT pass:
 *    one index read per member, behind a button, with a bar. Same posture as
 *    the Policies tab's override scan — the expensive authoritative thing is
 *    asked for, never done to you on the way in.
 * 2. *Is the number true?* — every index carries `scannedAt`, its last
 *    AUTHORITATIVE rebuild. A stale one is CHIPPED, and a member who has never
 *    been scanned says exactly that rather than showing a confident zero.
 * 3. *Make it true* — per-member rescan, and a roster-wide one.
 *
 * ## Why staleness is measured from `scannedAt` and not `updatedAt`
 *
 * `updatedAt` moves on every advisory charge (`lib/storage.ts` — a write path
 * handing over a delta it already knew). So an index charged this morning and
 * last WALKED a year ago has a fresh `updatedAt` and is a year of accumulated
 * drift; measuring staleness from it would report exactly the wrong indexes as
 * healthy. `scannedAt` is the last time anything actually looked at the disk,
 * which is the only field that can answer "should this be rescanned".
 *
 * The by-root pass reads full indexes, so it has both, and it names the drift
 * where it can see it: charged-since-scanned is shown as its own count.
 *
 * ## Why the rescan-all button loops instead of calling `rescan-all`
 *
 * The route has a whole-roster action and it is the right thing from a script.
 * Here it would be one POST that walks every member's filesystem and says
 * nothing until it is done — a reconcile with no progress is one an
 * administrator abandons halfway and re-presses, doubling the work it was
 * already waiting on. So the button drives the per-member action and reports
 * where it is. `rescanAllStorage` stays exported for the caller that has nobody
 * to show a bar to.
 */
"use client";

import * as React from "react";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Glyph, token } from "@axf/core";

import { useAccountsSettings } from "./settings";
import {
  fetchStorage,
  fetchUserPage,
  fmtBytes,
  fmtWhen,
  rescanStorage,
  type AdminUserRow,
  type RootLabel,
} from "./adminApi";

/**
 * How old a scan may be before it is called stale.
 *
 * There is no server-side rescan schedule — nothing reconciles on a timer, by
 * design (`lib/storage.ts`: the authoritative walk is explicit, always). So
 * this is the interval at which an administrator is TOLD a number is worth
 * rebuilding, not a promise that anything rebuilt it. It lives here as one
 * named constant rather than as a setting: a knob for it would be a preference
 * about when to be warned, which is not a setting a surface cannot work
 * without (the minimal-sui rule).
 */
const STALE_AFTER_HOURS = 24;
const STALE_AFTER_MS = STALE_AFTER_HOURS * 60 * 60 * 1000;

/** How many members one pass reads. The route's own maximum page. */
const ROSTER_LIMIT = 200;

/** Index reads in flight during the by-root pass. Enough to be quick, few
 *  enough not to queue the whole event loop behind one administrator. */
const SCAN_CONCURRENCY = 6;

/** How many rows the consumers table shows before it says what it is hiding. */
const TOP_N = 25;

const MB = 1024 * 1024;

/** Milliseconds since an ISO stamp, or null when it is absent or unparseable. */
function ageOf(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, now - t) : null;
}

/** An age as a person reads it. */
function fmtAge(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** One headline number — the Dashboard tab's tile, in the same shape so the
 *  two read as one suite. */
function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  const tile = (
    <Box
      sx={{
        border: `1px solid ${token("edge")}`,
        borderRadius: token("radius"),
        px: 1.75,
        py: 1,
        minWidth: 104,
      }}
    >
      <Typography sx={{ fontSize: 18, fontWeight: 700, fontFamily: token("mono") }}>{value}</Typography>
      <Typography
        sx={{ fontSize: 10.5, color: token("dim"), textTransform: "uppercase", letterSpacing: "0.08em" }}
      >
        {label}
      </Typography>
    </Box>
  );
  return hint ? <Tooltip title={hint}>{tile}</Tooltip> : tile;
}

/** The quota bar. Identical thresholds to the per-member gauge in
 *  `AdminUserDetail` on purpose — the same member must not look 79% full on one
 *  screen and amber on another. */
function QuotaBar({ used, limitBytes }: { used: number; limitBytes: number }) {
  if (limitBytes <= 0) {
    return (
      <Typography sx={{ fontSize: 10.5, color: token("dim") }}>no quota</Typography>
    );
  }
  const pct = Math.min(100, (used / limitBytes) * 100);
  return (
    <Stack sx={{ gap: 0.25, minWidth: 120 }}>
      <LinearProgress
        variant="determinate"
        value={pct}
        sx={{
          height: 5,
          borderRadius: 3,
          "& .MuiLinearProgress-bar": {
            background: pct >= 100 ? token("err") : pct >= 80 ? token("warn") : token("accent"),
          },
        }}
      />
      <Typography sx={{ fontSize: 10, color: token("dim"), fontFamily: token("mono") }}>
        {Math.round(pct)}% of {fmtBytes(limitBytes)}
      </Typography>
    </Stack>
  );
}

/* ================================== the tab =================================== */

interface Aggregate {
  /** Per root: owned bytes and files across every member read. */
  byRoot: Record<string, { bytes: number; files: number; members: number }>;
  /** Members whose index has moved by a charge since it was last walked. */
  drifting: number;
  /** How many members the pass actually read. */
  read: number;
}

export default function AdminStorageTab() {
  const settings = useAccountsSettings();

  const [rows, setRows] = React.useState<AdminUserRow[] | null>(null);
  const [total, setTotal] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const [roots, setRoots] = React.useState<RootLabel[]>([]);
  const [aggregate, setAggregate] = React.useState<Aggregate | null>(null);

  const [busy, setBusy] = React.useState<"none" | "aggregate" | "rescan-all">("none");
  const [done, setDone] = React.useState(0);
  const [rescanning, setRescanning] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);

  /** `Date.now()` once per load rather than per row — forty rows must not
   *  disagree about what "now" is while the table is being drawn. */
  const [now, setNow] = React.useState(0);

  const load = React.useCallback(async () => {
    setLoading(true);
    const res = await fetchUserPage({
      limit: ROSTER_LIMIT,
      sort: "storage",
      dir: "desc",
      withStorage: true,
      withPolicy: true,
    });
    setLoading(false);
    setNow(Date.now());
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setRows(res.data.rows);
    setTotal(res.data.total);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  /* ------------------------------ the by-root pass --------------------------- */

  const runAggregate = async () => {
    if (!rows) return;
    setBusy("aggregate");
    setDone(0);
    setNote(null);

    const byRoot: Aggregate["byRoot"] = {};
    let drifting = 0;
    let read = 0;
    let labels: RootLabel[] = roots;

    const names = rows.map((r) => r.username);
    for (let i = 0; i < names.length; i += SCAN_CONCURRENCY) {
      const batch = names.slice(i, i + SCAN_CONCURRENCY);
      const answers = await Promise.all(batch.map((n) => fetchStorage(n)));
      for (const answer of answers) {
        if (!answer.ok) continue;
        if (answer.data.roots.length > 0) labels = answer.data.roots;
        const usage = answer.data.usage;
        if (!usage) continue;
        read += 1;
        if (Date.parse(usage.updatedAt) > Date.parse(usage.scannedAt)) drifting += 1;
        for (const row of usage.roots) {
          const cell = byRoot[row.rootId] ?? { bytes: 0, files: 0, members: 0 };
          cell.bytes += row.bytes;
          cell.files += row.files;
          if (row.bytes > 0) cell.members += 1;
          byRoot[row.rootId] = cell;
        }
      }
      setDone(Math.min(names.length, i + batch.length));
    }

    setRoots(labels);
    setAggregate({ byRoot, drifting, read });
    setBusy("none");
  };

  /* -------------------------------- rescanning ------------------------------- */

  const rescanOne = async (username: string) => {
    setRescanning(username);
    const res = await rescanStorage(username);
    setRescanning(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setNote(
      res.data.usage
        ? `${username}: ${fmtBytes(res.data.usage.totalBytes)} measured on disk.`
        : `${username}: nothing measurable.`,
    );
    // The row's joined number came from the roster read, so the table is
    // re-read rather than patched — a hand-patched row and a re-read row
    // disagree the first time anything else changes underneath.
    await load();
  };

  const rescanAll = async () => {
    if (!rows) return;
    setBusy("rescan-all");
    setDone(0);
    setNote(null);
    const names = rows.map((r) => r.username);
    let scanned = 0;
    const refused: string[] = [];
    for (const [i, name] of names.entries()) {
      const res = await rescanStorage(name);
      if (res.ok && res.data.usage) scanned += 1;
      else refused.push(name);
      setDone(i + 1);
    }
    setBusy("none");
    setNote(
      `Rescanned ${scanned} of ${names.length} member${names.length === 1 ? "" : "s"}` +
        (refused.length > 0 ? ` — ${refused.length} refused: ${refused.join(", ")}.` : ".") +
        (total > names.length
          ? ` ${total - names.length} account(s) beyond the first ${names.length} were not touched.`
          : ""),
    );
    // Every index moved; the aggregate taken before them is now describing a
    // measurement that no longer exists. Dropping it is honest.
    setAggregate(null);
    await load();
  };

  /* --------------------------------- derived --------------------------------- */

  const measured = rows?.filter((r) => r.storage) ?? [];
  const neverScanned = rows?.filter((r) => r.storage === null || r.storage === undefined) ?? [];
  const ownedTotal = measured.reduce((n, r) => n + (r.storage?.totalBytes ?? 0), 0);
  const sharedTotal = measured.reduce((n, r) => n + (r.storage?.sharedBytes ?? 0), 0);
  const stale = measured.filter((r) => {
    const age = ageOf(r.storage?.scannedAt, now);
    return age !== null && age > STALE_AFTER_MS;
  });

  const consumers = [...measured]
    .sort((a, b) => (b.storage?.totalBytes ?? 0) - (a.storage?.totalBytes ?? 0))
    .slice(0, TOP_N);

  const rootTitle = (id: string): string => roots.find((r) => r.id === id)?.title ?? id;
  const rootShared = (id: string): boolean => roots.find((r) => r.id === id)?.shared === true;
  const working = busy !== "none";

  return (
    <Stack sx={{ gap: 1.5, maxWidth: 1100 }}>
      <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <Typography sx={{ fontSize: 13.5, fontWeight: 700, flex: 1 }}>Storage</Typography>
        <Button
          size="small"
          variant="outlined"
          disabled={working || !rows}
          onClick={() => void runAggregate()}
          sx={{ fontSize: 11.5, textTransform: "none" }}
        >
          {busy === "aggregate" ? <CircularProgress size={14} /> : "Break down by root"}
        </Button>
        <Button
          size="small"
          variant="outlined"
          color="warning"
          disabled={working || !rows}
          onClick={() => void rescanAll()}
          sx={{ fontSize: 11.5, textTransform: "none" }}
        >
          {busy === "rescan-all" ? <CircularProgress size={14} /> : "Rescan everyone"}
        </Button>
        <Tooltip title="Re-read the roster and its joined totals">
          <span>
            <IconButton size="small" disabled={working} onClick={() => void load()}>
              <Glyph id="icon-reload" size={14} />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      {error && (
        <Alert severity="error" variant="outlined" sx={{ fontSize: 12 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {note && (
        <Alert severity="success" variant="outlined" sx={{ fontSize: 12 }} onClose={() => setNote(null)}>
          {note}
        </Alert>
      )}

      {working && rows && (
        <Stack sx={{ gap: 0.5 }}>
          <LinearProgress
            variant="determinate"
            value={rows.length > 0 ? Math.min(100, (done / rows.length) * 100) : 0}
          />
          <Typography sx={{ fontSize: 11, color: token("dim") }}>
            {busy === "aggregate" ? "read" : "rescanned"} {done} of {rows.length}…
          </Typography>
        </Stack>
      )}

      {rows === null ? (
        loading ? (
          <CircularProgress size={20} />
        ) : (
          !error && (
            <Typography sx={{ fontSize: 12, color: token("dim") }}>
              The roster could not be read, and nothing here is a measurement of anything.
            </Typography>
          )
        )
      ) : (
        <>
          {/* ------------------------------ totals ----------------------------- */}
          <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
            <Stat label="accounts" value={total} />
            <Stat
              label="measured"
              value={measured.length}
              hint="Members with a storage index — the only ones any number here is about."
            />
            <Stat
              label="never scanned"
              value={neverScanned.length}
              hint="No index at all. Not zero bytes — unknown bytes."
            />
            <Stat
              label="stale"
              value={stale.length}
              hint={`Last walked more than ${STALE_AFTER_HOURS}h ago, so the figure may be carrying drift.`}
            />
            <Stat
              label="owned"
              value={fmtBytes(ownedTotal)}
              hint="Summed across measured members. Shared bytes are excluded — one thread belongs to everybody in it, and adding it up per member would count it repeatedly."
            />
            <Stat
              label="shared"
              value={fmtBytes(sharedTotal)}
              hint="Attributed to more than one member each, so this is NOT part of the total above and cannot be added to it."
            />
          </Stack>

          {neverScanned.length > 0 && (
            <Typography sx={{ fontSize: 11, color: token("dim") }}>
              {neverScanned.length} member{neverScanned.length === 1 ? " has" : "s have"} never been
              scanned — their bytes are not in the totals above, and nothing here knows how many
              there are.
            </Typography>
          )}

          {/* ---------------------------- by root ------------------------------ */}
          <Box>
            <Typography sx={{ fontSize: 12.5, fontWeight: 700, mb: 0.5 }}>By root</Typography>
            {aggregate === null ? (
              <Typography sx={{ fontSize: 12, color: token("dim") }}>
                The roster read carries each member’s total, not their breakdown — that is one index
                read per member, so it happens when you ask for it. Press “Break down by root”.
              </Typography>
            ) : aggregate.read === 0 ? (
              <Typography sx={{ fontSize: 12, color: token("dim") }}>
                Nobody has an index yet, so there is nothing to break down. Rescan somebody first.
              </Typography>
            ) : (
              <>
                <Table size={settings.denseTables ? "small" : "medium"}>
                  <TableHead>
                    <TableRow>
                      {["Root", "Bytes", "Files", "Members"].map((h) => (
                        <TableCell key={h} sx={{ fontSize: 11.5, color: token("dim") }}>
                          {h}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {Object.entries(aggregate.byRoot)
                      .sort((a, b) => b[1].bytes - a[1].bytes)
                      .map(([id, cell]) => (
                        <TableRow key={id} hover>
                          <TableCell sx={{ fontSize: 12 }}>
                            {rootTitle(id)}
                            {rootShared(id) && (
                              <Typography
                                component="span"
                                sx={{ fontSize: 10.5, color: token("warn"), ml: 0.75 }}
                              >
                                shared — counted for every participant
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell sx={{ fontSize: 12, fontFamily: token("mono") }}>
                            {fmtBytes(cell.bytes)}
                          </TableCell>
                          <TableCell sx={{ fontSize: 12, fontFamily: token("mono") }}>
                            {cell.files}
                          </TableCell>
                          <TableCell sx={{ fontSize: 12, fontFamily: token("mono") }}>
                            {cell.members}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
                <Typography sx={{ fontSize: 10.5, color: token("dim"), mt: 0.5 }}>
                  Read from {aggregate.read} index
                  {aggregate.read === 1 ? "" : "es"}.
                  {aggregate.drifting > 0
                    ? ` ${aggregate.drifting} of them have been charged since they were last walked, so those figures are carrying advisory drift.`
                    : " None of them have moved since they were last walked."}
                </Typography>
              </>
            )}
          </Box>

          {/* -------------------------- top consumers -------------------------- */}
          <Box>
            <Typography sx={{ fontSize: 12.5, fontWeight: 700, mb: 0.5 }}>
              Largest footprints
            </Typography>
            {measured.length === 0 ? (
              <Typography sx={{ fontSize: 12, color: token("dim") }}>
                Nobody has been scanned, so there is nothing to rank. “Rescan everyone” measures the
                roster; it walks every registered root per member and is deliberately slow.
              </Typography>
            ) : (
              <Table size={settings.denseTables ? "small" : "medium"}>
                <TableHead>
                  <TableRow>
                    {["Member", "Owned", "Against quota", "Shared", "Last scan", ""].map((h) => (
                      <TableCell key={h} sx={{ fontSize: 11.5, color: token("dim") }}>
                        {h}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {consumers.map((row) => {
                    const usage = row.storage;
                    const quotaBytes = (row.policy?.storageQuotaMB ?? 0) * MB;
                    const age = ageOf(usage?.scannedAt, now);
                    const isStale = age !== null && age > STALE_AFTER_MS;
                    return (
                      <TableRow key={row.username} hover>
                        <TableCell>
                          <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>
                            {row.screenname ?? row.username}
                          </Typography>
                          <Typography
                            sx={{ fontSize: 10.5, color: token("dim"), fontFamily: token("mono") }}
                          >
                            {row.username}
                            {row.disabled ? " · disabled" : ""}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ fontSize: 12, fontFamily: token("mono") }}>
                          {fmtBytes(usage?.totalBytes ?? 0)}
                        </TableCell>
                        <TableCell>
                          <QuotaBar used={usage?.totalBytes ?? 0} limitBytes={quotaBytes} />
                        </TableCell>
                        <TableCell sx={{ fontSize: 12, fontFamily: token("mono"), color: token("dim") }}>
                          {usage && usage.sharedBytes > 0 ? fmtBytes(usage.sharedBytes) : "—"}
                        </TableCell>
                        <TableCell>
                          <Stack direction="row" sx={{ alignItems: "center", gap: 0.75 }}>
                            <Typography sx={{ fontSize: 11.5, color: token("dim") }}>
                              {age === null ? fmtWhen(usage?.scannedAt) : fmtAge(age)}
                            </Typography>
                            {isStale && (
                              <Tooltip
                                title={`Last walked ${fmtAge(age)} — anything charged since is unreconciled. Nothing rescans on a schedule, so this is a prompt, not a fault.`}
                              >
                                <Chip
                                  size="small"
                                  variant="outlined"
                                  label="stale"
                                  sx={{
                                    height: 17,
                                    fontSize: 9.5,
                                    color: token("warn"),
                                    borderColor: token("warn"),
                                  }}
                                />
                              </Tooltip>
                            )}
                          </Stack>
                        </TableCell>
                        <TableCell align="right">
                          <Tooltip title={`Rebuild ${row.username}'s index from disk`}>
                            <span>
                              <IconButton
                                size="small"
                                disabled={working || rescanning !== null}
                                onClick={() => void rescanOne(row.username)}
                              >
                                {rescanning === row.username ? (
                                  <CircularProgress size={13} />
                                ) : (
                                  <Glyph id="icon-reload" size={13} />
                                )}
                              </IconButton>
                            </span>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
            {measured.length > TOP_N && (
              <Typography sx={{ fontSize: 10.5, color: token("dim"), mt: 0.5 }}>
                The {TOP_N} largest of {measured.length} measured members. The totals above are over
                all of them, not just these.
              </Typography>
            )}
            {total > ROSTER_LIMIT && (
              <Typography sx={{ fontSize: 10.5, color: token("warn"), mt: 0.5 }}>
                This page reads the first {ROSTER_LIMIT} accounts of {total} — the route’s maximum.
                Nothing on this tab says anything about the remaining {total - ROSTER_LIMIT}.
              </Typography>
            )}
          </Box>
        </>
      )}
    </Stack>
  );
}
