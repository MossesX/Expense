/**
 * @file The dock engine's STATE half: where a panel's arrangement lives, how it
 * gets persisted, and the two switches that decide whether any of it is live.
 *
 * `model.ts` holds the geometry that can be wrong; this holds the state that
 * can be lost. The split is deliberate — a unit test of `decide()` needs no
 * store, and a test of persistence needs no DOM.
 *
 * ## Core stays storage-agnostic, and that is not a formality
 *
 * The adapter is supplied by the caller ({@link DockPersistence}). The studio
 * hands it the per-user settings spine (the kv transport, so a layout follows
 * the person across browsers); a peeled app can hand it `localStorage`; a test
 * hands it nothing and gets an in-memory store that still behaves. Core must
 * not import a transport here for the same reason `persist/kv.ts` takes an io
 * driver: `node:fs` and `window.localStorage` are both host facts, and a
 * framework that picks one has picked a host.
 *
 * The adapter is per-ID (`load(id)` / `save(id, state)`) rather than
 * whole-document, which pushes BATCHING to the storage side where it belongs —
 * the studio's adapter holds one kv document behind a shared lazy promise, so
 * eight floatable panels are one read, and core never learns that.
 *
 * ## `save(id, null)` is the reset
 *
 * Not `clear(id)`. A third verb would be a third thing an adapter can implement
 * wrongly, and "the state is now nothing" is exactly what a reset means — the
 * defaults path in `resolveDockDefault` is what a null reads back as.
 *
 * ## Two switches, and why the MODE lives in core while the POLICY does not
 *
 * Nothing below decides who may rearrange anything. {@link dockMode} is a plain
 * pair of booleans a host pushes in: `editing` (this person is arranging the
 * chrome) and `floatable` (this person's panes and bars may float at all). The
 * studio derives them from an admin-gated setting and a per-user setting, and
 * core never learns what an administrator is — same boundary `settings/gates.ts`
 * draws, for the same reason.
 *
 * Both default to FALSE, so an app that never touches this file is byte-for-byte
 * the static app it was: `<Floatable>` renders its children and nothing else.
 */
"use client";

import * as React from "react";

import { clampDockPosition, parseDockState, resolveDockDefault } from "./model";
import type { DockSize, DockState } from "./model";

type Listener = () => void;

/* ── persistence ──────────────────────────────────────────────────────────── */

/**
 * Where a layout is kept. Both halves are the caller's; core calls them and
 * makes no promise about when.
 */
export interface DockPersistence {
  /** The stored value for one panel, or anything at all — `parseDockState`
   *  validates it, and junk reads as "nobody decided". */
  load(id: string): Promise<unknown> | unknown;
  /** Persist one panel's state. `null` means forget it (a reset). Failure is
   *  the adapter's to swallow: a layout that could not be saved must still
   *  apply for the session. */
  save(id: string, state: DockState | null): void | Promise<void>;
}

/** An adapter that keeps nothing. The default, so the engine works — for one
 *  session — before a host installs anything, and in tests. */
export const memoryDockPersistence = (): DockPersistence => {
  const docs = new Map<string, DockState>();
  return {
    load: (id) => docs.get(id) ?? null,
    save: (id, state) => {
      if (state) docs.set(id, state);
      else docs.delete(id);
    }
  };
};

/* ── the layout store ─────────────────────────────────────────────────────── */

export type DockSnapshot = Readonly<Record<string, DockState>>;

const EMPTY_SNAPSHOT: DockSnapshot = Object.freeze({});

/**
 * Every registered panel's arrangement, in one store.
 *
 * One store rather than one per panel, for the reason `toolbar/prefs.ts` gives
 * about its own document: a renderer subscribes ONCE for a surface instead of
 * once per item, and "reset every layout" is a real operation rather than a
 * loop somebody has to remember the members of.
 */
export class DockLayoutStore {
  #states = new Map<string, DockState>();
  /** What each id reverts TO. Registered by the panel itself, so `resetLayout`
   *  has an answer for a panel whose default is not the engine's baseline. */
  #defaults = new Map<string, Partial<DockState>>();
  #adapter: DockPersistence = memoryDockPersistence();
  #loaded = new Set<string>();
  #snapshot: DockSnapshot = EMPTY_SNAPSHOT;
  readonly #listeners = new Set<Listener>();

  /**
   * Install the host's storage. Replaces whatever was there and RE-READS every
   * panel already registered — a host that installs its adapter after the shell
   * has mounted (which is every host, because the adapter needs a signed-in
   * user) must not leave the first-registered bar on the defaults forever.
   */
  install(adapter: DockPersistence): void {
    this.#adapter = adapter;
    const ids = [...this.#defaults.keys()];
    this.#loaded.clear();
    for (const id of ids) this.#hydrate(id);
  }

  /** Declare a panel and what it reverts to. Idempotent: a component remounting
   *  must not re-read storage or overwrite the state it is already showing. */
  register(id: string, defaults?: Partial<DockState>): void {
    if (defaults !== undefined || !this.#defaults.has(id)) {
      this.#defaults.set(id, defaults ?? {});
    }
    this.#hydrate(id);
  }

  #hydrate(id: string): void {
    if (this.#loaded.has(id) || typeof window === "undefined") return;
    this.#loaded.add(id);
    void (async () => {
      try {
        const parsed = parseDockState(await this.#adapter.load(id));
        if (!parsed) return;
        // Never overwrite a state the person has already moved this session:
        // an adapter that answers slowly must not undo a drag that happened
        // while it was thinking.
        if (this.#states.has(id)) return;
        this.#states.set(id, parsed);
        this.#publish();
      } catch {
        // Unreadable storage: the defaults stand, exactly as a junk document
        // does. Never overwritten on a failed READ — one dropped request must
        // not wipe an arrangement.
      }
    })();
  }

  /** One panel's state, defaults applied. Always answers. */
  stateFor(id: string): DockState {
    const held = this.#states.get(id);
    if (held) return held;
    return resolveDockDefault(this.#defaults.get(id));
  }

  /** Move a panel. Optimistic — listeners first, storage after — because a
   *  drag that waits for a round trip is a drag that stutters. */
  set(id: string, state: DockState): void {
    this.#states.set(id, state);
    this.#publish();
    void Promise.resolve(this.#adapter.save(id, state)).catch(() => {
      // Storage down: the arrangement holds for the session.
    });
  }

  /** Re-clamp a floating panel into a container that has changed size. Answers
   *  whether anything moved, so a resize listener can stay quiet when nothing
   *  did. This is the FIRST defence against a panel dragged out of reach; the
   *  reset below is the second. */
  clampInto(id: string, container: DockSize): boolean {
    const state = this.stateFor(id);
    if (state.mode !== "floating" || !state.position || !state.size) return false;
    const next = clampDockPosition(state.position, state.size, container);
    if (next.x === state.position.x && next.y === state.position.y) return false;
    this.set(id, { ...state, position: next });
    return true;
  }

  /** Back to this panel's default — the way back for somebody who dragged a bar
   *  somewhere they cannot reach it. */
  resetLayout(id: string): void {
    const had = this.#states.delete(id);
    if (had) this.#publish();
    void Promise.resolve(this.#adapter.save(id, null)).catch(() => {});
  }

  /** Every panel back to its default. What a "reset all layouts" affordance
   *  fires, and the only operation that can rescue a panel whose id the person
   *  has no way to name. */
  resetAll(): void {
    const ids = [...this.#states.keys()];
    if (!ids.length) return;
    this.#states.clear();
    this.#publish();
    for (const id of ids) void Promise.resolve(this.#adapter.save(id, null)).catch(() => {});
  }

  /** Has this panel been arranged at all? What a "reset" affordance greys on. */
  touched(id: string): boolean {
    return this.#states.has(id);
  }

  /** Raise a floating panel above its siblings. Returns the new z, so a caller
   *  can hand it straight to `set`. */
  nextZ(): number {
    let top = 0;
    for (const s of this.#states.values()) if (s.z > top) top = s.z;
    return top + 1;
  }

  #publish(): void {
    this.#snapshot = Object.freeze(Object.fromEntries(this.#states));
    for (const fn of this.#listeners) fn();
  }

  subscribe = (fn: Listener): (() => void) => {
    this.#listeners.add(fn);
    return () => void this.#listeners.delete(fn);
  };

  getState = (): DockSnapshot => this.#snapshot;

  /** Always empty on the server, so SSR and the hydrating client agree and a
   *  saved arrangement lands as an ordinary repaint one frame later — the rule
   *  `toolbar/prefs.ts` states and the banner has already been burned by. */
  getServerState = (): DockSnapshot => EMPTY_SNAPSHOT;
}

/** The process-wide layout store. */
export const dockLayouts = new DockLayoutStore();

/** Subscribe a component to one panel's arrangement. */
export function useDockState(id: string, defaults?: Partial<DockState>): DockState {
  // Registration is an effect, not a render side-effect: it starts an async
  // read and React may render this twice (StrictMode) before committing once.
  React.useEffect(() => {
    dockLayouts.register(id, defaults);
    // `defaults` is a fresh literal on most call sites; keying the effect on it
    // would re-register every render. The id is what identifies the panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const snapshot = React.useSyncExternalStore(
    dockLayouts.subscribe,
    dockLayouts.getState,
    dockLayouts.getServerState
  );
  return snapshot[id] ?? resolveDockDefault(defaults);
}

/* ── the mode switches ────────────────────────────────────────────────────── */

/** The two booleans that decide whether the engine does anything. */
export interface DockModeState {
  /** Chrome may be REARRANGED right now — handles show, drags are live. */
  readonly editing: boolean;
  /** Panes and bars may float at all. Off is the static app, exactly. */
  readonly floatable: boolean;
}

const MODE_OFF: DockModeState = Object.freeze({ editing: false, floatable: false });

export class DockModeStore {
  #state: DockModeState = MODE_OFF;
  readonly #listeners = new Set<Listener>();

  set(patch: Partial<DockModeState>): void {
    const next: DockModeState = { ...this.#state, ...patch };
    if (next.editing === this.#state.editing && next.floatable === this.#state.floatable) return;
    this.#state = Object.freeze(next);
    for (const fn of this.#listeners) fn();
  }

  state = (): DockModeState => this.#state;

  /** Off. The server cannot know a person's settings, and a banner that renders
   *  a drag handle on the server and loses it on hydration tears the tree. */
  serverState = (): DockModeState => MODE_OFF;

  subscribe = (fn: Listener): (() => void) => {
    this.#listeners.add(fn);
    return () => void this.#listeners.delete(fn);
  };
}

export const dockMode = new DockModeStore();

export function useDockMode(): DockModeState {
  return React.useSyncExternalStore(dockMode.subscribe, dockMode.state, dockMode.serverState);
}
