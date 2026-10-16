/**
 * @file The seeded generator — a seed in, a complete valid theme out.
 *
 * **Model-free and deterministic.** The same seed always produces the same
 * theme, on any machine, forever. That is what makes a theme shareable as a
 * short string instead of a blob, what makes a rolled layout reproducible in a
 * bug report, and what lets a peeled app roll themes with no network and no
 * model. GizmoX proved this approach over 2000 rolls; this is the same idea,
 * rebuilt.
 *
 * **Generating is not authoring.** This produces a valid, legible theme from a
 * seed. It does not let a human place individual tokens — that is the SDK's
 * designer, and the split is what keeps the roller in core and the designer out
 * of a peeled app (INITIATION-PROMPT.md §4.3).
 *
 * The two properties that matter, and how each is achieved:
 *
 *   1. **Every roll is legible.** Contrast is CLAMPED, not re-rolled. Rejecting
 *      failures biases the output toward whatever happens to pass and quietly
 *      narrows the palette space; clamping keeps the hue the roll chose and
 *      moves only lightness.
 *   2. **Rolls are actually different from each other.** Hue is chosen from the
 *      seed and the harmony rule varies, so consecutive seeds do not produce
 *      four shades of the same blue — which is the failure mode of a generator
 *      that rolls each channel independently.
 */
import { clampContrast, contrast, hexToHsl, hslToHex, mix, rotate } from "./color";
import { DIALS } from "./spec";
import type { ColorDial, NumberDial, EnumDial, TextDial, ThemeValues } from "./spec";

/* ----------------------------------------------------------------- the rng */

/**
 * Mulberry32 — small, fast, and good enough that consecutive seeds produce
 * unrelated streams. `Math.random()` is deliberately never used anywhere in the
 * engine: a theme that cannot be reproduced from its seed is not a seeded
 * theme, it is a random one that happens to have a label.
 */
export function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const between = (r: () => number, lo: number, hi: number) => lo + r() * (hi - lo);
const quantise = (v: number, step: number) => Math.round(v / step) * step;

/* ------------------------------------------------------------------ colour */

export type Mode = "dark" | "light";

/**
 * Harmony rules for placing the accent's companions around the wheel.
 *
 * Exported because `Harmony` is a type and a type cannot be enumerated at
 * runtime: a surface offering a harmony picker would otherwise hand-keep its
 * own list of the four names, which is a list that goes stale the day a fifth
 * rule is added here — the same "no hand-kept list" reason the designer renders
 * its controls from `DIALS`. The rotations come with it deliberately: a picker
 * that can say "+120°/+240°" explains what the rule does instead of asking a
 * person to learn four words.
 */
export const HARMONIES = {
  analogous: [22, -22],
  triad: [120, 240],
  split: [150, 210],
  complement: [180, 160]
} as const;

export type Harmony = keyof typeof HARMONIES;

export interface RollOptions {
  /** Force a mode. Omitted, the seed decides — biased 3:1 toward dark. */
  readonly mode?: Mode;
  /** Force a harmony. Omitted, the seed decides. */
  readonly harmony?: Harmony;
  /** Force the base hue in degrees. Omitted, the seed decides. */
  readonly hue?: number;
}

export interface RolledTheme {
  readonly id: string;
  readonly seed: string;
  readonly name: string;
  readonly mode: Mode;
  readonly harmony: Harmony;
  readonly values: ThemeValues;
  /** Contrast ratios actually achieved, for anything that wants to show them. */
  readonly contrast: Readonly<Record<string, number>>;
}

/** Two-word names from the seed, so a rolled theme is referable in speech. */
const NAME_A = [
  "Copper", "Cobalt", "Ember", "Slate", "Vapour", "Terra", "Ion", "Cinder",
  "Aurora", "Basalt", "Quartz", "Nimbus", "Verdant", "Saffron", "Indigo", "Onyx"
];
const NAME_B = [
  "Signal", "Drift", "Vault", "Field", "Circuit", "Bloom", "Ridge", "Halo",
  "Current", "Lattice", "Harbour", "Prism", "Anvil", "Meridian", "Fathom", "Relay"
];

/**
 * Roll a complete theme.
 *
 * Palette first, because every other dial is independent but the colours are
 * not: panel and panel2 are derived from page so elevation reads correctly, and
 * ink/dim/accent are clamped against the page that was just chosen.
 */
export function rollTheme(seed: string, options: RollOptions = {}): RolledTheme {
  const r = rng(seed);

  // Draw all three from the stream ALWAYS, then let an option override the
  // value — never the draw.
  //
  // `options.mode ?? (r() < 0.75 ? …)` short-circuits, so forcing a mode skipped
  // a call to `r()` and every later draw shifted by one: the harmony took the
  // number the mode would have had, the hue took the harmony's, and "the same
  // theme in light" came out a different theme entirely. That made a light/dark
  // switch impossible to build on this function, and it silently changed the
  // hue whenever a harmony was forced.
  const rolledMode: Mode = r() < 0.75 ? "dark" : "light";
  const rolledHarmony: Harmony = pick(r, Object.keys(HARMONIES) as Harmony[]);
  const rolledHue = Math.floor(r() * 360);

  const mode: Mode = options.mode ?? rolledMode;
  const harmony: Harmony = options.harmony ?? rolledHarmony;
  const hue = options.hue ?? rolledHue;

  const dark = mode === "dark";

  // Page: a deeply tinted near-black, or a barely tinted near-white. Carrying a
  // little of the accent's hue into the surface is what stops a rolled theme
  // looking like a colour sitting on top of grey.
  const pageSat = between(r, 0.04, dark ? 0.22 : 0.06);
  const pageLight = dark ? between(r, 0.045, 0.1) : between(r, 0.94, 0.985);
  const page = hslToHex({ h: hue, s: pageSat, l: pageLight });

  // Elevation ramp, mixed toward the opposite end so both modes read correctly.
  const lift = dark ? "#ffffff" : "#000000";
  const panel = mix(page, lift, dark ? between(r, 0.04, 0.08) : between(r, 0.03, 0.06));
  const panel2 = mix(page, lift, dark ? between(r, 0.09, 0.15) : between(r, 0.07, 0.11));
  const edge = mix(page, lift, dark ? between(r, 0.14, 0.22) : between(r, 0.12, 0.2));

  // Accent: full saturation, mid lightness, then clamped for legibility.
  const accentRaw = hslToHex({
    h: hue,
    s: between(r, 0.62, 0.95),
    l: dark ? between(r, 0.5, 0.66) : between(r, 0.36, 0.5)
  });
  const accent = clampContrast(accentRaw, page, 3);

  const [rot2, rot3] = HARMONIES[harmony];
  const accent2 = clampContrast(rotate(accent, rot2), page, 3);
  const accent3 = clampContrast(rotate(accent, rot3), page, 3);

  // Ink and dim carry a trace of the hue rather than being neutral grey — the
  // difference between a theme and a colour applied to a grey app.
  const inkRaw = hslToHex({
    h: hue,
    s: between(r, 0.03, 0.1),
    l: dark ? between(r, 0.9, 0.97) : between(r, 0.08, 0.16)
  });
  const ink = clampContrast(inkRaw, page, 4.5);
  const dimRaw = hslToHex({
    h: hue,
    s: between(r, 0.05, 0.14),
    l: dark ? between(r, 0.58, 0.7) : between(r, 0.36, 0.48)
  });
  const dim = clampContrast(dimRaw, page, 3);

  // Status colours keep their conventional hues — a green "error" is a bug, not
  // a bold choice — but take the theme's saturation and lightness character.
  const statusS = between(r, 0.45, 0.7);
  const statusL = dark ? between(r, 0.52, 0.66) : between(r, 0.36, 0.46);
  const ok = clampContrast(hslToHex({ h: between(r, 130, 158), s: statusS, l: statusL }), page, 3);
  const warn = clampContrast(hslToHex({ h: between(r, 38, 52), s: statusS, l: statusL }), page, 3);
  const err = clampContrast(hslToHex({ h: between(r, 353, 366), s: statusS, l: statusL }), page, 3);
  // Info keeps a cool hue for the same reason the other statuses keep theirs —
  // a warm "info" reads as a warning — but takes the theme's character.
  const info = clampContrast(
    hslToHex({ h: between(r, 200, 226), s: statusS, l: statusL }),
    page,
    3
  );

  // accent2/accent3 are dials now (overridable by hand), still rolled from the
  // harmony rule rather than independently — independent rolls are how a
  // palette stops being a palette.
  const colours: Record<string, string> = {
    page, panel, panel2, edge, ink, dim, accent, accent2, accent3, info, ok, warn, err
  };

  /* Non-colour dials roll straight from their declared ranges, so a dial added
     to the spec is rolled the same day with no edit here. */
  const values: ThemeValues = { ...colours };
  for (const dial of DIALS) {
    if (dial.kind === "color") continue;
    if (dial.kind === "number") {
      const n = dial as NumberDial;
      values[n.id] = quantise(between(r, n.min, n.max), n.step);
    } else if (dial.kind === "enum") {
      values[dial.id] = pick(r, (dial as EnumDial).options);
    } else {
      // A text dial with NO candidates keeps its default instead of being
      // rolled. `pick()` on an empty array returns `undefined`, which would put
      // an undefined into the theme values and take the whole roll down with it.
      //
      // Optionless text dials arrived with the identity dials (`brandingPack` /
      // `logoPack`): their candidates are the packs an APP has registered, which
      // core cannot enumerate from a static spec. They are still dials — rolled
      // over, saved, restored and edited with a theme — they are simply not
      // randomised, which is right anyway. A roll should restyle the app, not
      // swap its logo for a different brand's.
      const t = dial as TextDial;
      values[t.id] = t.options.length > 0 ? pick(r, t.options) : t.default;
    }
  }

  const ratios: Record<string, number> = {};
  for (const dial of DIALS) {
    if (dial.kind !== "color") continue;
    const d = dial as ColorDial;
    if (!d.contrastAgainst || !d.minContrast) continue;
    const value = values[d.id] as string;
    const bg = values[d.contrastAgainst] as string;
    ratios[d.id] = Math.round(contrast(value, bg) * 100) / 100;
  }

  return {
    id: `roll-${seed}`,
    seed,
    name: `${pick(rng(seed + "a"), NAME_A)} ${pick(rng(seed + "b"), NAME_B)}`,
    mode,
    harmony,
    values,
    contrast: ratios
  };
}

/**
 * Verify a rolled theme is legible. The generator clamps, so this should always
 * pass — which is exactly why it exists: a failure here means a clamp regressed,
 * and that is the bug most likely to ship unnoticed.
 */
export function auditTheme(theme: RolledTheme): string[] {
  const problems: string[] = [];
  for (const dial of DIALS) {
    if (dial.kind !== "color") continue;
    const c = dial as ColorDial;
    if (!c.contrastAgainst || !c.minContrast) continue;
    const ratio = contrast(theme.values[c.id] as string, theme.values[c.contrastAgainst] as string);
    if (ratio < c.minContrast - 0.005) {
      problems.push(
        `${c.id} on ${c.contrastAgainst} is ${ratio.toFixed(2)}:1, below ${c.minContrast}:1`
      );
    }
  }
  return problems;
}

/** A short, human-typable seed. Deterministic given a counter or a string. */
export function seedFrom(input: string | number): string {
  const s = String(input);
  const r = rng(s);
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: 6 }, () => alphabet[Math.floor(r() * alphabet.length)]).join("");
}
