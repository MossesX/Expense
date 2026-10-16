/**
 * @file The single resolver — theme and pack composed into ONE variable set.
 *
 * The bug this replaces: `ThemeBridge` and `StylePublisher` both wrote
 * `--axf-ink`, `--axf-page` and the `--axf-brand-*` roles onto `:root` from
 * separate effects. Which won depended on which effect ran last, so the same
 * state produced different pixels depending on interaction history — roll a
 * theme and it showed; reload and the pack won. Re-ordering the effects only
 * moves that race. Two independent writers of one custom property IS the
 * defect, so there is now one writer and a stated precedence.
 *
 * ## The precedence, as of 2026-08-12 — and it is one sentence now
 *
 * **The theme owns every `--axf-*` variable; the pack owns only the
 * `--gxb-*` / `--axf-brand-*` identity roles its drawings paint in.**
 *
 * The history, kept because each layer of it was paid for:
 *
 * - A style package used to be a COMPLETE identity that overrode palette,
 *   typography and shape. That made a rolled theme change the dials and not
 *   the pixels, and the kind was deleted outright (owner: *"get rid of style
 *   packs entirely"*).
 * - A selected branding pack then still overrode `--axf-accent` and the
 *   status colours. With the pack now a FIXED app setting — always selected,
 *   never part of a theme — that override would have made the accent dial
 *   permanently dead. So it went the same way: no pack touches `--axf-*`,
 *   ever.
 * - What survives is the one split that was always right: the pack's IDENTITY
 *   roles (`--gxb-accent` and friends — what its drawings are painted in) stay
 *   the brand's own fixed colours, while its SURFACE-relative roles (`ink`,
 *   `dim`, `edge`, `page`) are republished FROM the theme, so a logo drawn for
 *   one surface stays legible on whatever surface the theme actually rolls.
 */
import type { ThemeValues } from "./spec";
import { themeVariables } from "./apply";
import { BRAND_ROLES, brandVar, legacyBrandVar } from "../brand/roles";
import type { BrandRole } from "../brand/roles";

/** Roles that are the brand's own, whatever surface they land on. */
const IDENTITY_ROLES: ReadonlySet<BrandRole> = new Set<BrandRole>([
  "accent",
  "accent2",
  "accent3",
  "ok",
  "warn",
  "err"
]);

/** Roles that only mean something relative to the surface they sit on. */
const SURFACE_ROLES: readonly BrandRole[] = ["ink", "dim", "edge", "page"];

/** The pack layer's contribution: its published role variables. */
export interface StyleInput {
  /** Everything the pack layer would publish (see `PackRegistry.#variables`). */
  readonly variables: Readonly<Record<string, string>>;
}

/**
 * Compose the final variable set. Pure, so it is testable and can be rendered
 * into a `<style>` tag server-side as easily as applied to the DOM.
 *
 * `themeVariables` already republishes the theme's palette as the brand roles
 * (the brand bridge in `apply.ts`), so with no pack this is complete on its
 * own. A pack then overwrites the IDENTITY roles with its own fixed brand
 * colours — that is what keeps a logo's colours the brand's rather than the
 * roll's — and the surface roles are re-asserted from the theme, so drawings
 * sit legibly on the surface actually in force.
 */
export function resolveVariables(
  values: ThemeValues,
  style: StyleInput | null = null
): Record<string, string> {
  const out = themeVariables(values);
  if (!style) return out;

  for (const role of BRAND_ROLES) {
    if (!IDENTITY_ROLES.has(role)) continue;
    const bv = brandVar(role);
    const lv = legacyBrandVar(role);
    if (style.variables[bv]) out[bv] = style.variables[bv];
    if (style.variables[lv]) out[lv] = style.variables[lv];
    // NOTE deliberately absent: the matching `--axf-<role>` is NOT copied. The
    // theme's dials own the app's accent and status colours unconditionally —
    // a pack that could override them is the "my roll changed nothing" defect.
  }

  for (const role of SURFACE_ROLES) {
    const fromTheme = out[`--axf-${role}`];
    if (!fromTheme) continue;
    out[brandVar(role)] = fromTheme;
    out[legacyBrandVar(role)] = fromTheme;
  }

  return out;
}
