/**
 * @file The admin suite's COMPOSITION SEAM, rendered — the registry half of
 * `accounts.admin-tab` (see `./adminTabs` for why that is a point and not an
 * import).
 *
 * ## What changed when the suite grew (P4)
 *
 * This file used to BE the tab strip: an "Overview" tab holding `AdminPane` +
 * `PermissionMatrix`, and a tab per contribution. The suite now owns the strip
 * (`./AdminPane`), so this file's job narrowed to the one thing it exists for —
 * turning contributions into tabs and handing them over.
 *
 * That is deliberately not a nested strip. Two strips would mean a contributed
 * wing lives one level deeper than Users and Policies do, which is exactly the
 * "second-class annex" arrangement a contribution point exists to avoid: a
 * moderation queue contributed by another module sits ON the suite's strip,
 * beside Matrix, indistinguishable from a tab the suite wrote itself.
 *
 * Two properties this file keeps true:
 *
 * - **The gate is the suite's, once.** `AccountsModule` renders the suite only
 *   for `permissions.administrator`, so a contributed pane inherits the gate
 *   rather than restating it. (Its ROUTES still gate themselves — a hidden tab
 *   is not a security boundary, the same way a hidden nav row never was.)
 * - **A contributed pane cannot take the suite down with it.** Each mounts
 *   inside core's `Boundary`, so a wing that throws loses its own tab and
 *   nothing else — the administrator can still reach the users table, which is
 *   the surface they need most when something is broken.
 */
"use client";

import * as React from "react";

import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";

import { Boundary, token } from "@axf/core";

import AdminPane, { type SuiteExtraTab } from "./AdminPane";
import { ADMIN_TAB_POINT, useContributedAdminTabs } from "./adminTabs";

export default function AdminSurface() {
  const contributed = useContributedAdminTabs();

  const extras = React.useMemo<SuiteExtraTab[]>(
    () =>
      contributed.map((c) => ({
        id: c.id,
        title: c.title,
        glyph: c.glyph,
        // A thunk, not an element: the pane is `React.lazy`, so building it here
        // would start the chunk fetch for every contributed tab the moment the
        // suite mounts rather than when its tab is chosen.
        render: () => (
          <Box sx={{ minHeight: 0 }}>
            {c.summary && (
              <Typography sx={{ fontSize: 11.5, color: token("dim"), mb: 1.25 }}>
                {c.summary} · contributed by <code>{c.from}</code>
              </Typography>
            )}
            <Boundary tier="contribution" source={`${c.from} → ${ADMIN_TAB_POINT}`}>
              <React.Suspense fallback={<CircularProgress size={20} />}>
                <c.Pane />
              </React.Suspense>
            </Boundary>
          </Box>
        ),
      })),
    [contributed],
  );

  return <AdminPane extraTabs={extras} />;
}
