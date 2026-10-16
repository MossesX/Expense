"use client";

/**
 * @file The expense store — a module-scope singleton, server-backed, seedless.
 *
 * A SINGLETON rather than hook state, for the same reason the Task Manager's
 * store is one: it has more than one kind of reader. The screen and its tabs
 * subscribe through React, but `expenses.commands.ts` — the behaviour behind
 * the context-menu rows — is plain functions with no hooks, and a command
 * mutating the singleton lands on every mounted surface at once.
 *
 * The `/api/expenses` route's kv document is the source of truth (it survives
 * any browser): loaded once on the first client subscription, mirrored back
 * with a short debounce on every commit. There is deliberately no seed data —
 * an empty store honestly renders empty.
 *
 * GizmoX's version also carried `syncFromDatagrid` (a Data Grid → expenses
 * conversion) — dropped, not stubbed: AmberX has no Data Grid module, and a
 * method that always throws is a dead affordance a UI would still draw a
 * button for.
 */

import * as React from "react";

import { uid } from "./id";
import { INCOME_CATEGORY, type Expense } from "./types";

export interface ExpensesState {
  readonly list: readonly Expense[];
  /** True once the first load settled (successfully or not). */
  readonly ready: boolean;
  readonly error: string | null;
}

const INITIAL: ExpensesState = { list: [], ready: false, error: null };

type Listener = () => void;

class ExpenseStore {
  #state: ExpensesState = INITIAL;
  #listeners = new Set<Listener>();
  #loadStarted = false;
  #saveTimer: ReturnType<typeof setTimeout> | null = null;

  /** The server render's snapshot — constant, so hydration cannot tear. */
  readonly #serverState: ExpensesState = INITIAL;

  subscribe = (fn: Listener): (() => void) => {
    this.#ensureLoaded();
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getState = (): ExpensesState => this.#state;
  getServerState = (): ExpensesState => this.#serverState;

  #set(patch: Partial<ExpensesState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const fn of this.#listeners) fn();
  }

  #ensureLoaded(): void {
    if (this.#loadStarted || typeof window === "undefined") return;
    this.#loadStarted = true;
    void (async () => {
      try {
        const res = await fetch("/api/expenses");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `load failed (${res.status})`);
        this.#set({ list: (data.expenses ?? []) as Expense[], ready: true });
      } catch (e) {
        this.#set({ error: e instanceof Error ? e.message : String(e), ready: true });
      }
    })();
  }

  #persist(next: readonly Expense[]): void {
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => {
      void fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expenses: next })
      }).catch(() => {
        /* offline/failed mirror — the in-memory list is still the session's
           truth, and the next successful commit writes the whole list */
      });
    }, 400);
  }

  commit(next: readonly Expense[]): void {
    this.#set({ list: next });
    this.#persist(next);
  }

  add(e: Expense): Expense {
    this.commit([...this.#state.list, e]);
    return e;
  }

  update(id: string, patch: Partial<Expense>): void {
    this.commit(
      this.#state.list.map((e) => (e.id === id ? { ...e, ...patch, updatedAt: Date.now() } : e))
    );
  }

  get(id: string): Expense | undefined {
    return this.#state.list.find((e) => e.id === id);
  }

  remove(id: string): void {
    this.commit(this.#state.list.filter((e) => e.id !== id));
  }

  /**
   * Delete a set of expenses in ONE commit.
   *
   * Not a loop over {@link remove}: that would fire the listeners and schedule
   * a mirror per row, so deleting forty selected rows would re-render the grid
   * forty times and race forty POSTs against each other. Returns how many
   * actually went, because the caller reports it and "deleted 3" over a list
   * that only had 2 of them is a lie the UI would otherwise tell.
   */
  removeMany(ids: readonly string[]): number {
    const doomed = new Set(ids);
    if (!doomed.size) return 0;
    const next = this.#state.list.filter((e) => !doomed.has(e.id));
    const gone = this.#state.list.length - next.length;
    if (gone) this.commit(next);
    return gone;
  }

  /**
   * Replace the whole ledger — what **Load** does with a snapshot.
   *
   * Deliberately total rather than a merge. A snapshot is a picture of the
   * ledger at a moment, and "load" means go back to it; a merge would silently
   * resurrect every expense deleted since, which is the opposite of a restore
   * and impossible to undo from the UI.
   */
  replaceAll(list: readonly Expense[]): void {
    this.commit([...list]);
  }

  /** Append expenses (an import), skipping ids already present. */
  addMany(list: readonly Expense[]): number {
    const have = new Set(this.#state.list.map((e) => e.id));
    const fresh = list.filter((e) => !have.has(e.id));
    if (fresh.length) this.commit([...this.#state.list, ...fresh]);
    return fresh.length;
  }
}

/** The process-wide expense store. One per runtime, like every store here. */
export const expenseStore = new ExpenseStore();

/** The store, inside a component. Server render sees the constant initial
 *  state, so SSR and the first client frame agree; the loaded list lands as
 *  an ordinary update. */
export function useExpenses() {
  const state = React.useSyncExternalStore(
    expenseStore.subscribe,
    expenseStore.getState,
    expenseStore.getServerState
  );
  return {
    list: state.list as Expense[],
    ready: state.ready,
    error: state.error,
    add: (e: Expense) => expenseStore.add(e),
    update: (id: string, patch: Partial<Expense>) => expenseStore.update(id, patch),
    remove: (id: string) => expenseStore.remove(id),
    removeMany: (ids: readonly string[]) => expenseStore.removeMany(ids),
    replaceAll: (list: readonly Expense[]) => expenseStore.replaceAll(list)
  };
}

/** A blank expense ready for the grid's inline editor. */
export function blankExpense(): Expense {
  const now = Date.now();
  const today = new Date(now);
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return {
    id: uid("exp"),
    date: iso,
    merchant: "New expense",
    category: "other",
    currency: "USD",
    items: [{ id: uid("li"), description: "Item", unit: 0, qty: 1 }],
    tax: 0,
    tip: 0,
    statedTotal: null,
    source: "manual",
    createdAt: now,
    updatedAt: now
  };
}

/** A blank one-off income (a refund, a side job, a gift) — the same shape,
 *  flagged `income` and filed under the income category. */
export function blankIncome(): Expense {
  const base = blankExpense();
  return {
    ...base,
    id: uid("inc"),
    merchant: "New income",
    category: INCOME_CATEGORY,
    kind: "income",
    items: [{ id: uid("li"), description: "Pay", unit: 0, qty: 1 }]
  };
}
