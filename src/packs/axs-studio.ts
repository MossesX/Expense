/**
 * @file The two imports (MASTER §6): `axs-studio-brand`, `axs-studio-logos`.
 *
 * (`axs-artifact-style` was the third and died with the style-package kind on
 * 2026-08-12 — packs are drawings now, and every colour/typography/shape value
 * it carried belongs to the theme's dials. Its palette rationale is preserved
 * in git history and in PLANNING-STATE.md; nothing imports it.)
 *
 * ## axs-studio-brand — base + overlay, and the two numbers that check it
 *
 * All 728 gizmox-brand entries (inlined to `svg:` by
 * `scripts/import-gizmox-brand.mjs`) as the BASE, with Amber's contract
 * drawings as the OVERLAY, winning on id collision. The overlay is Amber's
 * contract set — branding pack *plus* logo pack — because Amber's `lockup` and
 * `wordmark` live in its logo pack, and taking only the branding half leaves
 * the merged pack two required drawings short.
 *
 * The base is 453 drawings of GizmoX's own 0.1.0 pack plus the 275-drawing
 * brand extension (`scripts/gen-brand-extension.mjs`, 2026-08-13): 50 animated
 * icons, 25 badges, 50 animated badges in a new `animated-badge` category, and
 * 150 lettered logos — the six house names, twelve layouts, nine styles. Every
 * extension id is new, so the overlay's collision count is untouched by it.
 *
 * [P0-VERIFIED, amended at P4, amended again 2026-08-12, three times on
 * 2026-08-13 and once on 2026-08-15] The merge must land on exactly **758
 * entries**. With the template at 54 required ids (32 from the 2026-08-08
 * extension, `icon-chat` / `icon-account` promoted for the command bar at P4,
 * the six AmberArt tool icons added with the AmberArt import, `icon-trash` /
 * `icon-plus` added for the Task Manager's lists bar, `icon-eye-off` added for
 * the brand gallery's View menu, and the ELEVEN added 2026-08-15 for AmberArt
 * Pro's rail — text, marquee, lasso, wand, move, gradient, texture, stamp,
 * smudge, zoom, sticker), the overlay is 54 drawings of which **24** collide
 * with the base: 728 + 54 − 24 = 758.
 *
 * The collision count did not move, because the base is GizmoX's vocabulary and
 * GizmoX never drew a marquee, a lasso, a wand, a clone stamp or a peeled
 * sticker — all eleven are new on both sides of the sum. Measured against the
 * entries file rather than reasoned about, which is worth doing: the sentence
 * this replaced named `icon-rect` and `icon-fill` as colliding and `icon-eraser`
 * and `icon-ellipse` as new, and the base has it exactly the other way round.
 * The total was right and the breakdown was not — so trust the arithmetic here,
 * and re-measure before quoting which ids it is made of.
 *
 * A different total means the overlay is wrong, so the merge REFUSES rather
 * than registers. Worth keeping: this number is not decoration. It caught the
 * AmberArt import mid-edit twice — once when the drawings were added without
 * the requirement, and once when the requirement was added without updating
 * the count here — and both times it named the exact arithmetic rather than
 * leaving a pack quietly three drawings short.
 *
 * ## axs-studio-logos — the AmberX mark, registered but bound to nothing
 *
 * The mark from the staged Artifact, at **`mark-amberx`, never `mark`**:
 * `PackRegistry.resolved()` merges branding entries first and logo entries
 * second, so logos win on collision — an entry at `mark` would silently
 * displace the house mark, the precise opposite of the owner's directive that
 * the GizmoX lockup is the brand on both dashboards. A distinct id makes
 * "registered but bound to nothing" true by construction rather than by care.
 *
 */
import { brandRoleRef, REQUIRED_GLYPH_IDS } from "@axf/core";
import type { BrandingPackage, GlyphEntry, LogoPackage } from "@axf/core";

import { AMBER_BRANDING, AMBER_LOGOS, AMBER_PALETTE } from "./amber";
import baseData from "./axs-studio-brand.entries.json";

/* ----------------------------------------------------------------- the merge */

const BASE = baseData.entries as unknown as readonly GlyphEntry[];
const OVERLAY: readonly GlyphEntry[] = [
  ...AMBER_BRANDING.payload.entries,
  ...AMBER_LOGOS.payload.entries ?? []
];

function mergeEntries(): GlyphEntry[] {
  const contract = new Set(REQUIRED_GLYPH_IDS);
  const stray = OVERLAY.filter((e) => !contract.has(e.id)).map((e) => e.id);
  if (stray.length) {
    throw new Error(
      `axs-studio-brand: overlay entries outside the contract: ${stray.join(", ")} — ` +
        "the overlay is Amber's CONTRACT drawings, nothing else"
    );
  }
  const merged = new Map<string, GlyphEntry>();
  for (const entry of BASE) merged.set(entry.id, entry);
  let collisions = 0;
  for (const entry of OVERLAY) {
    if (merged.has(entry.id)) collisions += 1;
    merged.set(entry.id, entry);
  }
  // [P0-VERIFIED, amended at P4, again 2026-08-12, three times 2026-08-13 and
  // once 2026-08-15] 758, or the overlay is wrong. Checked here, at the moment
  // the data is assembled, so a bad merge is a thrown name rather than a quietly
  // short pack discovered by a dashed placeholder at first boot. (728 base +
  // 54-drawing overlay − 24 collisions; the file docblock carries the arithmetic.)
  if (merged.size !== 758) {
    throw new Error(
      `axs-studio-brand: merge produced ${merged.size} entries (${BASE.length} base + ` +
        `${OVERLAY.length} overlay, ${collisions} collisions) — expected exactly 758`
    );
  }
  const missingSvg = [...merged.values()].filter((e) => !e.svg).map((e) => e.id);
  if (missingSvg.length) {
    throw new Error(
      `axs-studio-brand: ${missingSvg.length} entries without inline svg: ` +
        missingSvg.slice(0, 5).join(", ")
    );
  }
  return [...merged.values()];
}

export const AXS_STUDIO_BRAND: BrandingPackage = {
  id: "axs-studio-brand",
  name: "Studio Brand — GizmoX vocabulary, Amber contract",
  version: "1.0.0",
  type: "branding-package",
  description:
    "GizmoX's 453-drawing visual vocabulary plus the 275-drawing brand extension (icons, badges " +
    "and the lettered AmberX/GizmoX logo set, every one painted through role variables) merged " +
    "with Amber's contract drawings, which win on collision. 758 entries; palette Amber's.",
  author: "AmberX",
  tags: ["branding", "import", "gizmox", "amber"],
  payload: {
    schemaVersion: 1,
    generator: "scripts/import-gizmox-brand.mjs + Amber contract overlay",
    seed: "gizmox-brand-system",
    // Amber's palette: it passed every legibility gate, and Signal already
    // anchors GizmoX-palette compatibility — this pack does not need to anchor
    // it twice.
    palette: AMBER_PALETTE,
    placements: [
      "pane-backdrop", "toolbar-mark", "titlebar-mark", "tab-icon", "empty-state",
      "loading", "corner-badge", "page-watermark", "float-window-mark", "nav-rail"
    ],
    entries: mergeEntries()
  }
};

/* ------------------------------------------------------------------ the mark */

/**
 * The AmberX mark from the staged Artifact (`assets/import/artifacts/
 * amberx-mark.svg`): four rounded arms on two 45° axes around a squared core.
 *
 * Converted, not copied — the staged file paints in the Artifact's own
 * `var(--accent)` / `var(--bg)` / `var(--ink)`, which resolve to NOTHING here,
 * plus bare `#fff` highlight strips that fail the no-bare-hex assertion. All
 * five paints go through `brandRoleRef()` (accent → accent, bg → page,
 * ink → ink, the white highlights → ink at their original opacity). Its
 * gradient was `id="account-glow"` — a bare global DOM id lifted from the
 * Artifact's account panel; namespaced here, or two copies of the mark on one
 * page would both point `url(#account-glow)` at whichever `<defs>` the browser
 * saw first.
 */
const MARK_ACCENT = brandRoleRef("accent", "#ff7a1a");
const MARK_PAGE = brandRoleRef("page", "#080706");
const MARK_INK = brandRoleRef("ink", "#f7f2ea");

const MARK_AMBERX: GlyphEntry = {
  id: "mark-amberx",
  label: "AmberX mark (artifact)",
  category: "mark",
  size: 96,
  shape: "square",
  style: "solid",
  animated: false,
  motion: "none",
  tags: ["mark", "amberx", "artifact"],
  svg:
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="96" height="96" role="img">` +
    `<defs><radialGradient id="axs-mark-amberx-glow" cx="50%" cy="50%" r="50%">` +
    `<stop offset="0%" stop-color="${MARK_ACCENT}" stop-opacity=".36"/>` +
    `<stop offset="55%" stop-color="${MARK_ACCENT}" stop-opacity=".12"/>` +
    `<stop offset="100%" stop-color="${MARK_ACCENT}" stop-opacity="0"/>` +
    `</radialGradient></defs>` +
    `<circle cx="100" cy="100" r="100" fill="url(#axs-mark-amberx-glow)"/>` +
    `<circle cx="100" cy="100" r="93" fill="none" stroke="${MARK_ACCENT}" stroke-opacity=".10" stroke-width="1.5"/>` +
    `<circle cx="100" cy="100" r="86" fill="none" stroke="${MARK_ACCENT}" stroke-opacity=".32" stroke-width="2.5"/>` +
    `<g transform="translate(100,100) scale(0.62)">` +
    `<g transform="rotate(45)">` +
    `<rect x="10" y="-16" width="96" height="32" rx="16" fill="${MARK_ACCENT}"/>` +
    `<rect x="-106" y="-16" width="96" height="32" rx="16" fill="${MARK_ACCENT}"/>` +
    `<rect x="16" y="-15" width="84" height="2.5" rx="1.25" fill="${MARK_INK}" opacity=".22"/>` +
    `<rect x="-100" y="-15" width="84" height="2.5" rx="1.25" fill="${MARK_INK}" opacity=".22"/>` +
    `</g>` +
    `<g transform="rotate(-45)">` +
    `<rect x="10" y="-16" width="96" height="32" rx="16" fill="${MARK_ACCENT}"/>` +
    `<rect x="-106" y="-16" width="96" height="32" rx="16" fill="${MARK_ACCENT}"/>` +
    `<rect x="16" y="-15" width="84" height="2.5" rx="1.25" fill="${MARK_INK}" opacity=".22"/>` +
    `<rect x="-100" y="-15" width="84" height="2.5" rx="1.25" fill="${MARK_INK}" opacity=".22"/>` +
    `</g>` +
    `<g transform="rotate(45)">` +
    `<rect x="-22" y="-22" width="44" height="44" rx="15" fill="${MARK_PAGE}"/>` +
    `<rect x="-15" y="-15" width="30" height="30" rx="8" fill="${MARK_INK}"/>` +
    `</g></g></svg>`
};

export const AXS_STUDIO_LOGOS: LogoPackage = {
  id: "axs-studio-logos",
  name: "Studio Logos — the AmberX mark",
  version: "1.0.0",
  type: "logo-package",
  description:
    "The AmberX mark from the owner's published Artifact, converted to the role vocabulary. " +
    "Registered at mark-amberx — a non-colliding id, so it displaces nothing: the GizmoX lockup " +
    "stays the brand on both dashboards, and the swap, when it comes, is one glyph id.",
  author: "AmberX",
  tags: ["logo", "amberx", "artifact"],
  payload: {
    source: "artifact",
    document: "AmberX Admin Dashboard — GizmoX Build Systems (demo)",
    variants: ["mark-amberx"],
    entries: [MARK_AMBERX]
  }
};
