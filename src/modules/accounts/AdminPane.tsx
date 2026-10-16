/**
 * @file **THE ADMIN SUITE** — the administrator's whole surface, as one tab
 * strip over split panes: Dashboard · Users · Files · Policies · Storage ·
 * Audit · Matrix, plus whatever other modules contribute through
 * `accounts.admin-tab` (see `./AdminSurface`, which is the seam and hands its
 * tabs in here).
 *
 * ## What this file used to be, and what replaced it
 *
 * The administrator OVERVIEW lived here — headline counts, who is online, a
 * per-account thread/storage table, and the one destructive control the
 * directory deliberately does not carry: **remove a user's stored data**. It
 * stayed as the Dashboard tab's content until something genuinely replaced it,
 * because deleting a working surface to make room for one that does not exist
 * yet is how a build loses a feature between two green typechecks.
 *
 * P9 is that replacement: `./AdminDashboard`, a card canvas on P6's dock
 * engine. Nothing was dropped in the move — the counts and the online roster
 * are cards, the per-account table became the top-consumers card reading P1's
 * ledger rather than thread sizes, and the destructive control moved to
 * `./RemoveDataDialog`, fired from the Storage card. That dialog is the ONLY
 * caller of `remove-user-data` in the studio, which is exactly why it went to
 * a file of its own before this tab changed shape underneath it.
 *
 * ## Why one strip and not a screen per concern
 *
 * The suite is the answer to "why can this person not do the thing they say
 * they cannot do", and that answer lives in three stores at once — the account
 * row, the policy cascade, and the permission matrix. Tabs keep them one click
 * apart and one gate deep. A second admin console with its own nav entry and
 * its own idea of what "administrator" means is the outcome this module has
 * been avoiding since the composition seam was written.
 *
 * ## The gate is the suite's, once
 *
 * `AccountsModule` renders this only for `permissions.administrator`. Nothing
 * below re-states the gate, and nothing below IS the gate — every route these
 * tabs call re-reads the administrator role from disk per request, because a
 * hidden tab is not a security boundary any more than a hidden nav row was.
 *
 * ## Every tab is now a real surface
 *
 * Files, Storage and Audit were named frames until P5 filled them; the strip's
 * shape was settled first precisely so a contributed tab could not land in a gap
 * that was going to be somebody's. Each is its own file, and each holds its own
 * state — this file composes the strip and owns nothing but which tab is on.
 */
"use client";

import * as React from "react";

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";

import { Glyph, token } from "@axf/core";

import { onAccountsCtx } from "./accounts.commands";
import AdminAuditTab from "./AdminAuditTab";
import AdminDashboard from "./AdminDashboard";
import AdminFilesTab from "./AdminFilesTab";
import AdminPoliciesTab from "./AdminPoliciesTab";
import AdminStorageTab from "./AdminStorageTab";
import AdminUsersTab from "./AdminUsersTab";
import PermissionMatrix from "./PermissionMatrix";

/* ================================= the suite ================================= */

/** A tab handed in from outside — the registry seam's shape, flattened so this
 *  file needs to know nothing about contributions. `./AdminSurface` builds
 *  these, boundary and all. */
export interface SuiteExtraTab {
  id: string;
  title: string;
  glyph?: string;
  render: () => React.ReactNode;
}

interface SuiteTab {
  id: string;
  title: string;
  glyph: string;
  /** True when the tab manages its own height (it holds a `PaneLayout`), so the
   *  frame must stretch rather than scroll. */
  fills?: boolean;
  render: () => React.ReactNode;
}

/** Glyph + text, the label shape every tab strip in this module uses. */
function TabLabel({ glyph, text }: { glyph?: string; text: string }) {
  return (
    <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
      {glyph ? <Glyph id={glyph} size={14} /> : null}
      <Typography component="span" sx={{ fontSize: 12.5, textTransform: "none" }}>
        {text}
      </Typography>
    </Stack>
  );
}

export interface AdminPaneProps {
  /** Tabs contributed through `accounts.admin-tab`, already wrapped. */
  extraTabs?: SuiteExtraTab[];
}

export default function AdminPane({ extraTabs = [] }: AdminPaneProps) {
  const [tab, setTab] = React.useState("users");

  /**
   * `?tab=` — where P8's admin landing points, and what makes any tab in this
   * suite bookmarkable.
   *
   * Validated against the tabs that actually exist rather than a list, so a
   * CONTRIBUTED tab is linkable the day it is contributed and a link to one
   * whose module was removed opens the suite normally instead of an empty
   * frame. Applied once: after that the strip is the person's, and a link
   * cannot keep dragging them back to where they arrived.
   */
  const applied = React.useRef(false);

  const tabs = React.useMemo<SuiteTab[]>(
    () => [
      { id: "dashboard", title: "Dashboard", glyph: "icon-eye", render: () => <AdminDashboard /> },
      { id: "users", title: "Users", glyph: "icon-account", fills: true, render: () => <AdminUsersTab /> },
      { id: "files", title: "Files", glyph: "icon-folder", fills: true, render: () => <AdminFilesTab /> },
      { id: "policies", title: "Policies", glyph: "icon-gear", fills: true, render: () => <AdminPoliciesTab /> },
      { id: "storage", title: "Storage", glyph: "icon-layers", render: () => <AdminStorageTab /> },
      { id: "audit", title: "Audit", glyph: "icon-history", render: () => <AdminAuditTab /> },
      { id: "matrix", title: "Matrix", glyph: "icon-grid", render: () => <PermissionMatrix /> },
      ...extraTabs.map((t) => ({
        id: t.id,
        title: t.title,
        glyph: t.glyph ?? "icon-plugin",
        render: t.render,
      })),
    ],
    [extraTabs],
  );

  // A contribution that disappears (a module unregistered under HMR) must not
  // leave the strip pointing at a tab that no longer exists.
  const known = React.useMemo(() => new Set(tabs.map((t) => t.id)), [tabs]);
  React.useEffect(() => {
    if (!known.has(tab)) setTab("users");
  }, [known, tab]);

  React.useEffect(() => {
    if (applied.current) return;
    applied.current = true;
    const asked = new URLSearchParams(window.location.search).get("tab");
    if (asked && known.has(asked)) setTab(asked);
    // Contributions arrive during boot, before this renders, so `known` is
    // complete on the first pass — the same reason `useContributedAdminTabs`
    // reads the registry per mount rather than subscribing.
  }, [known]);

  const active = tabs.find((t) => t.id === tab) ?? tabs[0];

  /**
   * *Refresh* on the suite's context menu (P10).
   *
   * It re-keys the active tab's frame, which REMOUNTS it — and that is the whole
   * implementation on purpose. Every tab reads its sources in a mount effect, so
   * a remount is "re-read everything on this tab" for all seven of them, for a
   * tab contributed by another module that this file has never seen, and for the
   * next one written. The alternative — a refresh callback threaded into each
   * tab — is a row that works on the tabs somebody remembered to wire and
   * silently does nothing on the rest, which is the coverage failure the whole
   * area walk exists to have ended.
   *
   * It does cost the tab's local view state (an open folder, a selected row).
   * That is the honest meaning of Refresh here: the sources are re-read, and
   * where you were in them is not a source.
   */
  const [refreshedAt, setRefreshedAt] = React.useState(0);
  React.useEffect(
    () => onAccountsCtx((s) => s.kind === "suite-refresh" && setRefreshedAt((n) => n + 1)),
    [],
  );

  return (
    <Stack data-axf-area="accounts.suite" sx={{ height: "100%", minHeight: 0 }}>
      <Tabs
        value={active.id}
        onChange={(_, v: string) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        slotProps={{ indicator: { sx: { background: token("accent") } } }}
        sx={{
          borderBottom: `1px solid ${token("edge")}`,
          minHeight: 38,
          flexShrink: 0,
          "& .MuiTab-root": { minHeight: 38, py: 0 },
        }}
      >
        {tabs.map((t) => (
          <Tab key={t.id} value={t.id} label={<TabLabel glyph={t.glyph} text={t.title} />} />
        ))}
      </Tabs>

      <Box
        // The tab id is part of the key as well as the nonce, which it always
        // effectively was: switching tabs already unmounts one subtree and
        // mounts another. Spelling it here is what makes the nonce mean
        // "remount this tab" rather than "remount whatever is on screen".
        key={`${active.id}:${refreshedAt}`}
        sx={
          active.fills
            ? // A pane layout measures its own container, so the frame gives it
              // an extent and gets out of the way — no scroll here, the panes
              // scroll themselves.
              { flex: 1, minHeight: 0, display: "flex" }
            : { flex: 1, minHeight: 0, overflow: "auto", p: 2 }
        }
      >
        {active.render()}
      </Box>
    </Stack>
  );
}
