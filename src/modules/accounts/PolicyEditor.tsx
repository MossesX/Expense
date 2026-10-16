/**
 * @file **The generic policy editor** — one renderer for the whole P2 cascade,
 * driven entirely by the typed catalog the route ships. It is used twice: on a
 * member (the Users tab's detail pane) and on the site tier (the Policies tab).
 * Same component, same code path, because they are the same operation at two
 * tiers.
 *
 * ## Generic is the requirement, not the shortcut
 *
 * There is no per-row code here and there must never be. A row arrives with a
 * `kind`, a `label`, a `hint` and its bounds, and this file turns that into a
 * control — so the day somebody adds an eighteenth policy row to
 * `lib/policy.ts`, the editor renders it with no edit. The moment one row earns
 * a special case, the next twelve get one too and the catalog stops being the
 * single source of what a policy IS.
 *
 * ## FOLLOWING versus PINNED is the whole design
 *
 * The cascade is default → site → user, and a resolved value cannot tell you
 * which tier produced it. "Pinned to 500" and "following a site that currently
 * says 500" are identical today and diverge the moment an administrator moves
 * the site — so the editor shows the distinction on every row, and never infers
 * it from a value.
 *
 * The consequence that shapes the controls: **a row that is FOLLOWING is not
 * editable.** Its control is disabled and pinning is a separate, explicit
 * gesture (the pin button), because an editor that let you drag a slider on a
 * following row would silently pin every row it touched — and an administrator
 * who opened the editor to LOOK would leave a member pinned to twelve values
 * that used to track the site. That is the failure this arrangement exists to
 * make impossible, not merely to discourage.
 *
 * Un-pinning is a DELETE, never a write-back of the default's current value:
 * the two are indistinguishable on the day they are done and different forever
 * after (`adminApi.unpinPolicy`).
 *
 * ## What `pinned` reads from
 *
 * `overrides` — the subject's own sparse document — and NOT `tiers`. They
 * disagree in one real case and the disagreement is honest: the two capability
 * rows that overlap the permission matrix are composed server-side, so a member
 * whose GRANT denies messaging reports `tiers.canMessage === "user"` while
 * having pinned nothing. Reading the pin off `tiers` would draw a pin nobody
 * placed, and un-pinning it would do nothing — so the row says what is actually
 * true: following the cascade, refused by the matrix.
 */
"use client";

import * as React from "react";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { token } from "@axf/core";
import type { SettingValue } from "@axf/core";

import { onAccountsCtx } from "./accounts.commands";
import {
  fetchPolicy,
  pinPolicy,
  unpinPolicy,
  type Answer,
  type PolicyRowWire,
  type PolicyView,
  type PolicyWriteReport,
} from "./adminApi";

/* ================================= helpers ================================== */

/** A value as a person reads it — the same spelling in the pin chip, the
 *  "following" hint and the Policies tab's diff. */
export function fmtPolicyValue(row: PolicyRowWire, value: SettingValue | undefined): string {
  if (value === undefined) return "—";
  if (row.kind === "switch") return value === true ? "on" : "off";
  if (row.kind === "select") {
    const hit = row.options?.find((o) => o.value === String(value));
    return hit ? hit.label : String(value);
  }
  if (row.kind === "text") return String(value).trim() === "" ? "(empty)" : String(value);
  return String(value);
}

/** Which tier a row is following, worded for the chip. `user` appears here only
 *  in the composed-capability case — the row is pinned nowhere, and the matrix
 *  is what refused it, so the chip says that rather than claiming a pin. */
function followingLabel(tier: string | undefined): string {
  if (tier === "site") return "following site";
  if (tier === "user") return "refused by the matrix";
  return "following default";
}

/* ================================ one row =================================== */

interface RowProps {
  row: PolicyRowWire;
  view: PolicyView;
  busy: boolean;
  onPin: (key: string, value: SettingValue) => void;
  onUnpin: (key: string) => void;
  onSet: (key: string, value: SettingValue) => void;
}

function PolicyRowView({ row, view, busy, onPin, onUnpin, onSet }: RowProps) {
  const value = view.values[row.key];
  const tier = view.tiers[row.key];
  // The pin is a FACT about the document, not an inference from the value —
  // see the file header on why this reads `overrides` and not `tiers`.
  const pinned = Object.prototype.hasOwnProperty.call(view.overrides, row.key);
  const siteOnlyHere = row.siteOnly === true && !view.isSite;
  const editable = pinned && !siteOnlyHere;

  // A number/text row holds a draft while it is being typed and commits on blur
  // or Enter — one write per decision, not one per keystroke.
  const [draft, setDraft] = React.useState<string>(String(value ?? ""));
  React.useEffect(() => {
    setDraft(String(value ?? ""));
  }, [value]);

  const commitText = () => {
    if (!editable) return;
    const next: SettingValue = row.kind === "number" ? Number(draft) : draft;
    if (row.kind === "number" && !Number.isFinite(next as number)) {
      setDraft(String(value ?? ""));
      return;
    }
    if (next === value) return;
    onSet(row.key, next);
  };

  const control = (): React.ReactNode => {
    switch (row.kind) {
      case "switch":
        return (
          <Switch
            size="small"
            checked={value === true}
            disabled={!editable || busy}
            slotProps={{ input: { "aria-label": `${view.subject} — ${row.label}` } }}
            onChange={(_, next) => onSet(row.key, next)}
          />
        );
      case "select":
        return (
          <TextField
            select
            size="small"
            value={String(value ?? "")}
            disabled={!editable || busy}
            onChange={(e) => onSet(row.key, e.target.value)}
            sx={{ width: 180, "& .MuiInputBase-input": { fontSize: 12.5 } }}
          >
            {(row.options ?? []).map((o) => (
              <MenuItem key={o.value} value={o.value} sx={{ fontSize: 12.5 }}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
        );
      case "number":
        return (
          <TextField
            type="number"
            size="small"
            value={draft}
            disabled={!editable || busy}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitText}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitText();
            }}
            slotProps={{ htmlInput: { min: row.min, max: row.max, step: row.step } }}
            sx={{ width: 140, "& .MuiInputBase-input": { fontSize: 12.5, fontFamily: token("mono") } }}
          />
        );
      default:
        return (
          <TextField
            size="small"
            value={draft}
            disabled={!editable || busy}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitText}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitText();
            }}
            sx={{ width: 220, "& .MuiInputBase-input": { fontSize: 12.5 } }}
          />
        );
    }
  };

  /** What this row would fall back to if un-pinned — the honest preview of the
   *  gesture, so nobody has to un-pin to find out. */
  const inherited = view.isSite
    ? view.defaults[row.key]
    : Object.prototype.hasOwnProperty.call(view.site, row.key)
      ? view.site[row.key]
      : view.defaults[row.key];

  return (
    <Stack
      direction="row"
      // The policy area (P10). `policyPinned` is the same FACT the pin chip
      // draws — read off `overrides`, never inferred from `tiers` — so the
      // menu's two rows and the row's own two buttons can never disagree about
      // which of them is live. `policyValue` is the formatted value, so *Copy
      // effective value* copies exactly the string on screen.
      data-axf-area="accounts.policy-row"
      data-axf-policy-subject={view.subject}
      data-axf-policy-key={row.key}
      data-axf-policy-pinned={pinned ? "1" : "0"}
      data-axf-policy-value={fmtPolicyValue(row, value)}
      sx={{
        alignItems: "flex-start",
        gap: 1.25,
        px: 1.5,
        py: 1,
        borderTop: `1px solid ${token("edge")}`,
        opacity: siteOnlyHere ? 0.65 : 1,
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>{row.label}</Typography>
          <Typography sx={{ fontSize: 10.5, color: token("dim"), fontFamily: token("mono") }}>
            {row.key}
          </Typography>
          {pinned ? (
            <Chip
              size="small"
              label={view.isSite ? "pinned · site" : "pinned"}
              variant="outlined"
              sx={{ height: 18, fontSize: 10, color: token("accent"), borderColor: token("accent") }}
            />
          ) : (
            <Chip
              size="small"
              label={followingLabel(tier)}
              variant="outlined"
              sx={{ height: 18, fontSize: 10, color: token("dim") }}
            />
          )}
          {siteOnlyHere && (
            <Chip
              size="small"
              label="site-wide only"
              variant="outlined"
              sx={{ height: 18, fontSize: 10, color: token("warn"), borderColor: token("warn") }}
            />
          )}
        </Stack>

        <Typography sx={{ fontSize: 11, color: token("dim"), mt: 0.25 }}>{row.hint}</Typography>

        <Typography sx={{ fontSize: 10.5, color: token("dim"), mt: 0.5 }}>
          {siteOnlyHere
            ? "This limiter is consulted before anybody has proved who they are, so it has no per-user tier — set it on the site defaults."
            : pinned
              ? `Un-pinning returns this to ${fmtPolicyValue(row, inherited)}.`
              : `Currently ${fmtPolicyValue(row, value)} — pinning fixes it here, so it stops moving when the tier above does.`}
        </Typography>
      </Box>

      <Stack direction="row" sx={{ alignItems: "center", gap: 0.5, flexShrink: 0 }}>
        {control()}
        {siteOnlyHere ? null : pinned ? (
          <Tooltip title={`Un-pin — ${row.label} follows the tier above again, including as it moves`}>
            <span>
              <Button
                size="small"
                disabled={busy}
                onClick={() => onUnpin(row.key)}
                sx={{ fontSize: 11, textTransform: "none", minWidth: 0, color: token("dim") }}
              >
                Un-pin
              </Button>
            </span>
          </Tooltip>
        ) : (
          <Tooltip title={`Pin ${fmtPolicyValue(row, value)} for ${view.subject} — it stops following the tier above`}>
            <span>
              <Button
                size="small"
                disabled={busy}
                onClick={() => onPin(row.key, value)}
                sx={{ fontSize: 11, textTransform: "none", minWidth: 0 }}
              >
                Pin
              </Button>
            </span>
          </Tooltip>
        )}
      </Stack>
    </Stack>
  );
}

/* ================================ the editor ================================ */

export interface PolicyEditorProps {
  /** A username, or {@link SITE_SUBJECT} for the site defaults. */
  subject: string;
  /** Bump to force a re-read (a role change or a suspension moves the cascade). */
  reloadKey?: number;
  /** Fired after any successful write, so a host can re-read its own row. */
  onChanged?: () => void;
}

/**
 * The editor. It re-reads the WHOLE subject after every write rather than
 * patching its own state: the cascade is composed server-side (a capability can
 * be overruled by the permission matrix, a suspension is three rows behaving as
 * one), so a locally-patched view would be the editor's opinion of the cascade
 * rather than the cascade.
 */
export default function PolicyEditor({ subject, reloadKey = 0, onChanged }: PolicyEditorProps) {
  const [view, setView] = React.useState<PolicyView | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const res = await fetchPolicy(subject);
    if (res.ok) {
      setView(res.data);
      setError(null);
    } else {
      setError(res.error);
    }
  }, [subject]);

  React.useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const after = async (ok: boolean, message: string | null) => {
    if (!ok) setError(message);
    else setError(null);
    await load();
    if (ok) onChanged?.();
  };

  const write = async (fn: () => Promise<Answer<PolicyWriteReport>>) => {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    await after(res.ok, res.ok ? null : res.error);
  };

  // Pin and set are the same PUT, and are named apart because the GESTURES are
  // different: pinning writes the value the row is ALREADY showing (making an
  // inherited value this subject's own), while setting writes a new value onto
  // a row that is already pinned. Only the first can surprise somebody, which
  // is why only the first has a button of its own.
  const onPin = (key: string, value: SettingValue) =>
    void write(() => pinPolicy(subject, { [key]: value }));
  const onSet = (key: string, value: SettingValue) =>
    void write(() => pinPolicy(subject, { [key]: value }));
  const onUnpin = (key: string) => void write(() => unpinPolicy(subject, [key]));

  /**
   * *Pin override* and *Follow default* on a row's context menu (P10).
   *
   * They run the editor's OWN `onPin` / `onUnpin`, which is the whole reason
   * they are allowed to be menu rows at all: the write goes through the same
   * PUT, the same re-read of the whole subject and the same error surface, so
   * the screen shows what happened rather than a policy quietly moving
   * off-screen. A menu row that called `pinPolicy` directly would be the
   * "acting instead of summoning" the map's doctrine rules out.
   *
   * `subject` is checked because the Policies tab renders TWO editors at once —
   * the site defaults beside a member's overrides — and both are listening. The
   * click carried which one it was over; without this both would act on it.
   *
   * Pin writes the value the row is ALREADY showing, exactly as the Pin button
   * does. A row whose value cannot be read is left alone rather than pinned to
   * `undefined`.
   */
  React.useEffect(
    () =>
      onAccountsCtx((s) => {
        if (s.kind === "policy-pin" && s.subject === subject) {
          const value = view?.values[s.key];
          if (value !== undefined) onPin(s.key, value);
        } else if (s.kind === "policy-unpin" && s.subject === subject) {
          onUnpin(s.key);
        }
      }),
    // `view` is a dependency because Pin reads the value in force off it — a
    // listener closed over a stale view would pin yesterday's number.
    [subject, view],
  );

  if (!view) {
    return error ? (
      <Alert severity="error" variant="outlined" sx={{ fontSize: 12 }}>
        {error}
      </Alert>
    ) : (
      <CircularProgress size={18} />
    );
  }

  // Groups in the catalog's declared order, then anything a later module
  // registered under a heading of its own — discovered, never listed here.
  const groups = [
    ...view.groups,
    ...view.rows.map((r) => r.group).filter((g) => !view.groups.includes(g)),
  ].filter((g, i, all) => all.indexOf(g) === i);

  const pinnedCount = Object.keys(view.overrides).length;

  return (
    <Stack sx={{ gap: 1.25, minWidth: 0 }}>
      <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>
          {view.isSite ? "Site defaults" : `Policy — ${view.subject}`}
        </Typography>
        <Chip
          size="small"
          variant="outlined"
          label={
            pinnedCount === 0
              ? view.isSite
                ? "nothing pinned — every member follows the shipped defaults"
                : "nothing pinned — following the site"
              : `${pinnedCount} pinned`
          }
          sx={{
            height: 19,
            fontSize: 10.5,
            ...(pinnedCount > 0
              ? { color: token("accent"), borderColor: token("accent") }
              : { color: token("dim") }),
          }}
        />
        {busy && <CircularProgress size={14} />}
      </Stack>

      {error && (
        <Alert severity="error" variant="outlined" sx={{ fontSize: 12 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {!view.isSite && view.suspension.on && (
        <Alert severity={view.suspension.lapsed ? "info" : "warning"} variant="outlined" sx={{ fontSize: 12 }}>
          {view.suspension.lapsed
            ? `Suspension has LAPSED (until ${view.suspension.until}) — ${view.subject} signs in normally.`
            : `Suspended${view.suspension.until ? ` until ${view.suspension.until}` : " indefinitely"}${
                view.suspension.reason ? ` — “${view.suspension.reason}”` : ""
              }`}
        </Alert>
      )}

      {groups.map((group) => {
        const rows = view.rows.filter((r) => r.group === group);
        if (rows.length === 0) return null;
        return (
          <Box
            key={group}
            sx={{ border: `1px solid ${token("edge")}`, borderRadius: token("radius"), overflow: "hidden" }}
          >
            <Typography
              sx={{
                fontSize: 10.5,
                fontFamily: token("mono"),
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: token("dim"),
                px: 1.5,
                py: 0.75,
              }}
            >
              {group}
            </Typography>
            {rows.map((row) => (
              <PolicyRowView
                key={row.key}
                row={row}
                view={view}
                busy={busy}
                onPin={onPin}
                onUnpin={onUnpin}
                onSet={onSet}
              />
            ))}
          </Box>
        );
      })}

      {!view.isSite && (
        <Typography sx={{ fontSize: 10.5, color: token("dim") }}>
          Two capability rows are composed with the permission matrix before they are answered —
          either saying no is a no, so a row can read as refused here while nothing is pinned.
        </Typography>
      )}
    </Stack>
  );
}
