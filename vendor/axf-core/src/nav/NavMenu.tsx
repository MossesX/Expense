/**
 * @file `<NavShell>` and `<NavMenu>` — the navigation chrome, arranged by the
 * rolled layout theme.
 *
 * The division of labour, stated once:
 *
 *   - the **asset** (a registered `nav-menu`) says what is navigable — items,
 *     routes, pack glyph ids;
 *   - the **layout dials** say where and how it presents — `navPlacement`
 *     moves it to another edge, `navStyle` switches rail / labeled / pills,
 *     `navIndicator` restyles the active marker, `navGlyph` resizes the
 *     icons, `navMotion` changes hover behaviour;
 *   - the **palette dials and brand bridge** colour it, exactly as they colour
 *     everything else.
 *
 * So a hot roll relocates and redesigns the menu with no remount and no edit
 * to any asset — which is the whole point of it being chrome the theme owns.
 *
 * **Every one of those dials reaches this file as a CSS custom property, and
 * none of them is read in JS.** That is not a style preference; it is the fix
 * for an app-wide hydration failure. Placement, style, indicator, motion and
 * the sizes used to be read off the store and baked into inline styles and into
 * which elements got rendered at all — a rail simply omitted its labels. The
 * server cannot read the stored theme, so it rendered that markup from the
 * DEFAULT theme while the client rendered it from the stored one, and React
 * responded by discarding the server tree on every route. `derived.ts` now
 * translates each dial's word into the CSS this file needs, so the menu's
 * markup is the same on both runtimes and only its computed style differs.
 *
 * A rail therefore still renders its labels and hides them with
 * `--axf-nav-label: none`. That is deliberate: hiding is a paint, omitting is a
 * render, and only one of the two can be true on a server that does not know
 * which theme is stored.
 *
 * Efficiency note: the hosted screen is passed as `children`, and a re-render
 * with an IDENTICAL children element lets React bail out of that whole subtree
 * — the module does not re-render because the nav moved. With the geometry in
 * variables, a roll now repaints the menu without re-rendering it either; the
 * subscription that remains exists only to keep the `data-axf-nav-*`
 * diagnostics truthful for the swap probes, and nothing is styled from them.
 *
 * **MUI (2026-08-10).** Structure is `Box` (`component` keeps the semantic
 * element — `main`, `nav`), items are `ButtonBase`, dividers are `Divider` and
 * text is `Typography`. `sx` was chosen over `styled()` precisely BECAUSE of
 * the rule above: every value below is still a `var(--axf-*)` string handed
 * straight to CSS, so nothing here reads the store and both runtimes emit
 * identical markup. `ButtonBase` also replaces the hand-rolled hover
 * `<style>` block — `sx` can express `&:hover`, which inline styles could not,
 * and that was the only reason the block existed.
 *
 * `ListItemButton` was NOT used for items: it brings its own padding, layout
 * and selected-state opinions, and every one of those is a dial's job here.
 * `ButtonBase` gives the keyboard and focus behaviour and nothing else.
 *
 * The `[data-axf-main] > *` rule stays a plain `<style>` block on purpose —
 * see the comment at its site.
 */
"use client";

import * as React from "react";
import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";

import { Glyph } from "../brand/Glyph";
import { editedGlyph, GlyphDropZone, useBrandEdits } from "../brand/edits";
import type { BrandEditTarget } from "../brand/edits";
import { token } from "../theme/apply";
import { useAppliedThemeValues, useTheme } from "../theme/ThemeBridge";
import { Boundary } from "../shell/Boundary";
import { navs } from "./registry";
import type { NavSurface } from "./types";

/** Subscribe to the nav registry. */
export function useNavMenus() {
  return React.useSyncExternalStore(navs.subscribe, navs.snapshot, navs.snapshot);
}

type Placement = "left" | "right" | "top" | "bottom";

const PLACEMENTS = new Set<string>(["left", "right", "top", "bottom"]);

/**
 * A `var()` reference in a property whose csstype is a literal union.
 *
 * CSS accepts a custom property anywhere a value is allowed; csstype models only
 * the enumerated keywords, so this is the type system catching up with CSS
 * rather than a claim about the value.
 *
 * The type argument is passed EXPLICITLY at each call. Under `React.CSSProperties`
 * contextual inference supplied it, but MUI's `sx` types a property as a whole
 * `ResponsiveStyleValue | SystemStyleObject | (theme) => ...` union, so inference
 * yields that union instead of the property's own type and the object stops
 * matching `SxProps`. Naming one legal keyword per call restores the original
 * meaning — the value is still `var(...)` at runtime either way.
 */
const cssVar = <T = string,>(name: string): T => `var(${name})` as T;

/** The dial's word, for the diagnostic attributes ONLY — never for styling. */
function placementOf(values: Record<string, unknown>): Placement {
  const word = String(values.navPlacement ?? "left");
  return (PLACEMENTS.has(word) ? word : "left") as Placement;
}

/**
 * Arranges the nav menu and the hosted screen according to `navPlacement`.
 * Mounted by `ModuleHost`; a host core does not know about can mount it the
 * same way around its own content.
 */
/* ---------------------------------------------------------- collapsing --- */

/**
 * Whether the nav is collapsed — a per-browser habit, kept in `localStorage`
 * (owner, 2026-09-15: *"make navigation menu in studio collapsible with
 * hamburger button"*).
 *
 * NOT a theme dial: the dials say how a nav PRESENTS, and are a designer's
 * choice that ships with a pack. Whether one person wants it out of the way
 * this afternoon is neither. The server and the first client frame both see
 * "expanded", and the stored choice lands in an effect, so hydration cannot
 * tear over a value the server cannot read.
 */
const NAV_COLLAPSED_KEY = "axf:nav:collapsed";

function useNavCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = React.useState(false);
  React.useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(NAV_COLLAPSED_KEY) === "1");
    } catch {
      /* storage blocked — expanded, for the session */
    }
  }, []);
  const toggle = React.useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(NAV_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* see above */
      }
      return next;
    });
  }, []);
  return [collapsed, toggle];
}

/** The ≡ control. Drawn as three bars rather than a pack glyph so it exists
 *  in every pack, including one that ships no icons at all. */
function NavToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <ButtonBase
      onClick={onToggle}
      aria-label={collapsed ? "Show navigation" : "Hide navigation"}
      aria-expanded={!collapsed}
      title={collapsed ? "Show navigation" : "Hide navigation"}
      data-axf-nav-toggle={collapsed ? "collapsed" : "expanded"}
      sx={{
        width: 34,
        height: 30,
        flexShrink: 0,
        borderRadius: "var(--axf-nav-item-radius, 6px)",
        color: token("ink"),
        "&:hover": { background: "var(--axf-nav-hover-bg)" }
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

export function NavShell({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const placement = placementOf(theme.values);
  const vertical = placement === "left" || placement === "right";
  const [collapsed, toggleCollapsed] = useNavCollapsed();
  /*
   * No nav menu registered for `app.nav` — a peeled app whose module declares
   * no nav — means no rail at all, toggle included. A ≡ button that opens an
   * empty column is not "no navigation", it is a navigation menu with nothing
   * in it, and the peel's "NavShell renders no menu" promise covers the toggle
   * too. Studio always has a nav, so this branch is the peel's alone.
   */
  const hasNav = useNavMenus().all.some((asset) => asset.surface === "app.nav");

  return (
    <Box
      data-axf-nav-flow={placement}
      data-axf-nav-collapsed={collapsed ? "1" : "0"}
      // `--axf-nav-flow` is the placement dial translated into a flex direction
      // by `derived.ts`. Reading the word here instead would put the theme back
      // in the markup, which is what the whole arrangement exists to avoid.
      sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: cssVar<"row">("--axf-nav-flow") }}
    >
      {/* The nav column (or row, for a top/bottom placement): the ≡ toggle,
          then the menu itself unless collapsed. Collapsed, what is left is a
          slim rail holding only the toggle, on the nav's own surface colour so
          the edge of the chrome stays where it was. */}
      {hasNav && (
      <Box
        data-axf-nav-rail
        sx={{
          display: "flex",
          flexDirection: vertical ? "column" : "row",
          alignItems: vertical ? "stretch" : "center",
          flexShrink: 0,
          minHeight: 0,
          minWidth: 0,
          ...(collapsed
            ? {
                background: "var(--axf-nav-surface)",
                borderStyle: "solid",
                borderColor: token("edge"),
                borderWidth: "var(--axf-nav-borders)",
                padding: "4px"
              }
            : {})
        }}
      >
        <Box sx={{ display: "flex", padding: collapsed ? 0 : "6px 6px 0", flexShrink: 0 }}>
          <NavToggle collapsed={collapsed} onToggle={toggleCollapsed} />
        </Box>
        {/* The nav is chrome: a crashing menu becomes a chip, not a dead app. */}
        {!collapsed && (
          <Boundary tier="app" source="app.nav" compact>
            <NavMenuSurface />
          </Boundary>
        )}
      </Box>
      )}
      {/* The ONE scroll container. A tall page scrolls here (never the
          document — the shell is a fixed viewport column); a viewport app
          opts out by taking flex:1 + minHeight:0 and scrolling its own
          panes. */}
      <Box
        component="main"
        data-axf-main
        sx={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", overflow: "auto" }}
      >
        {/*
          Why this rule exists, and why it is HERE rather than on each page.

          `<main>` is a column flex container, so a page root is a flex ITEM and
          its default `flex-shrink: 1` invites the container to compress it.
          What normally prevents that is the automatic minimum size: a flex item
          will not shrink below its content. But that protection is dropped the
          moment the item declares its own `overflow` — and declaring `overflow`
          on a page root is an ordinary thing to want.

          The result is silent and total: the page is squashed to exactly the
          viewport, its content spills out of a box the container believes is
          full, `scrollHeight` equals `clientHeight`, no scrollbar appears, and
          everything below the fold becomes unreachable. That is what the brand
          gallery shipped as — main 681px, scrollHeight 681px — and it reads as
          an empty or truncated page, never as a layout bug.

          Reproduced and fixed by mutation on /brand, 2026-08-09: giving the
          page root `overflow: auto` collapsed main's scrollHeight from 12091 to
          861 with the old default and left it at 12091 with this rule.

          The gallery was fixed once by deleting its own `overflow`, which works
          and lasts exactly until the next page needs one. Stated here instead,
          the guarantee is the shell's: content keeps its natural height and
          main scrolls, whatever a page declares.

          A stylesheet rule rather than an inline style because it applies to
          children this component does not render. That is also what preserves
          the documented opt-out: a viewport app declaring `flex: 1` INLINE
          (the diff browser, the build manager) sets flex-shrink back to 1 at a
          specificity a stylesheet cannot reach, and still bounds itself to main
          and scrolls its own panes.

          Deliberately NOT MUI's `GlobalStyles`: that would move the rule into
          the `mui` cascade layer, and the opt-out above is a statement about
          specificity that is only obviously true for an unlayered rule. The
          behaviour here was proven by mutation; moving it would mean proving it
          again for no gain.
        */}
        <style>{`[data-axf-main] > * { flex-shrink: 0; }`}</style>
        {children}
      </Box>
    </Box>
  );
}

/**
 * The menu itself, for one surface. Renders nothing when no menu is
 * registered — an app without navigation is legitimate, not an error.
 *
 * Exported (0.0.25) so a menu can be DRAWN BY ID somewhere that is not the
 * shell — the asset browser's live preview, an editor previewing a candidate.
 * It is deliberately the same affordance `Toolbar` has carried since it was
 * written ("draw that specific bar", for a picker previewing a candidate), and
 * for the same reason: without it, anything wanting to show a menu has to
 * re-draw one, and a second nav implementation is a second nav implementation
 * that will disagree with the first the day a dial is added.
 *
 * The public name keeps the `Surface` suffix because `NavMenu` is already
 * taken — by the branded TYPE a `defineNavMenu()` returns. Exporting a value
 * under that name would be a duplicate export in the barrel, and renaming the
 * type to free it up would touch every consumer of the asset contract to buy
 * one character.
 */
export function NavMenuSurface({
  surface = "app.nav",
  asset: assetId,
  onNavigate
}: {
  surface?: NavSurface;
  /**
   * Render THIS registered menu, by id, whatever the surface's active one is.
   *
   * Resolved against the WHOLE registry rather than the surface's candidates,
   * exactly as `Toolbar`'s `asset` is: a preview names a menu and does not
   * necessarily know which surface it declares. An id nothing registered falls
   * through to the surface resolution rather than blanking, because a missing
   * menu must degrade to the live one and never to an empty strip.
   */
  asset?: string;
  onNavigate?: (route: string) => void;
}) {
  const snapshot = useNavMenus();
  const theme = useTheme();
  /*
   * Which MENU renders is a theme decision (the `navMenu` chrome dial) — the
   * same arrangement as the banner in `Toolbar.tsx`, for the same reason: the
   * asset decides the markup (which items exist), so both runtimes must
   * resolve it from the applied theme the cookie carries, and an empty or
   * stale dial falls back to the registry's active menu. HOW the menu presents
   * stays entirely with the layout dials as CSS variables, exactly as the file
   * docblock demands.
   */
  const applied = useAppliedThemeValues();
  // Pending live edits from the branding page's drag-and-drop switch. Idle on
  // the server and on the hydrating render — see `brand/edits.tsx`.
  const editState = useBrandEdits();
  const dialled = surface === "app.nav" ? String(applied.navMenu ?? "").trim() : "";
  const fromTheme = dialled
    ? (snapshot.all.find((a) => a.surface === surface && a.id === dialled) ?? null)
    : null;
  const named = assetId ? (snapshot.all.find((a) => a.id === assetId) ?? null) : null;
  const asset = named ?? fromTheme ?? snapshot.active.get(surface) ?? null;

  // Active route, read after mount so the server (which has no location) and
  // the first client paint agree; hydration mismatch is the alternative.
  const [path, setPath] = React.useState<string | null>(null);
  React.useEffect(() => {
    const read = () => setPath(window.location.pathname);
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  if (!asset) return null;

  const go = onNavigate ?? ((route: string) => window.location.assign(route));

  /*
   * Which of this menu's icons may be dropped on — only `app.nav`, for the same
   * reason `Toolbar` only offers the banner: `navMenu` is the dial an edit saved
   * as a new asset gets pointed at, and a surface with no dial has nowhere to
   * commit one.
   *
   * And only when NO id was named. An explicitly named menu is a PREVIEW of a
   * candidate — the same posture `Toolbar`'s `arrangeable={false}` takes — and
   * it is very likely not the one the dial points at, so a drop here would
   * commit a glyph swap into an asset the reader is merely looking at.
   */
  const dropTarget = (item: string): BrandEditTarget | null =>
    surface === "app.nav" && !assetId ? { kind: "nav", asset: asset.id, item } : null;

  return (
    <Box
      component="nav"
      aria-label={asset.title}
      data-axf-nav={asset.id}
      // Diagnostics for the swap probes, NOT styling hooks. Nothing in this
      // file or its `sx` selects on them; the moment something does, the theme
      // is back in the markup and the hydration failure comes with it.
      data-axf-nav-style={String(theme.values.navStyle ?? "labeled")}
      data-axf-nav-motion={String(theme.values.navMotion ?? "fade")}
      sx={{
        display: "flex",
        // Every one of these is the layout dials arriving as CSS. See the file
        // docblock for why not one of them may be read off the store instead.
        //
        // `--axf-nav-axis`, NOT `--axf-nav-flow`: the flow is the SHELL's row and
        // says which side of the content the menu is on; the axis is the menu's
        // own, and for a menu down an edge it is the perpendicular one.
        flexDirection: cssVar<"row">("--axf-nav-axis"),
        alignItems: cssVar<"center">("--axf-nav-cross"),
        justifyContent: cssVar<"center">("--axf-nav-justify"),
        gap: "var(--axf-nav-gap)",
        flexShrink: 0,
        overflow: "auto",
        padding: "var(--axf-nav-pad)",
        width: "var(--axf-nav-w)",
        height: "var(--axf-nav-h)",
        background: "var(--axf-nav-surface)",
        fontFamily: token("sans"),
        fontSize: token("size-label"),
        // The menu's ONE border faces the content, whichever edge it is on — which
        // side that is comes from `--axf-nav-borders`, a width shorthand, so the
        // rule moves without four conditional properties.
        borderStyle: "solid",
        borderColor: token("edge"),
        borderWidth: "var(--axf-nav-borders)",
        transition: `width var(--axf-motion) var(--axf-easing), background var(--axf-motion) var(--axf-easing)`
      }}
    >
      {asset.items.map((item) => {
        if (item.kind === "divider") {
          // `flexItem` lets a Divider size itself from the flex axis instead of
          // assuming a horizontal rule; the dialled width/height still decide,
          // which is what keeps one element correct in a rail and in a bar.
          return (
            <Divider
              key={item.id}
              flexItem
              sx={{
                width: "var(--axf-nav-div-w)",
                height: "var(--axf-nav-div-h)",
                margin: "var(--axf-nav-div-m)",
                borderColor: token("edge"),
                background: token("edge"),
                flexShrink: 0
              }}
            />
          );
        }
        if (item.kind === "section") {
          // A heading has nowhere to live in a rail or a horizontal bar, so
          // `--axf-nav-section` hides it there. Hidden rather than omitted: a
          // flex item with `display: none` occupies nothing and does not even
          // draw a gap, and unlike an omission it does not make the MARKUP
          // depend on which theme the runtime happened to know about.
          return (
            <Typography
              key={item.id}
              component="span"
              sx={{
                display: cssVar<"block">("--axf-nav-section"),
                fontFamily: token("mono"),
                fontSize: "var(--axf-size-micro)",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: token("dim"),
                padding: "10px 8px 4px"
              }}
            >
              {item.label}
            </Typography>
          );
        }

        const active = path !== null && path === item.route;
        return (
          <ButtonBase
            key={item.id}
            className="axf-nav-link"
            title={item.label}
            aria-current={active ? "page" : undefined}
            onClick={() => go(item.route)}
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: cssVar<"center">("--axf-nav-item-justify"),
              gap: "9px",
              padding: "var(--axf-nav-item-pad)",
              font: "inherit",
              textAlign: "left",
              whiteSpace: "nowrap",
              flexShrink: 0,
              borderRadius: "var(--axf-nav-item-radius)",
              // Which indicator draws WHAT is the theme's business; whether an
              // item is the current one is the router's, and `path` is read
              // after mount so both runtimes start with nothing active.
              background: active ? "var(--axf-nav-active-bg)" : "transparent",
              color: active ? "var(--axf-nav-active-fg)" : token("ink"),
              boxShadow: active ? "var(--axf-nav-active-shadow)" : undefined,
              // The hover rules, which used to need a `<style>` block because
              // inline styles cannot say `:hover`. Still ONE rule driven by
              // variables — `derived.ts` resolves the three motion words into
              // them, so the markup stays theme-free.
              transition: `background var(--axf-motion) var(--axf-easing),
                           color var(--axf-motion) var(--axf-easing),
                           transform var(--axf-motion) var(--axf-easing),
                           box-shadow var(--axf-motion) var(--axf-easing)`,
              "&:hover": {
                background: "var(--axf-nav-hover-bg)",
                transform: "var(--axf-nav-hover-transform)",
                boxShadow: "var(--axf-nav-hover-shadow)"
              }
            }}
          >
            <GlyphDropZone target={dropTarget(item.id)} declared={item.glyph}>
              <Glyph
                id={editedGlyph(editState, dropTarget(item.id), item.glyph) ?? item.glyph}
                size="var(--axf-nav-glyph)"
              />
            </GlyphDropZone>
            <Typography
              component="span"
              sx={{
                display: cssVar<"inline">("--axf-nav-label"),
                textTransform: cssVar<"none">("--axf-nav-label-case"),
                letterSpacing: "var(--axf-nav-label-track)",
                fontSize: "var(--axf-nav-label-size)"
              }}
            >
              {item.label}
            </Typography>
          </ButtonBase>
        );
      })}
    </Box>
  );
}
