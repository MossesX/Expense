/**
 * @file The dashboard SPEC — every dial a wrapper can turn, declared as DATA,
 * plus the serialisable `DashboardSpec` an authored wrapper actually is.
 *
 * This is the file that turns `dashboard` from a code-only asset kind into an
 * AUTHORABLE one. Until now a wrapper was a `render` function and nothing
 * else, so the only way to have a new one was to write a `.tsx` file — which
 * is why toolbars and nav menus had a designer and dashboards did not. A
 * function cannot be saved to a kv document, sent through a prop or rolled
 * from a seed.
 *
 * So a wrapper is now a RECORD, and `Wrapper.tsx` is the one interpreter of
 * it. The relationship to `theme/spec.ts` is deliberate and exact:
 *
 *   - the **dials below** are declared data, so a dial added here appears in
 *     the designer, is rolled by the generator and reaches CSS with no edit to
 *     either — the same property `theme/spec.ts` exists to have;
 *   - the **generator** rolls every ACTIVE dial from its declared range, so a
 *     new dial is rolled the day it is added rather than silently skipped;
 *   - the **renderer** publishes every dial as `--axd-*` on the wrapper's own
 *     element — NEVER on `:root`. The one-publisher rule (`theme/resolve.ts`)
 *     says `AxfStyleRoot` alone owns `--axf-*` on the document, and a wrapper
 *     that republished theme variables would be the second author the whole
 *     engine is arranged to prevent. A separate namespace on a separate
 *     element is not a second publisher; it is a different variable.
 *
 * ## Active, and why every dial has a switch
 *
 * A dashboard's default is *the theme's* default: with no dial active, the
 * wrapper renders its children with the chrome the theme already implies and
 * adds nothing. Turning a dial ON is what makes the wrapper differ from the
 * theme — so "active" is not a UI convenience, it is the difference between
 * "the dashboard has an opinion here" and "the theme decides". An inactive
 * dial resolves to its DEFAULT rather than to its stored value, which is what
 * lets a roll be kept in the record and switched off without being lost.
 *
 * ## Inherit, and why it is a separate set
 *
 * `active` decides what the WRAPPER does. `inherit` decides what the THEME
 * takes when the dashboard is applied — the theme dials (from `theme/spec.ts`,
 * not from here) whose rolled values are written into the theme store. The two
 * are separate because they answer different questions: a rolled dashboard can
 * carry a whole palette and hand over only the three dials you actually wanted
 * out of it. `inherit` is only meaningful for ids `active` also holds; the
 * resolver filters rather than the chokepoint refusing, because a record that
 * has switched a dial off must not become invalid.
 */
import { rng } from "../theme/generate";

/** Dashboard dial groups. Presentation only — the roller treats them flat. */
export type DashSubsystem =
  /** Where the wrapper's own furniture sits and how much room it takes. */
  | "layout"
  /** What the furniture SHOWS — bands, strips, card treatment. */
  | "display"
  /** How it paints — surfaces, rules, shadow, tint. */
  | "style";

interface DashDialBase {
  readonly id: string;
  readonly subsystem: DashSubsystem;
  readonly label: string;
  /** What turning this actually changes, in one line. */
  readonly effect: string;
  /** The custom property it publishes as, on the WRAPPER — never on `:root`. */
  readonly cssVar: string;
}

export interface DashEnumDial extends DashDialBase {
  readonly kind: "enum";
  readonly default: string;
  readonly options: readonly string[];
}

export interface DashNumberDial extends DashDialBase {
  readonly kind: "number";
  readonly default: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** Appended when publishing — "px", "%", or "" for a bare number. */
  readonly unit: string;
}

export type DashDial = DashEnumDial | DashNumberDial;

/** A wrapper is a value per dial id. Nothing more — the spec supplies meaning. */
export type DashValues = Record<string, string | number>;

/* ---------------------------------------------------------------- the dials */

/**
 * Every layout, display and style option a wrapper has.
 *
 * Bounded on purpose, exactly as the module-interior theme dials are: nothing
 * here can hide the screen, drop a band's content or push a control off the
 * edge. A rolled wrapper must be able to rearrange the chrome without being
 * able to break it, or it is a roll nobody dares run.
 */
export const DASH_DIALS: readonly DashDial[] = [
  /* ------------------------------------------------------------- layout -- */
  {
    id: "frame",
    subsystem: "layout",
    kind: "enum",
    label: "Frame",
    effect: "How the screen is framed inside the wrapper — nothing, a rule, an outline, or a card.",
    cssVar: "--axd-frame",
    default: "none",
    options: ["none", "rule", "outline", "inset", "card"]
  },
  {
    id: "screenPad",
    subsystem: "layout",
    kind: "number",
    label: "Screen padding",
    effect: "Room the wrapper leaves around the screen it frames.",
    cssVar: "--axd-screen-pad",
    default: 0,
    min: 0,
    max: 40,
    step: 2,
    unit: "px"
  },
  {
    id: "screenMax",
    subsystem: "layout",
    kind: "enum",
    label: "Screen width",
    effect: "Caps the screen's reading width. \"none\" is full-bleed.",
    cssVar: "--axd-screen-max",
    default: "none",
    options: ["none", "1600px", "1360px", "1160px", "980px"]
  },
  {
    id: "screenAlign",
    subsystem: "layout",
    kind: "enum",
    label: "Screen alignment",
    effect: "Where the capped column sits. Ignored at full width.",
    cssVar: "--axd-screen-align",
    default: "center",
    options: ["start", "center", "end"]
  },
  {
    id: "headBand",
    subsystem: "layout",
    kind: "enum",
    label: "Header band",
    effect: "The strip above the screen — absent, slim, or tall enough for two readings.",
    cssVar: "--axd-head-band",
    default: "none",
    options: ["none", "slim", "tall"]
  },
  {
    id: "footBand",
    subsystem: "layout",
    kind: "enum",
    label: "Footer band",
    effect: "The strip pinned below the screen.",
    cssVar: "--axd-foot-band",
    default: "none",
    options: ["none", "slim", "tall"]
  },
  {
    id: "bandPad",
    subsystem: "layout",
    kind: "number",
    label: "Band padding",
    effect: "Horizontal room inside the header and footer bands.",
    cssVar: "--axd-band-pad",
    default: 16,
    min: 4,
    max: 40,
    step: 2,
    unit: "px"
  },
  {
    id: "corner",
    subsystem: "layout",
    kind: "number",
    label: "Frame radius",
    effect: "How round the framed screen's corners are. Ignored when the frame is off.",
    cssVar: "--axd-corner",
    default: 8,
    min: 0,
    max: 22,
    step: 1,
    unit: "px"
  },

  /* ------------------------------------------------------------ display -- */
  {
    id: "headLeft",
    subsystem: "display",
    kind: "enum",
    label: "Header · left",
    effect: "What the header band reads on the left.",
    cssVar: "--axd-head-left",
    default: "title",
    options: ["none", "title", "route", "module", "core"]
  },
  {
    id: "headRight",
    subsystem: "display",
    kind: "enum",
    label: "Header · right",
    effect: "What the header band reads on the right.",
    cssVar: "--axd-head-right",
    default: "route",
    options: ["none", "route", "clock", "core", "modules"]
  },
  {
    id: "footLeft",
    subsystem: "display",
    kind: "enum",
    label: "Footer · left",
    effect: "What the footer strip reads on the left.",
    cssVar: "--axd-foot-left",
    default: "core",
    options: ["none", "title", "route", "module", "core", "modules"]
  },
  {
    id: "footRight",
    subsystem: "display",
    kind: "enum",
    label: "Footer · right",
    effect: "What the footer strip reads on the right.",
    cssVar: "--axd-foot-right",
    default: "clock",
    options: ["none", "route", "clock", "core", "modules"]
  },
  {
    id: "bandCase",
    subsystem: "display",
    kind: "enum",
    label: "Band case",
    effect: "Whether band text reads as written or as spaced uppercase.",
    cssVar: "--axd-band-case",
    default: "uppercase",
    options: ["normal", "uppercase"]
  },
  {
    id: "bandTracking",
    subsystem: "display",
    kind: "number",
    label: "Band tracking",
    effect: "Letter spacing in the bands, in hundredths of an em.",
    cssVar: "--axd-band-tracking",
    default: 18,
    min: 0,
    max: 34,
    step: 1,
    unit: "em/100"
  },
  {
    id: "cards",
    subsystem: "display",
    kind: "enum",
    label: "Cards",
    effect:
      "How panels inside this wrapper are drawn. ACTIVE, the wrapper restyles every " +
      "MUI surface below it; off, each surface keeps whatever the theme gave it.",
    cssVar: "--axd-cards",
    default: "theme",
    options: ["theme", "flat", "outlined", "raised", "glass"]
  },
  {
    id: "cardRadius",
    subsystem: "display",
    kind: "number",
    label: "Card radius",
    effect: "Corner radius for panels inside the wrapper. Applies with the Cards dial.",
    cssVar: "--axd-card-radius",
    default: 8,
    min: 0,
    max: 22,
    step: 1,
    unit: "px"
  },
  {
    id: "cardPad",
    subsystem: "display",
    kind: "number",
    label: "Card padding",
    effect: "Room inside a panel. Applies with the Cards dial.",
    cssVar: "--axd-card-pad",
    default: 12,
    min: 4,
    max: 30,
    step: 1,
    unit: "px"
  },
  {
    id: "scroll",
    subsystem: "display",
    kind: "enum",
    label: "Scroll",
    effect:
      "Whether the screen scrolls inside the wrapper (bands stay pinned) or the whole " +
      "wrapper scrolls with it.",
    cssVar: "--axd-scroll",
    default: "screen",
    options: ["screen", "wrapper"]
  },

  /* -------------------------------------------------------------- style -- */
  {
    id: "surface",
    subsystem: "style",
    kind: "enum",
    label: "Wrapper surface",
    effect: "The backdrop the whole wrapper sits on.",
    cssVar: "--axd-surface",
    default: "page",
    options: ["page", "panel", "panel2"]
  },
  {
    id: "bandSurface",
    subsystem: "style",
    kind: "enum",
    label: "Band surface",
    effect: "The backdrop the header and footer bands sit on.",
    cssVar: "--axd-band-surface",
    default: "page",
    options: ["page", "panel", "panel2"]
  },
  {
    id: "bandInk",
    subsystem: "style",
    kind: "enum",
    label: "Band ink",
    effect: "Which text role the bands read in.",
    cssVar: "--axd-band-ink",
    default: "dim",
    options: ["dim", "ink", "accent", "accent2", "accent3"]
  },
  {
    id: "rules",
    subsystem: "style",
    kind: "enum",
    label: "Band rules",
    effect: "The line between a band and the screen — none, a hairline, or the edge weight.",
    cssVar: "--axd-rules",
    default: "hairline",
    options: ["none", "hairline", "edge", "accent"]
  },
  {
    id: "accentEdge",
    subsystem: "style",
    kind: "enum",
    label: "Accent edge",
    effect: "An accent seam on the framed screen — off, along one edge, or a glow around it.",
    cssVar: "--axd-accent-edge",
    default: "none",
    options: ["none", "top", "left", "glow"]
  },
  {
    id: "shade",
    subsystem: "style",
    kind: "number",
    label: "Frame shadow",
    effect: "Shadow depth under the framed screen. 0 is flat.",
    cssVar: "--axd-shade",
    default: 0,
    min: 0,
    max: 28,
    step: 1,
    unit: "px"
  },
  {
    id: "tint",
    subsystem: "style",
    kind: "number",
    label: "Accent tint",
    effect: "How much of the accent bleeds into the wrapper's surfaces, in percent.",
    cssVar: "--axd-tint",
    default: 0,
    min: 0,
    max: 24,
    step: 1,
    unit: "%"
  }
];

export const DASH_DIALS_BY_ID: ReadonlyMap<string, DashDial> = new Map(
  DASH_DIALS.map((d) => [d.id, d])
);

/** Dials grouped by subsystem, for any surface that lists them. */
export function dashDialsBySubsystem(): Record<DashSubsystem, DashDial[]> {
  const out = {} as Record<DashSubsystem, DashDial[]>;
  for (const dial of DASH_DIALS) (out[dial.subsystem] ??= []).push(dial);
  return out;
}

/** The wrapper that adds nothing — every dial at its default. */
export function defaultDashValues(): DashValues {
  const out: DashValues = {};
  for (const dial of DASH_DIALS) out[dial.id] = dial.default;
  return out;
}

/* --------------------------------------------------------------- the spec */

/**
 * An authored dashboard wrapper, as a serialisable record.
 *
 * Everything here survives `JSON.stringify` — it is stored in a kv document,
 * handed across the server/client module boundary as a prop, and reproduced
 * from a seed. `Wrapper.tsx` is what turns it back into a `Dashboard`.
 */
export interface DashboardSpec {
  readonly id: string;
  readonly title: string;
  /** One line for a picker — what this chrome actually looks like. */
  readonly description: string;
  /** Values for {@link DASH_DIALS}. Only ids in `active` take effect. */
  readonly display: DashValues;
  /**
   * Values for the THEME's dials (`theme/spec.ts`), carried by this wrapper.
   * Only ids in both `active` and `inherit` are written into the theme when
   * the wrapper is applied — see the file docblock.
   */
  readonly theme: Record<string, string | number>;
  /** Dial ids that are ON. Anything absent resolves to its dial default. */
  readonly active: readonly string[];
  /** Theme dial ids the theme takes on apply. Meaningful only when active. */
  readonly inherit: readonly string[];
  /** The seed this was rolled from, when it was rolled rather than dialled. */
  readonly seed?: string;
}

export class DashboardSpecError extends Error {}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** Keep only string/number entries — a stored document is not trusted input. */
function scalars(raw: unknown): DashValues {
  const out: DashValues = {};
  if (!isRecord(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) {
      out[key] = value;
    }
  }
  return out;
}

const strings = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];

/**
 * The chokepoint. Every authored wrapper passes through here — the designer's
 * save, the kv parse and the seed all call it, so a document written by hand
 * gets exactly the gate an edited one does.
 *
 * Deliberately TOLERANT about values and strict about identity: an unknown
 * dial id in `display` is dropped (the spec outgrew the record, or the record
 * outlived a dial) but a bad id or an empty description is refused, because
 * those are the fields a picker and the registry are built on.
 */
export function defineDashboardSpec(spec: DashboardSpec): DashboardSpec {
  if (!/^[a-z][a-z0-9-]*$/.test(spec?.id ?? "")) {
    throw new DashboardSpecError(`dashboard id "${spec?.id}" must be lower-kebab`);
  }
  if (!spec.title?.trim()) {
    throw new DashboardSpecError(`dashboard "${spec.id}" requires a title`);
  }
  if (!spec.description?.trim()) {
    throw new DashboardSpecError(
      `dashboard "${spec.id}" requires a description — a picker has to describe it without rendering it`
    );
  }

  const display: DashValues = {};
  for (const [key, value] of Object.entries(scalars(spec.display))) {
    if (DASH_DIALS_BY_ID.has(key)) display[key] = value;
  }

  return {
    id: spec.id,
    title: spec.title.trim(),
    description: spec.description.trim(),
    display,
    theme: scalars(spec.theme),
    active: strings(spec.active),
    inherit: strings(spec.inherit),
    ...(typeof spec.seed === "string" && spec.seed ? { seed: spec.seed } : null)
  };
}

/** The wrapper that adds nothing to the theme — the floor every roll starts from. */
export function emptyDashboardSpec(id: string, title: string): DashboardSpec {
  return defineDashboardSpec({
    id,
    title,
    description: "Matches the theme default — no dial active, so the wrapper adds nothing.",
    display: defaultDashValues(),
    theme: {},
    active: [],
    inherit: []
  });
}

/**
 * What the wrapper ACTUALLY draws with: the stored value for every active
 * dial, the dial's default for every inactive one.
 *
 * The fallback is to the DEFAULT and not to the stored value, deliberately —
 * that is what makes a switch reversible without destroying the roll it turned
 * off, and it is the mechanism behind "default matches the theme default".
 */
export function resolveDash(spec: DashboardSpec): DashValues {
  const active = new Set(spec.active);
  const out: DashValues = {};
  for (const dial of DASH_DIALS) {
    const stored = spec.display[dial.id];
    out[dial.id] = active.has(dial.id) && stored !== undefined ? stored : dial.default;
  }
  return out;
}

/** The theme dials this wrapper hands over on apply — active AND inherited. */
export function inheritedTheme(spec: DashboardSpec): Record<string, string | number> {
  const active = new Set(spec.active);
  const out: Record<string, string | number> = {};
  for (const id of spec.inherit) {
    if (!active.has(id)) continue;
    const value = spec.theme[id];
    if (value !== undefined) out[id] = value;
  }
  return out;
}

/* ------------------------------------------------------------- the roller */

const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const between = (r: () => number, lo: number, hi: number) => lo + r() * (hi - lo);
const quantise = (v: number, step: number) => Math.round(v / step) * step;

/**
 * Roll the DISPLAY half of a wrapper from a seed.
 *
 * Model-free and deterministic, the same contract `rollTheme` holds and for
 * the same reason: a wrapper you cannot reproduce from six characters is a
 * random wrapper with a label.
 *
 * **Every dial is drawn, always** — then only the active ones are kept. That
 * is not a stylistic choice, it is the bug `rollTheme`'s own "draw always,
 * override the value never the draw" comment records: skipping a draw for an
 * inactive dial shifts every later draw by one, so switching a dial off would
 * silently change the value of every dial after it and the same seed would
 * produce a different wrapper depending on which switches happened to be up.
 */
export function rollDash(seed: string, active: readonly string[]): DashValues {
  const r = rng(`dash:${seed}`);
  const on = new Set(active);
  const out: DashValues = {};
  for (const dial of DASH_DIALS) {
    const drawn: string | number =
      dial.kind === "enum"
        ? pick(r, dial.options)
        : quantise(between(r, dial.min, dial.max), dial.step);
    out[dial.id] = on.has(dial.id) ? drawn : dial.default;
  }
  return out;
}

/** Two-word names from the seed, so a rolled wrapper is referable in speech. */
const NAME_A = [
  "Console", "Atrium", "Deck", "Frame", "Gantry", "Loft", "Bridge", "Vault",
  "Terrace", "Bay", "Foundry", "Cabin", "Studio", "Hangar", "Keep", "Portico"
];
const NAME_B = [
  "Layout", "Chrome", "Shell", "Casing", "Surround", "Mount", "Fitting", "Rig",
  "Housing", "Facing", "Trim", "Jacket", "Cradle", "Sleeve", "Panel", "Skin"
];

/** A speakable name for a rolled wrapper. Deterministic, like everything here. */
export function dashName(seed: string): string {
  return `${pick(rng(`dn-a:${seed}`), NAME_A)} ${pick(rng(`dn-b:${seed}`), NAME_B)}`;
}
