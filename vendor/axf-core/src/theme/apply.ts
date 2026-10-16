/**
 * @file The applier — a theme's values become CSS custom properties.
 *
 * Every dial publishes through its declared `cssVar`, so a dial added to the
 * spec reaches CSS with no edit here. The only special cases are the derived
 * values a dial cannot express on its own — and those are declared as data in
 * `derived.ts` rather than hardcoded here, so adding one needs no edit to this
 * file.
 *
 * **The brand bridge.** The engine also republishes the theme's palette as the
 * brand pack roles (`--axf-brand-*` and `--gxb-*`), which is what makes every
 * drawing in every registered pack follow the rolled theme. Without it, GizmoX's
 * situation recurs: 453 role-coloured SVGs that were *capable* of recolouring
 * and never did, because nothing published the roles. The bridge is the entire
 * difference, and it belongs here rather than in a component so that it cannot
 * be forgotten by a surface that renders glyphs.
 */
import { mix, rotate } from "./color";
import { DIALS } from "./spec";
import { derivedVariables } from "./derived";
import type { NumberDial, ThemeValues } from "./spec";
import { BRAND_ROLES, brandVar, legacyBrandVar } from "../brand/roles";
import type { BrandRole } from "../brand/roles";

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/**
 * Turn a theme's values into the full custom-property bag.
 *
 * Pure: no DOM, no globals. That is what lets it be unit-tested, rendered into a
 * `<style>` tag server-side, and applied to a subtree rather than the root when
 * one surface wants its own theme.
 */
export function themeVariables(values: ThemeValues): Record<string, string> {
  const out: Record<string, string> = {};

  /* Declared dials — published straight from the spec. */
  for (const dial of DIALS) {
    const raw = values[dial.id];
    if (raw === undefined) continue;
    if (dial.kind === "number") {
      const n = dial as NumberDial;
      // "em/100" is a tracking convenience: the dial is a readable integer and
      // the published value is the em fraction CSS actually wants.
      //
      // The `?? ""` is the runtime backstop, not the contract: `NumberDial.unit`
      // is REQUIRED and documents `""` for a bare number, so a dial that omits
      // it fails to compile (`gridColumns`, the first unitless one, was caught
      // that way). This exists for the same reason the registries re-validate
      // what their branded types already guarantee — a JS caller or an `as`
      // cast sails past the type, and the failure here is nasty and quiet:
      // `${raw}${undefined}` publishes the string "4undefined", which is not a
      // CSS error but a value the browser silently discards, so the dial simply
      // appears to do nothing.
      out[n.cssVar] =
        n.unit === "em/100" ? `${Number(raw) / 100}em` : `${raw}${n.unit ?? ""}`;
    } else {
      out[dial.cssVar] = String(raw);
    }
  }

  /* Derived tokens — declared in `derived.ts`, computed here in a loop.
     This block used to be one hardcoded branch per token, which is exactly what
     stops a theme engine scaling: adding a token meant editing the applier, so
     the applier grew a branch per token and became the file nobody wants to
     touch. Now adding one is a single entry in DERIVED and no edit here. */
  Object.assign(out, derivedVariables(values));

  /* The brand bridge — the palette republished as pack roles, under BOTH
     vocabularies, so every registered pack recolours with the theme. */
  const accent = String(values.accent ?? "#ff7a1a");
  const palette: Record<BrandRole, string> = {
    accent,
    accent2: String(values.accent2 ?? rotate(accent, 120)),
    accent3: String(values.accent3 ?? rotate(accent, 240)),
    ink: String(values.ink ?? "#e6e8ec"),
    dim: String(values.dim ?? "#8a93a0"),
    edge: String(values.edge ?? "#2a2f38"),
    page: String(values.page ?? "#0e1013"),
    ok: String(values.ok ?? "#4cc38a"),
    warn: String(values.warn ?? "#d8c169"),
    err: String(values.err ?? "#f0616d")
  };
  for (const role of BRAND_ROLES) {
    out[brandVar(role)] = palette[role];
    out[legacyBrandVar(role)] = palette[role];
  }

  /* Panel surfaces, if the theme did not roll them (a hand-authored theme may
     supply only a page). Derived so a partial theme is still complete.
     Guarded: `mix` parses 6-digit hex by slicing, and a hand-authored theme
     can legally say `page: "white"` — which must skip derivation, not publish
     `#NaNNaN`. Same guard `resolve.ts` already applies. */
  if (HEX6.test(palette.page) && HEX6.test(palette.ink)) {
    if (values.panel === undefined) {
      out["--axf-panel"] = mix(palette.page, palette.ink, 0.06);
    }
    if (values.panel2 === undefined) {
      out["--axf-panel2"] = mix(palette.page, palette.ink, 0.11);
    }
  }

  return out;
}

/**
 * A `:root { … }` block from ALREADY-RESOLVED variables.
 *
 * The head block used to be `themeVariables(values)` — the theme alone — and
 * that was a real gap rather than a simplification: a branding pack supplies the
 * identity roles (`accent`, `ok`, `warn`, `err`), so the document painted the
 * THEME's accent and every `token()` surface shifted to the PACK's once
 * `AxfStyleRoot` published after hydration. Measured 2026-08-12: server
 * `--axf-accent: #b53c09`, live `#ff7a1a`.
 *
 * Taking a record instead of `ThemeValues` is what keeps one composition order
 * in the app. The caller resolves through `resolveVariables` — the ONE resolver,
 * with the stated precedence — and this only formats it. A second place that
 * merged a theme and a pack would be the two-writers bug `resolve.ts` exists to
 * have ended, in string form.
 */
export function variablesStyleBlock(
  variables: Readonly<Record<string, string>>,
  selector = ":root"
): string {
  const body = Object.entries(variables)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");
  return `${selector} {\n${body}\n}`;
}

/**
 * A `:root { … }` block for a theme with no pack composed over it.
 *
 * Kept because plenty of callers genuinely have only a theme (`ThemeScope`, the
 * designer's specimen, tests). A caller that HAS a pack must go through
 * `resolveVariables` and `variablesStyleBlock` instead — see above.
 */
export function themeStyleBlock(values: ThemeValues, selector = ":root"): string {
  return variablesStyleBlock(themeVariables(values), selector);
}

/** Read a token through its variable. Surfaces use this, never a literal. */
export function token(name: string): string {
  return `var(--axf-${name})`;
}
