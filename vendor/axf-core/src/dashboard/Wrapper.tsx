/**
 * @file The ONE interpreter of a {@link DashboardSpec} — data in, chrome out.
 *
 * `spec.ts` says what a wrapper can be; this says what it looks like. The
 * split is the same one `theme/spec.ts` and `theme/apply.ts` have, and it buys
 * the same thing: a dial added to the spec is rolled, saved, previewed and
 * published without an edit here, and this file never branches on a dial ID to
 * decide *whether* a dial matters — only on its VALUE to decide what it draws.
 *
 * ## Where the variables land, and why not on `:root`
 *
 * Every dial publishes as `--axd-*` **on the wrapper's own element**, through
 * plain inline style. That is not a second theme publisher: `AxfStyleRoot`
 * owns `--axf-*` on the document (the one-publisher rule, `theme/resolve.ts`)
 * and nothing here writes one. A wrapper that wants a theme value changed says
 * so through `inherit`, and the theme store makes the change — one author, one
 * moment, visible in the designer's override count like every other edit.
 *
 * The consequence worth stating: a surface below the wrapper can read
 * `var(--axd-card-radius)` and get the wrapper's opinion, and reading
 * `var(--axf-radius)` still gets the theme's. Two namespaces, no argument.
 *
 * ## The shared skeleton (the P8 contract)
 *
 * `DashboardChrome` re-renders `dashboard.render(ctx)` on a swap and React
 * reconciles by position and type, so every wrapper — the hand-written console
 * one included — must contribute the same keyed host-element skeleton or a
 * swap remounts the whole screen and loses its state. This renderer keeps
 * `<Box key="screen">` exactly as `dashboards/amberx-console.tsx` does, and
 * renders inline (never as `<SpecWrapper/>`) for the same reason: one element
 * type shared by every wrapper is what makes a swap a morph rather than a
 * remount.
 */
"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { registry } from "../registry";
import { AXF_CORE_VERSION } from "../version";
import { DASH_DIALS, resolveDash } from "./spec";
import type { DashboardSpec, DashValues } from "./spec";
import { defineDashboard } from "./types";
import type { Dashboard, DashboardCtx } from "./types";

/* ------------------------------------------------------------------ atoms */

/** A theme role name → the variable that carries it. */
const role = (name: string): string => `var(--axf-${name})`;

/**
 * A surface, optionally tinted with the accent.
 *
 * `color-mix` rather than a pre-computed hex, deliberately: the tint has to
 * follow the theme's accent as it is rolled, and a value computed here would
 * be a snapshot that stops tracking the moment a dial moves. 0% short-circuits
 * so the common case emits the plain variable.
 */
function surface(name: string, tint: number): string {
  const base = role(name);
  if (!tint) return base;
  return `color-mix(in srgb, ${role("accent")} ${tint}%, ${base})`;
}

/** The rule a band draws against the screen. */
function ruleFor(kind: string): string {
  switch (kind) {
    case "none":
      return "none";
    case "edge":
      return `var(--axf-border) solid ${role("edge")}`;
    case "accent":
      return `1px solid ${role("accent")}`;
    default:
      return `1px solid ${role("edge")}`;
  }
}

/* --------------------------------------------------------------- readings */

/**
 * The clock. Empty until the first client tick so the server render and the
 * hydrating one agree — the same shape `amberx-console.tsx` uses, and for the
 * same reason: a time rendered on the server is a hydration mismatch by
 * construction.
 */
function Clock() {
  const [now, setNow] = React.useState<string | null>(null);
  React.useEffect(() => {
    const tick = () => setNow(new Date().toLocaleTimeString());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);
  if (now === null) return null;
  return (
    <Typography component="span" sx={{ font: "inherit", fontVariantNumeric: "tabular-nums" }}>
      {now}
    </Typography>
  );
}

/**
 * One band reading, resolved from the live app rather than authored.
 *
 * Every option here is a LIVE value — the route being rendered, the module the
 * registry resolves for it, what the registry holds. A band that could carry
 * arbitrary authored text would make a wrapper a place to put content, and a
 * wrapper owns presentation and nothing else (`types.ts`, rule 1).
 */
function reading(
  kind: string,
  ctx: DashboardCtx,
  spec: DashboardSpec
): React.ReactNode {
  switch (kind) {
    case "none":
      return null;
    case "title":
      return spec.title;
    case "route":
      return ctx.pathname || "/";
    case "module": {
      const path = ctx.pathname || "/";
      const found = registry.modules().find((m) => m.route === path);
      return found ? found.title : "—";
    }
    case "core":
      return `AmberX · core ${AXF_CORE_VERSION}`;
    case "modules":
      return `${registry.modules().length}/12 module slots`;
    case "clock":
      return <Clock />;
    default:
      return null;
  }
}

/* ----------------------------------------------------------------- bands */

const BAND_HEIGHT: Record<string, number | undefined> = { slim: 24, tall: 40 };

function Band({
  where,
  spec,
  ctx,
  values
}: {
  where: "head" | "foot";
  spec: DashboardSpec;
  ctx: DashboardCtx;
  values: DashValues;
}) {
  const kind = String(values[`${where}Band`]);
  if (kind === "none") return null;

  const left = reading(String(values[`${where}Left`]), ctx, spec);
  const right = reading(String(values[`${where}Right`]), ctx, spec);
  const rule = ruleFor(String(values.rules));
  const tracking = Number(values.bandTracking) / 100;

  return (
    <Stack
      direction="row"
      data-axd-band={where}
      sx={{
        alignItems: "center",
        gap: "10px",
        flexShrink: 0,
        minHeight: BAND_HEIGHT[kind] ?? 24,
        px: `${Number(values.bandPad)}px`,
        background: surface(String(values.bandSurface), Number(values.tint)),
        color: role(String(values.bandInk)),
        fontFamily: role("mono"),
        fontSize: "var(--axf-size-micro)",
        letterSpacing: `${tracking}em`,
        textTransform: values.bandCase === "uppercase" ? "uppercase" : "none",
        // The rule always faces the screen: under a header, over a footer.
        ...(where === "head" ? { borderBottom: rule } : { borderTop: rule })
      }}
    >
      <Typography component="span" sx={{ font: "inherit", letterSpacing: "inherit" }}>
        {left}
      </Typography>
      <Box component="span" sx={{ flex: 1 }} />
      <Typography component="span" sx={{ font: "inherit", letterSpacing: "inherit" }}>
        {right}
      </Typography>
    </Stack>
  );
}

/* ----------------------------------------------------------------- frame */

/** What the `frame` dial means, as style. Nothing else branches on it. */
function frameStyle(values: DashValues): Record<string, unknown> {
  const radius = `${Number(values.corner)}px`;
  const shade = Number(values.shade);
  const tint = Number(values.tint);
  const shadow = shade ? `0 ${Math.round(shade / 2)}px ${shade}px rgba(0,0,0,.38)` : "none";

  switch (String(values.frame)) {
    case "rule":
      return { borderTop: `var(--axf-border) solid ${role("edge")}` };
    case "outline":
      return {
        border: `var(--axf-border) solid ${role("edge")}`,
        borderRadius: radius,
        boxShadow: shadow
      };
    case "inset":
      return {
        background: surface("panel", tint),
        border: `var(--axf-border) solid ${role("edge")}`,
        borderRadius: radius,
        boxShadow: `inset 0 1px 0 ${role("edge")}, ${shadow === "none" ? "none" : shadow}`
      };
    case "card":
      return {
        background: surface("panel", tint),
        borderRadius: radius,
        boxShadow: shade ? shadow : `0 6px 18px rgba(0,0,0,.28)`
      };
    default:
      return {};
  }
}

/** The accent seam. Separate from the frame so any frame can carry any seam. */
function seamStyle(values: DashValues): Record<string, unknown> {
  switch (String(values.accentEdge)) {
    case "top":
      return { borderTop: `2px solid ${role("accent")}` };
    case "left":
      return { borderLeft: `2px solid ${role("accent")}` };
    case "glow":
      return { boxShadow: `0 0 0 1px ${role("accent")}, 0 0 22px -6px ${role("accent")}` };
    default:
      return {};
  }
}

/**
 * The `cards` dial, as a scoped restyle of every MUI surface below the wrapper.
 *
 * `"theme"` returns nothing at all, which is the whole point of the value:
 * inactive (or explicitly theme-led) means the wrapper does not touch panels
 * and each keeps whatever the theme gave it. Anything else is the wrapper
 * having an opinion, and it says so by restyling `.MuiPaper-root` — the one
 * class every card, accordion and panel in this app resolves to.
 *
 * Portalled surfaces (menus, dialogs, tooltips) render outside this element by
 * construction, so they are untouched — which is right: a wrapper dresses the
 * screen it frames, not the overlays the shell raises above it.
 */
function cardStyle(values: DashValues): Record<string, unknown> {
  const kind = String(values.cards);
  if (kind === "theme") return {};
  const radius = `${Number(values.cardRadius)}px`;
  const pad = `${Number(values.cardPad)}px`;
  const common = { borderRadius: radius, "--axd-card-radius": radius, "--axd-card-pad": pad };

  switch (kind) {
    case "flat":
      return {
        "& .MuiPaper-root": {
          ...common,
          backgroundImage: "none",
          background: role("panel"),
          border: "none",
          boxShadow: "none"
        }
      };
    case "outlined":
      return {
        "& .MuiPaper-root": {
          ...common,
          backgroundImage: "none",
          background: role("panel"),
          border: `var(--axf-border) solid ${role("edge")}`,
          boxShadow: "none"
        }
      };
    case "raised":
      return {
        "& .MuiPaper-root": {
          ...common,
          backgroundImage: "none",
          background: role("panel2"),
          border: "none",
          boxShadow: "0 6px 18px rgba(0,0,0,.34)"
        }
      };
    case "glass":
      return {
        "& .MuiPaper-root": {
          ...common,
          backgroundImage: "none",
          background: `color-mix(in srgb, ${role("panel2")} 68%, transparent)`,
          backdropFilter: "blur(10px)",
          border: `1px solid color-mix(in srgb, ${role("edge")} 70%, transparent)`,
          boxShadow: "0 10px 30px rgba(0,0,0,.30)"
        }
      };
    default:
      return {};
  }
}

/* ------------------------------------------------------------- the render */

/**
 * A plain function, DELIBERATELY not a component — the P8 reconciliation
 * contract `amberx-console.tsx` records at length. Hooks stay legal by living
 * in the leaf components (`Clock`), never here.
 */
function specChrome(spec: DashboardSpec, ctx: DashboardCtx): React.ReactNode {
  const values = resolveDash(spec);
  const scrollWrapper = values.scroll === "wrapper";
  const pad = Number(values.screenPad);
  const max = String(values.screenMax);
  const align = String(values.screenAlign);

  return (
    <Box
      data-axd-spec={spec.id}
      // The dials, published as variables on this element — for anything below
      // that wants the wrapper's opinion rather than the theme's.
      style={publishedVars(values)}
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        background: surface(String(values.surface), Number(values.tint)),
        ...cardStyle(values)
      }}
    >
      <Band where="head" spec={spec} ctx={ctx} values={values} />

      {/* The screen. `key="screen"` and the same Box type every wrapper uses —
          the shared-skeleton contract that keeps a wrapper swap a morph rather
          than a remount, so the screen's state survives it. */}
      <Box
        key="screen"
        sx={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          overflow: scrollWrapper ? "visible" : "auto",
          p: pad ? `${pad}px` : 0,
          alignItems: max === "none" ? "stretch" : ALIGN[align] ?? "center"
        }}
      >
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            width: "100%",
            maxWidth: max === "none" ? "none" : max,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            ...frameStyle(values),
            ...seamStyle(values)
          }}
        >
          {ctx.children}
        </Box>
      </Box>

      <Band where="foot" spec={spec} ctx={ctx} values={values} />
    </Box>
  );
}

const ALIGN: Record<string, string> = { start: "flex-start", center: "center", end: "flex-end" };

/**
 * Every dial as its declared custom property.
 *
 * From `DASH_DIALS` rather than a hand-kept list, so a dial added to the spec
 * publishes the day it is added — the property `theme/apply.ts` has and the
 * reason a designer can never drift from the engine.
 */
function publishedVars(values: DashValues): React.CSSProperties {
  const out: Record<string, string> = {};
  for (const dial of DASH_DIALS) {
    const value = values[dial.id];
    out[dial.cssVar] =
      dial.kind === "number"
        ? `${value}${dial.unit === "em/100" ? "" : dial.unit}`
        : String(value);
  }
  return out as React.CSSProperties;
}

/**
 * A stored record → a registered wrapper.
 *
 * Goes through `defineDashboard`, so an authored wrapper meets exactly the
 * contract a hand-written one does — an editor is not a licence to register an
 * asset the chokepoint would refuse.
 */
export function dashboardFromSpec(spec: DashboardSpec): Dashboard {
  return defineDashboard({
    id: spec.id,
    title: spec.title,
    description: spec.description,
    render: (ctx) => specChrome(spec, ctx)
  });
}
