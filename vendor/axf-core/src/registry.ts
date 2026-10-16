/**
 * @file The registry — what the core knows about itself.
 *
 * Modules register; contributions register against declared points. The
 * registry refuses a contribution to a point nobody declared, and refuses one
 * whose payload does not satisfy the point. That refusal is the whole value:
 * it is the runtime layer of the enforcement doctrine, and it means a broken
 * contribution surfaces where it was made rather than as a blank pane later.
 *
 * In-memory for now. The requirement that will justify persistence: an asset
 * that can be enabled and disabled without recompiling. Until something needs
 * that, a file-backed registry would be speculative.
 */
import type { Contribution, ExtensionPoint, PointViolation } from "./points";
import { orderContributions, validateContribution } from "./points";
import type { Module } from "./module";

export interface RegistryReport {
  readonly modules: number;
  readonly points: number;
  readonly contributions: number;
  readonly violations: readonly PointViolation[];
}

/**
 * An extra answer to "what would this module have to take with it".
 *
 * {@link Registry.closureOf} walks a module's own points, which was the whole
 * story while every point belonged to a module. `ctx.item` (`axf-context-menus`
 * P3) is the first point that does not: a plugin adds a row to `module:a`'s
 * context menu by naming the AREA, and the registry has no idea which module an
 * area belongs to — the menu map does.
 *
 * So the registry asks. A source is given a module id and answers with the asset
 * ids that would have to travel with it for reasons only that source knows. That
 * keeps the dependency pointing the right way: `ctx` knows about the registry,
 * and the registry stays ignorant of menus.
 */
export type ClosureSource = (moduleId: string) => readonly string[];

export class Registry {
  readonly #modules = new Map<string, Module>();
  readonly #points = new Map<string, ExtensionPoint>();
  readonly #contributions = new Map<string, Contribution[]>();
  readonly #violations: PointViolation[] = [];
  readonly #closureSources = new Set<ClosureSource>();
  readonly #listeners = new Set<() => void>();
  #version = 0;

  registerModule(module: Module): this {
    if (this.#modules.has(module.id)) {
      throw new Error(`module "${module.id}" is already registered`);
    }
    this.#modules.set(module.id, module);
    for (const point of module.points) {
      if (this.#points.has(point.id)) {
        throw new Error(`extension point "${point.id}" is already declared`);
      }
      this.#points.set(point.id, point);
    }
    this.#changed();
    return this;
  }

  /**
   * Declare a point that belongs to no module — the core's own, and a core-level
   * subsystem's.
   *
   * Until `ctx.item` (`axf-context-menus` P3) every point in the system was
   * published by a module, so `registerModule` was the only way one could enter
   * the registry. `ctx.item` is published by the context-menu engine itself: it
   * has no route, it is not peelable, and there is no module it could be hung
   * off without lying about who owns it.
   *
   * The alternative was a private contribution list inside the menu engine, and
   * that is exactly what {@link closureOf} cannot see — a peeled app would ship
   * with its contributed rows silently missing. One method here is cheaper than
   * a second mechanism there.
   *
   * Throws on a re-declaration, the same as a module's points do: two owners for
   * one point id is a real bug, and the loser's contributions would validate
   * against a shape its author never wrote.
   */
  declarePoint(point: ExtensionPoint): this {
    if (this.#points.has(point.id)) {
      throw new Error(`extension point "${point.id}" is already declared`);
    }
    this.#points.set(point.id, point);
    this.#changed();
    return this;
  }

  /**
   * Register a contribution. A contribution to an undeclared point is recorded
   * as a violation rather than silently dropped — a plugin that appears to
   * install and then does nothing is the worst of the available outcomes.
   */
  contribute(contribution: Contribution): this {
    const point = this.#points.get(contribution.point);
    if (!point) {
      this.#violations.push({
        point: contribution.point,
        from: contribution.from,
        problem: "no module declares this extension point"
      });
      return this;
    }
    const problems = validateContribution(point, contribution);
    if (problems.length) {
      this.#violations.push(...problems);
      return this;
    }
    const list = this.#contributions.get(point.id) ?? [];
    if (point.cardinality === "one" && list.length) {
      this.#violations.push({
        point: point.id,
        from: contribution.from,
        problem: `point accepts one contribution and already has "${list[0].from}"`
      });
      return this;
    }
    list.push(contribution);
    this.#contributions.set(point.id, list);
    this.#changed();
    return this;
  }

  /* ── the change signal ─────────────────────────────────────────────────── */

  /**
   * Subscribe to registry changes — a module registered, a point declared, a
   * contribution accepted.
   *
   * Added 2026-08-13 with the `shell.strip` point, for a reason the assistant
   * host had already run into and worked around: **the registry fills during an
   * ASYNC boot, and nothing reading it re-renders when it does.** `AssistantHost`
   * solved that by awaiting `boot()` itself before its first read, which works
   * for a host that can reach the app's boot function. `AppShell` cannot — it is
   * core's, the boot is the host's, and a shell that imported one would invert
   * the dependency this package is built on.
   *
   * So the registry says when it changed, the same way every other core store
   * does. A reader pairs this with {@link version} through
   * `useSyncExternalStore` and recomputes what it needs; nothing here caches a
   * snapshot, because the shapes readers want (`contributionsTo`, `modules`)
   * are already derived per call and a second cache would be a second truth.
   */
  subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  };

  /**
   * A counter that increments on every accepted mutation — the stable snapshot
   * `useSyncExternalStore` requires.
   *
   * A number rather than an array, deliberately: `contributionsTo()` allocates a
   * fresh array on each call, and handing THAT to `useSyncExternalStore` is an
   * infinite render loop (a new identity every time it is asked to compare).
   * The version is stable between changes by construction.
   */
  version = (): number => this.#version;

  #changed(): void {
    this.#version++;
    for (const fn of this.#listeners) fn();
  }

  modules(): Module[] {
    return [...this.#modules.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  module(id: string): Module | undefined {
    return this.#modules.get(id);
  }

  points(): ExtensionPoint[] {
    return [...this.#points.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Contributions to a point, ordered the way the point says to order them. */
  contributionsTo<P = unknown>(pointId: string): Contribution<P>[] {
    const point = this.#points.get(pointId);
    if (!point) return [];
    return orderContributions(point, (this.#contributions.get(pointId) ?? []) as Contribution<P>[]);
  }

  violations(): readonly PointViolation[] {
    return this.#violations;
  }

  /**
   * Add a {@link ClosureSource}. Returns a remove function. Registering the same
   * function twice is a no-op — it is a Set — because the hosts that call this
   * are re-evaluated by a dev-server remount and a duplicated source would make
   * closures grow on refresh.
   */
  addClosureSource(source: ClosureSource): () => void {
    this.#closureSources.add(source);
    return () => {
      this.#closureSources.delete(source);
    };
  }

  /**
   * The peel closure: what a module would have to take with it. The module plus
   * every asset contributing to one of its points, plus whatever the registered
   * {@link ClosureSource}s add — today that is the assets that put rows in this
   * module's context menus, which reach it through a point the module does not
   * own and would otherwise be invisible here.
   *
   * A source that throws is skipped with a warning rather than taking the
   * closure down. A closure is read by the peeler and by diagnostics, and a
   * partial answer that says so beats no answer at all.
   *
   * It will grow transitive dependencies when an asset first has one — not
   * before.
   */
  closureOf(moduleId: string): { module: string; points: string[]; carries: string[] } | null {
    const module = this.#modules.get(moduleId);
    if (!module) return null;
    const points = module.points.map((p) => p.id);
    const carries = new Set<string>();
    for (const pointId of points) {
      for (const c of this.contributionsTo(pointId)) carries.add(c.from);
    }
    for (const source of this.#closureSources) {
      try {
        for (const id of source(moduleId)) carries.add(id);
      } catch (e) {
        if (typeof console !== "undefined") {
          console.warn(
            `[axf] a closure source failed for module "${moduleId}" and was skipped: ` +
              `${e instanceof Error ? e.message : String(e)}`
          );
        }
      }
    }
    return { module: module.id, points, carries: [...carries].sort() };
  }

  report(): RegistryReport {
    let contributions = 0;
    for (const list of this.#contributions.values()) contributions += list.length;
    return {
      modules: this.#modules.size,
      points: this.#points.size,
      contributions,
      violations: this.#violations
    };
  }
}

/** The process-wide registry the shell reads. */
export const registry = new Registry();
