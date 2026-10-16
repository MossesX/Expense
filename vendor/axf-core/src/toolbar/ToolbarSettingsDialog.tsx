/**
 * @file The toolbar settings dialog — ONE dialog for every bar in the app.
 *
 * Mounted once by `AppShell`, beside `SettingsDialog` and `ContextMenuRoot`,
 * for the reason all of that chrome is: chrome each surface has to remember is
 * chrome that is missing somewhere. It renders whichever bar `toolbarPrefsUi`
 * says is open — reached by right-clicking any toolbar and choosing *Toolbar
 * settings* — so a bar registered tomorrow has this dialog with no edit here
 * and none in the asset.
 *
 * **There is no preview pane, on purpose.** Every control writes through
 * `toolbarPrefs` immediately, and the bar being edited is the REAL bar on the
 * screen behind this dialog: turning the icons up moves the thing you are
 * looking at. That is the same argument the designer's Toolbar tab makes for
 * having no thumbnail — a truer preview than any picture of one.
 *
 * The knobs are per-USER and never leave a mark on the asset. *Reset* forgets
 * this bar's overrides entirely rather than writing the defaults back, so a bar
 * whose author later changes its declared icon size still moves for anyone who
 * reset — the difference between "no opinion" and "an opinion that happens to
 * match today's default", which the store's partial documents exist to keep.
 */
"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { token } from "../theme/apply";
import {
  TOOLBAR_ICON_MAX,
  TOOLBAR_ICON_MIN,
  TOOLBAR_THICKNESS_MAX,
  resolveToolbarPrefs,
  toolbarPrefs,
  toolbarPrefsTouched,
  toolbarPrefsUi,
  useToolbarPrefs
} from "./prefs";
import { useToolbars } from "./Toolbar";

/** One labelled row. The dialog is four of these and nothing else, so the
 *  label/hint/control rhythm is defined once rather than copied four times. */
function Row({
  label,
  hint,
  children
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 2, justifyContent: "space-between" }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{label}</Typography>
        <Typography sx={{ fontSize: 11.5, color: token("dim") }}>{hint}</Typography>
      </Box>
      {children}
    </Box>
  );
}

export function ToolbarSettingsDialog() {
  const openFor = React.useSyncExternalStore(
    toolbarPrefsUi.subscribe,
    toolbarPrefsUi.openFor,
    toolbarPrefsUi.serverOpenFor
  );
  const snapshot = useToolbars();
  const doc = useToolbarPrefs();

  if (!openFor) return null;
  const asset = snapshot.all.find((a) => a.id === openFor) ?? null;

  // A bar can be unregistered between the right-click and the render (a dev
  // reload, a deleted custom asset). Saying so beats an empty dialog, and beats
  // guessing at defaults for an asset nothing can describe.
  if (!asset) {
    return (
      <Dialog open onClose={() => toolbarPrefsUi.close()} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>Toolbar settings</DialogTitle>
        <DialogContent dividers>
          <Typography sx={{ fontSize: 13, color: token("dim") }}>
            No toolbar is registered as <strong>{openFor}</strong> any more.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button size="small" variant="contained" onClick={() => toolbarPrefsUi.close()}>
            Done
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  const prefs = resolveToolbarPrefs(asset, doc);
  const touched = toolbarPrefsTouched(asset.id, doc);

  return (
    <Dialog
      open
      onClose={() => toolbarPrefsUi.close()}
      maxWidth="sm"
      fullWidth
      aria-label={`${asset.title} settings`}
    >
      <DialogTitle sx={{ pb: 1 }}>
        {asset.title}
        <Typography
          component="span"
          sx={{ ml: 1, fontSize: 12, color: token("dim"), fontFamily: token("mono") }}
        >
          {asset.id}
        </Typography>
        {touched ? (
          <Chip size="small" variant="outlined" label="customised" sx={{ ml: 1, height: 18, fontSize: 10 }} />
        ) : null}
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={1.5}>
          <Row
            label="Show text"
            hint="The bar's own words — action labels, menu labels, a field's placeholder. Tooltips stay either way."
          >
            <Switch
              size="small"
              checked={prefs.labels}
              onChange={(e) => toolbarPrefs.set(asset.id, "labels", e.target.checked)}
              slotProps={{ input: { "aria-label": "Show text" } }}
            />
          </Row>

          <Row label="Icon size" hint={`${prefs.iconSize}px. A brand logo keeps its own declared width.`}>
            <Slider
              size="small"
              sx={{ width: 180 }}
              min={TOOLBAR_ICON_MIN}
              max={TOOLBAR_ICON_MAX}
              step={1}
              value={prefs.iconSize}
              onChange={(_, v) => toolbarPrefs.set(asset.id, "iconSize", Array.isArray(v) ? v[0] : v)}
              aria-label="Icon size"
              valueLabelDisplay="auto"
            />
          </Row>

          <Row label="Direction" hint="Which way the bar runs. A vertical bar takes its length from its items.">
            <TextField
              size="small"
              select
              value={prefs.orientation}
              onChange={(e) =>
                toolbarPrefs.set(asset.id, "orientation", e.target.value as "horizontal" | "vertical")
              }
              sx={{ minWidth: 150 }}
              slotProps={{ htmlInput: { "aria-label": "Direction" } }}
            >
              <MenuItem value="horizontal">Horizontal</MenuItem>
              <MenuItem value="vertical">Vertical</MenuItem>
            </TextField>
          </Row>

          <Row
            label="Thickness"
            hint={
              prefs.thickness
                ? `${prefs.thickness}px ${prefs.orientation === "vertical" ? "wide" : "tall"}. 0 hands it back to the bar.`
                : "0 — whatever the bar itself declares, scaled by the theme."
            }
          >
            <TextField
              size="small"
              type="number"
              value={String(prefs.thickness)}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                toolbarPrefs.set(asset.id, "thickness", Math.min(TOOLBAR_THICKNESS_MAX, Math.max(0, n)));
              }}
              slotProps={{
                input: { sx: { width: 96 } },
                htmlInput: { min: 0, max: TOOLBAR_THICKNESS_MAX, step: 2, "aria-label": "Thickness" }
              }}
            />
          </Row>

          <Typography sx={{ fontSize: 11.5, color: token("dim") }}>
            These are yours, not the asset&apos;s: they are saved for your account and change nothing
            for anyone else. To change what this bar ships with, edit it in the theme designer&apos;s
            Toolbar tab.
          </Typography>
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button
          size="small"
          color="inherit"
          disabled={!touched}
          onClick={() => toolbarPrefs.reset(asset.id)}
        >
          Reset to the bar&apos;s own
        </Button>
        <Button size="small" variant="contained" onClick={() => toolbarPrefsUi.close()}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}
