/**
 * @file `SurfaceRegistry` — many candidates per surface, one active, hot-swap.
 *
 * ── why this exists (2026-08-11) ─────────────────────────────────────────────
 *
 * `ToolbarRegistry` and `NavRegistry` were **structurally identical**: the same
 * three fields, the same eight methods, in the same order, 93 and 97 lines. The
 * only differences were the type parameter, the noun in an error message, and
 * one re-validation call. `DashboardRegistry` is the same family again.
 *
 * That happened for a defensible reason and is still a defect. The "module
 * drives the core" rule keeps core from growing speculative machinery — each
 * registry was written when a real requirement appeared — but it has no
 * mechanism for noticing that the THIRD instance of a shape should have become
 * a primitive. The owner spotted it from outside, asking why there were five
 * registries and whether every asset kind would get one. On the trajectory it
 * was on, yes.
 *
 * So the shape is a parameter now. The next swappable asset kind is a type
 * argument, not a file.
 *
 * ── what this deliberately does NOT absorb ───────────────────────────────────
 *
 * Not every registry is this one, and merging the rest would produce a class
 * where `register` means four different things:
 *
 * - **`Registry`** (modules/points/contributions) is a validated GRAPH —
 *   cardinality, ordering, violations, peel closure. It has no notion of an
 *   active member per surface, because a contribution does not displace another.
 * - **`PackRegistry`** carries SLOTS, persisted selection, and the two-tier
 *   `activate` (the user's choice, persists) vs `activateDefault` (the app
 *   stating a default) distinction — a difference that, when collapsed, silently
 *   destroyed saved brand selections once already.
 * - **`CommandRegistry` / `MenuMap` / `PredicateRegistry`** resolve NAMES to
 *   behaviour and enforce their own gates at registration.
 *
 * Each of those is a different job wearing the word "registry". If a future
 * reader is about to merge one of them into this, that is the reason not to.
 */

/** The minimum a registrable asset must carry to live on a surface. */
export interface SurfaceAsset<S extends string> {
  readonly id: string;
  readonly surface: S;
}

export interface SurfaceSnapshot<T, S> {
  /** The active asset per surface. */
  readonly active: ReadonlyMap<S, T>;
  /** Everything registered, for a picker or a roller. */
  readonly all: readonly T[];
}

export interface SurfaceRegistryOptions<T> {
  /**
   * What one of these is called, used verbatim in error messages —
   * `no toolbar "x" is registered`. A generic registry that said "asset" would
   * make every failure one indirection further from the reader.
   */
  readonly noun: string;
  /**
   * Re-validate at registration. The brands these assets carry are compile-time
   * only and an `as` cast sails past them, so a kind whose `define*()` enforces
   * real invariants passes it here — layer 2 of the enforcement doctrine.
   */
  readonly validate?: (asset: T) => void;
}

export class SurfaceRegistry<S extends string, T extends SurfaceAsset<S>> {
  readonly #byId = new Map<string, T>();
  readonly #active = new Map<S, string>();
  readonly #listeners = new Set<() => void>();
  #snapshot: SurfaceSnapshot<T, S> | null = null;
  readonly #noun: string;
  readonly #validate?: (asset: T) => void;

  constructor(options: SurfaceRegistryOptions<T>) {
    this.#noun = options.noun;
    this.#validate = options.validate;
  }

  register(asset: T): this {
    if (this.#byId.has(asset.id)) {
      throw new Error(`${this.#noun} "${asset.id}" is already registered`);
    }
    this.#validate?.(asset);
    this.#byId.set(asset.id, asset);
    // First registration for a surface becomes its default, so a surface is
    // never blank merely because nobody called activate().
    if (!this.#active.has(asset.surface)) this.#active.set(asset.surface, asset.id);
    this.#changed();
    return this;
  }

  /**
   * Register-or-replace — the EDITOR's write path, and the seed path for
   * assets loaded from disk (which re-run on every server render and must not
   * throw on the second pass).
   *
   * `register()` stays throw-on-duplicate on purpose: boot code registering
   * the same id twice is a real bug worth a loud failure. An editor saving the
   * same id twice is the normal case. Validation still runs — an edit is not
   * a licence to store an invalid asset.
   */
  upsert(asset: T): this {
    if (!this.#byId.has(asset.id)) return this.register(asset);
    this.#validate?.(asset);
    this.#byId.set(asset.id, asset);
    this.#changed();
    return this;
  }

  /**
   * Remove an asset. If it was the active one for its surface, the surface
   * falls back to its first remaining candidate — a surface with candidates
   * must never be left pointing at nothing, because "no toolbar registered"
   * is an error card, not a state a delete button should produce.
   */
  remove(id: string): this {
    const asset = this.#byId.get(id);
    if (!asset) return this;
    this.#byId.delete(id);
    if (this.#active.get(asset.surface) === id) {
      const next = this.candidates(asset.surface)[0];
      if (next) this.#active.set(asset.surface, next.id);
      else this.#active.delete(asset.surface);
    }
    this.#changed();
    return this;
  }

  /** Swap what is on a surface. Live — no remount. */
  activate(id: string): this {
    const asset = this.#byId.get(id);
    if (!asset) throw new Error(`no ${this.#noun} "${id}" is registered`);
    this.#active.set(asset.surface, id);
    this.#changed();
    return this;
  }

  /** Candidates for a surface, for a picker or a roller. */
  candidates(surface: S): T[] {
    return [...this.#byId.values()].filter((a) => a.surface === surface);
  }

  /** Cycle to the next candidate on a surface. Returns the newly active one. */
  cycle(surface: S): T | null {
    const list = this.candidates(surface);
    if (list.length < 2) return list[0] ?? null;
    const currentId = this.#active.get(surface);
    const at = list.findIndex((a) => a.id === currentId);
    const next = list[(at + 1) % list.length];
    this.activate(next.id);
    return next;
  }

  activeFor(surface: S): T | null {
    const id = this.#active.get(surface);
    return id ? this.#byId.get(id) ?? null : null;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** Stable between changes — `useSyncExternalStore` requires that. */
  snapshot = (): SurfaceSnapshot<T, S> => {
    if (this.#snapshot) return this.#snapshot;
    const active = new Map<S, T>();
    for (const [surface, id] of this.#active) {
      const a = this.#byId.get(id);
      if (a) active.set(surface, a);
    }
    this.#snapshot = { active, all: [...this.#byId.values()] };
    return this.#snapshot;
  };

  #changed(): void {
    this.#snapshot = null;
    for (const l of this.#listeners) l();
  }
}
