/**
 * @file The context-menu engine's internal barrel.
 *
 * Two layers live here now, and they are at different stages on purpose:
 *
 * 1. THE DEFAULT MENU — always-on, built to the owner's 2026-08-09 directive.
 *    `ContextMenuRoot` + `defaultMenu`, the floor every right-click gets.
 * 2. THE MAP — `axf-context-menus` P0 (2026-08-09): the predicate registry and
 *    the area → items map, with registration-time validation. Data and gates,
 *    no rendering.
 * 3. THE RESOLVER — P1 (2026-08-09): the `data-axf-area` walk (`areas.ts`) and
 *    the `MenuItem[] → CtxItem[]` compile step (`compose.ts`).
 * 4. THE RENDERER — P2 (2026-08-09): `ContextMenu` plus the three pure modules
 *    it is assembled from — `place.ts` (flip and clamp), `keyboard.ts` (the
 *    whole keyboard as a state machine) and `row-model.ts` (focusable /
 *    runnable / tone / reason). P1's deliberate gap is closed here too:
 *    `ContextMenuRoot` now walks, composes and draws, because the renderer can
 *    finally draw a submenu without dropping it.
 *
 * 5. CONTRIBUTIONS AND THE UNIVERSAL GROUP — P3 (2026-08-09):
 *    `contributions.ts` (the `ctx.item` extension point, routed through the
 *    registry core already has, so the peel closure understands menu rows for
 *    free) and `universal.ts` (D2's basics, as a declared area the engine
 *    appends to every menu rather than a hard-coded block).
 *
 * 6. THE EDITS-ONLY OVERLAY — P4 (2026-08-09): `overlay.ts` (the shape of a
 *    human edit and the pure functions that lay one over a scanned map) and
 *    `overlay-store.ts` (where one is kept, and the drift sweep that reports a
 *    stale entry instead of pruning it). The promise the last three phases each
 *    made was kept: nothing had to be undone. The map is still derived from
 *    declarations and never persisted; the overlay applies on read at
 *    `MenuMap.itemsFor`, so dropping it restores the defaults exactly.
 */
export { ContextMenuRoot } from "./ContextMenuRoot";
export { ContextMenu } from "./ContextMenu";
export type { ContextMenuProps } from "./ContextMenu";
export { defaultMenu } from "./default-menu";
export { registerCtxCommands } from "./commands";
export {
  isEditable,
  labelFor,
  readClipboard,
  resolveTarget,
  valueFor,
  activeTarget,
  setActiveTarget,
  activeContext,
  setActiveContext
} from "./resolve";
export { PredicateRegistry, PredicateDefinitionError, predicates } from "./predicates";
export type { MenuContext, Predicate, PredicateVerdict } from "./predicates";
export {
  MenuMap,
  MenuMapError,
  menu,
  MAX_CONTRIBUTING_AREAS,
  GROUP_DEFAULT,
  GROUP_UNIVERSAL
} from "./map";
export type { MenuMapSnapshot, MenuMapViolation } from "./map";
export {
  CTX_OVERLAY_KEY,
  EMPTY_OVERLAY,
  ITEM_PATH_SEP,
  OVERLAY_VERSION,
  applyAreaEdit,
  applyItemEdits,
  indexItemPaths,
  isEmptyAreaEdit,
  isEmptyItemEdit,
  isEmptyOverlay,
  normaliseItemEdit,
  parseOverlay
} from "./overlay";
export type { AreaEdit, ItemEdit, MenuOverlay, OverlayParseProblem } from "./overlay";
export {
  OverlayStore,
  ctxOverlay,
  installCtxOverlay,
  overlayDrift,
  reportOverlayDrift
} from "./overlay-store";
export type { OverlayDrift, OverlayStorage, OverlayStoreOptions } from "./overlay-store";
export { validateMenusDecl } from "./menus";
export type { ModuleMenusDecl } from "./menus";
export { registerModuleMenus } from "./register-menus";
export {
  AREA_ATTR,
  resolveAreaPath,
  clearUndeclaredAreaWarnings,
  inDevelopment
} from "./areas";
export type { AreaElement, AreaHit, AreaPath, ResolveAreaOptions } from "./areas";
export { composeArea, composeMenu, menuContextFor, resolveMenu } from "./compose";
export type { ComposeInput, ComposeOptions } from "./compose";
export {
  CTX_ITEM_POINT,
  clearInstalledCtxContributions,
  contributedItemId,
  ctxContributorsFor,
  ctxItem,
  ctxItems,
  declareCtxItemPoint,
  installCtxContributions
} from "./contributions";
export type {
  CtxContributionProblem,
  CtxItemPayload,
  InstallCtxOptions
} from "./contributions";
export {
  AREA_UNIVERSAL,
  UNIVERSAL_AREA,
  UNIVERSAL_ITEMS,
  declareUniversalArea,
  universalMenu,
  universalSuppressedBy
} from "./universal";
export {
  MENU_MARGIN,
  FLYOUT_OVERLAP,
  FLYOUT_LIFT,
  placeAtPoint,
  placeFlyout,
  isOnScreen
} from "./place";
export type { Box, Placement, Point, Size } from "./place";
export { rowModel, rowModels, focusableIndexes, toneToken } from "./row-model";
export type { RowModel, RowTone } from "./row-model";
export {
  NAV_INITIAL,
  TYPEAHEAD_RESET_MS,
  navigate,
  navFirst,
  panelItems,
  itemAt,
  focusPath,
  focusedItem
} from "./keyboard";
export type { NavState, NavKey, NavEffect, NavResult } from "./keyboard";
export type {
  Area,
  CtxClipboard,
  CtxItem,
  CtxRole,
  Group,
  ItemRole,
  MenuItem,
  CtxTarget,
  ToggleMarks
} from "./types";
