/**
 * @file Brand layer barrel — re-exported through `@axf/core`.
 */
export {
  BRAND_ROLES,
  ALL_BRAND_VARS,
  brandVar,
  legacyBrandVar,
  brandRoleRef,
  paletteVariables,
  validatePalette,
  paletteLegibility,
  contrastRatio,
  luminance
} from "./roles";
export type { BrandRole, BrandPalette } from "./roles";

export { PackRegistry, packs, PACKS_KEY, PACKS_COOKIE } from "./packs";
export type { PackProblem, PackStorage, ResolvedStyle } from "./packs";

export { Glyph, PackGlyph, StylePublisher, useResolvedStyle, assertPackSvg } from "./Glyph";

export {
  BRAND_DRAG_MIME,
  BrandEditStore,
  brandEdits,
  brandEditKey,
  editedGlyph,
  GlyphDropZone,
  isGlyphDrag,
  setGlyphDrag,
  useBrandEdits
} from "./edits";
export type { BrandEdit, BrandEditKind, BrandEditState, BrandEditTarget } from "./edits";

export type {
  AnyPackage,
  BrandingPackage,
  GlyphCategory,
  GlyphEntry,
  LogoPackage,
  PackageKind
} from "./types";

export { REQUIRED_GLYPHS, REQUIRED_GLYPH_IDS, checkCoverage } from "./requirements";
export type { GlyphRequirement, GlyphRequirementCategory, CoverageReport } from "./requirements";
