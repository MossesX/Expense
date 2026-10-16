/**
 * @file `<DashboardChrome>` — renders whichever dashboard wrapper resolves,
 * around the host's children.
 *
 * The host mounts this once around its content area and supplies nothing
 * else: the wrapper is resolved from the registry at render time, so a
 * wrapper registered later appears in the running app with no edit here, and
 * a stored id that stopped resolving falls back to the default **with a
 * visible report** — the substitution strip below names what was asked for
 * and what was rendered instead, because a silent fallback is a lost
 * preference nobody notices until the chrome "looks wrong".
 *
 * What this deliberately does NOT do: publish theme variables (the
 * one-publisher rule — `AxfStyleRoot` owns `:root`), mount crash boundaries
 * or the banner or `NavShell` (those are `AppShell`'s, OUTSIDE the wrapper,
 * so no wrapper can drop them by forgetting to render them).
 *
 * **MUI (2026-08-10).** The substitution notice is an `Alert` — it is exactly
 * an alert, so it is one. `icon={false}` and the compact `sx` keep it the thin
 * strip it has always been rather than the three-line block Alert defaults to;
 * the point of the strip is to be noticed without taking the top of the screen
 * away from the app it is reporting on.
 *
 * The wrapper `Box` keeps `display: contents` — it exists only to carry the
 * `data-axf-dashboard` probe attribute and must not introduce a box into the
 * layout, or every wrapper's geometry shifts under it.
 */
"use client";

import * as React from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";

import { token } from "../theme/apply";
import { useAppliedThemeValues } from "../theme/ThemeBridge";
import { dashboards } from "./registry";

/** Subscribe to the dashboard registry. */
export function useDashboards() {
  return React.useSyncExternalStore(dashboards.subscribe, dashboards.snapshot, dashboards.snapshot);
}

export function DashboardChrome({ children }: { children: React.ReactNode }) {
  const snapshot = useDashboards();
  /*
   * Which wrapper draws the shell is a THEME decision (the `dashboard` chrome
   * dial), exactly as `bannerBar` and `navMenu` already are — so a saved look
   * restores the wrapper it was designed around and the designer's Dashboard
   * tab previews one live. The registry's own resolution is the FLOOR: an
   * empty dial or an id nothing registered falls through to it, so a stale
   * selection degrades to the default wrapper and never to a blank shell.
   *
   * `useAppliedThemeValues`, not `useTheme().values`: the wrapper decides the
   * MARKUP, so the server and the hydrating client must resolve it from the
   * same applied theme (the cookie) or the whole chrome swaps after hydration.
   */
  const applied = useAppliedThemeValues();
  const dialled = String(applied.dashboard ?? "").trim();
  const fromTheme = dialled ? snapshot.all.find((d) => d.id === dialled) ?? null : null;

  const base = snapshot.resolution;
  // A dialled id that resolved wins outright. One that did NOT resolve is a
  // substitution and is reported as one — the same contract rule 4 the
  // registry holds for its own stored id, applied to the theme's.
  const { dashboard, substituted, requestedId } = fromTheme
    ? { dashboard: fromTheme, substituted: false, requestedId: dialled }
    : dialled
      ? { dashboard: base.dashboard, substituted: Boolean(base.dashboard), requestedId: dialled }
      : base;

  // Read after mount so server and first client paint agree.
  const [pathname, setPathname] = React.useState("");
  React.useEffect(() => {
    const read = () => setPathname(window.location.pathname);
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  // Nothing registered at all: the content still renders. A wrapper is
  // chrome, and missing chrome must never take the screen down with it.
  if (!dashboard) return <>{children}</>;

  return (
    <>
      {substituted && (
        <Alert
          severity="warning"
          variant="outlined"
          icon={false}
          data-axf-dashboard-substituted={requestedId ?? ""}
          sx={{
            py: "3px",
            px: "10px",
            fontFamily: token("mono"),
            fontSize: 10.5,
            color: token("warn"),
            border: 0,
            borderBottom: `1px solid ${token("edge")}`,
            borderRadius: 0,
            "& .MuiAlert-message": { p: 0, overflow: "visible" }
          }}
        >
          dashboard &quot;{requestedId}&quot; is not registered — showing &quot;{dashboard.id}&quot;
        </Alert>
      )}
      <Box data-axf-dashboard={dashboard.id} sx={{ display: "contents" }}>
        {dashboard.render({ children, pathname })}
      </Box>
    </>
  );
}
