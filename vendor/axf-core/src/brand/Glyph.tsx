/**
 * @file `<Glyph>` and the hooks that make a pack swap repaint without a remount.
 *
 * `StylePublisher` writes the active pack's variables onto `:root` and rewrites
 * them on every swap. Because every drawing in every pack references those
 * variables rather than literals, a swap repaints hundreds of SVGs with a single
 * style write — no component re-renders to change colour. React re-renders only
 * where the *set* of drawings changed, which is what `useResolvedStyle` is for.
 *
 * `dangerouslySetInnerHTML` is how an inline SVG string reaches the DOM. It is
 * safe here for a specific, checkable reason and not by assumption: pack markup
 * is authored in this repo and compiled in, never fetched or user-supplied.
 * `assertPackSvg` enforces that the moment a pack could come from anywhere else
 * — it is called on every entry, so the guard cannot be forgotten later.
 *
 * ── THE ICON SOURCE, DECIDED (2026-08-10, P2) ────────────────────────────────
 *
 * **Every icon in AmberX resolves through the branding pack, i.e. through this
 * component. `@mui/icons-material` is not installed and must not be.**
 *
 * The reason is mechanical rather than aesthetic, and it is why the decision is
 * recorded at the component rather than in a style guide. A pack drawing paints
 * in `var(--axf-brand-*)` / `var(--gxb-*)`, which `AxfStyleRoot` republishes
 * from the live theme — so a roll repaints hundreds of glyphs with one style
 * write and no re-render. A Material icon paints a hex compiled into its own
 * SVG; a theme can reach its `color` and nothing else, so a two-tone or
 * role-coloured mark would simply stop following the theme. Half the icons
 * following a roll and half not is worse than either, which is what "one
 * source, applied everywhere" is protecting against.
 *
 * It is enforced, not merely written down: `check-imports.mjs` names
 * `@mui/icons-material` explicitly for BOTH packages, and `check:glyphs`
 * verifies every glyph id referenced in the tree exists in the identity
 * template — so a missing drawing is a failing gate rather than an empty box on
 * a screen nobody reloaded.
 *
 * The consequence, stated so it is a decision and not a surprise: a name with no
 * drawing means ADDING a glyph to the pack, never reaching for a Material
 * import. That cost is the price of the property above.
 *
 * ── MUI (2026-08-10, P2) ─────────────────────────────────────────────────────
 *
 * The wrappers are `Box component="span"`. What they wrap is not MUI and cannot
 * be: it is the pack's own SVG string, injected verbatim. The `sx` here sizes
 * the drawing's box and nothing else — the drawing paints itself.
 */
"use client";

import * as React from "react";
import Box from "@mui/material/Box";

import { packs } from "./packs";
import type { ResolvedStyle } from "./packs";
import type { GlyphEntry } from "./types";

/**
 * Subscribe to the active style. Re-renders only when a pack actually swaps.
 *
 * The third argument is `serverResolved`, not `resolved`, and that matters as
 * much here as it does for the theme: the registry restores the user's stored
 * packs in its constructor, the server has no such storage, and a `<Glyph>`
 * renders its pack's SVG markup directly — so passing `resolved` here made the
 * hydrating client disagree with the server's HTML the moment anyone had picked
 * a pack, and React discards the whole tree over that. See
 * `PackRegistry.serverResolved`.
 */
export function useResolvedStyle(): ResolvedStyle {
  return React.useSyncExternalStore(packs.subscribe, packs.resolved, packs.serverResolved);
}

/**
 * Publishes the active style's variables onto the document root.
 *
 * Written imperatively rather than as a `<style>` tag so a swap mutates
 * existing properties instead of replacing a stylesheet — the difference is
 * whether the browser transitions the colours or flashes through unstyled.
 */
/**
 * @deprecated The single publisher is `AxfStyleRoot` in the theme layer,
 * which composes theme + packs through `resolveVariables`. This wrote the same
 * custom properties from a second effect, and which one won depended on effect
 * order. Kept as a no-op so an app still mounting it does not resurrect that.
 */
export function StylePublisher() {
  return null;
}

const FORBIDDEN = /<script|<foreignObject|\son\w+\s*=|javascript:/i;

/**
 * Per-entry memo of the sanitised, fluid markup and the parsed aspect.
 *
 * Entries are frozen data owned by the registry, so identity is a safe cache
 * key. Without this, every render of every `<Glyph>` re-runs three regexes over
 * the SVG string — invisible for one bar, real for a 450-glyph gallery
 * re-rendered by a pack swap. A WeakMap so a deregistered pack's entries are
 * collectable rather than pinned by their own cache.
 */
const PREPARED = new WeakMap<GlyphEntry, { markup: string | null; aspect: number }>();

function prepared(entry: GlyphEntry): { markup: string | null; aspect: number } {
  let hit = PREPARED.get(entry);
  if (!hit) {
    hit = { markup: assertPackSvg(entry), aspect: aspectOf(entry.svg) };
    PREPARED.set(entry, hit);
  }
  return hit;
}

/**
 * Refuse markup that could execute. Packs are compiled in today, so this never
 * fires — which is precisely why it belongs here now rather than later: the day
 * a pack is installed at runtime, the guard is already in the path instead of
 * being something someone has to remember to add.
 */
export function assertPackSvg(entry: GlyphEntry): string | null {
  if (!entry.svg) return null;
  if (FORBIDDEN.test(entry.svg)) {
    if (typeof console !== "undefined") {
      console.error(`[axf] glyph "${entry.id}" contains executable markup and was not rendered`);
    }
    return null;
  }
  return fluid(entry.svg);
}

/**
 * Strip hardcoded pixel dimensions off the root `<svg>` so the container
 * decides the size.
 *
 * Pack drawings are authored with `width="200" height="32"` for standalone
 * viewing, and those attributes WIN over any container — so a lockup asked to
 * render at 340 renders at 200 and silently ignores you. That defeats the point
 * of a sizeable glyph, and it is invisible until someone measures.
 *
 * Fixed here rather than in every pack, because a pack author writing a normal
 * SVG should not have to know this, and a rule that depends on remembering is
 * the rule this codebase keeps deleting.
 */
function fluid(svg: string): string {
  return svg.replace(/<svg\b[^>]*>/i, (tag) => {
    const cleaned = tag
      .replace(/\s(width|height)="[^"]*"/gi, "")
      .replace(/\spreserveAspectRatio="[^"]*"/gi, "");
    return cleaned.replace(
      /<svg\b/i,
      `<svg width="100%" height="100%" preserveAspectRatio="xMidYMid meet"`
    );
  });
}

/** Aspect ratio (w/h) from the viewBox, so a wide glyph is not forced square. */
function aspectOf(svg: string | undefined): number {
  const box = svg?.match(/viewBox="([\d.\s-]+)"/i)?.[1]?.trim().split(/\s+/);
  if (!box || box.length !== 4) return 1;
  const w = Number(box[2]);
  const h = Number(box[3]);
  return h > 0 && w > 0 ? w / h : 1;
}

/**
 * Height from width, keeping the drawing's own aspect.
 *
 * `size` may be a CSS LENGTH rather than a number — `var(--axf-nav-glyph)`,
 * `calc(340px * var(--axf-bar-scale) / 100)` — which is what lets the chrome
 * size its drawings from the theme without reading the theme in JS. A number
 * baked into markup is a value the server and the client can disagree about; a
 * `calc()` is one the browser resolves after both have agreed.
 */
function heightFor(width: number | string, aspect: number): number | string {
  return typeof width === "number"
    ? Math.round(width / aspect)
    : `calc((${width}) / ${aspect})`;
}

/**
 * A drawing rendered from the ENTRY, rather than looked up by id through the
 * identity in force.
 *
 * `<Glyph id>` is the right call almost everywhere: the app draws the identity
 * that is selected, and a swap repaints it. But a screen that shows a pack
 * NOBODY selected — the `/settings` picker, whose whole job is "see it before
 * you choose it" — cannot go through `resolved.glyphs`, because that map holds
 * the active branding and logo packs and nothing else. Asking it for a drawing
 * only the candidate pack carries answers "missing", so a card for a pack that
 * is not in force renders as a wall of dashed placeholders and the picker shows
 * nothing to pick between. That is exactly what it did until 2026-08-15.
 *
 * Everything else is shared with `<Glyph>` deliberately — same sanitiser, same
 * fluid rewrite, same aspect, same memo — so a preview cannot drift from what
 * the app will actually paint once the pack is chosen.
 *
 * COLOUR is a different question and stays the caller's. A drawing paints in
 * the `--gxb-*` / `--axf-brand-*` role variables, which resolve wherever it is
 * mounted, so an unselected pack previews in the ACTIVE palette unless the
 * caller scopes that pack's own `paletteVariables()` onto an ancestor. The
 * settings card does; the choice belongs there rather than here, because a
 * component that forced a palette could not draw a glyph in the app's colours.
 */
export function PackGlyph({
  entry,
  size,
  title,
  className,
  style: styleProp
}: {
  entry: GlyphEntry;
  /** Width. A number is pixels; a string is any CSS length, including `var()`. */
  size?: number | string;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { markup, aspect } = prepared(entry);
  const box = size ?? entry.size ?? 24;
  // `size` is the WIDTH. Height follows the drawing's own aspect, so a 200×32
  // lockup asked for 340 comes out 340×54 rather than squashed into a square.
  const height = heightFor(box, aspect);

  if (!markup) {
    return (
      <Box
        component="span"
        sx={{ display: "inline-block", width: box, height }}
        style={styleProp}
      />
    );
  }

  return (
    <Box
      component="span"
      className={className}
      role="img"
      aria-label={title ?? entry.label}
      title={title ?? entry.label}
      sx={{
        display: "inline-flex",
        width: box,
        height,
        lineHeight: 0,
        flexShrink: 0
      }}
      // A caller's `style` still wins over the box above, exactly as it did when
      // both were one spread — an inline declaration beats a generated class.
      style={styleProp}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

export function Glyph({
  id,
  size,
  title,
  className,
  style: styleProp
}: {
  id: string;
  /** Width. A number is pixels; a string is any CSS length, including `var()`. */
  size?: number | string;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const resolved = useResolvedStyle();
  const entry = resolved.glyphs.get(id);

  if (!entry) {
    // Visible, not silent. A missing glyph that renders as nothing is a hole
    // nobody notices until it ships.
    return (
      <Box
        component="span"
        role="img"
        aria-label={`missing glyph ${id}`}
        title={`no glyph "${id}" in ${resolved.brandingId ?? "(no pack)"}`}
        sx={{
          display: "inline-block",
          width: size ?? 16,
          height: size ?? 16,
          border: "1px dashed var(--axf-err, #e5484d)",
          borderRadius: "2px"
        }}
        style={styleProp}
      />
    );
  }

  return (
    <PackGlyph
      entry={entry}
      size={size}
      title={title}
      className={className}
      style={styleProp}
    />
  );
}
