"use client";

/**
 * @file **Reset appearance** — one function, because a partial reset is the bug.
 *
 * Owner, 2026-08-12: *"theme designer not showing up in nav / reset theme and
 * layouts"*. Those two halves are the same incident. `navStyle` is a rolled
 * LAYOUT dial whose options include `rail` — an icon-only nav with no labels —
 * and `navPlacement` can move the menu to any edge. So a roll can genuinely
 * make a screen "not show up in the nav" without anything being broken, and the
 * way out is to put the appearance back.
 *
 * ## Why this is one function and not three buttons
 *
 * Appearance persists in FOUR places, and a reset that misses one is worse than
 * no reset at all: the user clicks it, the app half-changes, and they conclude
 * the feature does not work rather than that they missed a step. The full
 * inventory, which is the whole value of this file:
 *
 *   1. `axf:theme@1` (localStorage) — seed, roll options and hand edits,
 *      including the `bannerBar` / `navMenu` chrome dials.
 *   2. `axf_theme` (cookie) — the SERVER's copy, which is what paints the first
 *      frame. Cleared by the same `#persist()` the store runs, so it cannot
 *      drift from (1) — that is why this goes through `theme.reset()` rather
 *      than deleting the key.
 *   3. `axf:theme-vars@1` — the pre-paint variable cache the boot script
 *      replays. Signature-stamped, so a stale one is refused rather than
 *      misapplied, but clearing it removes the question entirely.
 *   4. `axs:dashboard@1` — the dashboard's card placement. This is the
 *      "layouts" half of the ask, and it is studio state rather than theme
 *      state, which is exactly why the reset lives here and not in core.
 *
 * ## What it deliberately does NOT touch
 *
 *   - **Saved looks** (the shelf, in the kv store). They are authored work. A
 *     reset undoes the appearance in force, not the library you built.
 *   - **Custom chrome assets** (`chrome-assets.json`). Same argument: the dials
 *     that SELECT a custom bar or nav are cleared, so the app returns to the
 *     default chrome, but the assets themselves survive to be re-selected.
 *   - **The branding pack.** Branding is a fixed app setting picked at
 *     `/settings`, never rolled and never part of a theme (owner, 2026-08-12:
 *     *"branding is just that — its not negotiable, its global and does not
 *     change"*). Resetting the theme must not silently change the identity.
 */

import { THEME_VARS_KEY, theme as themeStore } from "@axf/core";

/** The dashboard's card placement, mirrored from `DashboardModule`. */
export const DASHBOARD_KEY = "axs:dashboard@1";

export interface ResetReport {
  /** Storage keys actually cleared, for the surface to report honestly. */
  readonly cleared: readonly string[];
  /** True when a reload is needed for every surface to agree. */
  readonly reloadRecommended: boolean;
}

/**
 * Put the theme and the layouts back to what the app ships with.
 *
 * Returns what it did rather than nothing: the surface says "reset — cleared 3
 * of 4" instead of a green tick that means nothing, and a storage write that
 * silently failed (private mode, quota) is visible instead of invented.
 */
export function resetAppearance(): ResetReport {
  const cleared: string[] = [];

  /*
   * The theme goes through the STORE, not through storage. The store owns the
   * localStorage doc and the cookie mirror together, and writing them from two
   * places is how they drift — which shows up as a cold load painting the old
   * theme and the app correcting it a frame later.
   *
   * If a preview is in force (the designer is open), it has to end first:
   * `#persist()` refuses while previewing, so a reset issued from the designer
   * would repaint and then come back on the next reload. `endPreview()`
   * restores the applied theme, and the reset then applies and persists over
   * it.
   */
  if (themeStore.previewing()) themeStore.endPreview();
  themeStore.reset();
  cleared.push("theme (seed, roll options, dial edits, chrome selection)");

  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(THEME_VARS_KEY);
      cleared.push("pre-paint variable cache");
    } catch {
      /* private mode — the cache is an optimisation, its absence costs a frame */
    }
    try {
      window.localStorage.removeItem(DASHBOARD_KEY);
      cleared.push("dashboard layout");
    } catch {
      /* same */
    }
  }

  return { cleared, reloadRecommended: true };
}
