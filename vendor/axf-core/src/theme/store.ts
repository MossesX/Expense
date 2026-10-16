/**
 * @file The theme store — active theme, roll history, persistence.
 *
 * Two rules inherited from GizmoX and kept deliberately:
 *
 *   1. **Hot render.** Selecting a theme applies it immediately. There is no
 *      preview mode and no apply button.
 *   2. **Save instantly, no confirm step.** A selection is persisted the moment
 *      it is made. A theme picker with a Save button is a picker where half the
 *      choices are lost.
 *
 * A third rule arrived with the lock, and it is the exception the first two
 * create rather than a contradiction of them:
 *
 *   3. **A locked theme refuses every mutation, HERE.** Hot render plus no
 *      confirm step means the only protection a settled theme has is that
 *      nobody touches it — and `apply()` wipes `#overrides` by design, so one
 *      roll destroys an afternoon of hand edits with no undo anywhere. The
 *      lock is the guard for that, and it lives on the store because the store
 *      is the chokepoint: a lock enforced by a disabled button is enforced only
 *      for the surface that remembered to disable it, and this engine already
 *      has `theme.setValue` callers that are not the designer (the console
 *      wrapper's look sets three dials at mount). Locking is itself a
 *      mutation and is persisted like every other one.
 *
 * History exists because rolling is how themes are found: you roll past a good
 * one constantly, and a roller you cannot step back through is a roller that
 * wastes what it finds. Seeds are stored, not resolved themes — a seed is six
 * characters and regenerates exactly, so history costs nothing and survives a
 * change to the generator's non-visual dials.
 *
 * Storage is injectable and defaults to `localStorage` when a window exists, so
 * this module imports nothing browser-specific and stays usable server-side.
 */
import { THEME_KEY, themeCookieValue, themeSignature } from "./boot";
import type { ThemeRecord } from "./boot";
import { rollTheme, seedFrom } from "./generate";
import type { Mode, RollOptions, RolledTheme } from "./generate";
import { defaultValues } from "./spec";
import type { ThemeValues } from "./spec";

export interface ThemeStorage {
  read(key: string): string | null;
  write(key: string, value: string): void;
}

const memoryStorage = (): ThemeStorage => {
  const map = new Map<string, string>();
  return {
    read: (k) => map.get(k) ?? null,
    write: (k, v) => void map.set(k, v)
  };
};

const browserStorage = (): ThemeStorage | null => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return {
      read: (k) => window.localStorage.getItem(k),
      write: (k, v) => window.localStorage.setItem(k, v)
    };
  } catch {
    // Private mode, disabled storage, a sandboxed iframe — all fine. A theme
    // that cannot persist should still apply.
    return null;
  }
};

/** One definition, shared with the pre-paint boot script that also reads it. */
const KEY = THEME_KEY;

interface Persisted {
  readonly seed: string | null;
  readonly options: RollOptions;
  readonly history: readonly string[];
  /** Hand-edited dial values layered over the rolled theme. */
  readonly overrides: ThemeValues;
  /**
   * Label of what the theme is locked to, or null when it is free.
   *
   * Deliberately NOT part of `themeSignature()`. The signature exists so a
   * cache of resolved variables can never be replayed over a different theme
   * (`theme/boot.ts`), and a lock changes no variable — signing it would
   * invalidate every cached boot on lock and unlock, producing a flash of the
   * default theme as the reward for protecting one.
   */
}

export interface ThemeState {
  /** The theme in force, rolled and then overlaid with any overrides. */
  readonly values: ThemeValues;
  /** Metadata about the current roll — null when showing the default theme. */
  readonly rolled: RolledTheme | null;
  readonly seed: string | null;
  readonly history: readonly string[];
  readonly historyIndex: number;
  readonly overrides: ThemeValues;
  readonly options: RollOptions;
  /**
   * What the theme is locked to, or null when it is free to change.
   *
   * A label rather than a boolean, because "why will this dial not move" is
   * the question a lock creates, and a surface can only answer it if the lock
   * says what it is holding.
   */
  /**
   * True while the designer holds an unsaved preview.
   *
   * On the snapshot rather than only on `previewing()`, because the surfaces
   * that must say "this is not saved yet" are React components, and a method is
   * not something `useSyncExternalStore` can re-render on.
   */
  readonly previewing: boolean;
}

/**
 * Reconstruct theme values from a persisted/cookie record — the SERVER's entry
 * point into the engine.
 *
 * It is the same two lines `state()` uses, extracted rather than duplicated,
 * because the whole value of the cookie mirror is that the server computes the
 * SAME values the client will. A second composition order here (overrides under
 * the roll instead of over it, say) would produce a server paint that is subtly
 * wrong and then corrected — a flash with extra steps.
 *
 * Cheap enough to run per request: `rollTheme` is seeded arithmetic over the
 * dial spec, not I/O.
 */
export function valuesFrom(record: ThemeRecord | null): ThemeValues {
  if (!record) return defaultValues();
  const rolled = record.seed ? rollTheme(record.seed, record.options as RollOptions) : null;
  const base = rolled ? rolled.values : defaultValues();
  return { ...base, ...(record.overrides as ThemeValues) };
}

export class ThemeStore {
  readonly #listeners = new Set<() => void>();
  readonly #storage: ThemeStorage;

  #seed: string | null = null;
  #options: RollOptions = {};
  #history: string[] = [];
  #index = -1;
  #overrides: ThemeValues = {};
  /**
   * True between `beginPreview()` and `endPreview()`/`commitPreview()`.
   *
   * Only `#persist()` reads it. Everything else — `state()`, the listeners, the
   * variables published to `documentElement`, the MUI theme — behaves exactly as
   * it always did, which is the point: the owner asked for the preview to repaint
   * the whole app so a theme can be judged on real UI, and only to be DISCARDED
   * unless applied. Those are separate properties, and conflating them is what a
   * preview scoped to one panel gets wrong.
   */
  #previewing = false;
  /** The applied record, kept so `endPreview()` can restore it without a reload. */
  #applied: Persisted | null = null;
  #snapshot: ThemeState | null = null;
  /** Never invalidated — the default theme is a constant, not a state. */
  #serverSnapshot: ThemeState | null = null;
  #counter = 0;

  constructor(storage?: ThemeStorage) {
    this.#storage = storage ?? browserStorage() ?? memoryStorage();
    this.#restore();
  }

  /* ------------------------------- lifecycle ------------------------------ */

  #restore(): void {
    try {
      const raw = this.#storage.read(KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Persisted>;
      this.#seed = typeof parsed.seed === "string" ? parsed.seed : null;
      this.#options = parsed.options ?? {};
      this.#history = Array.isArray(parsed.history) ? [...parsed.history] : [];
      this.#overrides = parsed.overrides ?? {};
      this.#index = this.#seed ? this.#history.indexOf(this.#seed) : -1;
    } catch {
      // A corrupt or half-written value is not worth crashing the app over —
      // and silently starting from the default is the honest recovery, because
      // the alternative is an app that will not boot until someone clears
      // storage they do not know about.
      this.#seed = null;
      this.#history = [];
      this.#overrides = {};
      // Unlocked, deliberately. Recovering INTO a lock would leave an app that
      // refuses every theme change because of a value it could not read — the
      // one failure mode a lock must not have.
    }
  }

  /**
   * Persist immediately. Called by every mutation — there is no save step.
   *
   * **Refused while previewing.** That is the whole mechanism behind the
   * designer's preview: a preview is defined as a change that never reaches the
   * two persistent mirrors, so the moment the document reloads (and the nav
   * navigates with `window.location.assign`, so every nav click is a reload)
   * the applied theme is what comes back. Guarding the WRITER rather than each
   * mutation is the same chokepoint argument the lock makes one screen up —
   * there are `theme.setValue` callers that are not the designer, and none of
   * them should have to know a preview is in progress.
   */
  #persist(): void {
    if (this.#previewing) return;
    const payload: Persisted = {
      seed: this.#seed,
      options: this.#options,
      history: this.#history.slice(-64),
      overrides: this.#overrides,
    };
    try {
      this.#storage.write(KEY, JSON.stringify(payload));
    } catch {
      /* storage full or unavailable — the theme still applies */
    }
    this.#mirrorToCookie();
  }

  /**
   * Mirror the applied theme where the SERVER can read it — see `THEME_COOKIE`.
   *
   * Written from the same call as `localStorage`, on purpose. Two mirrors of one
   * record updated from two places is two records that drift, and the drift is
   * invisible until a cold load paints a palette the app then corrects.
   *
   * Silent on failure, like every other write here: a rejected cookie costs the
   * pre-hydration paint, which is exactly the behaviour that shipped before the
   * mirror existed.
   */
  #mirrorToCookie(): void {
    if (typeof document === "undefined") return;
    try {
      document.cookie = themeCookieValue({
        seed: this.#seed,
        options: this.#options as Readonly<Record<string, unknown>>,
        overrides: this.#overrides as Readonly<Record<string, string | number>>
      });
    } catch {
      /* disabled cookies — the theme still applies, one paint later */
    }
  }

  #changed(): void {
    this.#snapshot = null;
    this.#persist();
    for (const listener of this.#listeners) listener();
  }

  /* -------------------------------- reading ------------------------------- */

  /**
   * What the current theme was resolved FROM, as the pre-paint boot script
   * computes it from the persisted JSON. `AxfStyleRoot` stamps this onto the
   * variables it caches, so a cache written for one theme can never be replayed
   * over another — see `theme/boot.ts`.
   */
  signature = (): string =>
    themeSignature({ seed: this.#seed, options: this.#options, overrides: this.#overrides });

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /**
   * The snapshot the SERVER renders, and the one the client HYDRATES with.
   *
   * This is the fix for an app-wide hydration failure, and it belongs on the
   * store rather than in any component. `#restore()` runs in the constructor at
   * module scope, so by the time the first client render happens the store
   * already holds the persisted theme — while the server, which cannot read
   * `localStorage`, rendered the default one. Every surface that turns a dial
   * into markup then disagreed with its own server output (banner height
   * `44px`→`38`, nav motion `fade`→`none`, lockup glyph `104x32`→`90x28`), and
   * React responds to a mismatch by throwing the server tree away and
   * re-rendering the whole app on the client.
   *
   * `useSyncExternalStore` has the seam for exactly this: its third argument is
   * used for the server render AND for the initial hydrating client render, and
   * React then re-reads `state()` in a passive effect and schedules an update if
   * it differs. So hydration matches by construction, and the persisted theme
   * arrives one commit later as a normal update rather than as a mismatch.
   *
   * Cached, because a `useSyncExternalStore` getter that returns a fresh object
   * every call is an infinite render loop, not a slow one. Frozen fields, so
   * this is genuinely the shipped default and not "whatever the store was
   * before someone rolled".
   */
  serverState = (): ThemeState => {
    this.#serverSnapshot ??= {
      values: defaultValues(),
      rolled: null,
      seed: null,
      history: [],
      historyIndex: -1,
      overrides: {},
      options: {},
      // The server cannot read a lock any more than it can read a theme, and
      // a surface that renders "locked" on the server and "free" a commit
      // later is the same hydration mismatch this whole snapshot prevents.
      // Same argument, and it is stronger here: a preview is by definition
      // client-only state the server has never heard of.
      previewing: false
    };
    return this.#serverSnapshot;
  };

  /** Stable between changes — `useSyncExternalStore` requires that. */
  state = (): ThemeState => {
    if (this.#snapshot) return this.#snapshot;
    const rolled = this.#seed ? rollTheme(this.#seed, this.#options) : null;
    const base = rolled ? rolled.values : defaultValues();
    this.#snapshot = {
      values: { ...base, ...this.#overrides },
      rolled,
      seed: this.#seed,
      history: this.#history,
      historyIndex: this.#index,
      overrides: this.#overrides,
      options: this.#options,
      previewing: this.#previewing
    };
    return this.#snapshot;
  };

  /* -------------------------------- preview -------------------------------- */

  /*
   * The designer's preview, and the reason it lives on the store.
   *
   * Rules 1 and 2 at the head of this file — hot render, save instantly — are
   * about the theme IN FORCE, and they are not repealed here. What changes is
   * which acts produce an applied theme: turning a dial in the designer is now
   * a preview, and Apply is what makes it the theme. The owner's framing
   * (2026-08-12) is exactly that: *"theme designer is not supposed to apply the
   * theme to the app across all pages until its saved and applied"*.
   *
   * A preview still repaints the whole app, deliberately — that was the chosen
   * shape when the alternatives were a preview pane and a page-scoped preview.
   * A palette can only be judged on real chrome, and a swatch grid that lies
   * about how the theme feels is how the half-light/half-dark designer shipped
   * looking fine.
   *
   * What makes it disposable is that NOTHING durable is written: `#persist()`
   * refuses, so `localStorage` and the cookie both still describe the applied
   * theme. Every nav click is a full document load (`window.location.assign`),
   * so leaving the designer discards the preview with no code involved at all.
   * `endPreview()` exists for the client-transition case — an unmount, a tab
   * switch — where no reload comes to do it for us.
   */

  /** Enter preview. Mutations repaint the app but stop reaching storage. */
  beginPreview(): void {
    if (this.#previewing) return;
    // Snapshot BEFORE the flag goes up, so what is captured is the applied
    // record rather than the first preview edit that happens to arrive first.
    this.#applied = {
      seed: this.#seed,
      options: this.#options,
      history: this.#history.slice(),
      overrides: this.#overrides,
    };
    this.#previewing = true;
    // `#changed()` and not a bare flag assignment: `previewing` is ON the
    // snapshot, and `state()` returns a CACHED snapshot until something
    // invalidates it. Without this the flag was true in the store and false in
    // every React surface reading it — the preview banner never appeared, which
    // is exactly how this was caught. Nothing is persisted by this call: the
    // flag is already up, so `#persist()` returns early by its own guard.
    this.#changed();
  }

  /** Discard the preview and restore the applied theme. */
  endPreview(): void {
    if (!this.#previewing) return;
    this.#previewing = false;
    const applied = this.#applied;
    this.#applied = null;
    if (!applied) return;
    this.#seed = applied.seed;
    this.#options = applied.options;
    this.#history = [...applied.history];
    this.#overrides = applied.overrides;
    this.#index = this.#seed ? this.#history.indexOf(this.#seed) : -1;
    this.#changed();
  }

  /**
   * Make the preview the applied theme. This is what Apply calls.
   *
   * Note it does NOT re-apply anything: the values are already in force and
   * already painted. The only thing that changes is that they now persist —
   * which is the honest description of what "apply" means once a preview
   * exists, and why this is three lines rather than a second apply path.
   */
  commitPreview(): void {
    if (!this.#previewing) return;
    this.#previewing = false;
    this.#applied = null;
    this.#changed();
  }

  /** Whether an unsaved preview is in force. Surfaces use it to say so. */
  previewing = (): boolean => this.#previewing;

  /* The LOCK lived here and was deleted on 2026-08-12 (owner: "get rid of all
     that lock unlock shit"). It was not merely redundant, it was actively
     harmful: eight mutation paths — `setValue` included — returned early while
     a lock was held, so applying a saved theme made every dial in the designer
     silently do nothing. A control that swallows input without saying so is the
     worst failure mode available, and the fix is the absence of the feature,
     not a better message. Apply applies; save saves. */

  /* -------------------------------- rolling ------------------------------- */

  /**
   * Roll a fresh theme. Applied and saved immediately.
   *
   * **Null means refused** — the theme is locked and nothing changed. Widening
   * the return rather than returning a fabricated `RolledTheme` is the whole
   * difference between a refusal a caller can see and one it cannot: a roll
   * object handed back for a roll that did not happen is a lie in the shape of
   * a success. Nothing consumed this return value when the lock was added, so
   * the honest signature cost nothing.
   */
  roll(options?: RollOptions): RolledTheme | null {
    const seed = seedFrom(`${Date.now?.() ?? 0}:${this.#counter++}:${this.#history.length}`);
    return this.apply(seed, options);
  }

  /**
   * Apply a specific seed — the shareable path. Also how history replays.
   * Null means refused, as with {@link roll}.
   *
   * This is the call the lock exists for: it clears `#overrides`
   * unconditionally, so an accidental roll is not a change that can be stepped
   * back out of — the hand edits are simply gone.
   */
  apply(seed: string, options?: RollOptions): RolledTheme | null {
    this.#seed = seed;
    if (options) this.#options = options;
    // Overrides belong to the theme they were made against; carrying them onto
    // a new roll produces a theme that is neither the roll nor the edit.
    this.#overrides = {};
    if (this.#history[this.#index] !== seed) {
      this.#history = [...this.#history.slice(0, this.#index + 1), seed];
      this.#index = this.#history.length - 1;
    }
    this.#changed();
    return rollTheme(seed, this.#options);
  }

  back(): boolean {
    if (this.#index <= 0) return false;
    this.#index -= 1;
    this.#seed = this.#history[this.#index];
    this.#overrides = {};
    this.#changed();
    return true;
  }

  forward(): boolean {
    if (this.#index >= this.#history.length - 1) return false;
    this.#index += 1;
    this.#seed = this.#history[this.#index];
    this.#overrides = {};
    this.#changed();
    return true;
  }

  /** Constrain future rolls — mode, harmony, hue. Re-rolls the current seed. */
  setOptions(options: RollOptions): void {
    this.#options = { ...this.#options, ...options };
    this.#changed();
  }

  /** Hand-edit one dial over the rolled theme. The SDK designer's entry point. */
  setValue(dialId: string, value: string | number): void {
    this.#overrides = { ...this.#overrides, [dialId]: value };
    this.#changed();
  }

  clearOverrides(): void {
    this.#overrides = {};
    this.#changed();
  }

  /**
   * Return to the shipped default theme — seed, hand edits AND roll options.
   *
   * The options clear is not incidental. `#options` carries the roller's
   * constraints (mode, harmony, hue), and `setOptions` MERGES, so there is no
   * other way to get back to an unconstrained roller: a reset that left them
   * would hand back "the shipped default, except every future roll is still
   * pinned to the dark teal you were experimenting with", which is not what
   * this method's one-line contract says and not what anyone means by reset.
   *
   * `#history` is deliberately KEPT. It is a record of seeds visited, not part
   * of the theme in force — a reset should undo the appearance, not erase the
   * trail back to a look you liked an hour ago.
   *
   * The lock this used to be refused by was deleted on 2026-08-12.
   */
  reset(): void {
    this.#seed = null;
    this.#overrides = {};
    this.#options = {};
    this.#changed();
  }

  /** Convenience: force a mode without disturbing the seed. */
  setMode(mode: Mode): void {
    this.setOptions({ mode });
  }
}

/** The process-wide theme store. */
export const theme = new ThemeStore();
