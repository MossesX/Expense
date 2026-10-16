/**
 * @file Theme engine barrel — re-exported through `@axf/core`.
 *
 * What is here is the ROLLING half: the spec, the seeded generator, the clamps,
 * the applier, the store and the bridge. A peeled app gets all of it and can
 * re-theme itself freely.
 *
 * What is deliberately NOT here is the AUTHORING half — a full-token designer
 * and a drag-and-drop layout editor. Those live in the SDK, and the split is
 * enforced by where the code is rather than by a licence check
 * (INITIATION-PROMPT.md §4.3). `setValue()` on the store is the seam: core
 * exposes the ability to set a dial, the SDK supplies the surface that makes
 * setting 24 of them by hand pleasant.
 */
export { DIALS, DIALS_BY_ID, dialsBySubsystem, defaultValues } from "./spec";
export type {
  Dial,
  ColorDial,
  NumberDial,
  EnumDial,
  TextDial,
  DialSubsystem,
  ThemeValues
} from "./spec";

export { rollTheme, auditTheme, seedFrom, rng, HARMONIES } from "./generate";
export type { Harmony, Mode, RollOptions, RolledTheme } from "./generate";

export { themeVariables, themeStyleBlock, variablesStyleBlock, token } from "./apply";
export { resolveVariables } from "./resolve";
export type { StyleInput } from "./resolve";

export { ThemeStore, theme, valuesFrom } from "./store";
export type { ThemeState, ThemeStorage } from "./store";

export {
  themeBootScript,
  themeSignature,
  parseThemeCookie,
  themeCookieValue,
  THEME_KEY,
  THEME_VARS_KEY,
  THEME_COOKIE
} from "./boot";
export type { CachedVariables, ThemeRecord } from "./boot";

export {
  ThemeBridge,
  AxfStyleRoot,
  AxfHydrationTheme,
  useTheme,
  useHydrationValues,
  useAppliedThemeValues
} from "./ThemeBridge";

export { contrast, luminance, clampContrast, hexToHsl, hslToHex, mix, rotate } from "./color";

export { DERIVED, derivedVariables, dependentsOf, shadowFor } from "./derived";
export type { DerivedToken } from "./derived";

/* The MUI half of the same engine. `muiThemeFrom` is the pure mapping and
   `AxfMuiRoot` the one provider; `MUI_DIAL_MAP` / `MUI_UNDRIVEN` are the
   RECORD of what corresponds and what deliberately does not, which is the
   difference between a dial with no MUI counterpart and a dial that was
   forgotten. See `theme/mui.ts` for why resolved values beat cssVariables. */
export {
  MUI_DIAL_MAP,
  MUI_UNDRIVEN,
  mappingFor,
  muiThemeFrom,
  unmappedDials,
  unmappedSpecDials
} from "./mui";
export type { DialMapping } from "./mui";
export { AxfMuiRoot } from "./MuiBridge";

export { composeTheme, diffAgainst, BASE_LAYER, ThemeCompositionError } from "./compose";
export type { ThemeLayer, ResolvedLayer } from "./compose";

export { applyVariables, clearVariables, changeCount } from "./publish";
export type { PublishHandle } from "./publish";

export { ThemeScope } from "./ThemeScope";
