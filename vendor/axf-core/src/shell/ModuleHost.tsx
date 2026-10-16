/**
 * @file `ModuleHost` — the shell renders a registered module through this, and
 * `Slot` is how that module renders whatever plugged into one of its points.
 *
 * The important property: a module never looks up its own contributions. It
 * declares a point and renders a `<Slot>`; the host resolves it from the
 * registry. That indirection is what lets a rolled layout place and order a
 * contribution later, and what stops a plugin being a hole punched through the
 * layout system (INITIATION-PROMPT.md §4.1).
 *
 * **The host renders NO chrome and publishes NO theme variables.** Both moved
 * to `AppShell` (2026-08-08, owner directive that every route is a testing
 * surface): the banner, the nav and the style root mount once at the app
 * root, so `/` and plain plugin routes get the same shell as module routes.
 * What stays here is what only a module host can do: the host context, and
 * the module-tier crash boundary around the screen.
 *
 * **MUI (2026-08-10, P2).** The host's own frame is a `Box`, and its two error
 * readouts are `Alert`s — an unregistered module id and a `Slot` for an
 * undeclared point are exactly alerts, so they are ones. Both were `<pre>`
 * before, which said "raw output" about text that is a sentence.
 *
 * `severity="error"` with `variant="outlined"` and `icon={false}` keeps them
 * the dense strips they were rather than the three-line blocks Alert defaults
 * to, and the colours still come from `token()` so they follow the engine
 * rather than MUI's own error palette — the same posture `Dashboard.tsx` took
 * for its substitution notice.
 *
 * These are NOT crash fallbacks and must not be confused with `Boundary`'s:
 * they render on a wiring mistake found by ordinary code, with the tree intact
 * and every provider alive. `Boundary`'s panel renders when something has
 * already thrown, which is why that one alone stays off the kit.
 */
"use client";

import * as React from "react";
import type { ReactNode } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";

import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";

import { registry } from "../registry";
import type { Module } from "../module";
import { Glyph } from "../brand/Glyph";
import { setHostedModule, settings, settingsUi } from "../settings/store";
import { token } from "../theme/apply";
import { Boundary, ContributionView } from "./Boundary";

interface HostContextValue {
  readonly module: Module;
}

const HostContext = React.createContext<HostContextValue | null>(null);

/**
 * Shared chrome for the two wiring-error strips. One definition, because two
 * near-identical copies is how the "no module" and "undeclared point" reports
 * stop looking like the same kind of thing — which is the only reason a reader
 * knows they ARE the same kind of thing.
 *
 * `border: 0` + `borderRadius: 0` strip Alert's own outline: these sit in the
 * content area where a rounded card reads as a component that loaded, and the
 * message needs to read as the surface failing to wire up.
 */
const ALERT_SX = {
  m: 2,
  py: "6px",
  px: "12px",
  fontFamily: token("mono"),
  fontSize: 12,
  color: token("err"),
  background: "transparent",
  border: `1px dashed ${token("err")}`,
  borderRadius: token("radius-tight"),
  "& .MuiAlert-message": { p: 0, overflow: "visible" }
} as const;

/** The module currently being hosted. Throws outside a host, deliberately. */
export function useHost(): HostContextValue {
  const ctx = React.useContext(HostContext);
  if (!ctx) throw new Error("useHost() called outside a <ModuleHost>");
  return ctx;
}

/**
 * The gear (0.0.20) — the toolbar half of the shell-owned sui affordance.
 * Sticky rather than absolute so it stays put while the host scrolls; zero
 * height so it costs the layout nothing; rendered only when the module
 * actually registered settings, because a gear that opens an empty dialog
 * teaches people the gear does nothing.
 */
function SettingsGear({ moduleId, title }: { moduleId: string; title: string }) {
  const has = React.useSyncExternalStore(
    (fn) => settings.subscribe(fn),
    () => settings.has(moduleId),
    () => false
  );
  if (!has) return null;
  return (
    <Box sx={{ position: "sticky", top: 6, zIndex: 20, alignSelf: "flex-end", height: 0, mr: 1 }}>
      <Tooltip title={`${title} settings`}>
        <IconButton
          size="small"
          aria-label={`${title} settings`}
          data-axf-module-gear={moduleId}
          onClick={() => settingsUi.open(moduleId)}
          sx={{ p: 0.5, color: token("dim"), "&:hover": { color: token("accent") } }}
        >
          <Glyph id="icon-gear" size={15} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

export function ModuleHost({ moduleId }: { moduleId: string }) {
  const module = registry.module(moduleId);

  // The hosted-module seam: how hook-less command handlers (the universal
  // band's "Module settings" row) answer "which module is on screen". An
  // effect, not a render write — publishing during render is the exact
  // mistake I-8 records against PacksSeed.
  React.useEffect(() => {
    if (!module) return;
    setHostedModule({ id: module.id, title: module.title });
    return () => setHostedModule(null);
  }, [module]);

  if (!module) {
    return (
      <Alert severity="error" variant="outlined" icon={false} sx={ALERT_SX}>
        No module registered with id &quot;{moduleId}&quot;. Registered:{" "}
        {registry.modules().map((m) => m.id).join(", ") || "(none)"}
      </Alert>
    );
  }
  const Screen = module.component;
  return (
    <HostContext.Provider value={{ module }}>
      <Box
        data-axf-module={module.id}
        /**
         * A flex COLUMN, not a plain block — the host is a container as well as
         * an item, and a screen that declares `flex: 1` needs something to
         * resolve it against.
         *
         * It was a block until 2026-08-11, and the omission stayed invisible
         * while every hosted screen happened to fit. The Build Manager does
         * not: it is a `flex: 1` root with three scrolling panes above a fixed
         * run strip. Under a block parent `flex: 1` is inert, so the root grew
         * to its content — 2933px inside a 918px host — the panes stopped
         * scrolling independently, and START, STOP, the mode toggles and the
         * cost readout were pushed a screen and a half below the fold.
         *
         * Worth a note rather than a silent fix, because of WHEN it broke: that
         * screen was fine for weeks and regressed the day it was PROMOTED to a
         * registered module. Before promotion its route imported it directly,
         * so it sat in `main`'s own flex column and `flex: 1` resolved.
         * Registering it was the right move and it changed the box the screen
         * lives in — the kind of regression a promotion is least expected to
         * cause, and nothing was watching for it.
         *
         * Fixing it in the SCREEN was tried first and does not work: against a
         * block parent whose own height comes from `flex: 1`, a `height: 100%`
         * child still measures its content. The constraint has to start here.
         */
        sx={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          overflow: "auto"
        }}
      >
        <SettingsGear moduleId={module.id} title={module.title} />
        {/* The module tier: a screen that throws is replaced by a named panel
            while AppShell's banner and nav above stay alive. */}
        <Boundary tier="module" source={module.id}>
          <Screen />
        </Boundary>
      </Box>
    </HostContext.Provider>
  );
}

/**
 * Render everything contributed to one of the host module's points.
 *
 * `children` is the empty state — what the host shows when nothing has plugged
 * in. A point with no contributions and no empty state renders nothing at all,
 * which reads as a bug rather than as "nothing here yet".
 */
export function Slot({
  point,
  render,
  children
}: {
  point: string;
  render: (payload: never, from: string) => ReactNode;
  children?: ReactNode;
}) {
  const { module } = useHost();
  const declared = module.points.some((p) => p.id === point);
  if (!declared) {
    return (
      <Alert severity="error" variant="outlined" icon={false} sx={ALERT_SX}>
        {module.id} renders a Slot for &quot;{point}&quot;, which it does not declare.
      </Alert>
    );
  }
  const contributions = registry.contributionsTo(point);
  if (!contributions.length) return <>{children ?? null}</>;
  return (
    <>
      {contributions.map((c) => (
        // The contribution tier — one boundary PER contribution, so a crashing
        // plugin cannot take its siblings down with it. `ContributionView`
        // invokes `render()` in its own render phase, below the boundary;
        // calling it here would run plugin code during the HOST's render,
        // above a boundary that has not mounted, and the throw would escape a
        // tier up (proven by mutation: the panel then blames the module).
        <Boundary key={`${c.from}:${c.point}`} tier="contribution" source={`${c.from} → ${c.point}`} compact>
          <ContributionView
            render={render as (payload: unknown, from: string) => ReactNode}
            payload={c.payload as unknown}
            from={c.from}
            point={c.point}
          />
        </Boundary>
      ))}
    </>
  );
}
