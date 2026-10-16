/**
 * @file `AxfMuiRoot` — the ONE MUI provider, and the sibling of `AxfStyleRoot`.
 *
 * The pairing is the design. `AxfStyleRoot` publishes the theme as custom
 * properties for `token()` surfaces; this publishes the SAME theme as an MUI
 * `Theme` for MUI surfaces. One store, one set of dial values, two renderings —
 * which is why an MUI `<Paper>` and a hand-built card can sit side by side and
 * agree, rather than agreeing today and drifting at the first roll.
 *
 * Mounted by `AppShell`, for the reason every other piece of chrome moved there
 * on 2026-08-08: chrome each surface has to remember is chrome that is missing
 * somewhere. A route does not opt in to being themed, and cannot forget to.
 *
 * ## Why the memo dependency is `theme.values` and not the store
 *
 * `useTheme()` returns a snapshot that `ThemeStore` caches and invalidates on
 * change, so `values` is referentially stable between rolls and referentially
 * NEW after one. That is exactly the memo key wanted: `createTheme` runs once
 * per theme rather than once per render, and it does run again the moment a
 * dial moves. Subscribing to the store here instead would have rebuilt the
 * theme on every notification, including ones that changed no dial.
 *
 * It also means the hydration contract is inherited rather than re-implemented:
 * `useTheme` reads through `ThemeStore.serverState()`, so the server render and
 * the hydrating client render build the theme from the DEFAULT values and agree
 * by construction; the persisted theme lands one commit later as an ordinary
 * update. See the docblock on `ThemeStore.serverState`.
 *
 * ## Why that correction has to happen in a LAYOUT effect
 *
 * "One commit later as an ordinary update" is safe for markup and wrong for
 * paint. An ordinary update is passive: the browser is free to paint the
 * default-themed tree before React applies the persisted one, so every MUI
 * surface showed the DEFAULT palette for a beat and then snapped to the real
 * theme — reported by the owner on 2026-08-10 as "a different theme loads for
 * 1 second every time I switch pages", and on every page switch because the nav
 * navigates with `window.location.assign` (a full document load, not a client
 * transition).
 *
 * It was only MUI that flashed, which is what made it confusing: `AxfStyleRoot`
 * publishes the custom properties in a `useLayoutEffect`, so `token()` surfaces
 * are already correct at first paint. This is the same fix, for the renderer
 * that resolves its values in JS instead of reading them from CSS — adopt the
 * live values in a layout effect, which React flushes synchronously BEFORE the
 * browser paints.
 *
 * The store is read directly rather than through `useTheme()`: at the moment
 * this effect runs, the hook is still reporting the server snapshot by design,
 * and that is precisely the value that must not be painted.
 *
 * This is NOT a hydration risk. The hydrating render still uses the defaults
 * and still matches the server byte for byte; the adoption is an ordinary
 * post-hydration re-render that happens to be flushed before paint.
 *
 * Deliberately NOT fixed by moving MUI onto `cssVariables` mode: `mui.ts`
 * rejected that with its reasons (MUI runs `alpha()`/`darken()`/
 * `getContrastRatio()` over palette entries and needs real values), and one
 * flash is not grounds for reopening a decision made on correctness.
 *
 * ## No `CssBaseline`, deliberately
 *
 * MUI's `CssBaseline` injects a global reset. Two reasons it stays out:
 *
 *   1. `app/layout.tsx` already sets `body` margin, background, colour, family
 *      and size from the theme's own variables, and each of those lines exists
 *      because of a specific incident (the body-transition latch, most
 *      recently). A reset that re-declares them is a second writer of styling
 *      that has already been fought for once.
 *   2. GizmoX's cascade-layer trap was exactly this shape in reverse — an
 *      unlayered global rule beating every layered MUI rule regardless of
 *      specificity, and a `*` reset collapsing every TextField. A baseline
 *      belongs in a declared layer or nowhere, and "nowhere" costs this app
 *      nothing.
 */
"use client";

import * as React from "react";
import type { ReactNode } from "react";

import { ThemeProvider } from "@mui/material/styles";

import { muiThemeFrom } from "./mui";
import { theme as themeStore } from "./store";
import { useHydrationValues, useTheme } from "./ThemeBridge";

/** What the bridge builds the MUI theme FROM. Values only, since 2026-08-12:
 *  no pack may touch an `--axf-*` value any more (`resolve.ts`), so the MUI
 *  palette is a pure function of the dials and composing the pack layer here
 *  would be dead weight that implies a precedence that no longer exists. */
interface Adopted {
  readonly values: ReturnType<typeof themeStore.state>["values"];
}

export function AxfMuiRoot({ children }: { children: ReactNode }) {
  // Defaults during the server render and the hydrating client render, by
  // design — see "Why the memo dependency" above.
  const { values } = useTheme();

  /*
   * The applied theme as the server read it — see `AxfHydrationTheme`.
   *
   * This is what closes the last flash, and it is a different flash from the one
   * the layout effect below fixed. That one was "React painted the default tree
   * before the persisted theme landed", and a layout effect is early enough for
   * it. This one is EARLIER THAN REACT: the browser paints the SSR HTML as soon
   * as it parses it, and MUI's palette is already serialised into that HTML as
   * literal hex by emotion. Nothing running after hydration can be early enough,
   * because hydration is the thing being waited for — which is why the interval
   * the owner measured was ~1s rather than a frame.
   *
   * The boot script cannot help here either: it writes custom properties, and
   * `mui.ts` deliberately refused `cssVariables` mode. So the only remedy is for
   * the server to emit the right palette, which is what the cookie mirror is for.
   */
  const hydrationValues = useHydrationValues();

  // …and the live values before the first paint — see "Why that correction has
  // to happen in a LAYOUT effect" above. Both dependencies stay in the list so
  // a later roll OR a pack swap re-runs this and the adopted pair keeps
  // tracking the stores.
  const [adopted, setAdopted] = React.useState<Adopted>(() => ({
    // `hydrationValues` on both the server render and the hydrating client
    // render, so the two still agree byte for byte — they simply agree on the
    // APPLIED theme now instead of on the default one. Falls back to `values`
    // (the defaults) on a first visit, where there is no cookie to read and the
    // old behaviour is the only behaviour available.
    values: hydrationValues ?? values
  }));
  React.useLayoutEffect(() => {
    const liveValues = themeStore.state().values;
    setAdopted((current) => (current.values === liveValues ? current : { values: liveValues }));
  }, [values]);

  const mui = React.useMemo(() => muiThemeFrom(adopted.values), [adopted]);

  return <ThemeProvider theme={mui}>{children}</ThemeProvider>;
}
