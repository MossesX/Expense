/**
 * @file THE DEFAULT STATE, captured as data — the theme, packs, chrome and
 * baselines every new user gets, and the factory-reset target.
 *
 * One module, data only: no React, no side effects, `import type` only from
 * core. Everything a fresh account's appearance and baseline consist of is
 * stated HERE rather than scattered across boot code, so the appearance-state
 * engine (P1) can save named snapshots of the SAME shape and apply default and
 * saved states through ONE apply path — `defaultStateSnapshot()` returns that
 * shape.
 *
 * ## DEFAULT_THEME — a CHOSEN seed, with the measurements that chose it
 *
 * Seed `x6hq29`, picked by rolling 64 deterministic candidate seeds
 * (`seedFrom("axf-default-state-<i>")`, i = 0..63) through the real generator
 * (`rollTheme`, core theme/generate.ts) under both `{}` and `{ mode: "dark" }`
 * — 128 rolls — and scoring for the house identity: amber over near-black,
 * legible by measurement rather than by eye. What `x6hq29` measured:
 *
 * | value | hex | contrast on page | spec minimum |
 * |---|---|---|---|
 * | page | `#1e1a15` | (rel. luminance 0.011 — near-black, warm) | — |
 * | ink | `#f0efed` | **15.06:1** | 4.5 |
 * | dim | `#b7b3ad` | **8.29:1** | 3 |
 * | accent | `#f9ae3d` (hue 36°) | **9.19:1** | 3 |
 *
 * `paletteLegibility()` (core brand/roles.ts) over the rolled palette
 * (accent/accent2/accent3/ink/dim/edge/page/ok/warn/err): **zero problems**.
 * The accent's 36° hue sits beside the house amber (`#f0982e`, ~30°), so the
 * default theme and the default identity pack speak the same colour.
 *
 * `options` is `{}` deliberately: the seed rolls IDENTICAL values with
 * `{ mode: "dark" }` (verified in the same scan), and an empty options record
 * leaves the roller unconstrained — the posture `ThemeStore.reset()` takes.
 * `overrides` is empty: the roll needed no hand correction.
 *
 * ## What the other constants record, and where each was read from
 *
 * - DEFAULT_PACKS — the app-default identity `seedDefaultIdentity()` states
 *   (src/packs/default-identity.ts): the merged studio brand whose base
 *   recolours to Amber, i.e. the axf-amber house style. Two slots, the same
 *   two `PackRegistry` persists (core brand/packs.ts, `SLOT_ORDER`).
 * - DEFAULT_CHROME — the shipped registry defaults the theme's optionless
 *   chrome dials (`bannerBar` / `navMenu` / `dashboard`, empty = "the app's
 *   default") fall back to, read from `studio.subsystem.ts`: `command-bar` is
 *   explicitly `toolbars.activate()`d, `studio-nav` registers first and is the
 *   app.nav fallback, `dash-amberx-console` is the only registered wrapper.
 * - DEFAULT_SETTINGS_BASELINE — per-ns overrides for where a module's default
 *   should differ from its decl default. EMPTY today, on purpose: no module
 *   currently ships a default that disagrees with its own decl
 *   (`settingsDefaults()`, core settings/store.ts serves decl defaults until a
 *   kv doc exists). The seam is the contract; content arrives when a module
 *   earns an exception.
 * - DEFAULT_DATA_BASELINE — what a fresh boot seeds on disk, read from the
 *   code rather than invented: NOTHING. `ModuleSettingsStore` lazy-creates its
 *   kv doc on first write; `seedChromeAssets(null)` (src/chrome/seed.ts)
 *   tolerates an absent chrome-assets doc and registers shipped chrome only;
 *   packs/toolbars/navs/dashboards are re-registered from code every boot.
 *   So the baseline is the ABSENCE of per-user documents — a factory reset
 *   restores it by deleting, not by writing seeded shapes.
 */
import type { RollOptions, ThemeValues } from "@axf/core";

/**
 * The persisted theme record minus history — what `ThemeStore` needs to put a
 * theme in force (`apply(seed, options)` then overrides), and what a saved
 * appearance snapshot carries. History is deliberately absent: it is a trail
 * of seeds visited, not part of the look (`ThemeStore.reset()` keeps it).
 */
export interface ThemeStateSnapshot {
  /** `null` = the spec's own `defaultValues()` — no roll in force. */
  readonly seed: string | null;
  readonly options: RollOptions;
  /** Hand-edited dial values layered over the roll. */
  readonly overrides: ThemeValues;
}

export const DEFAULT_THEME: ThemeStateSnapshot = {
  seed: "x6hq29",
  options: {},
  overrides: {}
};

/** One id (or a deliberate `null`) per `PackRegistry` slot. */
export interface PacksState {
  readonly "branding-package": string | null;
  readonly "logo-package": string | null;
}

export const DEFAULT_PACKS: PacksState = {
  "branding-package": "axs-studio-brand",
  "logo-package": "axs-studio-logos"
};

/**
 * Concrete asset ids for the three chrome surfaces. The theme dials' shipped
 * default is `""` ("whatever the registry has active"); these are what that
 * resolves to on a fresh boot, recorded concretely so a reset can assert them.
 */
export interface ChromeState {
  readonly bannerBar: string;
  readonly navMenu: string;
  readonly dashboard: string;
}

export const DEFAULT_CHROME: ChromeState = {
  bannerBar: "command-bar",
  navMenu: "studio-nav",
  dashboard: "dash-amberx-console"
};

/**
 * kv ns → setting key → value, mirroring `SettingValue`'s union structurally
 * rather than importing the runtime module's type graph.
 */
export type SettingsBaseline = Readonly<
  Record<string, Readonly<Record<string, string | number | boolean>>>
>;

export const DEFAULT_SETTINGS_BASELINE: SettingsBaseline = {};

/** kv ns → the document a fresh account should hold. Empty = no documents. */
export type DataBaseline = Readonly<Record<string, unknown>>;

export const DEFAULT_DATA_BASELINE: DataBaseline = {};

/**
 * The one shape appearance state travels in — the default below, and every
 * named snapshot the P1 engine saves. Default and saved states go through the
 * SAME apply path because they are the same type.
 */
export interface AppearanceStateSnapshot {
  readonly version: 1;
  readonly theme: ThemeStateSnapshot;
  readonly packs: PacksState;
  readonly chrome: ChromeState;
  readonly settings: SettingsBaseline;
  readonly data: DataBaseline;
}

/** The default state, in the snapshot shape the P1 engine saves and applies. */
export function defaultStateSnapshot(): AppearanceStateSnapshot {
  return {
    version: 1,
    theme: DEFAULT_THEME,
    packs: DEFAULT_PACKS,
    chrome: DEFAULT_CHROME,
    settings: DEFAULT_SETTINGS_BASELINE,
    data: DEFAULT_DATA_BASELINE
  };
}
