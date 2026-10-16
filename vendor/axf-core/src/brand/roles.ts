/**
 * @file Palette roles — the compatibility surface with GizmoX's branding packs.
 *
 * GizmoX's `gizmox-brand` pack draws every one of its 453 SVGs through
 * `var(--gxb-<role>, <shipped hex>)` across exactly ten roles. That vocabulary
 * is the reason the pack recolours with a theme instead of painting its shipped
 * hexes, and it is proven — so AmberX adopts it verbatim rather than inventing
 * a parallel one.
 *
 * **Both variable families are published.** `--axf-brand-<role>` is the name
 * AmberX uses going forward; `--gxb-<role>` is emitted alongside it with the
 * same value, so a pack authored for GizmoX drops into AmberX and recolours
 * correctly with no edit to a single SVG. That aliasing is the whole of
 * "compatible": one publication, two vocabularies, no translation step to
 * drift.
 */

/** The ten roles, in the order GizmoX's generator declares them. */
export const BRAND_ROLES = [
  "accent",
  "accent2",
  "accent3",
  "ink",
  "dim",
  "edge",
  "page",
  "ok",
  "warn",
  "err"
] as const;

export type BrandRole = (typeof BRAND_ROLES)[number];

export type BrandPalette = Record<BrandRole, string>;

/** AmberX's own variable name for a role. */
export function brandVar(role: BrandRole): string {
  return `--axf-brand-${role}`;
}

/** GizmoX's variable name for the same role — emitted for pack compatibility. */
export function legacyBrandVar(role: BrandRole): string {
  return `--gxb-${role}`;
}

/**
 * A `var()` reference with a fallback, the way a pack's SVG should name a role.
 * Prefers AmberX's variable and falls back through GizmoX's before the literal,
 * so a glyph renders correctly under either publisher.
 */
export function brandRoleRef(role: BrandRole, fallback: string): string {
  return `var(${brandVar(role)}, var(${legacyBrandVar(role)}, ${fallback}))`;
}

/** Every property name a publisher writes, for callers that need to clear them. */
export const ALL_BRAND_VARS: string[] = BRAND_ROLES.flatMap((r) => [
  brandVar(r),
  legacyBrandVar(r)
]);

/**
 * Publish a palette as CSS custom properties, under both vocabularies.
 * One value per role, written twice — never derived differently for the two,
 * because two publishers of the same role is how a pack ends up half-recoloured.
 */
export function paletteVariables(palette: BrandPalette): Record<string, string> {
  const out: Record<string, string> = {};
  for (const role of BRAND_ROLES) {
    const value = palette[role];
    out[brandVar(role)] = value;
    out[legacyBrandVar(role)] = value;
  }
  return out;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Problems with a palette, named. Returns them rather than throwing so a pack
 *  loader can report every fault at once instead of the first. */
export function validatePalette(palette: Partial<BrandPalette>): string[] {
  const problems: string[] = [];
  for (const role of BRAND_ROLES) {
    const value = palette[role];
    if (value === undefined) {
      problems.push(`missing role "${role}"`);
    } else if (!HEX.test(value)) {
      problems.push(`role "${role}" is "${value}" — expected a 6-digit hex`);
    }
  }
  return problems;
}

/* ------------------------------- contrast ---------------------------------- */

function channel(hex: string, at: number): number {
  const v = parseInt(hex.slice(at, at + 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance, WCAG definition. */
export function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

/** WCAG contrast ratio between two hexes, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/**
 * Legibility check every pack must pass before it can be activated.
 *
 * A pack that ships an ink barely distinguishable from its page is not a style
 * choice, it is an unreadable app — and the failure mode is silent, because the
 * author had it on a different monitor. 4.5 is WCAG AA for body text; 3 is the
 * large-text/graphical threshold, which is the right bar for a dim label and
 * for status colours used as fills.
 */
export function paletteLegibility(palette: BrandPalette): string[] {
  const problems: string[] = [];
  const check = (role: BrandRole, against: BrandRole, min: number) => {
    const ratio = contrastRatio(palette[role], palette[against]);
    if (ratio < min) {
      problems.push(
        `${role} on ${against} is ${ratio}:1 — needs ${min}:1 (${palette[role]} / ${palette[against]})`
      );
    }
  };
  check("ink", "page", 4.5);
  check("dim", "page", 3);
  check("accent", "page", 3);
  check("ok", "page", 3);
  check("warn", "page", 3);
  check("err", "page", 3);
  return problems;
}
