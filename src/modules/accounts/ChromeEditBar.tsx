/**
 * @file The edit-mode strip — what tells a person the chrome is arrangeable
 * right now, and the second of the two ways back.
 *
 * ## Why an affordance and not just a setting
 *
 * `Edit UI` and `Floatable panes & toolbars` are switches in a dialog, and a
 * mode entered from a dialog is a mode people forget they are in. Every drag
 * handle in the app appearing at once is a large visual change with no
 * explanation attached to it; this strip is the explanation, and it carries the
 * way out (Done) beside the way back (Reset all).
 *
 * ## Two resets, and they are not redundant
 *
 * `<Floatable>` draws a reset beside every handle it renders. That is the
 * per-panel one and it is the important one, because it travels with the thing
 * that can be lost.
 *
 * This is the other case, and it is the case the plan actually named: *"a user
 * who dragged a toolbar off-screen must always have a way back"*. A panel whose
 * own handle has been dragged somewhere awkward cannot be rescued by a button
 * on that handle. The engine's viewport clamp (`clampDockPosition`, applied on
 * every move AND on every container resize) is the first defence and makes that
 * nearly impossible; this is the second, and it works without the person being
 * able to name — or reach — the panel.
 *
 * It fires the `ui.layout.reset-all` COMMAND rather than calling the engine, so
 * the same operation is one name away for a menu row, a hotkey or a bar item
 * that wants it later, and this file stays a surface.
 *
 * ## Placement
 *
 * Bottom-centre, `position: fixed`, above the dock ghost's z-order but out of
 * the way of all four snap edges — a strip pinned to an edge would sit exactly
 * where somebody is trying to drop something.
 */
"use client";

import * as React from "react";

import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { commands, dockLayouts, token, useDockMode } from "@axf/core";

import { accountsSettings } from "./settings";
import { RESET_LAYOUTS_COMMAND } from "./lib/chromeEditing";

export default function ChromeEditBar() {
  const mode = useDockMode();
  if (!mode.editing && !mode.floatable) return null;

  const chrome = mode.editing;

  return (
    <Paper
      elevation={6}
      // Not an area marker and not a toolbar asset: this is a transient mode
      // affordance that exists only while a mode is on, and a registered bar
      // would put it in the theme designer's list of bars a person can select.
      data-axf-chrome-edit
      sx={{
        position: "fixed",
        bottom: 18,
        left: "50%",
        transform: "translateX(-50%)",
        // Above the panels (1200 + z) and the ghost (2000), because the way out
        // of a mode must never be underneath the thing the mode is drawing.
        zIndex: 2100,
        px: 1.5,
        py: 0.75,
        borderRadius: "var(--axf-radius)",
        border: `1px solid ${token("accent")}`,
        background: token("panel")
      }}
    >
      <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
        <Typography sx={{ fontSize: 11.5, color: token("dim"), fontFamily: token("mono") }}>
          {chrome
            ? "Editing UI layout — drag a handle to move, an edge to dock"
            : "Floating layout on — drag a handle to move, an edge to dock"}
        </Typography>
        <Button
          size="small"
          color="inherit"
          onClick={() => commands.run(RESET_LAYOUTS_COMMAND)}
          sx={{ fontSize: 11.5, textTransform: "none" }}
        >
          Reset all layouts
        </Button>
        {chrome && (
          <Button
            size="small"
            variant="contained"
            onClick={() => accountsSettings.set("editUi", false)}
            sx={{ fontSize: 11.5, textTransform: "none" }}
          >
            Done
          </Button>
        )}
      </Stack>
    </Paper>
  );
}

/** Re-exported so a caller that only wants the operation does not import the
 *  surface. The strip is one way to fire it; the command is the operation. */
export const resetAllLayouts = (): void => dockLayouts.resetAll();
