/**
 * @file The nav registry — many candidates per surface, one active.
 *
 * Runtime re-validation is here rather than trusted from `defineNavMenu`,
 * because the compile-time brand is erased and a JS caller or an `as` cast
 * sails past it — the same doctrine as every other chokepoint. It is passed to
 * the shared registry as its `validate` hook, so it still runs on every
 * `register()`.
 *
 * ── the behaviour moved, the API did not (2026-08-11) ────────────────────────
 *
 * This file's own docblock used to say it was "deliberately identical in shape
 * to `ToolbarRegistry`… Three registries that behave the same are one thing to
 * learn". It was more than identical in shape — it was identical in
 * implementation, 97 lines against toolbar's 93, differing only in the noun in
 * an error message and this validation call. Both now bind
 * `../registries/surface`, which holds the behaviour once. Every exported name
 * and message is unchanged.
 */
import { SurfaceRegistry } from "../registries/surface";
import type { SurfaceSnapshot } from "../registries/surface";
import { defineNavMenu } from "./types";
import type { NavMenu, NavSurface } from "./types";

export type NavSnapshot = SurfaceSnapshot<NavMenu, NavSurface>;

export class NavRegistry extends SurfaceRegistry<NavSurface, NavMenu> {
  constructor() {
    super({
      noun: "nav menu",
      // Wrapped rather than passed by reference: `defineNavMenu` RETURNS the
      // branded menu, and a validator whose return value is silently discarded
      // reads like a mistake at the call site.
      validate: (menu) => {
        defineNavMenu(menu);
      }
    });
  }
}

/** The process-wide nav registry. Per-runtime, like every registry. */
export const navs = new NavRegistry();
