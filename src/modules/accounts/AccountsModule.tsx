/**
 * @file The Accounts screen — the member surface, and the login card's second
 * home: signed out it renders `./LoginCard` (username/password against
 * `accounts.json`, plus the forced password-change step while an admin-issued
 * temp credential is in force); signed in it is a left rail (collapsible to
 * its icons through the ≡ at its top — the choice persists per browser) over
 * four surfaces — Members (the directory + admin CRUD, and the read-only profile
 * viewer it opens), Messages (the messenger) and My profile (the profile
 * editor), and, for administrators only, Admin — which since 2026-08-15 is a
 * tab strip (`./AdminSurface`): the overview + the permission matrix are its
 * first tab, and other modules contribute their administrator-only panes into
 * it through `accounts.admin-tab` rather than growing a second admin console.
 *
 * Everything on screen reads the P3 store (`./store`): the session verdict,
 * the directory, presence, the unread total on the Messages tab. The store is
 * also what flips core's `SessionStore` on sign-in/out, so the shell chrome
 * reacts without this file doing anything.
 *
 * The login flow is the proven AmberX Vid shape (GizmoX
 * `src/modules/amberxvid/ModuleLogin.tsx`, read never imported), minus the
 * screenname gate: screennames are self-service through the profile engine
 * (P5), not part of entry. `mustChangePassword` is a SESSION state here, not a
 * pre-login step — the server signs the user in and flags them, and every
 * surface except the change form stays behind the flag until it clears.
 *
 * Since the studio-wide gate landed (`proxy.ts`, 2026-08-15) a signed-out
 * visitor is redirected to `/login` before this route renders at all, so the
 * card below is reached only when a session dies under an already-open
 * `/accounts` screen. It stays because that case is real — and because the
 * screen would otherwise have a state it could not draw.
 *
 * Both roots mark `data-axf-area="accounts.surface"` (P6) — the signed-out
 * login card (in `./LoginCard`) as well as the signed-in shell. One marker on
 * the signed-in root would leave the login pane with an arealess right-click,
 * which is precisely the coverage hole the area walk exists to have ended.
 */
"use client";

import * as React from "react";

import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Glyph, token } from "@axf/core";

import AdminSurface from "./AdminSurface";
import LoginCard from "./LoginCard";
import MessengerPane from "./MessengerPane";
import ProfilePane from "./ProfilePane";
import StatePane from "./StatePane";
import UsersPane from "./UsersPane";
import { accountsStore, useAccountsState } from "./store";

type Surface = "members" | "messages" | "profile" | "state" | "admin";

/* ------------------------------------------------------------ collapsing --- */

/**
 * Whether the left rail is collapsed to its icons — a per-browser habit kept in
 * `localStorage` (owner, 2026-10-16: *"make left menu collapsible"*), the same
 * arrangement core's `NavShell` uses for the app nav and for the same reason:
 * it is one person's preference for this afternoon, not a theme dial.
 *
 * The server and the first client frame both see "expanded"; the stored
 * choice lands in an effect, so hydration cannot tear over a value the server
 * cannot read.
 */
const RAIL_COLLAPSED_KEY = "axs:accounts:rail:collapsed";

const RAIL_WIDTH = 200;
const RAIL_WIDTH_COLLAPSED = 56;

function useRailCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = React.useState(false);
  React.useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(RAIL_COLLAPSED_KEY) === "1");
    } catch {
      /* storage blocked — expanded, for the session */
    }
  }, []);
  const toggle = React.useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(RAIL_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* see above */
      }
      return next;
    });
  }, []);
  return [collapsed, toggle];
}

/** The ≡ control. Three bars rather than a pack glyph, so it exists in every
 *  pack — including one that ships no icons at all. */
function RailToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <ButtonBase
      onClick={onToggle}
      aria-label={collapsed ? "Expand menu" : "Collapse menu"}
      aria-expanded={!collapsed}
      title={collapsed ? "Expand menu" : "Collapse menu"}
      data-axf-accounts-rail-toggle={collapsed ? "collapsed" : "expanded"}
      sx={{
        width: 34,
        height: 30,
        flexShrink: 0,
        borderRadius: "6px",
        color: token("ink"),
        "&:hover": { background: `color-mix(in srgb, ${token("accent")} 14%, transparent)` }
      }}
    >
      <Box
        component="span"
        aria-hidden
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: "3px",
          "& > span": { display: "block", width: 16, height: 2, borderRadius: 1, background: "currentColor" }
        }}
      >
        <span />
        <span />
        <span />
      </Box>
    </ButtonBase>
  );
}

/** One rail tab's label — glyph + text, the unread badge on Messages. Collapsed,
 *  the glyph alone, with the text as a tooltip so the rail stays legible. */
function RailLabel({
  glyph,
  text,
  badge,
  collapsed
}: {
  glyph: string;
  text: string;
  badge?: number;
  collapsed?: boolean;
}) {
  const icon = <Glyph id={glyph} size={15} />;
  const badged = badge ? (
    <Badge badgeContent={badge} color="primary" sx={{ "& .MuiBadge-badge": { fontSize: 9 } }}>
      {icon}
    </Badge>
  ) : (
    icon
  );
  if (collapsed) {
    return (
      <Tooltip title={text} placement="right">
        <Box component="span" sx={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
          {badged}
        </Box>
      </Tooltip>
    );
  }
  return (
    <Stack direction="row" sx={{ alignItems: "center", gap: 1.25, width: "100%" }}>
      {badged}
      <Typography component="span" sx={{ fontSize: 12.5, textTransform: "none" }}>
        {text}
      </Typography>
    </Stack>
  );
}

const SURFACES: readonly Surface[] = ["members", "messages", "profile", "state", "admin"];

/**
 * The surface named in `?surface=`, or null.
 *
 * Read from `window.location` in an effect rather than through
 * `useSearchParams`, for the reason `LoginScreen` gives about the same choice:
 * the hook imposes a Suspense boundary on every ancestor, and this is used
 * once, client-side, to pick an initial tab. An unknown value answers null and
 * the rail opens where it always did — a stale link must lose its deep link,
 * never the screen.
 */
function useRequestedSurface(): Surface | null {
  const [asked, setAsked] = React.useState<Surface | null>(null);
  React.useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("surface");
    if (raw && (SURFACES as readonly string[]).includes(raw)) setAsked(raw as Surface);
  }, []);
  return asked;
}

export default function AccountsModule() {
  const state = useAccountsState();
  const [surface, setSurface] = React.useState<Surface>("members");
  const requested = useRequestedSurface();
  const [collapsed, toggleCollapsed] = useRailCollapsed();

  const administrator = state.permissions?.administrator === true;

  // A `?surface=` deep link — what P8's admin landing arrives on, and what any
  // bookmark of an admin tab carries. Applied once, after the permission probe
  // answers: `admin` is gated, and honouring it before `administrator` is known
  // would bounce a real administrator straight back to Members by the effect
  // below. Once the person has clicked a tab themselves, their click wins.
  const applied = React.useRef(false);
  React.useEffect(() => {
    if (applied.current || !requested || !state.loaded) return;
    if (requested === "admin" && !administrator) return;
    applied.current = true;
    setSurface(requested);
  }, [requested, state.loaded, administrator]);

  // A demotion mid-session must not leave the Admin surface on screen —
  // permissions refresh on the next probe, and this puts the tab back too.
  React.useEffect(() => {
    if (!administrator && surface === "admin") setSurface("members");
  }, [administrator, surface]);

  if (!state.loaded) {
    return (
      <Box sx={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CircularProgress size={26} />
      </Box>
    );
  }

  if (!state.session || state.session.mustChangePassword) {
    return <LoginCard me={state.session} />;
  }

  const me = state.session;

  return (
    <Box
      data-axf-area="accounts.surface"
      sx={{ display: "flex", height: "100%", minHeight: 0, color: token("ink") }}
    >
      {/* ------------------------------- left rail ------------------------------- */}
      <Stack
        data-axf-accounts-rail={collapsed ? "collapsed" : "expanded"}
        sx={{
          width: collapsed ? RAIL_WIDTH_COLLAPSED : RAIL_WIDTH,
          flexShrink: 0,
          minHeight: 0,
          borderRight: `1px solid ${token("edge")}`,
          transition: "width var(--axf-motion, 160ms) var(--axf-easing, ease)",
          overflow: "hidden"
        }}
      >
        <Box sx={{ display: "flex", p: "6px 6px 0", justifyContent: collapsed ? "center" : "flex-start" }}>
          <RailToggle collapsed={collapsed} onToggle={toggleCollapsed} />
        </Box>

        {collapsed ? (
          <Tooltip title={`${me.screenname ?? me.username} · ${me.role}`} placement="right">
            <Box sx={{ display: "flex", justifyContent: "center", p: "8px 0 6px" }}>
              <Glyph id="icon-account" size={20} />
            </Box>
          </Tooltip>
        ) : (
          <Stack direction="row" sx={{ alignItems: "center", gap: 1.25, p: "6px 14px 8px" }}>
            <Glyph id="icon-account" size={20} />
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography
                sx={{
                  fontSize: 12.5,
                  fontWeight: 700,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {me.screenname ?? me.username}
              </Typography>
              <Typography sx={{ fontSize: 10.5, color: token("dim"), fontFamily: token("mono") }}>
                {me.role}
              </Typography>
            </Box>
          </Stack>
        )}

        <Tabs
          orientation="vertical"
          value={surface}
          onChange={(_, v: Surface) => setSurface(v)}
          slotProps={{ indicator: { sx: { background: token("accent"), left: 0, width: 2 } } }}
          sx={{
            flex: 1,
            "& .MuiTab-root": {
              minHeight: 40,
              minWidth: 0,
              alignItems: collapsed ? "center" : "flex-start",
              px: collapsed ? 0 : "14px",
              opacity: 0.85,
            },
            "& .Mui-selected": { opacity: 1 },
          }}
        >
          <Tab value="members" label={<RailLabel glyph="icon-account" text="Members" collapsed={collapsed} />} />
          <Tab
            value="messages"
            label={<RailLabel glyph="icon-chat" text="Messages" badge={state.unread} collapsed={collapsed} />}
          />
          <Tab value="profile" label={<RailLabel glyph="icon-account" text="My profile" collapsed={collapsed} />} />
          <Tab value="state" label={<RailLabel glyph="icon-eye" text="State" collapsed={collapsed} />} />
          {administrator && (
            <Tab value="admin" label={<RailLabel glyph="icon-gear" text="Admin" collapsed={collapsed} />} />
          )}
        </Tabs>

        {collapsed ? (
          <Tooltip title="Sign out" placement="right">
            <ButtonBase
              aria-label="Sign out"
              onClick={() => void accountsStore.logout()}
              sx={{ m: 1, height: 30, borderRadius: "6px", color: token("dim") }}
            >
              <Glyph id="icon-power" size={15} />
            </ButtonBase>
          </Tooltip>
        ) : (
          <Button
            size="small"
            onClick={() => void accountsStore.logout()}
            sx={{ m: 1, color: token("dim"), fontSize: 12, textTransform: "none" }}
          >
            Sign out
          </Button>
        )}
      </Stack>

      {/* ------------------------------- surfaces -------------------------------- */}
      <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "auto" }}>
        {surface === "members" && <UsersPane />}

        {surface === "messages" && <MessengerPane />}

        {surface === "profile" && <ProfilePane />}

        {surface === "state" && <StatePane />}

        {/* The admin surface is a TAB STRIP as of 2026-08-15: the overview and
            the matrix are its first tab, and every other tab arrives through
            `accounts.admin-tab` (see `./adminTabs`). The gate stays here, once,
            so a contributed pane inherits it rather than restating it. */}
        {surface === "admin" && administrator && <AdminSurface />}
      </Box>
    </Box>
  );
}
