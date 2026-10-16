/**
 * @file Dashboard barrel — the `dashboard` asset kind, re-exported through
 * `@axf/core`.
 *
 * A dashboard is a shell WRAPPER: chrome around `ctx.children`, registered
 * and swappable like every other asset, presentation and nothing else. The
 * resolver falls back to the default and reports rather than throwing —
 * a stale stored id must never leave the app with no chrome.
 */
export { defineDashboard, DashboardDefinitionError } from "./types";
export type { Dashboard, DashboardAsset, DashboardCtx } from "./types";

/**
 * The AUTHORABLE half (2026-08-12). A wrapper used to be a `render` function
 * and therefore code-only; `DashboardSpec` is the same asset as a serialisable
 * record, with its own dial spec and its own seeded generator, and
 * `dashboardFromSpec` is the one interpreter that turns a record back into a
 * registered wrapper.
 */
export {
  DASH_DIALS,
  DASH_DIALS_BY_ID,
  DashboardSpecError,
  dashDialsBySubsystem,
  dashName,
  defaultDashValues,
  defineDashboardSpec,
  emptyDashboardSpec,
  inheritedTheme,
  resolveDash,
  rollDash
} from "./spec";
export type {
  DashDial,
  DashEnumDial,
  DashNumberDial,
  DashSubsystem,
  DashValues,
  DashboardSpec
} from "./spec";

export { dashboardFromSpec } from "./Wrapper";

export { DashboardRegistry, dashboards } from "./registry";
export type { DashboardResolution, DashboardSnapshot } from "./registry";

export { DashboardChrome, useDashboards } from "./Dashboard";
