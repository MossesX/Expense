/**
 * @file Derived tokens, declared as DATA — the implementation-scalability half.
 *
 * A dial is a value someone sets. A **derived token** is computed from dials:
 * the type scale from body-size and ratio, the shadow from one elevation
 * number, padding from a density word. They are the majority of what CSS
 * actually receives, and they were hardcoded in a block inside `apply.ts`.
 *
 * That block is exactly the thing that stops a theme engine scaling. Adding a
 * token meant editing the applier, so the applier grew a branch per token and
 * became the file nobody wants to touch. GizmoX's engine reached ~175 fields
 * that way.
 *
 * Declared here instead, each with the dials it reads and a pure function. The
 * applier loops. **Adding a derived token is one entry in this array and no
 * edit anywhere else** — same property the `DIALS` list already gives the
 * generator and the designer.
 *
 * `from` is not decoration: it is the dependency list, so a surface can show
 * what a token is computed from, and a future incremental publisher can skip
 * recomputing tokens whose inputs did not change.
 */
import { mix } from "./color";
import type { ThemeValues } from "./spec";

const HEX6 = /^#[0-9a-fA-F]{6}$/;

export interface DerivedToken {
  /** The CSS custom property this publishes as. */
  readonly cssVar: string;
  /** Dial ids this reads. The dependency list. */
  readonly from: readonly string[];
  /** One line: what it is and why it is derived rather than dialled. */
  readonly note: string;
  readonly compute: (values: ThemeValues) => string;
}

const num = (v: ThemeValues, id: string, fallback: number): number => {
  const raw = Number(v[id]);
  return Number.isFinite(raw) ? raw : fallback;
};

const round = (n: number): number => Math.round(n * 100) / 100;

const DENSITY_PAD: Record<string, string> = {
  tight: "6px 9px",
  normal: "10px 14px",
  airy: "15px 20px"
};

const DENSITY_ROW: Record<string, string> = {
  tight: "26px",
  normal: "32px",
  airy: "40px"
};

/* ---------------------------------------------------------------- layout ---
 * The layout dials publish their raw value (`--axf-nav-placement: top`), which
 * is a WORD, not something CSS can lay anything out with. So the chrome used to
 * read those words back out of the store in JS and bake the result into inline
 * styles — `flexDirection: "column"`, `width: 190`, `padding: "10px 8px"`.
 *
 * That is what made the theme structural, and it cost an app-wide hydration
 * failure: the server has no `localStorage`, so it rendered those literals from
 * the DEFAULT theme while the client rendered them from the stored one, and
 * React threw the server tree away on every route.
 *
 * Translating each word into the CSS the chrome actually needs — here, as data —
 * means the chrome's markup no longer depends on the theme at all. Its geometry
 * arrives the same way its colours always did: as custom properties the theme
 * publishes and the browser resolves. The chrome renders identically on both
 * runtimes, and a roll that moves the nav to another edge repaints without
 * re-rendering anything.
 */

const word = (v: ThemeValues, id: string, fallback: string): string =>
  String(v[id] ?? fallback);

/** Vertical placements put the menu beside the content, not above it. */
const vertical = (v: ThemeValues): boolean => {
  const placement = word(v, "navPlacement", "left");
  return placement === "left" || placement === "right";
};

const rail = (v: ThemeValues): boolean => word(v, "navStyle", "labeled") === "rail";

/** A surface dial names a token; `var()` defers the lookup so a pack or a later
 *  derivation can still change what that token IS. */
const SURFACES = new Set(["page", "panel", "panel2"]);
const surfaceRef = (v: ThemeValues, id: string, fallback: string): string => {
  const name = word(v, id, fallback);
  return `var(--axf-${SURFACES.has(name) ? name : fallback})`;
};

const NAV_FLOW: Record<string, string> = {
  left: "row",
  right: "row-reverse",
  top: "column",
  bottom: "column-reverse"
};

/** Border-width shorthand putting the menu's ONE rule on the content side. */
const NAV_BORDERS: Record<string, string> = {
  left: "0 var(--axf-border) 0 0",
  right: "0 0 0 var(--axf-border)",
  top: "0 0 var(--axf-border) 0",
  bottom: "var(--axf-border) 0 0 0"
};

/** Inset direction for the `bar` indicator — it faces the content too. A bar
 *  pointing off-screen reads as decoration rather than as "you are here". */
const NAV_BAR_INSET: Record<string, string> = {
  left: "inset -2px 0 0 0 var(--axf-accent)",
  right: "inset 2px 0 0 0 var(--axf-accent)",
  top: "inset 0 -2px 0 0 var(--axf-accent)",
  bottom: "inset 0 2px 0 0 var(--axf-accent)"
};

const ALIGN: Record<string, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end"
};

/**
 * The type scale.
 *
 * Five sizes from two dials rather than five dials, because declared
 * independently they drift out of proportion the first time someone nudges one.
 * Deriving them keeps the authored hierarchy intact at every body size — the
 * same reasoning behind a percentage font scale rather than a pixel one.
 */
const scale = (step: number): DerivedToken["compute"] => (v) => {
  const body = num(v, "sizeBody", 13.5);
  const ratio = num(v, "scaleRatio", 1.35);
  return `${round(body * Math.pow(ratio, step))}px`;
};

/**
 * One elevation number to one shadow. Exported because it has TWO consumers:
 * the `--axf-shadow` token below, and the MUI bridge, which has to expand this
 * single dial into MUI's 25-entry `shadows` ramp (`theme/mui.ts`).
 *
 * It is exported rather than copied for the reason the whole of this file
 * exists: a second implementation of a derivation is a second answer, and the
 * two drift the first time one of them is tuned. A rolled theme's cards and an
 * MUI `<Paper>` sitting beside them must cast the same shadow because they came
 * from the same function, not because someone kept two formulas in step.
 */
export function shadowFor(elevation: number): string {
  const e = Number.isFinite(elevation) ? elevation : 6;
  if (e <= 0) return "none";
  const alpha = Math.min(0.55, 0.16 + e * 0.016).toFixed(2);
  return `0 ${round(e * 0.7)}px ${round(e * 2.6)}px rgba(0,0,0,${alpha})`;
}

export const DERIVED: readonly DerivedToken[] = [
  {
    cssVar: "--axf-size-micro",
    from: ["sizeBody", "scaleRatio"],
    note: "One step below label. Captions, ids, counts.",
    compute: scale(-2)
  },
  {
    cssVar: "--axf-size-label",
    from: ["sizeBody", "scaleRatio"],
    note: "One step below body. Field labels, secondary text.",
    compute: scale(-1)
  },
  {
    cssVar: "--axf-size-body",
    from: ["sizeBody"],
    note: "The base. Everything else is a power of the ratio away from it.",
    compute: (v) => `${round(num(v, "sizeBody", 13.5))}px`
  },
  {
    cssVar: "--axf-size-title",
    from: ["sizeBody", "scaleRatio"],
    note: "One step above body.",
    compute: scale(1)
  },
  {
    cssVar: "--axf-size-hero",
    from: ["sizeBody", "scaleRatio"],
    note: "Two steps above body.",
    compute: scale(2)
  },
  {
    cssVar: "--axf-shadow",
    from: ["elevation"],
    note: "Offset, blur and alpha from ONE elevation number, so depth stays coherent.",
    compute: (v) => shadowFor(num(v, "elevation", 6))
  },
  {
    cssVar: "--axf-pad",
    from: ["density"],
    note: "Density word to real padding. A word is authorable; a pixel pair is not.",
    compute: (v) => DENSITY_PAD[String(v.density ?? "normal")] ?? DENSITY_PAD.normal
  },
  {
    cssVar: "--axf-row",
    from: ["density"],
    note: "Row height for the same density word.",
    compute: (v) => DENSITY_ROW[String(v.density ?? "normal")] ?? DENSITY_ROW.normal
  },
  {
    cssVar: "--axf-radius-tight",
    from: ["radius"],
    note: "Half the main radius, so nested corners stay in proportion.",
    compute: (v) => `${round(Math.max(0, num(v, "radius", 8) * 0.5))}px`
  },
  {
    cssVar: "--axf-selection",
    from: ["page", "accent"],
    note:
      "Selected-row / highlight background — the accent carried 22% of the way into the page, " +
      "so it follows both dials and stays legible under the theme's own ink.",
    compute: (v) => {
      const page = String(v.page ?? "");
      const accent = String(v.accent ?? "");
      return HEX6.test(page) && HEX6.test(accent) ? mix(page, accent, 0.22) : accent || "#4f8ef7";
    }
  },
  {
    cssVar: "--axf-focus",
    from: ["accent2", "accent"],
    note:
      "Focus-ring colour. The secondary accent when the theme has one, so focus reads as " +
      "distinct from selection; the accent otherwise.",
    compute: (v) => String(v.accent2 ?? v.accent ?? "#4f8ef7")
  },

  /* ------------------------------------------------------- toolbar geometry */
  {
    cssVar: "--axf-bar-surface",
    from: ["barBackground"],
    note: "The bar-surface dial names a token; this is the reference the CSS uses.",
    compute: (v) => surfaceRef(v, "barBackground", "panel2")
  },
  {
    cssVar: "--axf-bar-thickness",
    from: ["barHeight", "barScale"],
    note:
      "Height for a bar whose asset declares none, already scaled. An asset that " +
      "DOES declare one scales its own number by --axf-bar-scale the same way.",
    compute: () => "calc(var(--axf-bar-h) * var(--axf-bar-scale) / 100)"
  },

  /* ----------------------------------------------------------- nav geometry */
  {
    cssVar: "--axf-nav-flow",
    from: ["navPlacement"],
    note:
      "Direction of the SHELL row that holds the menu and the content — which of " +
      "the two comes first. Not the menu's own axis; see --axf-nav-axis.",
    compute: (v) => NAV_FLOW[word(v, "navPlacement", "left")] ?? NAV_FLOW.left
  },
  {
    cssVar: "--axf-nav-axis",
    from: ["navPlacement"],
    note:
      "Direction the menu stacks its OWN items in — the perpendicular of the shell " +
      "flow, because a menu down the left edge is a column inside a row. Collapsing " +
      "the two into one variable laid every item out horizontally off-screen.",
    compute: (v) => (vertical(v) ? "column" : "row")
  },
  {
    cssVar: "--axf-nav-surface",
    from: ["navBackground"],
    note: "The nav-surface dial names a token; this is the reference the CSS uses.",
    compute: (v) => surfaceRef(v, "navBackground", "panel")
  },
  {
    cssVar: "--axf-nav-w",
    from: ["navPlacement", "navStyle", "navSize"],
    note: "Menu width: the extent when vertical and labelled, compact for a rail, auto when horizontal.",
    compute: (v) => (vertical(v) ? (rail(v) ? "54px" : "var(--axf-nav-size)") : "auto")
  },
  {
    cssVar: "--axf-nav-h",
    from: ["navPlacement", "navStyle"],
    note: "Menu height: a fixed strip when horizontal, auto when it runs down an edge.",
    compute: (v) => (vertical(v) ? "auto" : rail(v) ? "40px" : "44px")
  },
  {
    cssVar: "--axf-nav-pad",
    from: ["navPlacement", "navStyle"],
    note: "Menu padding — a rail is tight on all sides, a bar only on its long axis.",
    compute: (v) => (rail(v) ? "6px" : vertical(v) ? "10px 8px" : "0 10px")
  },
  {
    cssVar: "--axf-nav-justify",
    from: ["navAlign"],
    note: "Where items sit along the menu's own axis.",
    compute: (v) => ALIGN[word(v, "navAlign", "start")] ?? ALIGN.start
  },
  {
    cssVar: "--axf-nav-cross",
    from: ["navPlacement"],
    note: "Cross-axis alignment: items fill a vertical menu's width, centre in a bar.",
    compute: (v) => (vertical(v) ? "stretch" : "center")
  },
  {
    cssVar: "--axf-nav-borders",
    from: ["navPlacement", "border"],
    note: "Border-width shorthand giving the menu one rule, on the content side.",
    compute: (v) => NAV_BORDERS[word(v, "navPlacement", "left")] ?? NAV_BORDERS.left
  },
  {
    cssVar: "--axf-nav-div-w",
    from: ["navPlacement"],
    note: "Divider width — a hairline across a vertical menu, a tick in a bar.",
    compute: (v) => (vertical(v) ? "auto" : "1px")
  },
  {
    cssVar: "--axf-nav-div-h",
    from: ["navPlacement"],
    note: "Divider height, the other half of the same pair.",
    compute: (v) => (vertical(v) ? "1px" : "16px")
  },
  {
    cssVar: "--axf-nav-div-m",
    from: ["navPlacement"],
    note: "Divider margin, so it breathes along whichever axis the menu runs.",
    compute: (v) => (vertical(v) ? "6px 4px" : "0 4px")
  },

  /* --------------------------------------------------------------- nav items */
  {
    cssVar: "--axf-nav-item-pad",
    from: ["navPlacement", "navStyle"],
    note: "Item padding for the three nav styles.",
    compute: (v) => (rail(v) ? "8px" : vertical(v) ? "7px 10px" : "5px 11px")
  },
  {
    cssVar: "--axf-nav-item-justify",
    from: ["navStyle"],
    note: "A rail centres its lone glyph; a labelled item starts at the leading edge.",
    compute: (v) => (rail(v) ? "center" : "flex-start")
  },
  {
    cssVar: "--axf-nav-item-radius",
    from: ["navStyle", "navIndicator"],
    note: "Fully round for pills (whether the STYLE or the INDICATOR asked), tight otherwise.",
    compute: (v) =>
      word(v, "navStyle", "labeled") === "pills" || word(v, "navIndicator", "bar") === "pill"
        ? "999px"
        : "var(--axf-radius-tight)"
  },
  {
    cssVar: "--axf-nav-label",
    from: ["navStyle"],
    note:
      "Whether an item's label is drawn. A rail hides it in CSS rather than omitting " +
      "the element, so the menu's MARKUP does not depend on the theme.",
    compute: (v) => (rail(v) ? "none" : "inline")
  },
  {
    cssVar: "--axf-nav-label-case",
    from: ["navLabelCase"],
    note: "`text-transform` for labels — the dial's own word is not a valid CSS value.",
    compute: (v) => (word(v, "navLabelCase", "normal") === "uppercase" ? "uppercase" : "none")
  },
  {
    cssVar: "--axf-nav-label-track",
    from: ["navLabelCase"],
    note: "Uppercase labels need tracking to stay readable; sentence case does not.",
    compute: (v) => (word(v, "navLabelCase", "normal") === "uppercase" ? "0.08em" : "normal")
  },
  {
    cssVar: "--axf-nav-label-size",
    from: ["navLabelCase"],
    note: "Uppercase reads larger at the same size, so it is set slightly smaller.",
    compute: (v) => (word(v, "navLabelCase", "normal") === "uppercase" ? "0.92em" : "1em")
  },
  {
    cssVar: "--axf-nav-section",
    from: ["navStyle", "navPlacement"],
    note: "Section headings have nowhere to live in a rail or a horizontal bar.",
    compute: (v) => (rail(v) || !vertical(v) ? "none" : "inline")
  },

  /* ----------------------------------------------------- nav active + hover */
  {
    cssVar: "--axf-nav-active-bg",
    from: ["navIndicator"],
    note: "Only the pill indicator fills the active item.",
    compute: (v) => (word(v, "navIndicator", "bar") === "pill" ? "var(--axf-accent)" : "transparent"),
  },
  {
    cssVar: "--axf-nav-active-fg",
    from: ["navIndicator"],
    note: "A filled pill needs the page colour on top of it; every other indicator accents the text.",
    compute: (v) => (word(v, "navIndicator", "bar") === "pill" ? "var(--axf-page)" : "var(--axf-accent)")
  },
  {
    cssVar: "--axf-nav-active-shadow",
    from: ["navIndicator", "navPlacement"],
    note: "The edge bar or the glow — whichever the indicator dial asked for.",
    compute: (v) => {
      const indicator = word(v, "navIndicator", "bar");
      if (indicator === "glow") return "0 0 12px var(--axf-accent)";
      if (indicator !== "bar") return "none";
      return NAV_BAR_INSET[word(v, "navPlacement", "left")] ?? NAV_BAR_INSET.left;
    }
  },
  {
    cssVar: "--axf-nav-hover-bg",
    from: ["navMotion"],
    note: "Hover surface. `none` really means none — the item must not light up at all.",
    compute: (v) => (word(v, "navMotion", "fade") === "none" ? "transparent" : "var(--axf-panel2)")
  },
  {
    cssVar: "--axf-nav-hover-transform",
    from: ["navMotion"],
    note: "Slide nudges toward the content, lift raises; the rest hold still.",
    compute: (v) => {
      const motion = word(v, "navMotion", "fade");
      return motion === "slide"
        ? "translate(2px, 0)"
        : motion === "lift"
          ? "translateY(-1px)"
          : "none";
    }
  },
  {
    cssVar: "--axf-nav-hover-shadow",
    from: ["navMotion"],
    note: "Only lift casts one — a raised thing with no shadow does not read as raised.",
    compute: (v) => (word(v, "navMotion", "fade") === "lift" ? "var(--axf-shadow)" : "none")
  }
];

/** Compute every derived token. The applier calls this and publishes the map. */
export function derivedVariables(values: ThemeValues): Record<string, string> {
  const out: Record<string, string> = {};
  for (const token of DERIVED) out[token.cssVar] = token.compute(values);
  return out;
}

/** Which derived tokens read a given dial — for a designer surface, and for
 *  an incremental publisher that skips untouched branches. */
export function dependentsOf(dialId: string): DerivedToken[] {
  return DERIVED.filter((t) => t.from.includes(dialId));
}
