/**
 * @file The toolbar registry — many candidates per surface, one active.
 *
 * Hot-swappable means exactly this: `activate()` mutates the active id and
 * notifies, every mounted `<Toolbar>` re-renders from the new asset, and no
 * host re-mounts. The bar changes under a running app.
 *
 * ── the behaviour moved, the API did not (2026-08-11) ────────────────────────
 *
 * This file used to carry the whole implementation — and `nav/registry.ts`
 * carried a structurally identical copy of it, with `dashboard/registry.ts` a
 * near-relative. All of it now lives once in `../registries/surface`; this file
 * is the toolbar's binding of it. Every exported name, method and error message
 * is unchanged, so no consumer moved.
 *
 * Its original docblock noted it was "modelled on `PackRegistry` deliberately:
 * same subscribe/snapshot shape … Two registries that behave differently are
 * two things to learn; two that behave the same are one." That instinct was
 * right and stopped one step short — behaving the same and BEING the same are
 * different, and only the second one stops the next copy being written.
 */
import { SurfaceRegistry } from "../registries/surface";
import type { SurfaceSnapshot } from "../registries/surface";
import type { Toolbar, ToolbarSurface } from "./types";

export type ToolbarSnapshot = SurfaceSnapshot<Toolbar, ToolbarSurface>;

export class ToolbarRegistry extends SurfaceRegistry<ToolbarSurface, Toolbar> {
  constructor() {
    // No `validate`: `defineToolbar` is the chokepoint, and `ToolbarRegistry`
    // has never re-run it here. Adding one now would be a behaviour change
    // smuggled in under a refactor — it belongs in its own step, with the
    // mutation test that proves it goes red.
    super({ noun: "toolbar" });
  }
}

export const toolbars = new ToolbarRegistry();
