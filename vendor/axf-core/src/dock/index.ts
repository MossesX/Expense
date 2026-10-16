/**
 * @file The dock/float engine — the barrel.
 *
 * `model.ts` is the pure geometry (no DOM, no React — the half that can be
 * wrong and therefore the half that is unit-tested), `store.ts` the state and
 * its host-supplied persistence adapter, `Floatable.tsx` the renderer.
 *
 * The boundary this package holds: **core owns the geometry and the
 * interaction; WHAT is floatable, WHO may rearrange it and WHERE the
 * arrangement is kept are the caller's.** That is why `DockPersistence` is an
 * argument rather than an import and why `dockMode` is a pair of booleans a
 * host pushes in rather than a role check — core has no transport and no idea
 * what an administrator is.
 */
export {
  DOCK_DEFAULT_FLOAT_SIZE,
  DOCK_GHOST_PX,
  DOCK_MIN_FLOAT,
  DOCK_SNAP_RANGE_PX,
  clampDockPosition,
  decide,
  dockTo,
  floatAt,
  isInFlow,
  nudged,
  orientationFor,
  parseDockState,
  resolveDockDefault
} from "./model";
export type {
  DockDecision,
  DockMode,
  DockOrientation,
  DockPoint,
  DockRect,
  DockSize,
  DockState,
  DockZone
} from "./model";

export {
  DockLayoutStore,
  DockModeStore,
  dockLayouts,
  dockMode,
  memoryDockPersistence,
  useDockMode,
  useDockState
} from "./store";
export type { DockModeState, DockPersistence, DockSnapshot } from "./store";

export { DockOrientationContext, DockZones, Floatable, useDockOrientation } from "./Floatable";
export type { FloatableProps } from "./Floatable";
