/**
 * @file The `dashboard` asset kind — a shell WRAPPER, nothing more.
 *
 * Owner directive, 2026-08-07: "the dashboard is simply a wrapper ui, it
 * means nothing." It is the chrome around the screen — where navigation-ish
 * furniture sits, where the content area is, how the frame is presented. It
 * owns presentation and nothing else. (This is what INITIATION-PROMPT.md §4
 * called `ui-wrapper`; one name is adopted — `dashboard` — and the other
 * dropped, so two kinds never mean one thing.)
 *
 * The contract, ported from GizmoX's shell-wrapper registry (the contract,
 * not the file):
 *
 *   1. **The host owns every piece of state and behaviour** — rosters, docks,
 *      search, the clock. None of it is a wrapper's business.
 *   2. **A wrapper receives a fully-resolved {@link DashboardCtx}** — plain
 *      data and callbacks, already filtered — and returns the chrome around
 *      `ctx.children`. It renders no state of its own beyond presentation.
 *   3. **Registering makes it selectable** — options are resolved from the
 *      registry at render time, so a wrapper contributed later appears with
 *      no edit anywhere.
 *   4. **The resolver falls back rather than throws** — a stored id naming a
 *      wrapper that no longer exists resolves to the default and REPORTS the
 *      substitution, never an app with no chrome at all.
 *   5. **Anything that must exist regardless of chrome mounts OUTSIDE it** —
 *      the style root, the crash boundaries, the banner and `NavShell` are
 *      `AppShell`'s, so a wrapper cannot drop them by forgetting them.
 *
 * And what it must NOT own: no regions array, no cards block, no palette
 * field, and **no `ThemeScope` around the app** — colour, type, shape and
 * density stay the theme engine's, published once on `:root` by
 * `AxfStyleRoot` (the one-publisher rule). A wrapper that wants a different
 * look ships a theme layer alongside itself and lets the store activate it.
 */
import type { ReactNode } from "react";

/**
 * Everything a wrapper needs, fully resolved by the host. Deliberately small:
 * a first draft of this kind grew theme layers, dials, extension points and a
 * region tree, and was rejected as over-built. It grows a field when a real
 * host has real data to pass — never speculatively.
 */
export interface DashboardCtx {
  /** The screen. A wrapper arranges chrome around this and returns it. */
  readonly children: ReactNode;
  /** The path the host is rendering for. */
  readonly pathname: string;
}

export interface DashboardAsset {
  readonly id: string;
  readonly title: string;
  /** One line for a picker — what this chrome actually looks like. */
  readonly description: string;
  /** Chrome around `ctx.children`. Presentation only. */
  readonly render: (ctx: DashboardCtx) => ReactNode;
}

declare const DASHBOARD_BRAND: unique symbol;
export type Dashboard = DashboardAsset & { readonly [DASHBOARD_BRAND]: true };

export class DashboardDefinitionError extends Error {}

/** The chokepoint. Every dashboard wrapper passes through here. */
export function defineDashboard(spec: DashboardAsset): Dashboard {
  if (!/^[a-z][a-z0-9-]*$/.test(spec.id)) {
    throw new DashboardDefinitionError(`dashboard id "${spec.id}" must be lower-kebab`);
  }
  if (!spec.title.trim()) {
    throw new DashboardDefinitionError(`dashboard "${spec.id}" requires a title`);
  }
  if (!spec.description.trim()) {
    throw new DashboardDefinitionError(
      `dashboard "${spec.id}" requires a description — a picker has to describe it without rendering it`
    );
  }
  if (typeof spec.render !== "function") {
    throw new DashboardDefinitionError(`dashboard "${spec.id}" requires a render function`);
  }
  return spec as Dashboard;
}
