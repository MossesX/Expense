/**
 * @file `AxfStyleRoot` — the ONE publisher of `:root` custom properties.
 *
 * Properties are written imperatively rather than as a `<style>` tag, so a
 * change mutates existing custom properties instead of swapping a stylesheet —
 * the difference between the colours transitioning and the page flashing
 * through unstyled.
 *
 * **This file used to contain the bug it now prevents.** `ThemeBridge` and
 * `StylePublisher` each wrote `--axf-ink`, `--axf-page` and the brand roles
 * from their own effect. Which won depended on which effect ran last: roll a
 * theme and it showed, reload and the pack won — the same state producing
 * different pixels depending on interaction history. The old docblock claimed
 * mounting them together fixed the order, which was true of MOUNT order and
 * said nothing about UPDATE order.
 *
 * Two independent writers of one custom property is the defect. Re-ordering
 * them only moves it. So there is one writer, and `resolveVariables` states the
 * precedence explicitly.
 */
"use client";

import * as React from "react";

import { THEME_KEY, THEME_VARS_KEY, themeSignature } from "./boot";
import type { CachedVariables } from "./boot";
import { PACKS_KEY } from "../brand/packs";
import { resolveVariables } from "./resolve";
import { theme as themeStore } from "./store";
import type { ThemeState } from "./store";
import { packs } from "../brand/packs";
import { useResolvedStyle } from "../brand/Glyph";
import { applyVariables, clearVariables } from "./publish";
import type { PublishHandle } from "./publish";

/**
 * Cache what was just published, for the next document's `<head>` script.
 *
 * The variables are the expensive part of a theme — seed through generator,
 * spec, derivations and the active pack — and the pre-paint script cannot run
 * any of that. So the publisher leaves its answer behind, stamped with the
 * theme it answered FOR, and the script replays it before the first paint
 * instead of the page flashing the default palette. See `theme/boot.ts`.
 *
 * Failure is silent and harmless in both directions: no cache means a default
 * first paint corrected on hydration, which is exactly what happened before.
 */
function cacheForNextBoot(vars: Readonly<Record<string, string>>): void {
  try {
    // The signature must cover the pack selection as well as the dials, because
    // the variables were resolved from BOTH. `themeStore.signature()` knows only
    // the dials, so the pack half is read from storage here — deliberately the
    // same raw JSON the boot script reads, rather than the registry's in-memory
    // state, so the two sides cannot agree in memory and disagree on disk. That
    // is the invariant `themeSignature`'s docblock states, extended to the pack.
    const rawPacks = window.localStorage.getItem(PACKS_KEY);
    const sig = themeSignature(
      JSON.parse(window.localStorage.getItem(THEME_KEY) ?? "null"),
      rawPacks ? JSON.parse(rawPacks) : undefined
    );
    const payload: CachedVariables = { sig, vars };
    window.localStorage.setItem(THEME_VARS_KEY, JSON.stringify(payload));
  } catch {
    /* private mode, storage full, sandboxed iframe — the theme still applies */
  }
}

/**
 * The applied theme as the SERVER read it, for the first render on both sides.
 *
 * ## Why a context and not `ThemeStore.serverState()`
 *
 * `serverState()` is a singleton method, and on the server a singleton is shared
 * by every concurrent request. Putting one visitor's theme in it would serve it
 * to the next visitor — a data leak in the shape of a palette. A context is
 * per-render by construction, which is the property needed.
 *
 * ## Why this is not a hydration risk
 *
 * The value travels in the RSC payload, so the hydrating client render reads the
 * SAME object the server rendered from. That is the entire hydration contract:
 * both sides must agree, not both sides must be default. Defaults were never the
 * requirement — they were the only thing the server could know before the cookie
 * mirror existed.
 *
 * Null when there is no cookie (a first visit), and then everything behaves
 * exactly as it did before: default first paint, corrected after hydration.
 */
const HydrationValues = React.createContext<ThemeState["values"] | null>(null);

/** Provide the server-read theme. Mounted by the app's root layout. */
export function AxfHydrationTheme({
  values,
  children
}: {
  values: ThemeState["values"] | null;
  children: React.ReactNode;
}) {
  return <HydrationValues.Provider value={values}>{children}</HydrationValues.Provider>;
}

/** The server-read theme, or null on a first visit. */
export function useHydrationValues(): ThemeState["values"] | null {
  return React.useContext(HydrationValues);
}

/**
 * Subscribe to the active theme.
 *
 * The third argument is `serverState`, not `state`, and that is the whole fix
 * for the app-wide hydration failure — see the docblock on `ThemeStore.
 * serverState`. React uses it for the server render and for the hydrating
 * client render, so both produce identical markup; the persisted theme lands
 * one commit later as an ordinary update. Passing `state` here (what this used
 * to do) meant hydration read `localStorage`, disagreed with the server, and
 * React discarded the server tree on every route.
 */
export function useTheme(): ThemeState {
  return React.useSyncExternalStore(
    themeStore.subscribe,
    themeStore.state,
    themeStore.serverState
  );
}

/**
 * The APPLIED theme values, correct on the first paint of both runtimes.
 *
 * `useTheme().values` is the DEFAULTS during the server render and the
 * hydrating client render, by design. That is right for surfaces whose markup
 * is theme-independent (they read `var(--axf-*)`), and wrong for the ones
 * whose MARKUP depends on a dial — which chrome asset renders, which items a
 * menu has. Those need the value the server actually knew: the cookie-borne
 * theme `AxfHydrationTheme` provides.
 *
 * Same adoption pattern as `AxfMuiRoot`: hydration values first (both sides
 * agree byte for byte, on the APPLIED theme), then the live store values in a
 * layout effect — flushed before paint, so a stored value never flashes in
 * late. Falls back to the defaults on a first visit, where there is nothing
 * else to know.
 */
export function useAppliedThemeValues(): ThemeState["values"] {
  const { values } = useTheme();
  const hydration = useHydrationValues();
  const [adopted, setAdopted] = React.useState<ThemeState["values"]>(
    () => hydration ?? values
  );
  React.useLayoutEffect(() => {
    const live = themeStore.state().values;
    setAdopted((current) => (current === live ? current : live));
  }, [values]);
  return adopted;
}

/** Mount once, at the app root. */
export function AxfStyleRoot() {
  const theme = useTheme();
  const style = useResolvedStyle();

  const vars = React.useMemo(
    () => resolveVariables(theme.values, { variables: style.variables }),
    [theme.values, style.variables]
  );

  // Same diff-based writer `ThemeScope` uses. Two publishing paths that behave
  // differently is how one of them quietly gets a bug the other does not.
  const handle = React.useRef<PublishHandle>({});

  /**
   * Publish the LIVE theme and the LIVE pack — never the hydration snapshot.
   *
   * `useTheme` and `useResolvedStyle` both report their SERVER snapshot during
   * the hydrating render, deliberately, so the markup matches. Publishing
   * `vars` (memoised from those snapshots) meant this effect wrote the DEFAULT
   * pack's variables over the correct ones the boot script had already put on
   * `documentElement` before paint — and the real pack then landed a commit
   * later. That is the flash the owner reported on 2026-08-10, reproducible by
   * choosing any pack other than the app default: with the default selected the
   * snapshot happens to be right, so nothing visibly moves and the bug hides.
   *
   * The boot cache could not catch it either: `themeSignature` did not include
   * the styleId until the same day, so "same dials, different pack" was
   * indistinguishable from "same everything".
   *
   * Reading the stores directly here is the fix and costs nothing: by the time
   * a layout effect runs, both stores hold the real values, and a layout effect
   * is flushed before the browser paints. `vars` stays as the dependency — it
   * changes whenever either snapshot does, which is exactly when this must
   * re-run (a roll, a pack swap, or the post-hydration correction).
   */
  React.useLayoutEffect(() => {
    const liveStyle = packs.resolved();
    const liveVars = resolveVariables(themeStore.state().values, {
      variables: liveStyle.variables
    });
    handle.current = applyVariables(document.documentElement, liveVars, handle.current);
    cacheForNextBoot(liveVars);
  }, [vars]);

  React.useEffect(
    () => () => {
      // Clear AND reset the handle. Under StrictMode's dev double-mount this
      // cleanup runs between the two mounts: without the reset, the remounted
      // layout effect diffs the same `vars` against a handle that still claims
      // everything is written and publishes NOTHING — the app boots on the SSR
      // default block and only heals when a value actually changes. Caught by
      // the P8 boot probe (page #0e1013 where the artifact look was active).
      clearVariables(document.documentElement, handle.current);
      handle.current = {};
    },
    []
  );

  return null;
}

/**
 * @deprecated Mount `<AxfStyleRoot>`, which is the only publisher.
 *
 * Kept as a no-op rather than deleted: an app that still mounts this would
 * otherwise start a second writer, which is precisely the defect above.
 */
export function ThemeBridge() {
  return null;
}
