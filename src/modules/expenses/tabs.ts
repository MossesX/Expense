"use client";

/**
 * @file The Expense Tracker's **tab group** — the model behind the strip.
 *
 * The module used to render three fixed MUI `Tab`s over one `useState`. The
 * owner's ask turned that into a real tab group: *"new report which opens in a
 * new tab because for this layout report displayed in tab group … allow
 * undocking tab and floating as window. if last tab is removed, floated, or
 * closed display animated amberx logo in empty tab."*
 *
 * Four properties follow from those two sentences, and each one is why this is
 * a store rather than component state:
 *
 *   1. **Tabs are open documents, not a fixed enum.** A report is a tab, and
 *      there can be any number of them.
 *   2. **A tab can leave the strip without closing.** Floating moves a tab from
 *      the docked list into a window; the tab and its content are the same
 *      object in both places, so nothing is rebuilt and nothing is lost. Docking
 *      puts it back.
 *   3. **The group can be EMPTY**, and that is a legitimate state with its own
 *      surface (the animated mark), not an error.
 *   4. **Context-menu commands act on it.** `expenses.commands.ts` is plain
 *      functions with no hooks — the taskman precedent — so the state they
 *      mutate has to be a module-scope singleton they can import.
 *
 * ## What is deliberately NOT persisted
 *
 * Nothing here. Which tabs are open, where a window sits, which tab is active
 * — all session state, exactly as the Task Manager's floating windows are
 * ("a floating window is something you opened, not something you configured").
 * Reports themselves are on disk in the vault; the tab showing one is not.
 */

import * as React from "react";

import type { VaultFormat } from "./vault";

/* ------------------------------------------------------------------ shape */

export type TabKind = "grid" | "tree" | "statements" | "report";

/** Where a floated tab is, and how it stacks. */
export interface WindowGeom {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Click-to-front ordering; higher is nearer. */
  z: number;
  minimized: boolean;
}

export interface ReportPayload {
  /** The vault filename once saved; null for a freshly generated draft. */
  name: string | null;
  format: VaultFormat;
  /** The document itself — HTML or markdown text. */
  content: string;
  /** Period key the report covers, when it came from a statement. */
  period?: string;
}

export interface TabState {
  /** Stable and unique. Base tabs use their kind; reports use `report:<key>`. */
  readonly id: string;
  readonly kind: TabKind;
  title: string;
  /** Present only on `kind === "report"`. */
  report?: ReportPayload;
  /** Floating geometry, or null while the tab is docked in the strip. */
  window: WindowGeom | null;
}

export interface TabsState {
  readonly tabs: readonly TabState[];
  /** The active DOCKED tab. Null when the strip is empty. */
  readonly activeId: string | null;
}

/** The three views the module ships with, in their strip order. */
export const BASE_TABS: readonly { id: string; kind: TabKind; title: string }[] = [
  { id: "grid", kind: "grid", title: "Grid" },
  { id: "tree", kind: "tree", title: "Tree" },
  { id: "statements", kind: "statements", title: "Statements" }
];

const INITIAL: TabsState = {
  tabs: BASE_TABS.map((t) => ({ ...t, window: null })),
  activeId: "grid"
};

/** Where the first floated window lands, and how far each next one cascades. */
const FLOAT_ORIGIN = { x: 140, y: 130, w: 720, h: 460 } as const;
const FLOAT_CASCADE = 28;

type Listener = () => void;

/**
 * Exported for `test/expenses-tabs.test.ts`, which needs fresh instances.
 * App code never constructs one — it imports the {@link expenseTabs} singleton,
 * which is what lets commands and every mounted surface share one group.
 */
export class TabsStore {
  #tabs: TabState[] = BASE_TABS.map((t) => ({ ...t, window: null }));
  #activeId: string | null = "grid";
  #z = 1;
  #floated = 0;
  /** Counter behind `report:draft-<n>` ids for reports not yet saved. */
  #drafts = 0;
  #snapshot: TabsState | null = null;
  #listeners = new Set<Listener>();

  subscribe = (fn: Listener): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  /** Cached, because a `useSyncExternalStore` getter that allocates is a loop. */
  getState = (): TabsState => {
    this.#snapshot ??= { tabs: [...this.#tabs], activeId: this.#activeId };
    return this.#snapshot;
  };

  /** Constant, so the server render and the hydrating client render agree. */
  getServerState = (): TabsState => INITIAL;

  #changed(): void {
    this.#snapshot = null;
    for (const fn of this.#listeners) fn();
  }

  /* ------------------------------------------------------------ reading */

  get(id: string): TabState | undefined {
    return this.#tabs.find((t) => t.id === id);
  }

  docked(): TabState[] {
    return this.#tabs.filter((t) => t.window === null);
  }

  floating(): TabState[] {
    return this.#tabs.filter((t) => t.window !== null);
  }

  /* ------------------------------------------------------------ opening */

  /**
   * Activate the first docked tab, or `null` when there is none.
   *
   * Called after every removal and every float, because "which tab is active"
   * is not something a caller should have to recompute — and forgetting to is
   * how a strip ends up pointing at a tab that is now a window.
   */
  #reseat(preferAfter?: number): void {
    const docked = this.docked();
    if (!docked.length) {
      this.#activeId = null;
      return;
    }
    if (this.#activeId && docked.some((t) => t.id === this.#activeId)) return;
    // Prefer the neighbour that took the closed tab's place — a strip that
    // jumps to the far left every time you close something loses your place.
    const index = Math.min(preferAfter ?? 0, docked.length - 1);
    this.#activeId = docked[Math.max(0, index)].id;
  }

  activate(id: string): void {
    const tab = this.get(id);
    if (!tab) return;
    // Activating a floated tab means bringing its WINDOW forward, not moving
    // it back into the strip — the two are different requests and conflating
    // them makes a click on a taskbar entry silently re-dock the window.
    if (tab.window) {
      this.focusWindow(id);
      return;
    }
    if (this.#activeId === id) return;
    this.#activeId = id;
    this.#changed();
  }

  /**
   * Restore every base view — what the empty state's one button and the
   * `expenses.tabs.restore` menu row both call.
   *
   * Re-sorted through {@link sortTabs} rather than appended: base views keep
   * their canonical order, so a restored Grid never ends up sitting after three
   * reports, which reads as a different application.
   */
  restoreBaseTabs(): void {
    for (const base of BASE_TABS) {
      if (!this.get(base.id)) this.#tabs = [...this.#tabs, { ...base, window: null }];
      else if (this.get(base.id)?.window) this.patchWindow(base.id, null);
    }
    this.#tabs = [...this.#tabs].sort(sortTabs);
    this.#reseat();
    this.#changed();
  }

  /**
   * Open a report in its own tab, activating it.
   *
   * Keyed by vault name when it has one, so opening the same saved report
   * twice focuses the tab you already have rather than growing a second copy
   * of the same document that can then disagree with itself.
   */
  openReport(payload: ReportPayload, title: string): string {
    const id = payload.name ? `report:${payload.name}` : `report:draft-${++this.#drafts}`;
    const existing = this.get(id);
    if (existing) {
      existing.title = title;
      existing.report = payload;
      if (existing.window) this.focusWindow(id);
      else this.#activeId = id;
      this.#changed();
      return id;
    }
    this.#tabs = [...this.#tabs, { id, kind: "report", title, report: payload, window: null }];
    this.#activeId = id;
    this.#changed();
    return id;
  }

  /** A draft tab that has just been saved adopts its filename identity. */
  renameReport(id: string, name: string, title: string): string {
    const tab = this.get(id);
    if (!tab || tab.kind !== "report" || !tab.report) return id;
    const nextId = `report:${name}`;
    const clash = nextId !== id && this.get(nextId);
    if (clash) this.close(nextId);
    const next: TabState = {
      ...tab,
      id: nextId,
      title,
      report: { ...tab.report, name },
      window: tab.window
    };
    this.#tabs = this.#tabs.map((t) => (t.id === id ? next : t));
    if (this.#activeId === id) this.#activeId = nextId;
    this.#changed();
    return nextId;
  }

  /* ------------------------------------------------------------ removing */

  close(id: string): void {
    const index = this.docked().findIndex((t) => t.id === id);
    const before = this.#tabs.length;
    this.#tabs = this.#tabs.filter((t) => t.id !== id);
    if (this.#tabs.length === before) return;
    this.#reseat(index);
    this.#changed();
  }

  /** Close every other tab — including floated ones, which is what "others"
   *  means to a person looking at a screen full of them. */
  closeOthers(id: string): void {
    if (!this.get(id)) return;
    this.#tabs = this.#tabs.filter((t) => t.id === id);
    this.#reseat();
    this.#changed();
  }

  /* ------------------------------------------------------------ floating */

  /**
   * Undock a tab into a floating window.
   *
   * Windows cascade from a fixed origin rather than opening on top of each
   * other: three windows in exactly the same place look like one window and a
   * broken app.
   */
  float(id: string): void {
    const tab = this.get(id);
    if (!tab || tab.window) return;
    const step = (this.#floated++ % 6) * FLOAT_CASCADE;
    const index = this.docked().findIndex((t) => t.id === id);
    tab.window = {
      x: FLOAT_ORIGIN.x + step,
      y: FLOAT_ORIGIN.y + step,
      w: FLOAT_ORIGIN.w,
      h: FLOAT_ORIGIN.h,
      z: ++this.#z,
      minimized: false
    };
    this.#reseat(index);
    this.#changed();
  }

  /** Put a floating tab back in the strip and make it the active one. */
  dock(id: string): void {
    const tab = this.get(id);
    if (!tab || !tab.window) return;
    tab.window = null;
    this.#tabs = [...this.#tabs].sort(sortTabs);
    this.#activeId = id;
    this.#changed();
  }

  focusWindow(id: string): void {
    const tab = this.get(id);
    if (!tab?.window) return;
    if (tab.window.z === this.#z && !tab.window.minimized) return;
    tab.window = { ...tab.window, z: ++this.#z, minimized: false };
    this.#changed();
  }

  /** Patch a window's geometry. `null` docks it — see {@link dock}. */
  patchWindow(id: string, patch: Partial<WindowGeom> | null): void {
    const tab = this.get(id);
    if (!tab?.window) return;
    if (patch === null) {
      this.dock(id);
      return;
    }
    tab.window = { ...tab.window, ...patch };
    this.#changed();
  }
}

/**
 * Base views keep their canonical order and reports follow, so re-docking never
 * shuffles the strip into an order nobody chose.
 */
function sortTabs(a: TabState, b: TabState): number {
  const rank = (t: TabState) => {
    const i = BASE_TABS.findIndex((base) => base.kind === t.kind);
    return i === -1 ? BASE_TABS.length : i;
  };
  return rank(a) - rank(b);
}

/** The process-wide tab group. */
export const expenseTabs = new TabsStore();

/** The tab group inside a component. */
export function useExpenseTabs(): TabsState {
  return React.useSyncExternalStore(
    expenseTabs.subscribe,
    expenseTabs.getState,
    expenseTabs.getServerState
  );
}
