/**
 * @file The module-settings runtime: ONE generic store class, a registry keyed
 * by owner id, and the tiny UI store the shell's dialog and gear read.
 *
 * Replaces four structurally identical hand-rolled `SettingsStore` classes
 * (taskman, expenses, claude-workspace, amberart). The API is theirs, kept
 * verbatim — `subscribe` / `getState` / `getServerState` / `set` / `reset` —
 * so migration is mechanical and `useSyncExternalStore` call sites do not
 * change shape.
 *
 * What DID change, deliberately: persistence is the kv transport
 * (`defaultKv()` — HTTP to `/api/axf/kv/<ns>` in a browser, memory elsewhere),
 * not `localStorage`. Server-side, per-user, survives a restart — which is the
 * whole reason `persist/kv.ts` was built; its header names the third
 * hand-rolled store as the promotion signal, and these were the fourth
 * through seventh.
 *
 * The load is LAZY and ASYNC: first read returns the defaults, the kv read is
 * kicked off, and when it lands the merged document arrives as an ordinary
 * notification. That is the same posture the localStorage stores took
 * (`getServerState` returns defaults so hydration cannot tear), stretched
 * over a network read. Writes are optimistic: state and listeners first, the
 * PUT after, and a failed PUT keeps the change in memory for the session —
 * the theme store's rule (saved instantly, no confirm step, degrade quietly).
 */
"use client";

import * as React from "react";

import { defaultKv } from "../persist/client";
import type { KvTransport } from "../persist/client";
import { settingsDefaults, validateSettingsDecl } from "./decl";
import type { ModuleSettingsDecl, SettingValue } from "./decl";

export type SettingsValues = Record<string, SettingValue>;

type Listener = () => void;

const DOC_VERSION = 1;

export class ModuleSettingsStore {
  readonly ownerId: string;
  readonly decl: ModuleSettingsDecl;
  #defaults: SettingsValues;
  #state: SettingsValues;
  #transport: KvTransport;
  #loadStarted = false;
  #listeners = new Set<Listener>();

  constructor(ownerId: string, decl: ModuleSettingsDecl, transport?: KvTransport) {
    this.ownerId = ownerId;
    this.decl = decl;
    this.#defaults = settingsDefaults(decl);
    this.#state = this.#defaults;
    // Resolved lazily when omitted: `defaultKv()` picks http vs memory by
    // runtime, and constructing stores at module scope must not pin the
    // server's memory transport into a client bundle's instance.
    this.#transport = transport ?? defaultKv();
  }

  #ensureLoaded(): void {
    if (this.#loadStarted || typeof window === "undefined") return;
    this.#loadStarted = true;
    void this.#transport
      .read(this.decl.ns)
      .then((doc) => {
        const stored = doc && doc.v === DOC_VERSION ? (doc.settings as Partial<SettingsValues>) : null;
        if (!stored) return;
        // Merged over the defaults, never assigned: a doc written before a
        // row existed must not read back as `undefined` for it. A stored key
        // whose row was REMOVED is dropped on the same pass — a value with no
        // row has no control and no reader.
        const next: SettingsValues = { ...this.#defaults };
        for (const key of Object.keys(this.#defaults)) {
          const v = stored[key];
          if (v !== undefined && typeof v === typeof this.#defaults[key]) next[key] = v;
        }
        this.#state = next;
        for (const fn of this.#listeners) fn();
      })
      .catch(() => {
        // Unreadable/absent document: the defaults stand. Overwritten on the
        // next edit only.
      });
  }

  subscribe = (fn: Listener): (() => void) => {
    this.#ensureLoaded();
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getState = (): SettingsValues => {
    this.#ensureLoaded();
    return this.#state;
  };

  /** The snapshot React uses on the server — always the defaults, so the
   *  server and the first client frame agree and hydration cannot tear. */
  getServerState = (): SettingsValues => this.#defaults;

  set(key: string, value: SettingValue): void {
    this.#ensureLoaded();
    if (!(key in this.#defaults)) {
      // A typo'd key must fail where it is written, not vanish into a doc.
      throw new Error(`"${this.ownerId}" has no setting "${key}"`);
    }
    if (this.#state[key] === value) return;
    this.#state = { ...this.#state, [key]: value };
    for (const fn of this.#listeners) fn();
    void this.#transport
      .write(this.decl.ns, { v: DOC_VERSION, settings: this.#state })
      .catch(() => {
        // Route down / no host: the change stays in memory for the session.
      });
  }

  reset(): void {
    for (const key of Object.keys(this.#defaults)) this.set(key, this.#defaults[key]);
  }
}

/* ── the registry ─────────────────────────────────────────────────────────── */

export class SettingsRegistryError extends Error {}

/**
 * Owner id → live store. Not a `SurfaceRegistry` — nothing here is a
 * swappable candidate on a surface; it is one store per owner, permanent for
 * the life of the runtime, the same shape as the command registry.
 */
export class SettingsRegistry {
  #stores = new Map<string, ModuleSettingsStore>();
  #listeners = new Set<Listener>();

  register(ownerId: string, decl: ModuleSettingsDecl, transport?: KvTransport): ModuleSettingsStore {
    const existing = this.#stores.get(ownerId);
    // Idempotent under a dev-server remount — same owner, same ns is a
    // re-evaluation, not a conflict.
    if (existing) {
      if (existing.decl.ns !== decl.ns) {
        throw new SettingsRegistryError(
          `"${ownerId}" re-registered settings with ns "${decl.ns}" over "${existing.decl.ns}"`
        );
      }
      return existing;
    }
    const problems = validateSettingsDecl(ownerId, decl);
    if (problems.length) {
      throw new SettingsRegistryError(
        `"${ownerId}" declares invalid settings:\n  - ${problems.join("\n  - ")}`
      );
    }
    for (const store of this.#stores.values()) {
      if (store.decl.ns === decl.ns) {
        throw new SettingsRegistryError(
          `"${ownerId}" claims kv ns "${decl.ns}", already owned by "${store.ownerId}"`
        );
      }
    }
    const store = new ModuleSettingsStore(ownerId, decl, transport);
    this.#stores.set(ownerId, store);
    for (const fn of this.#listeners) fn();
    return store;
  }

  get(ownerId: string): ModuleSettingsStore | null {
    return this.#stores.get(ownerId) ?? null;
  }

  has(ownerId: string): boolean {
    return this.#stores.has(ownerId);
  }

  ids(): string[] {
    return [...this.#stores.keys()];
  }

  subscribe(fn: Listener): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }
}

export const settings = new SettingsRegistry();

/**
 * The one registration seam, `registerModuleMenus`'s twin: a host (Studio's
 * subsystem, the peeled app's generated boot) calls it for every module it
 * registers, and a module with no `settings` is a no-op. Plugins with settings
 * of their own call it directly with their plugin id.
 */
export function registerModuleSettings(spec: {
  readonly id: string;
  readonly settings?: ModuleSettingsDecl;
}): void {
  if (!spec.settings) return;
  settings.register(spec.id, spec.settings);
}

/** Read an owner's settings outside React — what command handlers use.
 *  Returns the decl defaults for an owner that registered none, so a caller
 *  can read `getModuleSettings(id).dense` without a null dance. */
export function getModuleSettings(ownerId: string): SettingsValues {
  return settings.get(ownerId)?.getState() ?? {};
}

const EMPTY: SettingsValues = {};
const emptySub = () => () => {};
const emptyGet = () => EMPTY;

/** Live settings inside a component; safe under SSR (server sees defaults).
 *  An owner with no registered settings yields a stable empty object. */
export function useModuleSettings(ownerId: string): SettingsValues {
  const store = settings.get(ownerId);
  return React.useSyncExternalStore(
    store ? store.subscribe : emptySub,
    store ? store.getState : emptyGet,
    store ? store.getServerState : emptyGet
  );
}

/* ── the dialog's UI store ────────────────────────────────────────────────── */

/**
 * Which owner's settings dialog is open, if any. A store rather than component
 * state because its writers have no hooks: the `module.settings.open` command
 * (a plain function fired from a context menu) and the gear in `ModuleHost`.
 * The one reader is the shell-mounted `SettingsDialog`.
 */
class SettingsUiStore {
  #openFor: string | null = null;
  #listeners = new Set<Listener>();

  open(ownerId: string): void {
    if (this.#openFor === ownerId) return;
    this.#openFor = ownerId;
    for (const fn of this.#listeners) fn();
  }

  close(): void {
    if (this.#openFor === null) return;
    this.#openFor = null;
    for (const fn of this.#listeners) fn();
  }

  openFor = (): string | null => this.#openFor;

  /** Server snapshot: closed. A dialog cannot be open before anyone clicked. */
  serverOpenFor = (): null => null;

  subscribe = (fn: Listener): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };
}

export const settingsUi = new SettingsUiStore();

/* ── the hosted-module seam ───────────────────────────────────────────────── */

/**
 * The module currently on screen, published by `ModuleHost` on mount. This is
 * how a hook-less command handler ("Module settings" on the universal band)
 * answers "settings for WHICH module" — the ctx area path could answer it too,
 * but only for clicks inside a marked area, and the universal band is on every
 * menu.
 */
let hosted: { id: string; title: string } | null = null;

export function setHostedModule(mod: { id: string; title: string } | null): void {
  hosted = mod;
}

export function hostedModule(): { id: string; title: string } | null {
  return hosted;
}
