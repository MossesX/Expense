/**
 * @file Toolbar barrel — the `toolbar` asset kind, re-exported through
 * `@axf/core`.
 *
 * A bar is an ASSET: registered, swappable at runtime, and versioned like
 * anything else. The arrangement belongs to the asset; the content belongs to
 * the host, supplied by name through slots.
 */
export { defineToolbar, ToolbarDefinitionError, SURFACE_ROLES } from "./types";
export type {
  Toolbar as ToolbarAssetBrand,
  ToolbarAsset,
  ToolbarItem,
  ToolbarSurface,
  ToolbarRole,
  ToolbarFill
} from "./types";

export { ToolbarRegistry, toolbars } from "./registry";
export type { ToolbarSnapshot } from "./registry";

export { Toolbar, useToolbars } from "./Toolbar";

/** The per-user presentation layer (0.0.21) — words, icon size, direction and
 *  thickness, laid over what the asset declares. See `prefs.ts`. */
export {
  TOOLBAR_ICON_DEFAULT,
  TOOLBAR_ICON_MAX,
  TOOLBAR_ICON_MIN,
  TOOLBAR_PREFS_NS,
  TOOLBAR_THICKNESS_MAX,
  ToolbarPrefsStore,
  declaredToolbarPrefs,
  resolveToolbarPrefs,
  toolbarPrefs,
  toolbarPrefsTouched,
  toolbarPrefsUi,
  useToolbarPrefs
} from "./prefs";
export type { ToolbarOrientation, ToolbarPrefs, ToolbarPrefsDoc, ToolbarPrefsPatch } from "./prefs";
export { ToolbarSettingsDialog } from "./ToolbarSettingsDialog";

export {
  InlineToolbars,
  INLINE_TOOLBAR_ATTR,
  INLINE_TOOLBAR_TAG,
  findInlineToolbars,
  inlineToolbarId
} from "./inline";
