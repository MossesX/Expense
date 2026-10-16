/**
 * @file The theme spec — every dial the engine can turn, declared as DATA.
 *
 * This is the file the whole engine hangs off. A dial is not a property on an
 * object somewhere; it is an entry here, with a type, a range and a default.
 * Everything else reads this list:
 *
 *   - the **generator** rolls a value for every dial, so a new dial is rolled
 *     the day it is added and cannot be silently skipped;
 *   - the **applier** publishes every dial, so a new dial reaches CSS with no
 *     edit to the applier;
 *   - the **SDK designer** (later) renders a control per dial, so it cannot
 *     drift out of sync with what the engine actually supports.
 *
 * That is the difference between a theme engine and a struct with colours in
 * it. GizmoX's engine has ~175 of these; this starts smaller and grows by the
 * "module drives the core" rule — but the SHAPE is the thing being ported, and
 * the shape is right from the first dial.
 *
 * Dials are grouped into subsystems purely for presentation. The engine treats
 * the list as flat.
 */

export type DialSubsystem =
  | "palette"
  | "typography"
  | "shape"
  | "motion"
  | "density"
  | "layout"
  /**
   * Which registered CHROME ASSETS the shell renders — the banner toolbar and
   * the nav menu. A subsystem of its own because these values are asset ids
   * rather than measurements.
   *
   * (A `brand` subsystem lived here until 2026-08-12, carrying
   * `brandingPack` / `logoPack` dials. It was removed on the owner's rule that
   * branding is a fixed APP SETTING — global, never rolled, never part of a
   * theme. Pack selection lives only in `PackRegistry` now.)
   */
  | "chrome";

interface DialBase {
  readonly id: string;
  readonly subsystem: DialSubsystem;
  readonly label: string;
  /** What turning this actually changes, in one line. */
  readonly effect: string;
  /** The CSS custom property this dial publishes as. */
  readonly cssVar: string;
}

export interface ColorDial extends DialBase {
  readonly kind: "color";
  readonly default: string;
  /**
   * Legibility contract. When set, the generator CLAMPS the rolled value until
   * it meets `minContrast` against the named dial — it does not reject and
   * re-roll. Rejection biases the distribution towards whatever happens to pass;
   * clamping keeps the hue the roll chose and moves only lightness.
   */
  readonly contrastAgainst?: string;
  readonly minContrast?: number;
}

export interface NumberDial extends DialBase {
  readonly kind: "number";
  readonly default: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** Appended when publishing — "px", "ms", "em", or "" for a bare number. */
  readonly unit: string;
}

export interface EnumDial<T extends string = string> extends DialBase {
  readonly kind: "enum";
  readonly default: T;
  readonly options: readonly T[];
}

export interface TextDial extends DialBase {
  readonly kind: "text";
  readonly default: string;
  /** Candidate values the roller picks from. */
  readonly options: readonly string[];
}

export type Dial = ColorDial | NumberDial | EnumDial | TextDial;

/* --------------------------------------------------------------- the dials */

export const DIALS: readonly Dial[] = [
  /* palette — the six that carry the identity, plus status */
  {
    id: "page",
    subsystem: "palette",
    kind: "color",
    label: "Page",
    effect: "The base surface everything sits on. Sets whether the theme is dark or light.",
    cssVar: "--axf-page",
    default: "#0e1013"
  },
  {
    id: "panel",
    subsystem: "palette",
    kind: "color",
    label: "Panel",
    effect: "Card and pane background, one step off the page.",
    cssVar: "--axf-panel",
    default: "#15181d"
  },
  {
    id: "panel2",
    subsystem: "palette",
    kind: "color",
    label: "Panel raised",
    effect: "The second elevation — gutters, headers, hovered rows.",
    cssVar: "--axf-panel2",
    default: "#1b1f26"
  },
  {
    id: "ink",
    subsystem: "palette",
    kind: "color",
    label: "Ink",
    effect: "Body text. The one dial that decides whether the app is readable.",
    cssVar: "--axf-ink",
    default: "#e6e8ec",
    contrastAgainst: "page",
    minContrast: 4.5
  },
  {
    id: "dim",
    subsystem: "palette",
    kind: "color",
    label: "Dim",
    effect: "Secondary text, labels, captions.",
    cssVar: "--axf-dim",
    default: "#8a93a0",
    contrastAgainst: "page",
    minContrast: 3
  },
  {
    id: "edge",
    subsystem: "palette",
    kind: "color",
    label: "Edge",
    effect: "Borders and dividers.",
    cssVar: "--axf-edge",
    default: "#2a2f38"
  },
  {
    id: "accent",
    subsystem: "palette",
    kind: "color",
    label: "Accent",
    effect: "The brand colour. Drives the brand packs' whole triad.",
    cssVar: "--axf-accent",
    default: "#ff7a1a",
    contrastAgainst: "page",
    minContrast: 3
  },
  {
    id: "accent2",
    subsystem: "palette",
    kind: "color",
    label: "Accent 2",
    effect:
      "The secondary accent — what a pack's two-tone drawings paint their detail in. " +
      "Rolled from the harmony rule; dial it to override the rotation.",
    cssVar: "--axf-accent2",
    default: "#4f8ef7",
    contrastAgainst: "page",
    minContrast: 3
  },
  {
    id: "accent3",
    subsystem: "palette",
    kind: "color",
    label: "Accent 3",
    effect: "The tertiary accent — highlights and third-voice details.",
    cssVar: "--axf-accent3",
    default: "#b06df7",
    contrastAgainst: "page",
    minContrast: 3
  },
  {
    id: "info",
    subsystem: "palette",
    kind: "color",
    label: "Info",
    effect: "Informational status — the cool fourth voice beside ok/warn/err.",
    cssVar: "--axf-info",
    default: "#6faeea",
    contrastAgainst: "page",
    minContrast: 3
  },
  {
    id: "ok",
    subsystem: "palette",
    kind: "color",
    label: "Success",
    effect: "Positive status.",
    cssVar: "--axf-ok",
    default: "#4cc38a",
    contrastAgainst: "page",
    minContrast: 3
  },
  {
    id: "warn",
    subsystem: "palette",
    kind: "color",
    label: "Warning",
    effect: "Cautionary status.",
    cssVar: "--axf-warn",
    default: "#d8c169",
    contrastAgainst: "page",
    minContrast: 3
  },
  {
    id: "err",
    subsystem: "palette",
    kind: "color",
    label: "Error",
    effect: "Failure status.",
    cssVar: "--axf-err",
    default: "#f0616d",
    contrastAgainst: "page",
    minContrast: 3
  },

  /* chrome — which registered assets draw the shell's banner and nav menu.
   *
   * These are part of a theme DESIGN: a saved look restores the bar and the
   * menu it was designed around, and the designer's Toolbar / Nav menu tabs
   * write them. Empty means "whatever the registry has active" — the app's
   * default chrome — which is what makes them safe on every theme saved before
   * they existed.
   *
   * `options` is empty because the candidates are the assets an APP has
   * registered, and core cannot enumerate those from a static spec — see the
   * optionless branch in `generate.ts`. That also means a roll NEVER changes
   * them: a roll restyles the app, it does not swap which toolbar it has.
   */
  {
    id: "bannerBar",
    subsystem: "chrome",
    kind: "text",
    label: "Banner toolbar",
    effect: "Which registered toolbar asset draws the app banner. Empty = the app's default.",
    cssVar: "--axf-banner-bar",
    default: "",
    options: []
  },
  {
    id: "navMenu",
    subsystem: "chrome",
    kind: "text",
    label: "Nav menu",
    effect: "Which registered nav-menu asset the shell places. Empty = the app's default.",
    cssVar: "--axf-nav-menu-asset",
    default: "",
    options: []
  },
  {
    id: "dashboard",
    subsystem: "chrome",
    kind: "text",
    label: "Dashboard wrapper",
    effect:
      "Which registered dashboard asset wraps the screen. Empty = the registry's default.",
    cssVar: "--axf-dashboard-asset",
    default: "",
    options: []
  },

  /* typography */
  {
    id: "sans",
    subsystem: "typography",
    kind: "text",
    label: "Interface face",
    effect: "The family everything reads in.",
    cssVar: "--axf-sans",
    default: "Inter, Segoe UI, system-ui, sans-serif",
    options: [
      "Inter, Segoe UI, system-ui, sans-serif",
      "Segoe UI, Inter, system-ui, sans-serif",
      "system-ui, Inter, sans-serif",
      "Georgia, Cambria, serif"
    ]
  },
  {
    id: "mono",
    subsystem: "typography",
    kind: "text",
    label: "Mono face",
    effect: "Code, ids, numbers.",
    cssVar: "--axf-mono",
    default: "Cascadia Mono, Consolas, monospace",
    options: [
      "Cascadia Mono, Consolas, monospace",
      "Consolas, Cascadia Mono, monospace",
      "ui-monospace, SFMono-Regular, monospace"
    ]
  },
  {
    id: "sizeBody",
    subsystem: "typography",
    kind: "number",
    label: "Body size",
    effect: "Base text size; the rest of the scale is derived from it.",
    cssVar: "--axf-size-body",
    default: 13.5,
    min: 12,
    max: 16,
    step: 0.5,
    unit: "px"
  },
  {
    id: "scaleRatio",
    subsystem: "typography",
    kind: "number",
    label: "Type scale",
    effect: "How much bigger each step is. 1.2 is gentle, 1.5 is dramatic.",
    cssVar: "--axf-scale-ratio",
    default: 1.35,
    min: 1.12,
    max: 1.6,
    step: 0.01,
    unit: ""
  },
  {
    id: "weightStrong",
    subsystem: "typography",
    kind: "number",
    label: "Strong weight",
    effect: "Weight used for titles and emphasis.",
    cssVar: "--axf-weight-strong",
    default: 700,
    min: 500,
    max: 900,
    step: 50,
    unit: ""
  },
  {
    id: "tracking",
    subsystem: "typography",
    kind: "number",
    label: "Tracking",
    effect: "Letter spacing, in hundredths of an em.",
    cssVar: "--axf-tracking",
    default: 1,
    min: -1,
    max: 6,
    step: 0.5,
    unit: "em/100"
  },

  /* shape */
  {
    id: "radius",
    subsystem: "shape",
    kind: "number",
    label: "Corner radius",
    effect: "How round cards and panes are. 0 is brutalist, 16 is soft.",
    cssVar: "--axf-radius",
    default: 8,
    min: 0,
    max: 20,
    step: 1,
    unit: "px"
  },
  {
    id: "border",
    subsystem: "shape",
    kind: "number",
    label: "Border weight",
    effect: "Thickness of every divider and outline.",
    cssVar: "--axf-border",
    default: 1,
    min: 1,
    max: 3,
    step: 1,
    unit: "px"
  },
  {
    id: "elevation",
    subsystem: "shape",
    kind: "number",
    label: "Elevation",
    effect: "Shadow depth. 0 is flat.",
    cssVar: "--axf-elevation",
    default: 6,
    min: 0,
    max: 24,
    step: 1,
    unit: "px"
  },

  /* density */
  {
    id: "density",
    subsystem: "density",
    kind: "enum",
    label: "Density",
    effect: "Padding and row height throughout.",
    cssVar: "--axf-density",
    default: "normal",
    options: ["tight", "normal", "airy"]
  },
  {
    id: "gap",
    subsystem: "density",
    kind: "number",
    label: "Gap",
    effect: "Space between panes and cards.",
    cssVar: "--axf-gap",
    default: 16,
    min: 6,
    max: 28,
    step: 1,
    unit: "px"
  },

  /* layout — where and how the chrome is arranged. These are the dials a
     rolled LAYOUT theme turns: the nav menu reads them, so a roll can move it
     to another edge, change its whole presentation style, resize its icons and
     switch its motion — hot, like every other dial. */
  {
    id: "navPlacement",
    subsystem: "layout",
    kind: "enum",
    label: "Nav placement",
    effect: "Which edge the navigation menu lives on.",
    cssVar: "--axf-nav-placement",
    default: "left",
    options: ["left", "right", "top", "bottom"]
  },
  {
    id: "navStyle",
    subsystem: "layout",
    kind: "enum",
    label: "Nav style",
    effect: "The menu's whole presentation: icon rail, labeled list, or pill buttons.",
    cssVar: "--axf-nav-style",
    default: "labeled",
    options: ["rail", "labeled", "pills"]
  },
  {
    id: "navSize",
    subsystem: "layout",
    kind: "number",
    label: "Nav extent",
    effect: "Width of a vertical nav (labeled styles). A rail ignores it and stays compact.",
    cssVar: "--axf-nav-size",
    default: 190,
    min: 150,
    max: 240,
    step: 2,
    unit: "px"
  },
  {
    id: "navGlyph",
    subsystem: "layout",
    kind: "number",
    label: "Nav icon size",
    effect: "How big the menu's pack icons draw.",
    cssVar: "--axf-nav-glyph",
    default: 16,
    min: 13,
    max: 20,
    step: 1,
    unit: "px"
  },
  {
    id: "navIndicator",
    subsystem: "layout",
    kind: "enum",
    label: "Nav indicator",
    effect: "How the active item is marked: an edge bar, a filled pill, or a glow.",
    cssVar: "--axf-nav-indicator",
    default: "bar",
    options: ["bar", "pill", "glow"]
  },
  {
    id: "navMotion",
    subsystem: "layout",
    kind: "enum",
    label: "Nav motion",
    effect: "What items do on hover: nothing, fade, slide toward the content, or lift.",
    cssVar: "--axf-nav-motion",
    default: "fade",
    options: ["none", "fade", "slide", "lift"]
  },
  {
    id: "navBackground",
    subsystem: "layout",
    kind: "enum",
    label: "Nav surface",
    effect: "Which surface the nav menu sits on — flush with the page, or raised.",
    cssVar: "--axf-nav-bg",
    default: "panel",
    options: ["page", "panel", "panel2"]
  },
  {
    id: "navGap",
    subsystem: "layout",
    kind: "number",
    label: "Nav item gap",
    effect: "Space between nav items.",
    cssVar: "--axf-nav-gap",
    default: 2,
    min: 0,
    max: 10,
    step: 1,
    unit: "px"
  },
  {
    id: "navLabelCase",
    subsystem: "layout",
    kind: "enum",
    label: "Nav label case",
    effect: "Whether nav labels read as written or as spaced uppercase.",
    cssVar: "--axf-nav-case",
    default: "normal",
    options: ["normal", "uppercase"]
  },
  {
    id: "navAlign",
    subsystem: "layout",
    kind: "enum",
    label: "Nav alignment",
    effect: "Where the items sit along the menu's axis.",
    cssVar: "--axf-nav-align",
    default: "start",
    options: ["start", "center", "end"]
  },
  {
    id: "barScale",
    subsystem: "layout",
    kind: "number",
    label: "Bar scale",
    effect:
      "Percentage multiplier on every toolbar's declared height and brand width — the theme's " +
      "handle on bars whose geometry the ASSET owns, same posture as a global font scale.",
    cssVar: "--axf-bar-scale",
    default: 100,
    min: 85,
    max: 115,
    step: 1,
    unit: ""
  },
  {
    id: "barHeight",
    subsystem: "layout",
    kind: "number",
    label: "Bar height default",
    effect: "Height for a toolbar whose asset does not declare one.",
    cssVar: "--axf-bar-h",
    default: 34,
    min: 30,
    max: 56,
    step: 1,
    unit: "px"
  },
  {
    id: "barBackground",
    subsystem: "layout",
    kind: "enum",
    label: "Bar surface default",
    effect: "Surface for a toolbar whose asset does not declare one.",
    cssVar: "--axf-bar-bg",
    default: "panel2",
    options: ["page", "panel", "panel2"]
  },
  {
    id: "contentWidth",
    subsystem: "layout",
    kind: "enum",
    label: "Content width",
    effect:
      "Max width for reading surfaces that opt in via var(--axf-content-max). " +
      "\"none\" is full-bleed.",
    cssVar: "--axf-content-max",
    default: "none",
    options: ["none", "1600px", "1360px", "1160px"]
  },
  {
    id: "pagePad",
    subsystem: "layout",
    kind: "number",
    label: "Page padding",
    effect: "Outer padding for screens that opt in via var(--axf-page-pad).",
    cssVar: "--axf-page-pad",
    default: 24,
    min: 12,
    max: 44,
    step: 2,
    unit: "px"
  },

  /* layout — INSIDE a module.
   *
   * Every layout dial above this point addresses the SHELL: the nav, the bar,
   * the page. That was the whole of "layout" until now, which is why a roll
   * could move the nav to another edge and leave every module's interior
   * pixel-identical — the engine had no vocabulary for what a module is made
   * of. `module.ts` has described a module as having "its panes rearranged by
   * a rolled layout" since it was written; these are the dials that make that
   * sentence true rather than aspirational.
   *
   * Deliberately GEOMETRY-ONLY and bounded. A roll must be able to rearrange a
   * screen without being able to break it: nothing here can drop a pane, hide
   * a card or push a control off-screen, because a roll that can make content
   * unreachable is a roll nobody dares run. Same line `MUI_UNDRIVEN` draws
   * around breakpoints and z-index. */
  {
    id: "gridColumns",
    subsystem: "layout",
    kind: "number",
    label: "Card grid columns",
    effect:
      "Column count for a module's card grid, via var(--axf-grid-columns). Cards keep " +
      "their declared span, so a narrower grid reflows them rather than dropping any.",
    cssVar: "--axf-grid-columns",
    default: 4,
    min: 2,
    max: 6,
    step: 1,
    // A column COUNT — the first number dial with no unit. `""` is what
    // NumberDial documents for a bare number, and omitting it does not
    // typecheck, which is how this got caught the moment it was written.
    unit: ""
  },
  {
    id: "gridUnit",
    subsystem: "layout",
    kind: "number",
    label: "Card grid row unit",
    effect: "Height of one grid row, via var(--axf-grid-unit). Card heights are multiples of it.",
    cssVar: "--axf-grid-unit",
    default: 132,
    min: 96,
    max: 184,
    step: 4,
    unit: "px"
  },
  {
    id: "gridGap",
    subsystem: "layout",
    kind: "number",
    label: "Card grid gap",
    effect: "Space between cards in a module's grid, via var(--axf-grid-gap).",
    cssVar: "--axf-grid-gap",
    default: 12,
    min: 4,
    max: 28,
    step: 2,
    unit: "px"
  },
  {
    id: "surfacePad",
    subsystem: "layout",
    kind: "number",
    label: "Module surface padding",
    effect:
      "Padding inside a module's own content area, via var(--axf-surface-pad). Distinct " +
      "from pagePad, which is the shell's outer padding.",
    cssVar: "--axf-surface-pad",
    default: 14,
    min: 0,
    max: 32,
    step: 2,
    unit: "px"
  },
  {
    id: "paneGutter",
    subsystem: "layout",
    kind: "number",
    label: "Split pane gutter",
    effect:
      "Thickness of the draggable divider between panes, via var(--axf-pane-gutter). " +
      "PaneLayout still MEASURES at the interaction, so a rolled gutter changes the " +
      "target size without changing how a drag is computed.",
    cssVar: "--axf-pane-gutter",
    default: 6,
    min: 2,
    max: 14,
    step: 1,
    unit: "px"
  },

  /* motion */
  {
    id: "motionMs",
    subsystem: "motion",
    kind: "number",
    label: "Transition",
    effect: "How long a state change takes. 0 disables motion.",
    cssVar: "--axf-motion",
    default: 140,
    min: 0,
    max: 400,
    step: 10,
    unit: "ms"
  },
  {
    id: "easing",
    subsystem: "motion",
    kind: "enum",
    label: "Easing",
    effect: "The curve every transition follows.",
    cssVar: "--axf-easing",
    default: "cubic-bezier(.2,.7,.3,1)",
    options: [
      "cubic-bezier(.2,.7,.3,1)",
      "cubic-bezier(.4,0,.2,1)",
      "linear",
      "cubic-bezier(.34,1.56,.64,1)"
    ]
  }
];

export const DIALS_BY_ID: ReadonlyMap<string, Dial> = new Map(DIALS.map((d) => [d.id, d]));

/** Dial ids grouped by subsystem, for any surface that lists them. */
export function dialsBySubsystem(): Record<DialSubsystem, Dial[]> {
  const out = {} as Record<DialSubsystem, Dial[]>;
  for (const dial of DIALS) {
    (out[dial.subsystem] ??= []).push(dial);
  }
  return out;
}

/** A theme is a value per dial id. Nothing more — the spec supplies meaning. */
export type ThemeValues = Record<string, string | number>;

export function defaultValues(): ThemeValues {
  const out: ThemeValues = {};
  for (const dial of DIALS) out[dial.id] = dial.default;
  return out;
}
