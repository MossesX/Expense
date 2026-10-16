"use client";

/**
 * @file The grid's **row selection** — a singleton, for one reason.
 *
 * The owner asked for *"multiple select rows and delete selected rows from
 * context menu or del key"*. Both of those act from outside React: the
 * context-menu row is a plain command in `expenses.commands.ts`, and the Del
 * key is a document listener. Neither can read component state, so the
 * selection lives where both can see it — the same argument the store and the
 * settings both make in this module.
 *
 * ## Anchored ranges
 *
 * Shift-click selects a RANGE, and a range needs an anchor and an ordering.
 * The anchor is the last row clicked without shift; the ordering is whatever
 * the grid is currently sorted by, which it hands in at click time. Storing the
 * order here instead would mean the store re-deriving the grid's sort — two
 * places computing one thing, and the range would silently be wrong the moment
 * someone re-sorted.
 */

import * as React from "react";

type Listener = () => void;

const EMPTY: ReadonlySet<string> = new Set();

class SelectionStore {
  #ids: ReadonlySet<string> = EMPTY;
  #anchor: string | null = null;
  #listeners = new Set<Listener>();

  subscribe = (fn: Listener): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getState = (): ReadonlySet<string> => this.#ids;

  /** Constant empty set — the server has no selection, and neither does the
   *  first client frame, so hydration cannot tear. */
  getServerState = (): ReadonlySet<string> => EMPTY;

  #set(ids: ReadonlySet<string>): void {
    this.#ids = ids;
    for (const fn of this.#listeners) fn();
  }

  /** Every selected id, as an array — what the delete command iterates. */
  ids(): string[] {
    return [...this.#ids];
  }

  has(id: string): boolean {
    return this.#ids.has(id);
  }

  get size(): number {
    return this.#ids.size;
  }

  clear(): void {
    if (!this.#ids.size && this.#anchor === null) return;
    this.#anchor = null;
    this.#set(EMPTY);
  }

  /** Replace the selection with exactly this row, and anchor here. */
  only(id: string): void {
    this.#anchor = id;
    this.#set(new Set([id]));
  }

  /** Add or remove one row without disturbing the rest (ctrl/cmd-click). */
  toggle(id: string): void {
    const next = new Set(this.#ids);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.#anchor = id;
    this.#set(next);
  }

  /**
   * Select from the anchor to `id` in the given display order (shift-click).
   *
   * With no anchor this degenerates to {@link only}, which is what every
   * table does and what a person expects from the first shift-click.
   */
  range(id: string, order: readonly string[]): void {
    if (!this.#anchor || !order.includes(this.#anchor)) {
      this.only(id);
      return;
    }
    const from = order.indexOf(this.#anchor);
    const to = order.indexOf(id);
    if (to === -1) return;
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    this.#set(new Set(order.slice(lo, hi + 1)));
  }

  /** Select everything currently displayed (the header checkbox, Ctrl+A). */
  all(order: readonly string[]): void {
    this.#set(new Set(order));
  }

  /**
   * Drop ids that no longer exist.
   *
   * Called after a delete: a selection holding ids of deleted rows reports
   * "3 selected" over an empty grid, and the next Del press then deletes
   * nothing while claiming to delete three.
   */
  prune(live: readonly string[]): void {
    if (!this.#ids.size) return;
    const alive = new Set(live);
    const next = new Set([...this.#ids].filter((id) => alive.has(id)));
    if (next.size === this.#ids.size) return;
    if (this.#anchor && !alive.has(this.#anchor)) this.#anchor = null;
    this.#set(next);
  }
}

/** The process-wide grid selection. */
export const expenseSelection = new SelectionStore();

/** The selection inside a component. */
export function useExpenseSelection(): ReadonlySet<string> {
  return React.useSyncExternalStore(
    expenseSelection.subscribe,
    expenseSelection.getState,
    expenseSelection.getServerState
  );
}
