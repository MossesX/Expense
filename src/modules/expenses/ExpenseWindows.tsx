"use client";

/**
 * @file **Floating tabs** — the owner's *"allow undocking tab and floating as
 * window"*.
 *
 * Every tab whose `window` geometry is set renders here instead of in the
 * strip: draggable by its title bar, resizable from the corner, z-ordered on
 * click, minimizable to a stack down the RIGHT edge, and — the one thing the
 * Task Manager's windows have no need for — **re-dockable**, by the ⇲ button or
 * by double-clicking the title bar.
 *
 * The shape is deliberately the Task Manager's (`TaskWindows.tsx`), down to the
 * minimized stack going down the right edge rather than along the bottom: that
 * decision was made once, for a reason recorded there (a bottom row collides
 * with the shell's status strip and loses window identity after two or three),
 * and a second window system in the same app that behaves differently is a
 * worse outcome than either behaviour on its own.
 *
 * Geometry is session state and is not persisted, same as the Task Manager's —
 * a floating window is something you opened, not something you configured.
 *
 * ── MUI ─────────────────────────────────────────────────────────────────────
 * Frames are `Paper`, bars are `Stack`, controls are `IconButton`. The drag and
 * resize maths stay bespoke: a window's position mid-gesture is a measured
 * number and MUI has no component that owns one — the same exception
 * `panes/PaneLayout` holds.
 */

import * as React from "react";

import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { token } from "@axf/core";

import TabContent from "./TabContent";
import { expenseTabs, type TabState } from "./tabs";
import type { Expense } from "./types";

/** Below this the content is unreadable and the title bar's buttons collide. */
const MIN_W = 340;
const MIN_H = 200;

interface WindowProps {
  tab: TabState;
  expenses: Expense[];
  onUpdate: (id: string, patch: Partial<Expense>) => void;
  onAdd: () => void;
}

function WindowFrame({ tab, expenses, onUpdate, onAdd }: WindowProps) {
  /**
   * The live gesture's geometry, painted while the pointer is down and
   * committed to the store on release. A store write per `pointermove` would
   * re-render every other window and the docked panel sixty times a second.
   */
  const [live, setLive] = React.useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const geom = tab.window;
  if (!geom) return null;
  const pos = live ?? { x: geom.x, y: geom.y, w: geom.w, h: geom.h };

  const startDrag = (e: React.PointerEvent) => {
    // A grab that landed on one of the title bar's buttons belongs to it.
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    expenseTabs.focusWindow(tab.id);
    const sx = e.clientX;
    const sy = e.clientY;
    const { x, y, w, h } = { x: geom.x, y: geom.y, w: geom.w, h: geom.h };
    const move = (ev: PointerEvent) => {
      setLive({ x: Math.max(0, x + ev.clientX - sx), y: Math.max(0, y + ev.clientY - sy), w, h });
    };
    const up = (ev: PointerEvent) => {
      setLive(null);
      expenseTabs.patchWindow(tab.id, {
        x: Math.max(0, x + ev.clientX - sx),
        y: Math.max(0, y + ev.clientY - sy)
      });
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    expenseTabs.focusWindow(tab.id);
    const sx = e.clientX;
    const sy = e.clientY;
    const { x, y, w, h } = { x: geom.x, y: geom.y, w: geom.w, h: geom.h };
    const move = (ev: PointerEvent) => {
      setLive({
        x,
        y,
        w: Math.max(MIN_W, w + ev.clientX - sx),
        h: Math.max(MIN_H, h + ev.clientY - sy)
      });
    };
    const up = (ev: PointerEvent) => {
      setLive(null);
      expenseTabs.patchWindow(tab.id, {
        w: Math.max(MIN_W, w + ev.clientX - sx),
        h: Math.max(MIN_H, h + ev.clientY - sy)
      });
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const button = { padding: "2px", fontSize: 13, color: token("dim") } as const;

  return (
    <Paper
      component="section"
      elevation={0}
      onPointerDown={() => expenseTabs.focusWindow(tab.id)}
      aria-label={`Floating tab: ${tab.title}`}
      // Still an expenses surface, so a right-click inside a window carries the
      // module's rows — and the tab's own rows, because the bar marks the tab.
      data-axf-area="expenses.tabstrip"
      sx={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        width: pos.w,
        height: pos.h,
        zIndex: 1200 + geom.z,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: token("panel"),
        backgroundImage: "none",
        border: `1px solid color-mix(in srgb, ${token("accent")} 25%, ${token("edge")})`,
        borderRadius: token("radius"),
        boxShadow: "0 18px 50px rgba(0, 0, 0, 0.55)"
      }}
    >
      <Stack
        direction="row"
        onPointerDown={startDrag}
        // Double-click re-docks, matching the framework's float-panes rule
        // ("re-docks on a double-click of its title bar").
        onDoubleClick={() => expenseTabs.dock(tab.id)}
        data-axf-area="expenses.tab"
        data-axf-tab={tab.id}
        data-axf-tab-title={tab.title}
        sx={{
          alignItems: "center",
          gap: "8px",
          padding: "4px 10px",
          cursor: "grab",
          userSelect: "none",
          touchAction: "none",
          background: `color-mix(in srgb, ${token("accent")} 8%, transparent)`,
          borderBottom: `1px solid ${token("edge")}`
        }}
      >
        <Typography
          component="span"
          sx={{
            fontSize: 12.5,
            fontWeight: 700,
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: token("ink")
          }}
        >
          {tab.title}
        </Typography>
        <Tooltip title="Dock back into the tab strip">
          <IconButton size="small" aria-label="Dock" onClick={() => expenseTabs.dock(tab.id)} sx={button}>
            ⇲
          </IconButton>
        </Tooltip>
        <IconButton
          size="small"
          title="Minimize"
          aria-label="Minimize"
          onClick={() => expenseTabs.patchWindow(tab.id, { minimized: true })}
          sx={button}
        >
          –
        </IconButton>
        <IconButton
          size="small"
          title="Close"
          aria-label="Close"
          onClick={() => expenseTabs.close(tab.id)}
          sx={{ ...button, "&:hover": { color: token("err") } }}
        >
          ×
        </IconButton>
      </Stack>

      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 1.2, display: "flex", flexDirection: "column" }}>
        <TabContent tab={tab} expenses={expenses} onUpdate={onUpdate} onAdd={onAdd} compact />
      </Box>

      <Box
        onPointerDown={startResize}
        aria-hidden
        sx={{ position: "absolute", right: 0, bottom: 0, width: 16, height: 16, cursor: "nwse-resize", touchAction: "none" }}
      >
        <Box
          component="span"
          sx={{
            position: "absolute",
            right: 3,
            bottom: 3,
            width: 8,
            height: 8,
            borderRight: `2px solid ${token("dim")}`,
            borderBottom: `2px solid ${token("dim")}`
          }}
        />
      </Box>
    </Paper>
  );
}

export default function ExpenseWindows({
  tabs,
  expenses,
  onUpdate,
  onAdd
}: {
  /** Floating tabs only. */
  tabs: readonly TabState[];
  expenses: Expense[];
  onUpdate: (id: string, patch: Partial<Expense>) => void;
  onAdd: () => void;
}) {
  const minimized = tabs.filter((t) => t.window?.minimized);

  return (
    <>
      {tabs
        .filter((t) => !t.window?.minimized)
        .map((tab) => (
          <WindowFrame key={tab.id} tab={tab} expenses={expenses} onUpdate={onUpdate} onAdd={onAdd} />
        ))}

      {minimized.length > 0 && (
        <Stack sx={{ position: "fixed", right: 8, top: 96, zIndex: 1600, gap: "6px", width: 190 }}>
          {minimized.map((tab) => (
            <Paper
              key={tab.id}
              elevation={0}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "4px 8px",
                background: token("panel"),
                backgroundImage: "none",
                border: `1px solid ${token("edge")}`,
                borderRadius: token("radius"),
                boxShadow: "0 6px 18px rgba(0, 0, 0, 0.4)"
              }}
            >
              <ButtonBase
                title="Restore"
                onClick={() => expenseTabs.focusWindow(tab.id)}
                sx={{
                  flex: 1,
                  minWidth: 0,
                  justifyContent: "flex-start",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  display: "block",
                  textAlign: "left",
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: token("ink")
                }}
              >
                {tab.title}
              </ButtonBase>
              <IconButton
                size="small"
                title="Dock"
                aria-label="Dock"
                onClick={() => expenseTabs.dock(tab.id)}
                sx={{ padding: "2px", fontSize: 13, color: token("dim") }}
              >
                ⇲
              </IconButton>
              <IconButton
                size="small"
                title="Close"
                aria-label="Close"
                onClick={() => expenseTabs.close(tab.id)}
                sx={{ padding: "2px", fontSize: 14, color: token("dim"), "&:hover": { color: token("err") } }}
              >
                ×
              </IconButton>
            </Paper>
          ))}
        </Stack>
      )}
    </>
  );
}
