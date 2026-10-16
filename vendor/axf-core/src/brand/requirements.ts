/**
 * @file What a COMPLETE brand pack must contain.
 *
 * The problem this solves: brands are hot-swappable, so the moment a pack is
 * missing a drawing, some surface somewhere renders a dashed placeholder — and
 * you find out when you happen to visit that screen, not when you swap. A brand
 * you cannot swap with confidence is not really swappable.
 *
 * So "complete" is DATA. A pack is checked against this list at registration
 * and told exactly what it is missing, by id, with the geometry it has to fit.
 *
 * Geometry is the other half. A replacement lockup drawn 1:1 does not fit a
 * 6.25:1 slot — it renders letterboxed or crops, and no amount of CSS rescues a
 * drawing whose proportions are wrong. So every requirement states its viewBox
 * and aspect, and those are the numbers a designer works to.
 *
 * **These figures were measured off the running registry, not invented** — see
 * `aspect` on each entry.
 */

export type GlyphRequirementCategory =
  | "mark"
  | "lockup"
  | "wordmark"
  | "icon"
  | "spinner"
  | "watermark";

export interface GlyphRequirement {
  /** The id a pack must supply. Icons are `icon-<name>`. */
  readonly id: string;
  readonly category: GlyphRequirementCategory;
  /** Required viewBox, as authored. A pack must use these proportions. */
  readonly viewBox: string;
  /** width / height. The number that decides whether a drawing fits its slot. */
  readonly aspect: number;
  /** Largest size the framework renders it at — draw for this, not smaller. */
  readonly maxRenderedPx: number;
  /** Smallest size it must still read at. For a mark this is the hard one. */
  readonly minRenderedPx: number;
  /** Why it exists — so a designer knows what the drawing has to communicate. */
  readonly purpose: string;
  /**
   * `false` means a pack may omit it and the framework degrades gracefully.
   * Everything else is load-bearing: omit it and a surface breaks.
   */
  readonly required: boolean;
}

const ICON = (name: string, purpose: string): GlyphRequirement => ({
  id: `icon-${name}`,
  category: "icon",
  viewBox: "0 0 24 24",
  aspect: 1,
  maxRenderedPx: 30,
  minRenderedPx: 13,
  purpose,
  required: true
});

/**
 * The full contract. 54 drawings — five identity, forty-nine icons.
 *
 * Icons are drawn on a 24×24 grid and rendered as small as **13px**, which is
 * the constraint that matters: at 13px a two-tone icon with 1px detail becomes
 * mud. Draw for 13 and let it scale up, never the reverse.
 */
export const REQUIRED_GLYPHS: readonly GlyphRequirement[] = [
  {
    id: "mark",
    category: "mark",
    viewBox: "0 0 24 24",
    aspect: 1,
    maxRenderedPx: 192,
    minRenderedPx: 16,
    purpose:
      "The square identity. Used as a favicon, an app icon and the banner's brand for narrow " +
      "windows. Must still read at 16px — this is the drawing most likely to fail.",
    required: true
  },
  {
    id: "lockup",
    category: "lockup",
    viewBox: "0 0 200 32",
    aspect: 6.25,
    maxRenderedPx: 680,
    minRenderedPx: 200,
    purpose:
      "Mark plus name, horizontal. The banner's default brand at 340px wide. The 6.25:1 " +
      "proportion is fixed — a squarer lockup letterboxes inside the bar.",
    required: true
  },
  {
    id: "wordmark",
    category: "wordmark",
    viewBox: "0 0 160 32",
    aspect: 5,
    maxRenderedPx: 380,
    minRenderedPx: 120,
    purpose: "The name alone, no mark. Used where the mark already appears nearby.",
    required: true
  },
  {
    id: "spinner",
    category: "spinner",
    viewBox: "0 0 24 24",
    aspect: 1,
    maxRenderedPx: 88,
    minRenderedPx: 16,
    purpose:
      "Busy indicator. Animate with SMIL or CSS inside the SVG — it must move without a " +
      "component driving it, because it is rendered as inline markup.",
    required: true
  },
  {
    id: "watermark",
    category: "watermark",
    viewBox: "0 0 24 24",
    aspect: 1,
    maxRenderedPx: 400,
    minRenderedPx: 120,
    purpose:
      "Large faint background mark. Rendered at low opacity behind content, so it must read " +
      "as a silhouette rather than relying on internal contrast.",
    required: false
  },

  ICON("gear", "Settings and configuration."),
  ICON("search", "Find, filter by text."),
  ICON("book", "Documentation, reference, notes."),
  ICON("play", "Start, run, execute."),
  ICON("layers", "Stacks, projects, collections."),
  ICON("terminal", "Console, logs, command output."),
  ICON("plugin", "Plugins, extensions, contributions."),
  ICON("palette", "Theme, colour, appearance."),
  ICON("collapse", "Fold a panel toward the edge."),
  ICON("expand", "Unfold panels back to full width."),
  ICON("filter", "Reduce to matching items."),
  ICON("filter-off", "Clear all filters."),
  ICON("compare", "Compare one against many."),
  ICON("wrap", "Wrap long lines."),
  ICON("sync", "Keep two things in step."),
  ICON("eye", "Show or hide."),
  ICON("reload", "Re-read from source."),
  ICON("globe", "Widen scope to everything."),
  ICON("chevron-up", "Previous / up."),
  ICON("chevron-down", "Next / down."),

  // Extended by seven on 2026-08-08 (owner directive, studio-shell-init v0.2.0):
  // surfaces reference CONTRACT IDS only, so an id a surface needs is an id the
  // template must guarantee — 25 icons will not carry a framework plus an SDK,
  // and the alternative is surfaces quietly naming things outside the contract
  // again. The glyph-kit drawings landed in the same step, so no existing pack
  // went red when the requirement did.
  ICON("grid", "Tiles, modules, a launcher."),
  ICON("bolt", "Actions, power, quick commands."),
  ICON("brush", "Painting, art, drawing surfaces."),
  ICON("folder", "Files, directories, storage."),
  ICON("history", "Time, sessions, what happened before."),
  ICON("keyboard", "Hotkeys, input, shortcuts."),
  ICON("sparkle", "AI, generation, the new thing."),

  // Extended by two on 2026-08-08 (studio-shell-init P4, same rule as the seven
  // above): the command bar's dock chip and account action name these, and an
  // id a surface needs is an id the template must guarantee. The glyph-kit
  // drawings landed in the same edit, so no existing pack went red when the
  // requirement did.
  ICON("chat", "Conversation — the chat dock."),
  ICON("account", "The person using the app."),

  // Extended by six on 2026-08-12 (the AmberArt import), by the same rule as the
  // two above: AmberArt's tool rail names these ids, and an id a surface needs
  // is an id the template must guarantee. The glyph-kit drawings landed in the
  // SAME edit — which is not a nicety here. `packs/axs-studio.ts` refuses any
  // overlay entry outside this contract, so adding the drawings first and the
  // requirement second takes the whole app down with a 500 until both halves are
  // in. It did, for about a minute, which is how this comment came to be written.
  ICON("eraser", "Remove without deleting — AmberArt's eraser."),
  ICON("line", "A straight segment — the line tool."),
  ICON("rect", "A rectangle — the rectangle tool."),
  ICON("ellipse", "An ellipse — the ellipse tool."),
  ICON("fill", "Flood fill — pour colour into a region."),
  ICON("picker", "Eyedropper — take the colour under the pointer."),

  // Extended by two on 2026-08-13 (the Task Manager's lists bar), by the same
  // rule as every extension above: a surface may name CONTRACT ids only, so an
  // id a surface needs is an id the template must guarantee. The bar's three
  // actions are reload (already here), delete-all and new-list, and neither of
  // the last two had a drawing — the alternative was a delete button wearing
  // the eraser, which says "remove without deleting" and is the opposite of
  // what that button does. Drawn in `packs/glyph-kit.ts` in the SAME edit, so
  // no kit-built pack went incomplete when the requirement grew.
  ICON("trash", "Delete permanently — the destructive action."),
  ICON("plus", "Add a new thing — create."),

  // Extended by one on 2026-08-13 (the brand gallery's View menu), by the same
  // rule as every extension above: a surface may name CONTRACT ids only, so an
  // id a surface needs is an id the template must guarantee. `icon-eye` already
  // means "show or hide" and is the right drawing for the ACT of toggling; what
  // had no drawing was the STATE of being hidden, and a menu row that reports
  // hidden with an open eye says the opposite of what it means. Drawn in
  // `packs/glyph-kit.ts` in the SAME edit — adding the requirement first would
  // take every kit-built pack's coverage card red until the drawing landed.
  ICON("eye-off", "Hidden — the closed eye. The STATE, where icon-eye is the act."),

  // Extended by eleven on 2026-08-15 (AmberArt Pro), by the same rule as every
  // extension above: a surface may name CONTRACT ids only, so an id a surface
  // needs is an id the template must guarantee. AmberArt's rail grew from seven
  // tools to eighteen, and the alternative was the new eleven wearing borrowed
  // drawings — a marquee wearing `icon-rect`, a stamp wearing `icon-brush`, a
  // zoom wearing `icon-search` — which is a tooltip people have to read every
  // time. Drawn in `packs/glyph-kit.ts` in the SAME edit, for the reason the
  // AmberArt block above learned the hard way: `packs/axs-studio.ts` refuses
  // any overlay entry outside this contract, so the two halves land together
  // or the app 500s between them.
  ICON("text", "The type tool — set words on the canvas."),
  ICON("marquee", "Rectangular selection — the marching-ants region."),
  ICON("lasso", "Freehand selection — draw the region by hand."),
  ICON("wand", "Magic wand — select by colour similarity."),
  ICON("move", "Move what is selected, in any direction."),
  ICON("gradient", "A fade from one colour to another."),
  ICON("texture", "A procedural fill — pattern rather than flat colour."),
  ICON("stamp", "Clone stamp — paint one part of the image with another."),
  ICON("smudge", "Smudge — drag wet paint across the pixels."),
  ICON("zoom", "Magnify the canvas. `icon-search` finds; this one scales."),
  ICON("sticker", "A peel-and-place decal — the sticker sets.")
];

export const REQUIRED_GLYPH_IDS: readonly string[] = REQUIRED_GLYPHS.map((g) => g.id);

export interface CoverageReport {
  readonly packId: string;
  /** Required ids the pack does not supply. A surface breaks for each. */
  readonly missingRequired: readonly string[];
  /** Optional ids absent. The framework degrades gracefully. */
  readonly missingOptional: readonly string[];
  /** Supplied but with proportions that will not fit their slot. */
  readonly wrongAspect: readonly { id: string; expected: number; actual: number }[];
  /**
   * Required ids that ARE supplied but carry no measurable SVG — a `file:`
   * entry, or markup with no parseable viewBox. Before this array existed such
   * an entry passed the aspect check by not being checked: `aspectOf()` returned
   * null and the proportion test was skipped in silence, so an entirely
   * `file:`-based pack (GizmoX's is) reported `complete` without one drawing
   * ever being measured. Counted against `complete` for exactly that reason.
   */
  readonly uncheckable: readonly string[];
  /** Supplied and not in the contract — fine, but nothing will render them. */
  readonly extra: readonly string[];
  readonly complete: boolean;
}

const aspectOf = (svg: string | undefined): number | null => {
  const box = svg?.match(/viewBox="([\d.\s-]+)"/i)?.[1]?.trim().split(/\s+/);
  if (!box || box.length !== 4) return null;
  const w = Number(box[2]);
  const h = Number(box[3]);
  return w > 0 && h > 0 ? w / h : null;
};

/**
 * Check a set of supplied drawings against the contract.
 *
 * Reports rather than throws: a pack that is 90% complete is worth loading and
 * telling the truth about, and refusing it outright would make an in-progress
 * identity impossible to preview — which is exactly when you most want to look
 * at it.
 */
export function checkCoverage(
  packId: string,
  entries: readonly { id: string; svg?: string }[]
): CoverageReport {
  const supplied = new Map(entries.map((e) => [e.id, e]));
  const missingRequired: string[] = [];
  const missingOptional: string[] = [];
  const wrongAspect: { id: string; expected: number; actual: number }[] = [];
  const uncheckable: string[] = [];

  for (const req of REQUIRED_GLYPHS) {
    const entry = supplied.get(req.id);
    if (!entry) {
      (req.required ? missingRequired : missingOptional).push(req.id);
      continue;
    }
    const actual = aspectOf(entry.svg);
    if (actual === null) {
      // Supplied, but nothing to measure. For a required drawing that is a
      // fault, not a pass — "skipped" and "passed" must never be the same
      // report, or a pack with no inline SVG sails through untested.
      if (req.required) uncheckable.push(req.id);
      continue;
    }
    // 2% tolerance: a 200×32 and a 201×32 are the same drawing intent.
    if (Math.abs(actual - req.aspect) / req.aspect > 0.02) {
      wrongAspect.push({ id: req.id, expected: req.aspect, actual: +actual.toFixed(3) });
    }
  }

  const known = new Set(REQUIRED_GLYPH_IDS);
  const extra = [...supplied.keys()].filter((id) => !known.has(id));

  return {
    packId,
    missingRequired,
    missingOptional,
    wrongAspect,
    uncheckable,
    extra,
    complete: missingRequired.length === 0 && wrongAspect.length === 0 && uncheckable.length === 0
  };
}

/* --------------------------------------------------- resolving a brand mark */

/**
 * The chain a banner's brand drawing falls back through, most specific last.
 *
 * A toolbar asset names the drawing it WANTS (`command-bar` asks for GizmoX's
 * `lockup-horizontal`). That id is not in the contract above, so only the pack
 * that happens to carry it can satisfy the request — and every other pack drew
 * a dashed placeholder in the banner. That was reported as "selecting a style
 * package does not render a logo in the banner", and it was not a rendering
 * fault: the bar was asking for a drawing the contract never promised.
 *
 * The fix is to ask for the preferred drawing and then fall back through ids
 * every complete pack is REQUIRED to supply. A pack that satisfies the contract
 * therefore always puts a mark in the banner, whoever authored the bar.
 *
 * The order is deliberate: a lockup is the full identity, a wordmark is the
 * name without the mark, and the square mark is the last resort because it is
 * the least informative at banner width. The placeholder is still reachable —
 * a pack carrying none of these is genuinely incomplete and should say so.
 */
export const BRAND_GLYPH_FALLBACKS: readonly string[] = ["lockup", "wordmark", "mark"];

/**
 * The drawing a brand slot should render, given what the active identity holds.
 *
 * Returns `preferred` when it exists, then the first contract id that does. When
 * nothing resolves it returns the preferred id anyway, so `<Glyph>` renders its
 * named placeholder rather than this function inventing a silent empty box.
 */
export function resolveBrandGlyph(has: (id: string) => boolean, preferred?: string): string {
  const chain = preferred ? [preferred, ...BRAND_GLYPH_FALLBACKS] : BRAND_GLYPH_FALLBACKS;
  return chain.find(has) ?? preferred ?? BRAND_GLYPH_FALLBACKS[0];
}
