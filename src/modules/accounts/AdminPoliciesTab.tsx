/**
 * @file The Policies tab — the SITE tier on the left, and the members who have
 * stepped out of it on the right.
 *
 * Both halves are the same generic editor (`./PolicyEditor`): the site defaults
 * are a subject like any other (`_site`), which is the property that makes one
 * editor able to serve both tiers and the reason the route writes them through
 * one PUT.
 *
 * ## Why the override list is SCANNED and not fetched
 *
 * P3 gave the suite a per-subject policy read and no way to ask "who has pinned
 * anything" — the override documents are one file per subject and nothing
 * indexes them. So this pane walks the roster and reads each subject's cascade,
 * which is N requests, which is why it is a BUTTON and not something a tab
 * mount does to you. Same posture as the storage rescan: the expensive,
 * authoritative thing is asked for explicitly.
 *
 * The walk is bounded — {@link SCAN_LIMIT} members, in the roster's own order —
 * and when it stops short it SAYS so, with the number it did not reach. A cap
 * that quietly truncates reads as "nobody else has overrides", which is the one
 * wrong answer this pane could give.
 *
 * The right way to end all of this is an index (a route that lists override
 * documents), and that belongs with the audit/browse work rather than here —
 * noted so the next session extends the route instead of raising the cap.
 */
"use client";

import * as React from "react";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { PaneLayout, definePanes, token } from "@axf/core";
import type { SettingValue } from "@axf/core";

import PolicyEditor, { fmtPolicyValue } from "./PolicyEditor";
import {
  SITE_SUBJECT,
  fetchPolicy,
  fetchUserPage,
  type PolicyRowWire,
  type PolicyView,
} from "./adminApi";

/** How many members one scan will read. The roster's own order, so a second
 *  scan reads the same set — a random sample would make the list flicker. */
const SCAN_LIMIT = 200;
/** Reads in flight. Enough to be quick, few enough not to queue the dev
 *  server's whole event loop behind one administrator's curiosity. */
const SCAN_CONCURRENCY = 6;

const TREE = definePanes({
  kind: "split",
  direction: "row",
  weights: [50, 50],
  children: [
    { kind: "pane", id: "site", minSize: 360 },
    { kind: "pane", id: "overrides", minSize: 320 },
  ],
});

interface OverrideSummary {
  subject: string;
  view: PolicyView;
  keys: string[];
}

/** One pinned field, against what the subject would otherwise be following. */
function DiffRow({ row, pinned, inherited }: { row: PolicyRowWire; pinned: SettingValue; inherited: SettingValue }) {
  const same = fmtPolicyValue(row, pinned) === fmtPolicyValue(row, inherited);
  return (
    <Stack direction="row" sx={{ gap: 1, alignItems: "baseline", flexWrap: "wrap" }}>
      <Typography sx={{ fontSize: 11.5, minWidth: 160 }}>{row.label}</Typography>
      <Typography sx={{ fontSize: 11.5, fontFamily: token("mono"), color: token("accent") }}>
        {fmtPolicyValue(row, pinned)}
      </Typography>
      <Typography sx={{ fontSize: 10.5, color: token("dim") }}>
        {same
          ? // Worth naming rather than hiding: a pin that equals the tier above
            // looks like nothing today and is the whole point tomorrow — it
            // stops moving when the site moves.
            `same as the tier above right now — pinned, so it stops following it`
          : `was ${fmtPolicyValue(row, inherited)}`}
      </Typography>
    </Stack>
  );
}

function OverrideCard({
  entry,
  open,
  onToggle,
  onChanged,
}: {
  entry: OverrideSummary;
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const rowFor = (key: string): PolicyRowWire | undefined => entry.view.rows.find((r) => r.key === key);
  const inheritedFor = (key: string): SettingValue =>
    Object.prototype.hasOwnProperty.call(entry.view.site, key)
      ? entry.view.site[key]
      : entry.view.defaults[key];

  return (
    <Box sx={{ border: `1px solid ${token("edge")}`, borderRadius: token("radius"), p: 1.25 }}>
      <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <Typography sx={{ fontSize: 12.5, fontWeight: 600, fontFamily: token("mono") }}>
          {entry.subject}
        </Typography>
        <Chip
          size="small"
          variant="outlined"
          label={`${entry.keys.length} pinned`}
          sx={{ height: 18, fontSize: 10, color: token("accent"), borderColor: token("accent") }}
        />
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={onToggle} sx={{ fontSize: 11.5, textTransform: "none" }}>
          {open ? "Close editor" : "Edit"}
        </Button>
      </Stack>

      <Stack sx={{ gap: 0.25, mt: 0.75 }}>
        {entry.keys.map((key) => {
          const row = rowFor(key);
          return row ? (
            <DiffRow key={key} row={row} pinned={entry.view.overrides[key]} inherited={inheritedFor(key)} />
          ) : (
            // A pinned key with no catalog row: a module registered the row,
            // pinned somebody, and was then unregistered. Shown rather than
            // dropped — an invisible pin is one nobody can clear.
            <Typography key={key} sx={{ fontSize: 11, color: token("warn") }}>
              {key}: pinned, but no catalog row declares it any more
            </Typography>
          );
        })}
      </Stack>

      {open && (
        <Box sx={{ mt: 1.25 }}>
          <PolicyEditor subject={entry.subject} onChanged={onChanged} />
        </Box>
      )}
    </Box>
  );
}

export default function AdminPoliciesTab() {
  const [scan, setScan] = React.useState<OverrideSummary[] | null>(null);
  const [scanned, setScanned] = React.useState(0);
  const [total, setTotal] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setScan(null);
    setScanned(0);

    const roster = await fetchUserPage({ limit: SCAN_LIMIT, sort: "username", dir: "asc" });
    if (!roster.ok) {
      setBusy(false);
      setError(roster.error);
      return;
    }
    setTotal(roster.data.total);

    const names = roster.data.rows.map((r) => r.username);
    const found: OverrideSummary[] = [];
    for (let i = 0; i < names.length; i += SCAN_CONCURRENCY) {
      const batch = names.slice(i, i + SCAN_CONCURRENCY);
      const answers = await Promise.all(batch.map((name) => fetchPolicy(name)));
      for (const answer of answers) {
        if (!answer.ok) continue;
        const keys = Object.keys(answer.data.overrides);
        if (keys.length > 0) found.push({ subject: answer.data.subject, view: answer.data, keys });
      }
      setScanned(Math.min(names.length, i + batch.length));
    }

    setScan(found);
    setBusy(false);
  };

  const site = (
    <Box sx={{ height: "100%", minHeight: 0, overflow: "auto", p: 1.5 }}>
      <PolicyEditor
        subject={SITE_SUBJECT}
        // Moving the site tier changes what every un-pinned member resolves to,
        // so a scan taken before the move is stale by definition. Dropping it is
        // honest; silently leaving it on screen is not.
        onChanged={() => setScan(null)}
      />
    </Box>
  );

  const overrides = (
    <Box sx={{ height: "100%", minHeight: 0, overflow: "auto", p: 1.5 }}>
      <Stack sx={{ gap: 1.25 }}>
        <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <Typography sx={{ fontSize: 12.5, fontWeight: 700, flex: 1 }}>
            Members with overrides
          </Typography>
          <Button
            size="small"
            variant="outlined"
            disabled={busy}
            onClick={() => void run()}
            sx={{ fontSize: 11.5, textTransform: "none" }}
          >
            {busy ? <CircularProgress size={14} /> : scan ? "Rescan" : "Scan roster"}
          </Button>
        </Stack>

        {error && (
          <Alert severity="error" variant="outlined" sx={{ fontSize: 12 }}>
            {error}
          </Alert>
        )}

        {busy && (
          <Stack sx={{ gap: 0.5 }}>
            <LinearProgress
              variant="determinate"
              value={total > 0 ? Math.min(100, (scanned / Math.min(total, SCAN_LIMIT)) * 100) : 0}
            />
            <Typography sx={{ fontSize: 11, color: token("dim") }}>
              read {scanned} of {Math.min(total, SCAN_LIMIT)}…
            </Typography>
          </Stack>
        )}

        {scan === null && !busy && (
          <Typography sx={{ fontSize: 12, color: token("dim") }}>
            Nothing indexes the override documents — one file per subject, and no route lists them —
            so finding out who has pinned anything means reading each member’s cascade. That is a
            request per member, so it happens when you ask for it and not on the way in.
          </Typography>
        )}

        {scan !== null && (
          <>
            <Typography sx={{ fontSize: 11, color: token("dim") }}>
              {scan.length === 0
                ? "Nobody has pinned anything — every member follows the site defaults."
                : `${scan.length} member${scan.length === 1 ? "" : "s"} carry overrides.`}
              {total > SCAN_LIMIT
                ? ` Scanned the first ${SCAN_LIMIT} of ${total} accounts — ${total - SCAN_LIMIT} were not read, and nothing here says anything about them.`
                : ""}
            </Typography>
            {scan.map((entry) => (
              <OverrideCard
                key={entry.subject}
                entry={entry}
                open={open === entry.subject}
                onToggle={() => setOpen(open === entry.subject ? null : entry.subject)}
                // A pin moved here changes this member's diff and nothing else —
                // the site tier is untouched — so the scan is what gets re-run.
                onChanged={() => void run()}
              />
            ))}
          </>
        )}
      </Stack>
    </Box>
  );

  return (
    <Box sx={{ flex: 1, minHeight: 420, display: "flex" }}>
      <PaneLayout
        tree={TREE}
        storageKey="accounts-admin-policies"
        renderPane={(id) => (id === "site" ? site : overrides)}
      />
    </Box>
  );
}
