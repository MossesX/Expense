"use client";

/**
 * @file The settings dialog's Theme tab — the three faces of the theme as a
 * grid: **Color** (the palette), **Layout** (nav, bars, grid, density) and
 * **Style** (type, shape, motion). Each row rolls on its own, and each has an
 * Override switch: on, the row opens into every dial it owns, each editable;
 * off, the row follows the rolled theme again (owner, 2026-10-16).
 *
 * Everything here goes through core's `theme` store, so the result is the
 * same per-browser theme the studio's designer would produce — overrides are
 * `setValue`s, a group roll is `rollTheme` on a fresh seed with that group's
 * dials copied in as overrides, "roll everything" is the store's own `roll`.
 * The store keeps no per-dial clear, so dropping one override rebuilds the
 * set without it.
 */

import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { DIALS, rollTheme, seedFrom, theme, token, useTheme } from "@axf/core";
import type { Dial, DialSubsystem, ThemeValues } from "@axf/core";

import { MONO } from "./bits";

interface Group {
  readonly id: "color" | "layout" | "style";
  readonly title: string;
  readonly blurb: string;
  readonly subsystems: readonly DialSubsystem[];
}

const GROUPS: readonly Group[] = [
  { id: "color", title: "Color theme", blurb: "Page, panels, ink, accents and the four status colours.", subsystems: ["palette"] },
  { id: "layout", title: "Layout theme", blurb: "Where the nav sits and how it reads, bar heights, grid, padding, density.", subsystems: ["layout", "density"] },
  { id: "style", title: "Style theme", blurb: "Typefaces and sizes, corner radius, borders, elevation, motion.", subsystems: ["typography", "shape", "motion"] }
];

const dialsOf = (g: Group): Dial[] => DIALS.filter((d) => g.subsystems.includes(d.subsystem));

/** The store has `clearOverrides` and `setValue` only; this is "set exactly these". */
function replaceOverrides(next: ThemeValues): void {
  theme.clearOverrides();
  for (const [k, v] of Object.entries(next)) theme.setValue(k, v);
}

function Swatch({ color, title }: { color: string; title: string }) {
  return (
    <Tooltip title={`${title} ${color}`}>
      <Box sx={{ width: 16, height: 16, borderRadius: "4px", background: color, border: `1px solid ${token("edge")}`, flexShrink: 0 }} />
    </Tooltip>
  );
}

function Summary({ group, values }: { group: Group; values: ThemeValues }) {
  if (group.id === "color") {
    return (
      <Stack direction="row" spacing={0.5}>
        {["page", "panel", "ink", "accent", "accent2", "ok", "warn", "err"].map((id) => (
          <Swatch key={id} color={String(values[id])} title={id} />
        ))}
      </Stack>
    );
  }
  if (group.id === "layout") {
    return (
      <Typography sx={{ fontSize: 11.5, color: token("dim"), ...MONO }}>
        nav {String(values.navPlacement)} · {String(values.navStyle)} · density {String(values.density)} · pad {String(values.pagePad)}
      </Typography>
    );
  }
  return (
    <Typography sx={{ fontSize: 11.5, color: token("dim"), ...MONO, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 320 }}>
      {String(values.sans).split(",")[0].replace(/["']/g, "")} · {String(values.sizeBody)}px · radius {String(values.radius)} · {String(values.motionMs)}ms
    </Typography>
  );
}

function DialEditor({ dial, value, onChange }: { dial: Dial; value: string | number; onChange: (v: string | number) => void }) {
  switch (dial.kind) {
    case "color":
      return (
        <Stack direction="row" spacing={0.8} sx={{ alignItems: "center" }}>
          <Box
            component="input"
            type="color"
            value={String(value)}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
            aria-label={dial.label}
            sx={{ width: 28, height: 22, p: 0, border: `1px solid ${token("edge")}`, borderRadius: "4px", background: "transparent", cursor: "pointer" }}
          />
          <TextField
            size="small"
            value={String(value)}
            onChange={(e) => {
              const v = e.target.value.trim();
              if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v.toLowerCase());
            }}
            slotProps={{ htmlInput: { style: { fontFamily: "var(--axf-mono)", fontSize: 12, width: 72, padding: "4px 8px" } } }}
          />
        </Stack>
      );
    case "number":
      return (
        <Stack direction="row" spacing={0.6} sx={{ alignItems: "center" }}>
          <TextField
            size="small"
            type="number"
            value={String(value)}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) onChange(Math.min(dial.max, Math.max(dial.min, n)));
            }}
            slotProps={{ htmlInput: { min: dial.min, max: dial.max, step: dial.step, style: { fontFamily: "var(--axf-mono)", fontSize: 12, width: 64, padding: "4px 8px" } } }}
          />
          {dial.unit && <Typography sx={{ fontSize: 11, color: token("dim") }}>{dial.unit}</Typography>}
        </Stack>
      );
    case "enum":
      return (
        <TextField select size="small" value={String(value)} onChange={(e) => onChange(e.target.value)} sx={{ minWidth: 140 }}>
          {dial.options.map((o) => (
            <MenuItem key={o} value={o} sx={{ fontSize: 12.5 }}>
              {o}
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
          slotProps={{ htmlInput: { style: { fontFamily: "var(--axf-mono)", fontSize: 12, width: 220, padding: "4px 8px" } } }}
        />
      );
  }
}

export default function ThemeTab() {
  const state = useTheme();
  const [openRows, setOpenRows] = React.useState<Record<string, boolean>>({});
  const mode = state.options.mode ?? state.rolled?.mode ?? "dark";

  const overriddenIn = (g: Group): string[] => dialsOf(g).map((d) => d.id).filter((id) => id in state.overrides);

  const rollGroup = (g: Group) => {
    const rolled = rollTheme(seedFrom(`${Date.now()}:${Math.random()}`), state.options);
    const next: ThemeValues = { ...state.overrides };
    for (const d of dialsOf(g)) next[d.id] = rolled.values[d.id];
    replaceOverrides(next);
    setOpenRows((o) => ({ ...o, [g.id]: true }));
  };

  const setOverride = (g: Group, on: boolean) => {
    const ids = new Set(dialsOf(g).map((d) => d.id));
    if (on) {
      // Pin the group at its current values, so switching on changes nothing
      // visible and only makes each dial editable.
      const next: ThemeValues = { ...state.overrides };
      for (const id of ids) next[id] = state.values[id];
      replaceOverrides(next);
      setOpenRows((o) => ({ ...o, [g.id]: true }));
    } else {
      const next: ThemeValues = {};
      for (const [k, v] of Object.entries(state.overrides)) if (!ids.has(k)) next[k] = v;
      replaceOverrides(next);
      setOpenRows((o) => ({ ...o, [g.id]: false }));
    }
  };

  const resetDial = (id: string) => {
    const next: ThemeValues = {};
    for (const [k, v] of Object.entries(state.overrides)) if (k !== id) next[k] = v;
    replaceOverrides(next);
  };

  return (
    <Stack spacing={1.4}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
            {state.rolled ? state.rolled.name : "AmberX default"}
          </Typography>
          <Typography sx={{ fontSize: 11.5, color: token("dim"), ...MONO }}>
            {state.seed ? `seed ${state.seed}` : "no roll applied"} · {Object.keys(state.overrides).length} override{Object.keys(state.overrides).length === 1 ? "" : "s"}
          </Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        <ToggleButtonGroup
          size="small"
          exclusive
          value={mode}
          onChange={(_, v: "dark" | "light" | null) => {
            if (v) theme.setOptions({ mode: v });
          }}
        >
          <ToggleButton value="dark" sx={{ textTransform: "none", fontSize: 12, py: 0.3 }}>Dark</ToggleButton>
          <ToggleButton value="light" sx={{ textTransform: "none", fontSize: 12, py: 0.3 }}>Light</ToggleButton>
        </ToggleButtonGroup>
        <Tooltip title="A fresh theme — every group at once. Drops all overrides.">
          <Button size="small" variant="outlined" onClick={() => theme.roll()}>
            Roll everything
          </Button>
        </Tooltip>
        <Tooltip title="Back to the shipped look. Drops the roll and every override.">
          <Button size="small" color="inherit" onClick={() => theme.reset()} sx={{ color: token("dim") }}>
            Reset
          </Button>
        </Tooltip>
      </Stack>

      <Box sx={{ border: `1px solid ${token("edge")}`, borderRadius: 1, overflow: "hidden" }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ "& th": { background: token("panel2"), fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: token("dim") } }}>
              <TableCell sx={{ width: 36 }} />
              <TableCell>Theme</TableCell>
              <TableCell>Current</TableCell>
              <TableCell align="center" sx={{ width: 90 }}>Roll</TableCell>
              <TableCell align="center" sx={{ width: 90 }}>Override</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {GROUPS.map((g) => {
              const over = overriddenIn(g);
              const on = over.length > 0;
              const expanded = on && (openRows[g.id] ?? true);
              const dials = dialsOf(g);
              return (
                <React.Fragment key={g.id}>
                  <TableRow hover sx={{ "& td": { borderBottom: expanded ? "none" : undefined } }}>
                    <TableCell sx={{ py: 0.4 }}>
                      <IconButton
                        size="small"
                        disabled={!on}
                        aria-label={expanded ? "Collapse" : "Expand"}
                        onClick={() => setOpenRows((o) => ({ ...o, [g.id]: !(o[g.id] ?? true) }))}
                        sx={{ transition: "transform 160ms", transform: expanded ? "rotate(90deg)" : "none", fontSize: 12 }}
                      >
                        ▶
                      </IconButton>
                    </TableCell>
                    <TableCell sx={{ py: 0.6 }}>
                      <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{g.title}</Typography>
                      <Typography sx={{ fontSize: 11, color: token("dim") }}>{g.blurb}</Typography>
                    </TableCell>
                    <TableCell sx={{ py: 0.6 }}>
                      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                        <Summary group={g} values={state.values} />
                        {on && <Chip size="small" variant="outlined" label={`${over.length}/${dials.length} set`} sx={{ height: 18 }} />}
                      </Stack>
                    </TableCell>
                    <TableCell align="center" sx={{ py: 0.4 }}>
                      <Tooltip title={`Roll a new ${g.title.toLowerCase()} and pin it as overrides`}>
                        <Button size="small" variant="outlined" onClick={() => rollGroup(g)} sx={{ minWidth: 0, px: 1.2 }}>
                          Roll
                        </Button>
                      </Tooltip>
                    </TableCell>
                    <TableCell align="center" sx={{ py: 0.4 }}>
                      <Switch size="small" checked={on} onChange={(e) => setOverride(g, e.target.checked)} slotProps={{ input: { "aria-label": `Override ${g.title}` } }} />
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell colSpan={5} sx={{ p: 0, borderBottom: expanded ? undefined : "none" }}>
                      <Collapse in={expanded} unmountOnExit>
                        <Box sx={{ px: 2, py: 1, background: token("panel2") }}>
                          <Table size="small">
                            <TableBody>
                              {dials.map((d) => {
                                const set = d.id in state.overrides;
                                return (
                                  <TableRow key={d.id} sx={{ "& td": { borderBottom: `1px solid ${token("edge")}`, py: 0.5 } }}>
                                    <TableCell sx={{ width: "34%" }}>
                                      <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>{d.label}</Typography>
                                      <Typography sx={{ fontSize: 10.5, color: token("dim"), ...MONO }}>
                                        {d.id} · {d.cssVar}
                                      </Typography>
                                    </TableCell>
                                    <TableCell sx={{ width: "36%" }}>
                                      <Typography sx={{ fontSize: 11, color: token("dim") }}>{d.effect}</Typography>
                                    </TableCell>
                                    <TableCell>
                                      <Stack direction="row" spacing={0.8} sx={{ alignItems: "center", justifyContent: "flex-end" }}>
                                        <DialEditor dial={d} value={state.values[d.id]} onChange={(v) => theme.setValue(d.id, v)} />
                                        <Tooltip title={set ? "Follow the rolled theme for this token" : "Following the rolled theme"}>
                                          <span>
                                            <Button size="small" color="inherit" disabled={!set} onClick={() => resetDial(d.id)} sx={{ minWidth: 0, px: 0.8, color: token("dim"), fontSize: 11 }}>
                                              ↺
                                            </Button>
                                          </span>
                                        </Tooltip>
                                      </Stack>
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </Box>
                      </Collapse>
                    </TableCell>
                  </TableRow>
                </React.Fragment>
              );
            })}
          </TableBody>
        </Table>
      </Box>
      <Typography sx={{ fontSize: 11.5, color: token("dim") }}>
        The theme is kept per browser. Rolling a group pins its dials as overrides; “Roll everything” starts a fresh theme and drops them.
      </Typography>
    </Stack>
  );
}
