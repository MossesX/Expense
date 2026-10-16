/**
 * @file **Amber** — the house identity. A logo pack and a branding pack, plus
 * the style package that bundles and overrides them.
 *
 * The other four packs in this directory are exercises: Signal proves palette
 * compatibility with GizmoX, and Monolith / Vapor / Terra prove that one icon
 * geometry can speak in four voices. This one is different in intent — it is
 * what AmberX Studio is supposed to look like, so every identity drawing in it
 * is hand-built rather than assembled from a template.
 *
 * ## The mark
 *
 * A bead of resin at the apex of an **A**. The two legs converge into a filled
 * bead instead of a point, and a seam crosses them where an A's crossbar goes.
 * It is drawn that way for reasons that are checkable rather than tasteful:
 *
 *   - **It survives 16px.** One silhouette, one counter, three features — the
 *     bead (Ø7 units), the legs (3.4) and the seam (3.0). At 16px the thinnest
 *     of those is 2.0 device px, above the 1.5px floor where a feature starts
 *     to disappear. Nothing in it relies on internal contrast.
 *   - **It has no second reading.** Rotated 180° it is a V under a dot. The
 *     obvious alternatives all had one: a stone with an X in it is a close
 *     button, a stone with a slash through it is a prohibition sign, and a
 *     stone with a dot in it is a radio button. Those are not stylistic
 *     objections — a mark that reads as a control is a mark people will click.
 *   - **The bead is the brand, not decoration.** It reappears as the spinner:
 *     the same bead, orbiting. A loading state that is literally the logo in
 *     motion costs nothing extra and ties the two together.
 *
 * ## What is drawn here and what is not
 *
 * The five identity drawings — mark, lockup, wordmark, spinner, watermark — are
 * authored in this file. The icons — every `icon-*` in the contract — come from
 * `glyph-kit` in Amber's own voice, and that is the correct division rather
 * than a shortcut: the shared
 * geometry is what stops icon COVERAGE drifting between packs, while a mark is
 * the one thing a design system must never generate from a template.
 *
 * ## Palette
 *
 * Warm resin over near-black, with a cool teal as the harmony partner — the
 * "inclusion", the one cold thing suspended in a warm material. Measured
 * against `page` (#100c07) before it was written down, not after:
 *
 * | role | hex | on page | needs |
 * |---|---|---|---|
 * | ink | `#f6ecdd` | 16.67:1 | 4.5 |
 * | dim | `#a2907a` | 6.32:1 | 3 |
 * | accent | `#f0982e` | 8.57:1 | 3 |
 * | ok / warn / err | | 8.4 / 13.49 / 5.34 | 3 |
 * | edge | `#453521` | 1.66:1 | 1.5–3 (a border, not a design element) |
 *
 * `edge` was lifted from a first draft at 1.28:1, which is below the point a
 * hairline is actually visible. Nothing gates it — `paletteLegibility()` does
 * not check borders — which is exactly why it needed measuring by hand.
 */
import type { BrandingPackage, BrandPalette, GlyphEntry, LogoPackage } from "@axf/core";

import { buildIcons, buildWatermark, ref, svgDoc } from "./glyph-kit";
import type { Voice } from "./glyph-kit";

/** Exported for the axs-studio-brand merge, whose base recolours to Amber. */
export const AMBER_PALETTE: BrandPalette = {
  accent: "#f0982e",
  accent2: "#4ec3cf",
  accent3: "#ffcf6b",
  ink: "#f6ecdd",
  dim: "#a2907a",
  edge: "#453521",
  page: "#100c07",
  ok: "#57bd8a",
  warn: "#ffd23f",
  err: "#e5545b"
};

/**
 * Line art, round, 2.0 at a 24 grid, with the teal carrying secondary detail.
 * Distinct from every other pack on all three axes that matter at 13px: weight
 * (Signal 1.7, Vapor 1.5, Terra 2, Monolith 2.6), corner radius (3 / 6 / 2 / 0)
 * and which role the secondary uses — Signal's is `ink`, so its icons are
 * two-value; Amber's is a hue, so its icons are two-colour.
 */
const VOICE: Voice = {
  stroke: 2,
  cap: "round",
  join: "round",
  corner: 4,
  fill: "line",
  primary: "accent",
  secondary: "accent2"
};

const A = ref(AMBER_PALETTE,"accent");
const BEAD = ref(AMBER_PALETTE,"accent3");

/**
 * The mark body, shared by the mark, the watermark and the lockup so all three
 * are the same drawing rather than three drawings that agree today.
 *
 * Every coordinate is on a unit or a half-unit of the 24 grid, and the whole
 * figure sits inside the central live area (2 → 22) once round caps are
 * accounted for: the legs' caps reach y ≈ 21.8 and x ≈ 4.7, the bead's top edge
 * is y = 2.9. That margin IS the clear space when the mark is placed.
 */
const MARK_BODY =
  // Legs, converging on the bead's centre so the join is hidden beneath it.
  `<path d="M5.4 20.3 L12 6.4" fill="none" stroke="${A}" stroke-width="3.4" stroke-linecap="round"/>` +
  `<path d="M18.6 20.3 L12 6.4" fill="none" stroke="${A}" stroke-width="3.4" stroke-linecap="round"/>` +
  // The seam. Ends land inside the legs' width, so the outline stays one shape.
  `<path d="M7.7 15.6 H16.3" fill="none" stroke="${A}" stroke-width="3" stroke-linecap="round"/>` +
  // The bead, drawn last and lighter — the light caught in the resin.
  `<circle cx="12" cy="6.4" r="3.5" fill="${BEAD}"/>`;

/**
 * The spinner: the mark's own bead, orbiting a track.
 *
 * SMIL rather than CSS, because this is injected as inline markup with no
 * component and no stylesheet guaranteed to be in scope — a spinner that needs
 * an animation loop to be driven simply sits still. The bead also breathes on a
 * different period to the orbit, so the two never phase-lock into looking like
 * a single rigid rotation.
 */
const SPINNER: GlyphEntry = {
  id: "spinner",
  label: "Amber spinner",
  category: "spinner",
  size: 24,
  animated: true,
  motion: "spin",
  tags: ["spinner", "animated", "bead"],
  svg:
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" role="img" fill="none">` +
    `<circle cx="12" cy="12" r="8.5" fill="none" stroke="${ref(AMBER_PALETTE,"edge")}" stroke-width="2"/>` +
    `<g><circle cx="12" cy="3.5" r="2.6" fill="${A}">` +
    `<animate attributeName="r" values="2.6;3.2;2.6" dur="1.4s" repeatCount="indefinite"/>` +
    `</circle>` +
    `<animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" ` +
    `dur="1s" repeatCount="indefinite"/></g>` +
    `</svg>`
};

/**
 * The wordmark, set rather than outlined — `--axf-sans` is the pack's own face,
 * so the wordmark and the interface can never disagree about the brand's
 * letterforms. That is the house convention (`buildWordmark` does the same) and
 * it is kept here deliberately; what differs is the treatment, which is Amber's
 * own: heavier weight, negative tracking, and the terminal X in the bead's
 * honey rather than the body amber, so the wordmark carries the same two values
 * as the mark.
 */
const WORDMARK: GlyphEntry = {
  id: "wordmark",
  label: "AmberX wordmark",
  category: "wordmark",
  size: 160,
  shape: "wide",
  style: "solid",
  tags: ["wordmark"],
  svg:
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 32" width="160" height="32" role="img">` +
    `<text x="0" y="24" font-family="var(--axf-sans, Inter, system-ui, sans-serif)" font-size="24" ` +
    `font-weight="700" letter-spacing="-0.01em" fill="${ref(AMBER_PALETTE,"ink")}">Amber` +
    `<tspan fill="${BEAD}">X</tspan></text></svg>`
};

/**
 * The lockup. Mark at the left on the 24 grid, name beside it, discipline
 * label trailing in `dim`. The 6.25:1 proportion is fixed by the banner slot —
 * a squarer lockup letterboxes inside the bar, and no CSS rescues it.
 */
const LOCKUP: GlyphEntry = {
  id: "lockup",
  label: "AmberX horizontal lockup",
  category: "lockup",
  size: 200,
  shape: "wide",
  style: "solid",
  tags: ["lockup"],
  svg:
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 32" width="200" height="32" role="img" fill="none">` +
    `<g transform="translate(2 4)">${MARK_BODY}</g>` +
    `<text x="34" y="22" font-family="var(--axf-sans, Inter, system-ui, sans-serif)" font-size="20" ` +
    `font-weight="700" letter-spacing="-0.01em" fill="${ref(AMBER_PALETTE,"ink")}">Amber` +
    `<tspan fill="${BEAD}">X</tspan>` +
    `<tspan font-size="10.5" font-weight="500" letter-spacing="0.16em" fill="${ref(AMBER_PALETTE,"dim")}" dx="9">STUDIO</tspan>` +
    `</text></svg>`
};

export const AMBER_BRANDING: BrandingPackage = {
  id: "axf-amber-brand",
  name: "Amber Brand System",
  version: "1.0.0",
  type: "branding-package",
  description:
    "The house identity: the resin-bead A, its watermark, the bead spinner and the full icon set " +
    "in Amber's line voice — amber over near-black with a teal counterpoint.",
  author: "AmberX",
  tags: ["branding", "house", "amber", "line"],
  payload: {
    schemaVersion: 1,
    generator: "hand-drawn identity + glyph-kit icons",
    seed: "axf-amber",
    palette: AMBER_PALETTE,
    placements: ["toolbar-mark", "nav-rail", "empty-state", "loading", "page-watermark"],
    entries: [
      {
        id: "mark",
        label: "Amber mark",
        category: "mark",
        size: 24,
        shape: "square",
        style: "solid",
        tags: ["mark", "bead"],
        svg: svgDoc(MARK_BODY)
      },
      buildWatermark(MARK_BODY),
      SPINNER,
      ...buildIcons(VOICE, AMBER_PALETTE)
    ]
  }
};

export const AMBER_LOGOS: LogoPackage = {
  id: "axf-amber-logos",
  name: "Amber Logo Pack",
  version: "1.0.0",
  type: "logo-package",
  description:
    "AmberX's wordmark and horizontal lockup. Separate from the branding pack so the name can be " +
    "restyled without redrawing the icon set, and vice versa.",
  author: "AmberX",
  tags: ["logo", "wordmark", "lockup", "house"],
  payload: {
    source: "hand-drawn",
    document: "Amber",
    variants: ["wordmark", "lockup"],
    entries: [WORDMARK, LOCKUP]
  }
};
