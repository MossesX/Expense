/**
 * @file The dashboard registry — many wrappers, one active, fallback with a
 * REPORT.
 *
 * Modelled on `ToolbarRegistry` (same subscribe/snapshot shape, first
 * registration becomes the default, swap notifies and nothing re-mounts) with
 * ONE deliberate difference: `activate()` accepts an id that is not
 * registered. The stored wrapper id outlives the wrappers themselves — a
 * wrapper-providing plugin gets disabled, a stale value restores from storage
 * — and the contract for that case is **fall back to the default and say
 * so**, never a thrown error and never an app with no chrome. So the unknown
 * id is kept as requested, and every resolution reports the substitution
 * until the id resolves again (re-registering the missing wrapper heals it
 * live, with the stored preference intact).
 */
import type { Dashboard } from "./types";

export interface DashboardResolution {
  /** The wrapper to render — the default when the requested id is missing,
   *  `null` only when nothing at all is registered. */
  readonly dashboard: Dashboard | null;
  /** True when the requested id was missing and the default was substituted. */
  readonly substituted: boolean;
  /** What was actually asked for. */
  readonly requestedId: string | null;
}

export interface DashboardSnapshot {
  readonly resolution: DashboardResolution;
  /** Everything registered, for a picker. */
  readonly all: readonly Dashboard[];
}

export class DashboardRegistry {
  readonly #byId = new Map<string, Dashboard>();
  #defaultId: string | null = null;
  #requestedId: string | null = null;
  readonly #listeners = new Set<() => void>();
  #snapshot: DashboardSnapshot | null = null;
  readonly #reported = new Set<string>();

  register(dashboard: Dashboard): this {
    if (this.#byId.has(dashboard.id)) {
      throw new Error(`dashboard "${dashboard.id}" is already registered`);
    }
    this.#byId.set(dashboard.id, dashboard);
    // First registration becomes the default — the wrapper every fallback
    // lands on, so the app is never chrome-less merely because a stored id
    // went stale.
    if (this.#defaultId === null) this.#defaultId = dashboard.id;
    this.#changed();
    return this;
  }

  /**
   * Register or REPLACE — the authored-asset path.
   *
   * `register()` throws on a duplicate, which is right for code: two modules
   * claiming one id is a bug and it should be loud. An authored wrapper is a
   * DOCUMENT, and re-registering it is the normal case — every save from the
   * designer, every re-seed of the chrome document, every hot swap. Same seam
   * `ToolbarRegistry.upsert` gives the toolbar designer, and for the same
   * reason: without it the editor would have to remove-then-register, which is
   * two notifications and a window where the surface has no asset at all.
   *
   * **It never claims the default, and that is a fix rather than an omission.**
   * Authored wrappers are seeded during the RENDER phase (`<PacksSeed>`), and
   * code registers from `Subsystem.start()` — which `kernel.boot()` awaits, so
   * it lands in a later microtask. The data therefore arrives FIRST, and an
   * `upsert` that claimed the default the way `register` does handed the whole
   * app's fallback chrome to whichever authored wrapper happened to be in the
   * document. Observed live, 2026-08-12: one saved wrapper, no selection
   * anywhere, and every route rendered it instead of the built-in.
   *
   * The floor is `register()`'s to give (see {@link floorId}) — code ships the
   * wrapper an app is never without; a document proposes candidates.
   */
  upsert(dashboard: Dashboard): this {
    this.#byId.set(dashboard.id, dashboard);
    // A re-registered wrapper may heal a substitution that was already
    // reported; let it report afresh if the id goes missing again later.
    this.#reported.delete(dashboard.id);
    this.#changed();
    return this;
  }

  /**
   * The wrapper every fallback lands on.
   *
   * The first `register()`ed one — code's, deliberately. Until code has
   * registered anything, the first wrapper in insertion order stands in, so an
   * app whose ONLY wrappers are authored still has chrome rather than none;
   * code reclaims the floor the moment it registers, which is the right final
   * state whichever order the two arrived in.
   */
  floorId(): string | null {
    return this.#defaultId ?? this.#byId.keys().next().value ?? null;
  }

  /**
   * Drop a wrapper. Removing the one the theme asked for is not an error: the
   * resolver substitutes the default and says so, which is contract rule 4 and
   * exactly what should happen when an authored wrapper is deleted while it is
   * on screen.
   */
  remove(id: string): this {
    if (!this.#byId.delete(id)) return this;
    // The default going away leaves `#defaultId` dangling, and a dangling
    // default resolves to null — an app with no chrome at all. Clearing it
    // hands the floor to `floorId()`'s insertion-order stand-in instead.
    if (this.#defaultId === id) this.#defaultId = null;
    this.#changed();
    return this;
  }

  /**
   * Ask for a wrapper by id. Unknown ids are ACCEPTED — resolution falls back
   * to the default and reports, per contract rule 4. Live — no remount.
   */
  activate(id: string): this {
    this.#requestedId = id;
    this.#changed();
    return this;
  }

  /** Registered wrappers, the floor first, then by title. */
  candidates(): Dashboard[] {
    const floor = this.floorId();
    return [...this.#byId.values()].sort((a, b) =>
      a.id === floor ? -1 : b.id === floor ? 1 : a.title.localeCompare(b.title)
    );
  }

  /** Resolve the active wrapper, substituting the floor when it is gone. */
  resolve(): DashboardResolution {
    const floor = this.floorId();
    const requestedId = this.#requestedId ?? floor;
    const exact = requestedId ? this.#byId.get(requestedId) : undefined;
    if (exact) return { dashboard: exact, substituted: false, requestedId };

    const fallback = floor ? this.#byId.get(floor) ?? null : null;
    const substituted = Boolean(fallback);
    // Report once per missing id — a substitution that happens silently is a
    // preference that got lost, and nobody finds out until they wonder why
    // the chrome looks wrong.
    if (substituted && requestedId && !this.#reported.has(requestedId)) {
      this.#reported.add(requestedId);
      console.warn(`[axf] dashboard "${requestedId}" is not registered — falling back to "${floor}"`);
    }
    return { dashboard: fallback, substituted, requestedId };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** Stable between changes — `useSyncExternalStore` requires that. */
  snapshot = (): DashboardSnapshot => {
    if (this.#snapshot) return this.#snapshot;
    this.#snapshot = { resolution: this.resolve(), all: this.candidates() };
    return this.#snapshot;
  };

  #changed(): void {
    this.#snapshot = null;
    // A re-registered wrapper may heal a substitution; let it report afresh
    // if it goes missing again later.
    for (const l of this.#listeners) l();
  }
}

export const dashboards = new DashboardRegistry();
