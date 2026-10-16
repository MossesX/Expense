/**
 * @file `shell.strip` — the core's own extension point for a full-width band at
 * the very top of the app, above the banner.
 *
 * ── why this is a POINT and not a component ───────────────────────────────────
 *
 * The tab bar imported from GizmoX (2026-08-13) is the first plugin that extends
 * the FRAMEWORK rather than a module: it has no route, it belongs to no screen,
 * and it must be present on every route including the ones no module hosts. The
 * three homes core already had were each wrong for it:
 *
 *   - a MODULE point (`ModuleDecl.points`) — the bar is not inside any module,
 *     and hanging it off one would make it disappear on every other route;
 *   - a `SurfaceRegistry` (toolbars, navs, dashboards) — those hold many
 *     candidates and ONE active per surface, and strips do not displace each
 *     other. Two plugins may each want a band;
 *   - an import in `AppShell` — which is the thing this whole package exists to
 *     stop. The shell would then know the bar's name, and "disable the plugin"
 *     would mean editing the shell.
 *
 * So it is a core-owned point, declared through `Registry.declarePoint` the way
 * `ctx.item` is (`registry.ts` states the case for that method). The shell knows
 * only "some plugin registered a band", which is what makes the bar removable by
 * dropping one contribution and nothing else.
 *
 * ── the contract ──────────────────────────────────────────────────────────────
 *
 * A strip renders in the app's TOP FLOW ROW, before the banner. It owns its own
 * height and must claim only what it needs: everything below it — the banner,
 * the nav, the module — is pushed down by whatever it draws. That is the whole
 * reason a peeking bar overlays instead (`position: absolute` inside the strip's
 * own relative box) rather than being drawn taller: a band that takes 40px of
 * every screen to show something the reader is not looking at is a band that
 * gets disabled.
 *
 * Ordering is by priority, descending, so a second strip lands under the first
 * predictably rather than in registration order.
 */
import type { ReactNode } from "react";

import type { ExtensionPoint } from "../points";
import { registry } from "../registry";
import type { Registry } from "../registry";

export const SHELL_STRIP_POINT = "shell.strip";

/** What a `shell.strip` contribution provides. */
export interface ShellStripPayload {
  /** Stable id, for diagnostics and for the manager that lists strips. */
  readonly id: string;
  /** Human title — what a plugin manager or an inspector calls this band. */
  readonly title: string;
  /** The band. Rendered inside a contribution-tier boundary, so a throw here
   *  takes out this strip and nothing else. */
  readonly render: () => ReactNode;
}

export const SHELL_STRIP_POINT_DEF: ExtensionPoint = {
  id: SHELL_STRIP_POINT,
  title: "Shell strip",
  description:
    "A full-width band across the very top of the app, above the banner, on every route. " +
    "Contributions supply an id, a title and a render; the shell decides only that it goes " +
    "first, never what it contains.",
  kind: "ui-surface",
  cardinality: "many",
  requires: ["id", "title", "render"],
  ordering: "priority"
};

/**
 * Declare the point into a registry, idempotently.
 *
 * Idempotent for the same reason `declareClaudePoints` is: `declarePoint` throws
 * on a re-declaration (correctly — two owners for one point id is a real bug),
 * and this is ONE owner reached from two entry paths, a host's `start()` and a
 * dev-server re-evaluation. An existence check is the honest guard; swallowing
 * the throw would also swallow the real conflict.
 */
export function declareShellStripPoint(target: Registry = registry): void {
  if (target.points().some((p) => p.id === SHELL_STRIP_POINT)) return;
  target.declarePoint(SHELL_STRIP_POINT_DEF);
}
