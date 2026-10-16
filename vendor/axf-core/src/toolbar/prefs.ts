/**
 * @file Per-user PRESENTATION preferences for a toolbar asset — how big its
 * icons are, whether its words render, and which way it runs.
 *
 * Owner request, 2026-08-13: *"edit all toolbar assets new and existing to
 * contain a settings dialog opened by right clicking the toolbar and selecting
 * settings. allow changing various things like text or not, icon size,
 * vertical or horizontal"*.
 *
 * ## Why this is not a field on the asset, and not a theme dial
 *
 * The asset owns the ARRANGEMENT (`toolbar/types.ts`) — which items, in what
 * order, with what commands. It also states its own defaults for the three
 * things below, because a bar drawn as a big-icon tab strip is a different bar
 * from a 13px command bar and that is the author's call. What it cannot own is
 * the READER's call: "I want no words on my banner" is one person's preference
 * about one bar, and writing it into the asset would change it for everybody
 * and would have to be saved as a new asset to persist at all.
 *
 * A theme dial is the other tempting home and is wrong for the mirror-image
 * reason: a dial is part of a LOOK — rolled, saved to the shelf, applied by
 * anyone who applies that theme — and `bannerBar` already does the one thing a
 * theme legitimately decides about bars, which is *which bar*. Fifty toolbar
 * assets × four knobs is not a palette.
 *
 * So this is a third thing and says so: a per-user document, keyed by asset id,
 * additive over whatever the asset declares. The same posture as the live brand
 * edits in `brand/edits.tsx` — a layer the renderer consults, that nothing else
 * reads — except that this one persists, because a preference that does not
 * survive a reload is a preference nobody sets twice.
 *
 * ## Persistence, and what the two snapshots mean
 *
 * The kv transport (`persist/client.ts`), not `localStorage`: per-user,
 * server-side, survives a dev-server restart. Modelled on
 * `settings/store.ts` down to the posture, deliberately — one namespace,
 * lazy async load, optimistic writes, and `getServerState` pinned to the
 * defaults so the server render and the hydrating client render agree and the
 * banner cannot tear. The stored value is a PARTIAL per asset: a bar whose
 * author later raises its declared icon size shows that change to every reader
 * who never touched the icon size, which a full snapshot would silently freeze.
 */
"use client";

import * as React from "react";

import { defaultKv } from "../persist/client";
import type { KvTransport } from "../persist/client";
import type { ToolbarAsset } from "./types";

/** Which way a bar runs. Defaults from the asset's role; `rail` is vertical. */
export type ToolbarOrientation = "horizontal" | "vertical";

/** The four knobs, fully resolved — what the renderer reads. */
export interface ToolbarPrefs {
  /** Draw the asset's own words: action labels, menu labels, `label` items,
   *  a field's placeholder. Off leaves the icons and every tooltip. */
  readonly labels: boolean;
  /** Icon size in px for action / menu / field glyphs. A brand item keeps its
   *  own declared `width` — a logo is not an icon and does not scale with one. */
  readonly iconSize: number;
  readonly orientation: ToolbarOrientation;
  /**
   * Bar thickness in px — height when horizontal, width when vertical. `0`
   * means "whatever the asset declares, or the theme's bar-thickness dial",
   * which is the value that has to exist: without it, opening the dialog once
   * would pin a number and the bar would stop following its own asset.
   */
  readonly thickness: number;
}

/** What one asset's stored entry looks like: only the knobs actually touched. */
export type ToolbarPrefsPatch = Partial<ToolbarPrefs>;

/** Asset id → patch. The whole document, as the renderer and the dialog see it. */
export type ToolbarPrefsDoc = Readonly<Record<string, ToolbarPrefsPatch>>;

/** The kv namespace. One document per user for every bar they have tuned. */
export const TOOLBAR_PREFS_NS = "toolbar-prefs";

/** Bounds, stated once so the dialog's controls and the sanitiser agree. */
export const TOOLBAR_ICON_MIN = 10;
export const TOOLBAR_ICON_MAX = 48;
export const TOOLBAR_THICKNESS_MAX = 200;

/** The shipped icon size — what `action`/`menu` glyphs drew at before the
 *  asset could state one, kept as the default so no existing bar moved. */
export const TOOLBAR_ICON_DEFAULT = 13;

const DOC_VERSION = 1;
const EMPTY_DOC: ToolbarPrefsDoc = Object.freeze({});

type Listener = () => void;

const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Math.round(n)));

/**
 * The defaults for one asset: what it declares, with the role deciding
 * orientation. This is also the answer for an asset nobody has ever tuned, so
 * the resolution below is one merge rather than two code paths.
 */
export function declaredToolbarPrefs(asset: ToolbarAsset): ToolbarPrefs {
  return {
    labels: asset.labels !== false,
    iconSize: clamp(asset.iconSize ?? TOOLBAR_ICON_DEFAULT, TOOLBAR_ICON_MIN, TOOLBAR_ICON_MAX),
    orientation: asset.role === "rail" ? "vertical" : "horizontal",
    thickness: 0
  };
}

/**
 * Drop anything a stored document should not be able to say. A hand-edited kv
 * file, or one written by an older shape, must degrade to the asset's own
 * values rather than putting a 4000px icon in the banner.
 */
function sanitise(patch: unknown): ToolbarPrefsPatch {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) return {};
  const raw = patch as Record<string, unknown>;
  const out: { -readonly [K in keyof ToolbarPrefs]?: ToolbarPrefs[K] } = {};
  if (typeof raw.labels === "boolean") out.labels = raw.labels;
  if (typeof raw.iconSize === "number" && Number.isFinite(raw.iconSize)) {
    out.iconSize = clamp(raw.iconSize, TOOLBAR_ICON_MIN, TOOLBAR_ICON_MAX);
  }
  if (raw.orientation === "horizontal" || raw.orientation === "vertical") {
    out.orientation = raw.orientation;
  }
  if (typeof raw.thickness === "number" && Number.isFinite(raw.thickness)) {
    out.thickness = clamp(raw.thickness, 0, TOOLBAR_THICKNESS_MAX);
  }
  return out;
}

/**
 * The prefs a bar actually renders with.
 *
 * Takes the whole document rather than reading the store, so a renderer
 * subscribes once for the bar instead of once per item — the rule
 * `editedGlyph` already states for the brand-edit layer.
 */
export function resolveToolbarPrefs(asset: ToolbarAsset, doc: ToolbarPrefsDoc): ToolbarPrefs {
  const declared = declaredToolbarPrefs(asset);
  const stored = doc[asset.id];
  return stored ? { ...declared, ...sanitise(stored) } : declared;
}

/** Whether a bar has any override at all — what the dialog's Reset button and
 *  a "customised" badge ask, without either re-deriving the merge. */
export function toolbarPrefsTouched(assetId: string, doc: ToolbarPrefsDoc): boolean {
  return Object.keys(doc[assetId] ?? {}).length > 0;
}

export class ToolbarPrefsStore {
  #state: ToolbarPrefsDoc = EMPTY_DOC;
  #transport: KvTransport | null;
  #loadStarted = false;
  readonly #listeners = new Set<Listener>();

  constructor(transport?: KvTransport) {
    // Resolved lazily when omitted, for the reason `ModuleSettingsStore` gives:
    // this store is constructed at module scope, and `defaultKv()` picks http
    // vs memory by runtime — pinning the server's memory transport into a
    // client bundle's instance is exactly the bug that would produce.
    this.#transport = transport ?? null;
  }

  #kv(): KvTransport {
    this.#transport ??= defaultKv();
    return this.#transport;
  }

  #ensureLoaded(): void {
    if (this.#loadStarted || typeof window === "undefined") return;
    this.#loadStarted = true;
    void this.#kv()
      .read(TOOLBAR_PREFS_NS)
      .then((doc) => {
        if (!doc || doc.v !== DOC_VERSION) return;
        const bars = doc.bars;
        if (typeof bars !== "object" || bars === null || Array.isArray(bars)) return;
        const next: Record<string, ToolbarPrefsPatch> = {};
        for (const [id, patch] of Object.entries(bars as Record<string, unknown>)) {
          const clean = sanitise(patch);
          if (Object.keys(clean).length) next[id] = clean;
        }
        this.#state = next;
        for (const fn of this.#listeners) fn();
      })
      .catch(() => {
        // No route, no document, unreadable JSON: the assets' own values stand.
        // Overwritten on the next edit only — never on a failed read, or one
        // dropped request would wipe a person's preferences.
      });
  }

  subscribe = (fn: Listener): (() => void) => {
    this.#ensureLoaded();
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getState = (): ToolbarPrefsDoc => {
    this.#ensureLoaded();
    return this.#state;
  };

  /** Always the empty document. See the two-snapshots note in the docblock. */
  getServerState = (): ToolbarPrefsDoc => EMPTY_DOC;

  /** Set one knob on one bar. Optimistic: state and listeners first, PUT after
   *  — a failed write keeps the change for the session (the theme store's rule:
   *  saved instantly, no confirm step, degrade quietly). */
  set<K extends keyof ToolbarPrefs>(assetId: string, key: K, value: ToolbarPrefs[K]): void {
    this.#ensureLoaded();
    const clean = sanitise({ [key]: value });
    if (!(key in clean)) return;
    const current = this.#state[assetId] ?? {};
    if (current[key] === clean[key]) return;
    this.#write({ ...this.#state, [assetId]: { ...current, ...clean } });
  }

  /** Forget every override for one bar — back to what the asset declares. */
  reset(assetId: string): void {
    this.#ensureLoaded();
    if (!this.#state[assetId]) return;
    const next = { ...this.#state };
    delete next[assetId];
    this.#write(next);
  }

  #write(next: ToolbarPrefsDoc): void {
    this.#state = next;
    for (const fn of this.#listeners) fn();
    void this.#kv()
      .write(TOOLBAR_PREFS_NS, { v: DOC_VERSION, bars: next })
      .catch(() => {
        // Route down: the change stays in memory for the session.
      });
  }
}

/** The process-wide preference document. */
export const toolbarPrefs = new ToolbarPrefsStore();

/** Live prefs inside a component; safe under SSR (server sees no overrides). */
export function useToolbarPrefs(): ToolbarPrefsDoc {
  return React.useSyncExternalStore(
    toolbarPrefs.subscribe,
    toolbarPrefs.getState,
    toolbarPrefs.getServerState
  );
}

/* ── the dialog's UI store ────────────────────────────────────────────────── */

/**
 * Which bar's settings dialog is open, if any.
 *
 * A store rather than component state for the same reason `settingsUi` is one:
 * its writer has no hooks. `toolbar.settings.open` is a plain function fired
 * from a context menu, and the one reader is the shell-mounted dialog.
 */
class ToolbarPrefsUiStore {
  #openFor: string | null = null;
  readonly #listeners = new Set<Listener>();

  open(assetId: string): void {
    if (this.#openFor === assetId) return;
    this.#openFor = assetId;
    for (const fn of this.#listeners) fn();
  }

  close(): void {
    if (this.#openFor === null) return;
    this.#openFor = null;
    for (const fn of this.#listeners) fn();
  }

  openFor = (): string | null => this.#openFor;

  /** Closed. A dialog cannot be open before anyone right-clicked. */
  serverOpenFor = (): null => null;

  subscribe = (fn: Listener): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };
}

export const toolbarPrefsUi = new ToolbarPrefsUiStore();
