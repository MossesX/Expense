/**
 * @file `AppShell` — the whole chrome, mounted ONCE at the app root.
 *
 * Owner directive 2026-08-08: the dev server is a permanent fixture — every
 * route is a testing surface and must render the full shell, not only the
 * routes that happen to host a module. So the chrome moved UP: the banner and
 * the nav used to be mounted by `ModuleHost`, which made them true by
 * construction for module routes and absent everywhere else — the exact bug
 * where `/` and the plugin routes had no navbar.
 *
 * The shell owns, in order:
 *
 *   1. `AxfStyleRoot` — the one publisher of `:root` variables.
 *   2. The app-tier crash `Boundary` — the last net; nothing white-screens.
 *   2b. `ShellStrips` — whatever plugged into `shell.strip` (0.0.22), above the
 *      banner. The shell knows only that a plugin registered a band.
 *   3. The `app.banner` toolbar — whichever banner asset is active.
 *   4. `NavShell` — the registered nav menu, placed by the layout dials,
 *      arranged around `children`.
 *   5. `ContextMenuRoot` — ONE document-level right-click listener, so every
 *      route has a context menu without any surface opting in (owner,
 *      2026-08-09: "no matter where you click at all time"). Mounted here for
 *      the same reason the banner moved here: chrome that each surface has to
 *      remember is chrome that is missing somewhere.
 *
 * The banner's context slot is route-aware here rather than module-aware in
 * the host: `RouteContext` resolves the current path against the module
 * registry after mount and falls back to the bare path, so every surface —
 * module or plain route — gets a truthful title without knowing the shell
 * exists.
 *
 * `check:ui` verifies at source that THIS file mounts `<Toolbar>` — the
 * banner guarantee moved here from `ModuleHost`, and the guard moved with it.
 *
 * **MUI (2026-08-10, P2).** The viewport column is a `Box` and the route
 * readout is `Typography`, on the conventions `nav/NavMenu` and
 * `toolbar/Toolbar` established: `component` carries the semantic element, and
 * every themed value stays a `token()` string handed to CSS rather than read in
 * JS.
 *
 * The ORDER below is the part a rebuild could quietly break, so it is stated:
 * `Boundary` is OUTSIDE `AxfMuiRoot`, deliberately. The app tier is the last
 * net, and a net mounted inside the provider it is meant to catch cannot catch
 * that provider failing — the crash panel would be inside the subtree being
 * replaced. Outside, a throw from `AxfMuiRoot` (a malformed theme, a broken
 * Emotion cache) still renders a panel. `Boundary.tsx` documents the other half
 * of that arrangement: its fallback paints from engine CSS variables, so it
 * renders correctly with or without a provider above it.
 */
"use client";

import * as React from "react";
import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

import { commands } from "../commands";
import { DockZones } from "../dock/Floatable";
import { registry } from "../registry";
import { token } from "../theme/apply";
import { AxfStyleRoot } from "../theme/ThemeBridge";
import { AxfMuiRoot } from "../theme/MuiBridge";
import { Toolbar } from "../toolbar/Toolbar";
import { ToolbarSettingsDialog } from "../toolbar/ToolbarSettingsDialog";
import { InlineToolbars } from "../toolbar/inline";
import { NavShell } from "../nav/NavMenu";
import { ContextMenuRoot } from "../ctx/ContextMenuRoot";
import { SettingsDialog } from "../settings/SettingsDialog";
import { Boundary } from "./Boundary";
import { ShellStrips } from "./ShellStrips";

/** Banner context: the active module's title when the route hosts one, the
 *  path otherwise. Read after mount so server and first client paint agree. */
function RouteContext() {
  const [path, setPath] = React.useState<string | null>(null);
  React.useEffect(() => {
    const read = () => setPath(window.location.pathname);
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  if (path === null) return null;
  const module = registry.modules().find((m) => m.route === path);
  return (
    <>
      {/* Accent, because on a single-bar chrome this IS the "where you are"
          readout — the classic status bar's job, folded into the banner.
          `component="span"`: these land INSIDE the banner's slot, which is an
          inline flex row, and Typography's default <p> would break it. */}
      {/* `font: "inherit"` FIRST, then the overrides — it is a shorthand, so a
          later `fontWeight` wins and an earlier one would be erased. */}
      <Typography component="span" sx={{ font: "inherit", fontWeight: 700, color: token("accent") }}>
        {module ? module.title : path}
      </Typography>
      {module && (
        <Typography component="span" sx={{ font: "inherit", color: token("dim") }}>
          {module.route}
        </Typography>
      )}
    </>
  );
}

/**
 * Banner commands resolve by NAME through the core command registry — the bar
 * asset stays data, and the handlers live with whoever owns the behaviour
 * (registered at subsystem start). An unregistered name logs and degrades
 * inside `commands.run`, so the shell needs no error handling here.
 */
const runBannerCommand = (name: string): void => {
  commands.run(name);
};

export function AppShell({
  children,
  banner
}: {
  children: ReactNode;
  /** Extra banner fills (by slot id) merged over the shell's own `context`. */
  banner?: Record<string, ReactNode>;
}) {
  return (
    <Boundary tier="app" source="shell">
      <AxfStyleRoot />
      {/* The MUI half of the same theme, mounted here for the same reason
          AxfStyleRoot is: every route is themed by construction and none opts
          in. It wraps the chrome as well as the content, so the banner and the
          nav can be rebuilt on MUI without moving this. */}
      <AxfMuiRoot>
        <Box
          data-axf-shell
          sx={{
            background: token("page"),
            color: token("ink"),
            fontFamily: token("sans"),
            fontSize: token("size-body"),
            // A fixed viewport column, not minHeight: the shell's content area
            // (NavShell's <main>) is the thing that scrolls, so a viewport app
            // (the diff browser's columns, the build manager's panes) can take
            // flex:1 and get a genuinely bounded height. With minHeight there
            // was no bound anywhere and such a page grew to document scroll.
            height: "100vh",
            display: "flex",
            flexDirection: "column"
          }}
        >
          {/* Whatever plugged into `shell.strip` (0.0.22) — a full-width band
              above everything, on every route. FIRST in the column because
              that is the point's whole contract, and mounted here rather than
              imported by a host for the reason the banner is: a strip that
              each app has to remember to mount is a strip that is missing
              somewhere. Renders nothing at all until a plugin contributes. */}
          <ShellStrips />
          {/* `<Toolbar>` wraps ITSELF in the dock engine (0.0.23), so the
              banner is rearrangeable without this file knowing the engine
              exists — the same reason the banner moved here in the first place,
              applied one level down. Inert until a host turns a mode on. */}
          <Toolbar
            surface="app.banner"
            fill={{ context: <RouteContext />, ...banner }}
            onCommand={runBannerCommand}
          />
          <NavShell>{children}</NavShell>
          {/* The four edges, visible while a rearrangement is possible. Renders
              nothing otherwise, and never intercepts a pointer. */}
          <DockZones />
          <ContextMenuRoot />
          {/* ONE document scanner for inline toolbar placements, mounted for
              the same reason ContextMenuRoot is: a surface participates by
              MARKING itself (`data-axf-toolbar-asset` / `<axf-toolbar id>`)
              rather than by remembering to mount something. Renders nothing of
              its own — every bar it draws is portalled into the placeholder
              that named it, and it must sit INSIDE AxfMuiRoot because those
              bars are MUI. */}
          <InlineToolbars />
          {/* The ONE module-settings dialog (0.0.20), mounted at the shell for
              the reason everything else here is: a per-module dialog is a
              dialog a module can forget, and four modules had each hand-rolled
              one. Renders null until `settingsUi` names an owner. */}
          <SettingsDialog />
          {/* Its twin for BARS (0.0.21), mounted here for the same reason and
              opened the same way — a right-click anywhere inside any toolbar,
              *Toolbar settings*. One dialog for every bar in the app, so a bar
              registered tomorrow has it without opting in. */}
          <ToolbarSettingsDialog />
        </Box>
      </AxfMuiRoot>
    </Boundary>
  );
}
