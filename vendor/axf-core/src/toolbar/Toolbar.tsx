/**
 * @file `<Toolbar>` — renders whichever toolbar asset is active for a surface,
 * including the **banner** (`role: "banner"`, the top bar of a full-page ui).
 *
 * A host mounts this once and supplies `fill`: content for the asset's named
 * `slot` and `status` items. It never says what the bar looks like — that is
 * the asset's job, which is what makes swapping one change every surface at
 * once rather than three files.
 *
 * A slot the asset declares but the host does not fill renders NOTHING, not a
 * gap. A bar shared across surfaces will always have slots some hosts do not
 * use, and reserving space for them would make every bar look broken on the
 * surface that uses fewest.
 *
 * **MUI (2026-08-10).** Items are `ButtonBase`, text is `Typography`,
 * separators are `Divider`, and the bar itself is a `Box` whose `component`
 * still carries the landmark element the role demands (`header` / `footer` /
 * `div`). `sx` rather than `styled()`, for the same reason as `NavMenu`: every
 * geometry value below is a `calc()` or a `var(--axf-*)` handed to CSS, so no
 * theme value is read in JS and both runtimes emit identical markup.
 *
 * **Presentation preferences (2026-08-13).** Three things about a bar are the
 * READER's rather than the author's — whether its words render, how big its
 * icons are, and which way it runs — and they arrive here as one merged
 * `ToolbarPrefs` (`prefs.ts`) laid over what the asset declares. The merge
 * happens ONCE per bar, above the item loop, so no item re-derives it and no
 * second renderer appears for "the vertical case".
 *
 * `data-axf-toolbar` is load-bearing for that: it is what the context menu's
 * *Toolbar settings* row keys off (the ctx walk harvests every `data-axf-*` on
 * the way up, so the row appears for a right-click anywhere inside any bar, and
 * `toolbar.settings.open` reads the id back out of it). Every toolbar asset
 * therefore has the dialog without opting in — which is the only way "all
 * toolbar assets, new and existing" can be true of assets not written yet.
 *
 * MUI's own `Toolbar`/`AppBar` were NOT used. `AppBar` is `position: fixed`
 * chrome with elevation and its own colour scheme, and this bar's geometry,
 * surface and border are the asset's and the dials' — adopting AppBar would
 * mean fighting it back to neutral in every one of those, and a bar that has to
 * be fought is a bar that drifts. `ButtonBase` and `Typography` are used
 * because they add behaviour (focus, keyboard, ripple, type scale) rather than
 * arrangement.
 */
"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";

import { Glyph, useResolvedStyle } from "../brand/Glyph";
import { editedGlyph, GlyphDropZone, useBrandEdits } from "../brand/edits";
import type { BrandEditTarget } from "../brand/edits";
import { Floatable, useDockOrientation } from "../dock/Floatable";
import { resolveBrandGlyph } from "../brand/requirements";
import { token } from "../theme/apply";
import { useAppliedThemeValues } from "../theme/ThemeBridge";
import { resolveToolbarPrefs, useToolbarPrefs } from "./prefs";
import { toolbars } from "./registry";
import { SURFACE_ROLES } from "./types";
import type { ToolbarFill, ToolbarSurface } from "./types";
import type { DockZone } from "../dock/model";

/** Subscribe to the toolbar registry. */
export function useToolbars() {
  return React.useSyncExternalStore(toolbars.subscribe, toolbars.snapshot, toolbars.snapshot);
}

const TONE = (t?: string) => token(t && t !== "ink" ? t : "ink");

/**
 * The theme's handle on bars, expressed in CSS rather than read in JS.
 *
 * The ASSET owns its declared geometry; the dials supply defaults where it is
 * silent, and `barScale` is a percentage multiplier on whatever won — the same
 * posture as a global font scale, so presentation follows the theme without the
 * theme stealing the arrangement.
 *
 * This used to be `Number(theme.values.barScale) / 100` and friends, baked into
 * inline styles. That made the bar's MARKUP depend on the theme, and the server
 * cannot read the stored theme — so the banner rendered `44px` on the server and
 * `38px` on the client and React discarded the whole tree. A `calc()` says the
 * same thing without either runtime having to know the answer.
 */
const scaled = (px: number): string => `calc(${px}px * var(--axf-bar-scale) / 100)`;

/**
 * Shared chrome for the button-shaped items — one definition, because three
 * near-identical copies is how an action and a menu stop matching.
 *
 * A FUNCTION of the icon size since 0.0.21: the control has to grow with the
 * glyph inside it, or a 28px icon in a 22px button is a bar with its own
 * contents hanging out of it. 22px stays the floor, so every bar that draws at
 * the shipped 13px is pixel-identical to what it was.
 */
const controlSx = (icon: number) =>
  ({
    gap: "6px",
    height: `${Math.max(22, icon + 9)}px`,
    cursor: "pointer",
    borderRadius: "var(--axf-radius-tight)",
    border: `1px solid ${token("edge")}`,
    background: "transparent",
    color: token("ink"),
    fontFamily: "inherit",
    fontSize: 11,
    whiteSpace: "nowrap"
  }) as const;

/**
 * How a bar marks the item that is CURRENT — the tab-strip case.
 *
 * An underline rather than a filled chip, and drawn with `boxShadow` rather
 * than a border: a border would change the control's box and shuffle every
 * other item sideways as the selection moves, which is the one thing a tab
 * strip must not do. It sits on the trailing edge, so it reads as an underline
 * horizontally and as a spine vertically without a second rule.
 */
const activeSx = (vertical: boolean) =>
  ({
    color: token("accent"),
    borderColor: token("accent"),
    boxShadow: vertical
      ? `inset -2px 0 0 0 ${token("accent")}`
      : `inset 0 -2px 0 0 ${token("accent")}`
  }) as const;

/**
 * Where a surface's bar already sits — the `naturalZone` its `<Floatable>` is
 * told, so a bar docked at home renders in flow and costs the layout nothing.
 *
 * Derived from the ROLE rather than listed per surface, for the reason
 * `SURFACE_ROLES` itself gives about refusing unknown surfaces: a table
 * requiring an entry per surface makes adding one a two-file change, and that
 * is how a registry ends up bypassed. A surface with no declared role is a bar
 * in ordinary flow, which is "top".
 */
function naturalZoneFor(surface: ToolbarSurface): DockZone {
  switch (SURFACE_ROLES[surface]) {
    case "status-bar":
      return "bottom";
    case "rail":
      return "left";
    default:
      return "top";
  }
}

/**
 * A toolbar, wrapped in the dock engine so it can be rearranged.
 *
 * The wrap is HERE rather than at each mounting site for the reason the shell
 * mounts every other piece of chrome: a bar that only floats on the surfaces
 * somebody remembered to wrap is a bar that does not float somewhere. One wrap
 * covers the banner, the console's status strip, the designer's tab bar, every
 * inline placement, and every bar written after this line — none of them opting
 * in, none of them able to forget.
 *
 * It is inert by construction: `<Floatable>` renders its children and NO
 * wrapper element until a host turns a mode on, so with both switches off this
 * emits exactly the markup it emitted before the engine existed.
 *
 * The dock id is the SURFACE, not the asset. An arrangement belongs to a place
 * — "the app banner sits on the left now" — and keying it to whichever asset
 * currently occupies that place would silently reset a person's layout the
 * moment they picked a different banner from the theme designer.
 */
export function Toolbar(props: {
  surface?: ToolbarSurface;
  asset?: string;
  fill?: ToolbarFill;
  activeItem?: string;
  onCommand?: (command: string) => void;
  /**
   * Opt a bar OUT of being rearrangeable. For a bar that is not chrome at all —
   * a preview of a candidate asset inside an editor, where a drag handle would
   * offer to move something that does not exist yet.
   */
  arrangeable?: boolean;
}) {
  const { arrangeable = true, ...rest } = props;
  const surface = props.surface ?? "app.banner";
  if (!arrangeable) return <ToolbarBody {...rest} />;
  return (
    <Floatable
      id={`toolbar:${surface}`}
      label={surface === "app.banner" ? "Command bar" : `${surface} toolbar`}
      naturalZone={naturalZoneFor(surface)}
      requires="either"
    >
      <ToolbarBody {...rest} />
    </Floatable>
  );
}

function ToolbarBody({
  surface = "app.banner",
  asset: assetId,
  fill = {},
  activeItem,
  onCommand
}: {
  surface?: ToolbarSurface;
  /**
   * Render THIS registered asset, by id, whatever the surface's active one is.
   *
   * The surface path answers "what bar belongs here", which is a question about
   * arrangement and is the right one nearly everywhere. This answers "draw that
   * specific bar", which is what an INLINE placement asks (`inline.tsx`) and
   * what a picker previewing a candidate asks. An id nothing registered falls
   * through to the surface resolution rather than blanking, for the same reason
   * a stale `bannerBar` dial does: a missing bar must degrade to the default
   * one, never to an empty strip.
   */
  asset?: string;
  fill?: ToolbarFill;
  /**
   * The item id that is CURRENT, for a bar used as a tab strip.
   *
   * State, not arrangement, so it is the host's — the asset cannot know which
   * of its six actions is the screen you are on. Unknown ids simply highlight
   * nothing, because a bar whose host names a stale id must lose a highlight,
   * never a row.
   */
  activeItem?: string;
  onCommand?: (command: string) => void;
}) {
  const snapshot = useToolbars();
  // Read before the early return: a brand item resolves its drawing against the
  // identity in force, and hooks cannot live below a conditional.
  const identity = useResolvedStyle();
  // Pending live edits, read once for the whole bar rather than per item — see
  // `brand/edits.tsx`. Idle on the server and on the hydrating render, so this
  // subscription cannot change what either runtime emits.
  const editState = useBrandEdits();
  // The reader's own presentation overrides, read once for the whole bar for
  // the same reason. Empty on the server and on the hydrating render (the store
  // pins `getServerState` to the empty document), so a saved preference cannot
  // make the two runtimes disagree — it lands as an ordinary repaint one frame
  // after the kv read, exactly like a module's settings.
  const prefsDoc = useToolbarPrefs();
  // The automatic FLIP (0.0.23). A bar snapped to the left or right edge runs
  // vertically, and it learns that from the `<Floatable>` above it rather than
  // from a host that would have to know it was inside one. Null outside a
  // floatable — which is every bar in an app that never turns edit mode on — so
  // the reader's own preference stays the answer.
  const docked = useDockOrientation();
  /*
   * Which bar draws the app banner is a THEME decision (the `bannerBar` chrome
   * dial), so a saved look restores its own bar and the designer's Toolbar tab
   * previews one live. The dial names an id; the registry's active entry is the
   * fallback for an empty dial or an id nothing registered — a stale saved
   * selection must degrade to the default bar, never to a blank banner.
   *
   * `useAppliedThemeValues`, not `useTheme().values`: the ASSET decides the
   * markup, so the server and the hydrating client must resolve it from the
   * same applied theme (the cookie), or every glyph in the bar swaps after
   * hydration. Surfaces other than `app.banner` (a pane bar, the console's
   * status strip) are not themed selections and stay purely registry-driven.
   */
  const values = useAppliedThemeValues();
  const dialled = surface === "app.banner" ? String(values.bannerBar ?? "").trim() : "";
  const fromTheme = dialled
    ? (snapshot.all.find((a) => a.surface === surface && a.id === dialled) ?? null)
    : null;
  // An explicit id outranks both, and is checked against the whole registry
  // rather than the surface's candidates: an inline placement names a bar by
  // id and does not necessarily know (or care) which surface it declares.
  const named = assetId ? (snapshot.all.find((a) => a.id === assetId) ?? null) : null;
  const asset = named ?? fromTheme ?? snapshot.active.get(surface) ?? null;

  if (!asset) {
    return (
      <Box
        sx={{
          padding: "4px 10px",
          fontFamily: token("mono"),
          fontSize: 11,
          color: token("err"),
          borderBottom: `1px solid ${token("edge")}`
        }}
      >
        {assetId
          ? `no toolbar registered as "${assetId}", and none active for surface "${surface}"`
          : `no toolbar registered for surface "${surface}"`}
</Box>
    );
  }

  // Orientation follows the declared role — a rail is a vertical strip (the
  // declared "height" becomes its thickness), a status-bar is a bottom strip so
  // its rule sits on TOP, everything else is the familiar horizontal bar with
  // the rule underneath — UNLESS the reader has said otherwise. Either way it
  // is decided inside this ONE component; a second renderer per role, or per
  // preference, is how the bars drift apart again.
  const prefs = resolveToolbarPrefs(asset, prefsDoc);
  // The dock outranks the preference while a bar is edge-mounted: the person
  // put it on the left edge a moment ago, and a horizontal bar in a vertical
  // strip is not a preference being honoured, it is a bar hanging out of its
  // own container.
  const vertical = (docked ?? prefs.orientation) === "vertical";
  // The reader's number first, then the asset's own (a constant, identical on
  // both runtimes), then the dialled default — either way scaled in CSS.
  const thickness = prefs.thickness
    ? scaled(prefs.thickness)
    : asset.height
      ? scaled(asset.height)
      : "var(--axf-bar-thickness)";
  const control = controlSx(prefs.iconSize);
  const active = activeSx(vertical);
  const edge = `1px solid ${token("edge")}`;
  const Tag: "header" | "footer" | "div" =
    asset.role === "banner" ? "header" : asset.role === "status-bar" ? "footer" : "div";

  /*
   * Which of this bar's drawings may be dropped on.
   *
   * Only the app banner, because only the app banner has a dial (`bannerBar`)
   * the layout can be repointed at once an edit is saved as a new asset. A pane
   * bar or an inline placement is named by whoever mounted it, so an edit there
   * would render and then have nowhere to be committed to — see the nullable
   * `target` in `GlyphDropZone`.
   */
  const editable = surface === "app.banner";
  const dropTarget = (item: string): BrandEditTarget | null =>
    editable ? { kind: "toolbar", asset: asset.id, item } : null;

  return (
    <Box
      component={Tag}
      data-axf-toolbar={asset.id}
      data-axf-toolbar-role={asset.role}
      // header and footer are landmarks already; only the plain-div roles need
      // the explicit toolbar role (and only role="toolbar" may carry
      // aria-orientation).
      role={Tag === "div" ? "toolbar" : undefined}
      aria-orientation={Tag === "div" ? (vertical ? "vertical" : "horizontal") : undefined}
      sx={{
        display: "flex",
        flexDirection: vertical ? "column" : "row",
        alignItems: "center",
        gap: "10px",
        ...(vertical
          ? {
              width: thickness,
              // The host gives a RAIL its length (a sized flex row stretches
              // it); the asset owns only the thickness, same as it owns a
              // bar's height. A bar turned vertical by preference has no such
              // host — it was dropped into ordinary flow expecting to be a
              // strip — so it takes its length from its contents instead.
              // `height: "100%"` there resolves against an unsized parent and
              // collapses the bar to nothing, which reads as "the setting
              // deleted my toolbar".
              height: asset.role === "rail" ? "100%" : "auto",
              alignSelf: asset.role === "rail" ? undefined : "flex-start",
              padding: "10px 0"
            }
          : { height: thickness, padding: "0 10px" }),
        flexShrink: 0,
        // Never wrap. The asset declares a thickness; a wrapping bar silently
        // breaks that contract and overlaps whatever is beside it.
        flexWrap: "nowrap",
        overflow: "hidden",
        background: asset.background ? token(asset.background) : "var(--axf-bar-surface)",
        ...(asset.border === false
          ? {}
          : asset.role === "status-bar"
            ? { borderTop: edge }
            : vertical
              ? { borderRight: edge }
              : { borderBottom: edge }),
        fontFamily: token("mono"),
        fontSize: 11,
        lineHeight: 1.3
      }}
    >
      {asset.items.map((item) => {
        switch (item.kind) {
          case "brand": {
            // The asset names the drawing it WANTS; the identity in force
            // decides what it gets. Without this fallback a bar bound to a
            // non-contract id (`command-bar` asks for GizmoX's
            // `lockup-horizontal`) renders a dashed placeholder under every
            // other pack — which is what "selecting a style package does not
            // render a logo in the banner" was.
            //
            // A pending live edit outranks the asset's own choice and then goes
            // through the SAME fallback chain, so a dropped drawing that the
            // identity cannot supply degrades exactly like a declared one.
            const wanted = editedGlyph(editState, dropTarget(item.id), item.glyph);
            const glyphId = resolveBrandGlyph((id) => identity.glyphs.has(id), wanted);
            const glyph = <Glyph id={glyphId} size={scaled(item.width ?? 340)} />;
            // With a command the brand is a live control (a command bar's logo
            // goes home); a bare wrapper button so the drawing IS the button.
            return (
              <GlyphDropZone key={item.id} target={dropTarget(item.id)} declared={item.glyph}>
                {item.command ? (
                  <ButtonBase
                    aria-label={item.command}
                    onClick={() => onCommand?.(item.command as string)}
                    sx={{
                      display: "inline-flex",
                      alignItems: "center",
                      padding: 0,
                      background: "transparent",
                      cursor: "pointer",
                      flexShrink: 0
                    }}
                  >
                    {glyph}
                  </ButtonBase>
                ) : (
                  glyph
                )}
              </GlyphDropZone>
            );
          }

          case "label":
            // A `label` item is nothing BUT the asset's own words, so "text
            // off" removes it rather than rendering an empty span that still
            // spends a 10px gap.
            if (!prefs.labels) return null;
            return (
              <Typography
                key={item.id}
                component="span"
                sx={{
                  color: TONE(item.tone ?? "dim"),
                  fontSize: item.caps === false ? 11 : 9.5,
                  letterSpacing: item.caps === false ? "normal" : "0.1em",
                  textTransform: item.caps === false ? "none" : "uppercase",
                  whiteSpace: "nowrap"
                }}
              >
                {item.text}
              </Typography>
            );

          case "divider":
            return (
              <Divider
                key={item.id}
                orientation={vertical ? "horizontal" : "vertical"}
                flexItem
                sx={
                  vertical
                    ? { width: 14, height: "1px", borderColor: token("edge"), background: token("edge"), flexShrink: 0 }
                    : { width: "1px", height: 14, borderColor: token("edge"), background: token("edge"), flexShrink: 0 }
                }
              />
            );

          case "spacer":
            return <Box key={item.id} component="span" sx={{ flex: 1 }} />;

          case "action": {
            const word = prefs.labels ? item.label : undefined;
            const current = activeItem !== undefined && activeItem === item.id;
            return (
              <ButtonBase
                key={item.id}
                title={item.title}
                aria-label={item.title}
                // `aria-current` rather than `aria-pressed`: the highlight says
                // "this is the one you are on", which is a tab's claim, not a
                // toggle's state.
                aria-current={current ? "true" : undefined}
                onClick={() => onCommand?.(item.command)}
                sx={{
                  ...control,
                  ...(current ? active : {}),
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minWidth: `${Math.max(24, prefs.iconSize + 11)}px`,
                  padding: word ? "0 8px" : "0 5px"
                }}
              >
                <GlyphDropZone target={dropTarget(item.id)} declared={item.glyph}>
                  <Glyph
                    id={editedGlyph(editState, dropTarget(item.id), item.glyph) ?? item.glyph}
                    size={prefs.iconSize}
                  />
                </GlyphDropZone>
                {word && <Box component="span">{word}</Box>}
              </ButtonBase>
            );
          }

          case "menu":
            // The affordance is data; the MENU is the host's. Clicking fires
            // the command and the host opens whatever the command summons, so
            // the asset never carries a module list that goes stale.
            return (
              <ButtonBase
                key={item.id}
                title={item.label}
                aria-label={item.label}
                aria-haspopup="menu"
                aria-current={activeItem === item.id ? "true" : undefined}
                sx={{
                  ...control,
                  ...(activeItem !== undefined && activeItem === item.id ? active : {}),
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "0 8px"
                }}
                onClick={() => onCommand?.(item.command)}
              >
                <GlyphDropZone target={dropTarget(item.id)} declared={item.glyph}>
                  <Glyph
                    id={editedGlyph(editState, dropTarget(item.id), item.glyph) ?? item.glyph}
                    size={prefs.iconSize}
                  />
                </GlyphDropZone>
                {prefs.labels && <Box component="span">{item.label}</Box>}
                {/* The caret STAYS with the words off: it is the affordance
                    that says a menu opens here, not decoration on the word. */}
                <Box component="span" aria-hidden sx={{ color: token("dim"), fontSize: 8 }}>
                  ▾
                </Box>
              </ButtonBase>
            );

          case "field": {
            // A field-shaped BUTTON, never an input — a read-only input with a
            // focus handler re-opens its dialog forever when focus is restored
            // on close (types.ts documents the trap). A native button is
            // focusable with no focus handler at all. MUI does not change this:
            // an MUI `TextField` here would reintroduce exactly that trap, and
            // `ButtonBase` still renders a real <button>.
            return (
              <ButtonBase
                key={item.id}
                title={item.placeholder}
                aria-label={item.placeholder}
                onClick={() => onCommand?.(item.command)}
                sx={{
                  ...control,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "7px",
                  height: `${Math.max(24, prefs.iconSize + 11)}px`,
                  // With the words off a field has nothing to be wide FOR — its
                  // declared width exists to hold a placeholder and a hotkey
                  // hint, and 260px of empty box beside a search icon is the
                  // arrangement asking for space it no longer uses.
                  width: prefs.labels ? (item.width ?? 200) : "auto",
                  maxWidth: "100%",
                  // The declared width is the asset's arrangement — a flex row
                  // must clip the bar, not quietly crush the field to a stub.
                  flexShrink: 0,
                  padding: "0 8px",
                  background: token("page"),
                  color: token("dim"),
                  overflow: "hidden"
                }}
              >
                <GlyphDropZone target={dropTarget(item.id)} declared={item.glyph}>
                  <Glyph
                    id={editedGlyph(editState, dropTarget(item.id), item.glyph) ?? item.glyph}
                    size={prefs.iconSize - 1}
                  />
                </GlyphDropZone>
                {prefs.labels && (
                  <Box component="span" sx={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {item.placeholder}
                  </Box>
                )}
                {prefs.labels && item.hint && (
                  <Box
                    component="kbd"
                    sx={{
                      fontFamily: "inherit",
                      fontSize: 9,
                      padding: "1px 4px",
                      borderRadius: "3px",
                      border: `1px solid ${token("edge")}`,
                      background: "transparent",
                      color: token("dim")
                    }}
                  >
                    {item.hint}
                  </Box>
                )}
              </ButtonBase>
            );
          }

          case "status":
          case "slot": {
            const content = fill[item.id];
            if (content === undefined || content === null || content === false) return null;
            return (
              <Box
                key={item.id}
                component="span"
                sx={{
                  color: item.kind === "status" ? TONE(item.tone ?? "dim") : token("ink"),
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  // A bar is ONE line. Without these a host that fills a slot
                  // generously wraps the bar to three rows and collides with
                  // the brand — the slot has to clip, not reflow, because the
                  // asset owns the height and cannot know what a host will put
                  // in it.
                  minWidth: 0,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis"
                }}
              >
                {content}
              </Box>
            );
          }

          default:
            return null;
        }
      })}
    </Box>
  );
}
