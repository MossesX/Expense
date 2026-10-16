/**
 * @file The shell-owned settings dialog — ONE dialog for every owner's rows.
 *
 * This is the "shell-owned sui affordance" `TaskmanSui.tsx` predicted:
 * *"When AmberX grows a shell-owned sui affordance, this button is what gets
 * deleted."* Mounted once by `AppShell`, beside `ContextMenuRoot`, for the
 * same reason: chrome each surface has to remember is chrome that is missing
 * somewhere. It renders whichever owner `settingsUi` says is open, from that
 * owner's DECLARED rows — so a module's settings surface exists the moment
 * its decl does, with no per-module dialog file.
 *
 * Controls per kind: `switch` → `Switch`, `number` → bounded `TextField`
 * (`type="number"`), `text` → `TextField`, `select` → `TextField select`.
 * All MUI (`no-hand-rolled-ui.md` rule 0); colours ride the bridged theme.
 */
"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { registry } from "../registry";
import { token } from "../theme/apply";
import type { SettingRow, SettingValue } from "./decl";
import { settingsGates, useSettingsGates } from "./gates";
import { settings, settingsUi } from "./store";

function RowControl({
  row,
  value,
  onChange
}: {
  row: SettingRow;
  value: SettingValue;
  onChange: (v: SettingValue) => void;
}) {
  switch (row.kind) {
    case "switch":
      return (
        <Switch
          size="small"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          slotProps={{ input: { "aria-label": row.label } }}
        />
      );
    case "number":
      return (
        <TextField
          size="small"
          type="number"
          value={String(value)}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n)) return;
            const lo = row.min ?? -Infinity;
            const hi = row.max ?? Infinity;
            onChange(Math.min(hi, Math.max(lo, n)));
          }}
          slotProps={{
            input: { sx: { width: 96 } },
            htmlInput: { min: row.min, max: row.max, step: row.step ?? 1, "aria-label": row.label }
          }}
        />
      );
    case "select":
      return (
        <TextField
          size="small"
          select
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          sx={{ minWidth: 160 }}
          slotProps={{ htmlInput: { "aria-label": row.label } }}
        >
          {(row.options ?? []).map((opt) => (
            <MenuItem key={opt.value} value={opt.value}>
              {opt.label}
            </MenuItem>
          ))}
        </TextField>
      );
    case "text":
      return (
        <TextField
          size="small"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          sx={{ minWidth: 200 }}
          slotProps={{ htmlInput: { "aria-label": row.label } }}
        />
      );
  }
}

export function SettingsDialog() {
  const openFor = React.useSyncExternalStore(
    settingsUi.subscribe,
    settingsUi.openFor,
    settingsUi.serverOpenFor
  );
  const store = openFor ? settings.get(openFor) : null;
  const values = React.useSyncExternalStore(
    store ? store.subscribe : (fn: () => void) => (void fn, () => {}),
    store ? store.getState : () => null,
    store ? store.getServerState : () => null
  );
  // Re-render when a gate is registered or announces a change, so a row that
  // becomes this person's (a sign-in, a promotion) appears without a remount
  // and one that stops being theirs leaves.
  useSettingsGates();

  if (!openFor) return null;
  // The module registry first (a module's registered title is the one the rest
  // of the app shows), then the decl's own — the only answer available for an
  // owner that is not a module, which is every PLUGIN with settings — and the
  // bare id last, which is honest but is a heading nobody wrote.
  const title = registry.module(openFor)?.title ?? store?.decl.title ?? openFor;
  // A row naming a gate that does not hold is not this person's to set. An
  // ungated row, and a row whose gate nobody registered, both show — see
  // `gates.ts` on why the default is open.
  const rows = (store?.decl.rows ?? []).filter((row) => !row.gate || settingsGates.holds(row.gate));

  return (
    <Dialog open onClose={() => settingsUi.close()} maxWidth="sm" fullWidth aria-label={`${title} settings`}>
      <DialogTitle sx={{ pb: 1 }}>
        {title} settings
        <Typography component="span" sx={{ ml: 1, fontSize: 12, color: token("dim"), fontFamily: token("mono") }}>
          {openFor}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        {!store || !values ? (
          <Typography sx={{ fontSize: 13, color: token("dim") }}>
            This surface declares no settings.
          </Typography>
        ) : rows.length === 0 ? (
          // Distinct from the sentence above, and the difference is the whole
          // point: this surface HAS settings, none of them are yours. Saying
          // "declares no settings" here would send somebody hunting for a
          // dialog that is already open.
          <Typography sx={{ fontSize: 13, color: token("dim") }}>
            No settings here are yours to change.
          </Typography>
        ) : (
          <Stack spacing={1.5}>
            {rows.map((row) => (
              <Box
                key={row.key}
                sx={{ display: "flex", alignItems: "center", gap: 2, justifyContent: "space-between" }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{row.label}</Typography>
                  <Typography sx={{ fontSize: 11.5, color: token("dim") }}>{row.hint}</Typography>
                </Box>
                <RowControl row={row} value={values[row.key]} onChange={(v) => store.set(row.key, v)} />
              </Box>
            ))}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {store && (
          <Button size="small" color="inherit" onClick={() => store.reset()}>
            Reset to defaults
          </Button>
        )}
        <Button size="small" variant="contained" onClick={() => settingsUi.close()}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}
