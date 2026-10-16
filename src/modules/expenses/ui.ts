"use client";

/**
 * @file The module's **UI intents** — the seam between a context-menu command
 * and a dialog.
 *
 * Context-menu rows resolve to a command NAME and commands are plain functions
 * (`expenses.commands.ts`); that is the contract that keeps a menu
 * serialisable. But "Open report…" has to open a *dialog*, and a plain function
 * cannot mount React.
 *
 * So the command sets an intent and the screen renders it. One tiny store, two
 * fields, and the alternative — letting a command reach a component through a
 * module-scope mutable ref to a setState — is the thing that makes a menu
 * un-testable and the screen un-remountable.
 *
 * Not persisted: an open dialog is not a preference.
 */

import * as React from "react";

import type { VaultMode } from "./VaultDialog";

type Listener = () => void;

export interface ExpensesUiState {
  /** Which vault dialog is open, or null. */
  readonly dialog: VaultMode | null;
  /** The Paydays dialog (schedule + fill). Separate from `dialog` because it
   *  is not a vault mode and must not be typed as one. */
  readonly payday: boolean;
  readonly importing: boolean;
  readonly scanning: boolean;
  /** The Actions › Dupe dialog — possible duplicates inside the ledger. */
  readonly dupes: boolean;
  readonly settings: boolean;
  readonly deleting: boolean;
  readonly filterDialog: boolean;
  readonly welcome: boolean;
  /** The header filter's text — session state, not a setting. */
  readonly filterText: string;
  /** A transient line the screen shows and then forgets. */
  readonly toast: string | null;
}

const INITIAL: ExpensesUiState = {
  dialog: null,
  payday: false,
  importing: false,
  scanning: false,
  dupes: false,
  settings: false,
  deleting: false,
  filterDialog: false,
  welcome: false,
  filterText: "",
  toast: null
};

class UiStore {
  #state: ExpensesUiState = INITIAL;
  #listeners = new Set<Listener>();

  subscribe = (fn: Listener): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getState = (): ExpensesUiState => this.#state;
  getServerState = (): ExpensesUiState => INITIAL;

  #set(patch: Partial<ExpensesUiState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const fn of this.#listeners) fn();
  }

  openDialog(mode: VaultMode): void {
    this.#set({ dialog: mode });
  }

  closeDialog(): void {
    if (!this.#state.dialog) return;
    this.#set({ dialog: null });
  }

  openPayday(): void {
    if (this.#state.payday) return;
    this.#set({ payday: true });
  }

  closePayday(): void {
    if (!this.#state.payday) return;
    this.#set({ payday: false });
  }

  /** Say something happened. The screen clears it on a timer. */
  openImport(): void {
    if (this.#state.importing) return;
    this.#set({ importing: true });
  }

  closeImport(): void {
    if (!this.#state.importing) return;
    this.#set({ importing: false });
  }

  /** One opener/closer per boolean flag, so a command can name the dialog. */
  openScan(): void {
    if (!this.#state.scanning) this.#set({ scanning: true });
  }

  closeScan(): void {
    if (this.#state.scanning) this.#set({ scanning: false });
  }

  openDupes(): void {
    if (!this.#state.dupes) this.#set({ dupes: true });
  }

  closeDupes(): void {
    if (this.#state.dupes) this.#set({ dupes: false });
  }

  openSettings(): void {
    if (!this.#state.settings) this.#set({ settings: true });
  }

  closeSettings(): void {
    if (this.#state.settings) this.#set({ settings: false });
  }

  openDeleteSelected(): void {
    if (!this.#state.deleting) this.#set({ deleting: true });
  }

  closeDeleteSelected(): void {
    if (this.#state.deleting) this.#set({ deleting: false });
  }

  openFilterDialog(): void {
    if (!this.#state.filterDialog) this.#set({ filterDialog: true });
  }

  closeFilterDialog(): void {
    if (this.#state.filterDialog) this.#set({ filterDialog: false });
  }

  openWelcome(): void {
    if (!this.#state.welcome) this.#set({ welcome: true });
  }

  closeWelcome(): void {
    if (this.#state.welcome) this.#set({ welcome: false });
  }

  setFilterText(text: string): void {
    if (this.#state.filterText !== text) this.#set({ filterText: text });
  }

  say(message: string): void {
    this.#set({ toast: message });
  }

  clearToast(): void {
    if (this.#state.toast === null) return;
    this.#set({ toast: null });
  }
}

export const expenseUi = new UiStore();

export function useExpensesUi(): ExpensesUiState {
  return React.useSyncExternalStore(
    expenseUi.subscribe,
    expenseUi.getState,
    expenseUi.getServerState
  );
}
