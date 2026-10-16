"use client";

/**
 * @file Which headline **cards** the grid shows — a per-browser view
 * preference (owner, 2026-09-15: *"make cards hideable, default hide tax and
 * reconcile cards"*).
 *
 * `localStorage`, deliberately, and not the kv-backed module settings: which
 * tiles a person wants above the grid is a habit of one screen in one
 * browser, the same class of thing as a collapsed tree node. The settings
 * ceiling (`settings/decl.ts`) exists precisely so choices like this do not
 * become rows in a dialog. Missing storage (private mode, SSR) falls back to
 * the defaults and the page still works.
 */

import * as React from "react";

export type CardId = "count" | "spent" | "income" | "net" | "tax" | "unreconciled";

export const CARDS: readonly { id: CardId; label: string }[] = [
  { id: "count", label: "Expenses" },
  { id: "spent", label: "Spent" },
  { id: "income", label: "Income" },
  { id: "net", label: "Net" },
  { id: "tax", label: "Tax" },
  { id: "unreconciled", label: "Unreconciled" }
];

/** Hidden until asked for: tax and reconciliation are audit figures, not the
 *  daily glance. */
export const DEFAULT_HIDDEN: readonly CardId[] = ["tax", "unreconciled"];

const KEY = "axf:expenses:cards:hidden";

const VALID = new Set<string>(CARDS.map((c) => c.id));

function readHidden(): CardId[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return [...DEFAULT_HIDDEN];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed.filter((v) => VALID.has(String(v))) as CardId[]) : [...DEFAULT_HIDDEN];
  } catch {
    return [...DEFAULT_HIDDEN];
  }
}

function writeHidden(hidden: readonly CardId[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(hidden));
  } catch {
    /* storage blocked — the choice lasts for the session */
  }
}

/**
 * The hidden set and a toggle. Server render and the first client frame both
 * see the DEFAULTS; the stored choice lands in an effect, so hydration cannot
 * tear over something the server could not know.
 */
export function useHiddenCards(): { hidden: Set<CardId>; toggle: (id: CardId) => void; reset: () => void } {
  const [hidden, setHidden] = React.useState<CardId[]>(() => [...DEFAULT_HIDDEN]);
  React.useEffect(() => setHidden(readHidden()), []);
  const toggle = React.useCallback((id: CardId) => {
    setHidden((prev) => {
      const next = prev.includes(id) ? prev.filter((h) => h !== id) : [...prev, id];
      writeHidden(next);
      return next;
    });
  }, []);
  const reset = React.useCallback(() => {
    writeHidden(DEFAULT_HIDDEN);
    setHidden([...DEFAULT_HIDDEN]);
  }, []);
  return { hidden: new Set(hidden), toggle, reset };
}
