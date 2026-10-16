/**
 * @file The Expense Tracker's settings — a typed ADAPTER over the core store.
 *
 * The values, their reasons, and the considered-and-refused list moved to
 * `expenses.decl.ts` (`settings:` field — core 0.0.20, settings as data on
 * the module contract). This file keeps the module's typed API so
 * `expenses.commands.ts` reads `ExpensesSettings.confirmDelete` rather than a
 * bare record. Persistence moved from localStorage to the kv transport; the
 * surface is the shell's one `SettingsDialog` (`ExpensesSui.tsx` deleted).
 * The minimal-sui ceiling stands.
 */
"use client";

import { getModuleSettings, settings as settingsRegistry, useModuleSettings } from "@axf/core";

import { PAY_FREQUENCIES, type PayFrequency, type PaySchedule } from "./payday";

export interface ExpensesSettings {
  /** Ask before deleting an expense (grid row, tree leaf, or menu row). */
  confirmDelete: boolean;
  /** Take-home pay per payday, in DOLLARS — a settings value is a scalar the
   *  shell's dialog edits directly, and nobody types cents into a dial. */
  paydayAmount: number;
  /** `PayFrequency` — kept as a string here because a settings value is scalar. */
  paydayEvery: string;
  /** ISO date of the first payday; empty until the schedule is set up. */
  paydayAnchor: string;
  /** The Merchant column for a generated payday. */
  paydayPayer: string;
}

export const DEFAULT_SETTINGS: ExpensesSettings = {
  confirmDelete: true,
  paydayAmount: 0,
  paydayEvery: "biweekly",
  paydayAnchor: "",
  paydayPayer: "Payday"
};

const OWNER = "expenses";

/** Read the settings outside React — what the command handlers use. */
export function getExpensesSettings(): ExpensesSettings {
  return { ...DEFAULT_SETTINGS, ...getModuleSettings(OWNER) };
}

/** The four payday rows as one typed schedule, cents and all. */
export function paySchedule(v: ExpensesSettings = getExpensesSettings()): PaySchedule {
  const every = PAY_FREQUENCIES.some((f) => f.value === v.paydayEvery)
    ? (v.paydayEvery as PayFrequency)
    : "biweekly";
  return {
    amount: Math.max(0, Math.round((Number(v.paydayAmount) || 0) * 100)),
    every,
    anchor: String(v.paydayAnchor ?? "").trim(),
    payer: String(v.paydayPayer ?? "").trim() || "Payday"
  };
}

/** Live settings inside a component; safe under SSR (server sees defaults). */
export function useExpensesSettings(): ExpensesSettings {
  const values = useModuleSettings(OWNER);
  return { ...DEFAULT_SETTINGS, ...values };
}

/** The write half, shaped like the store it replaced. */
export const expensesSettings = {
  getState: getExpensesSettings,
  set<K extends keyof ExpensesSettings>(key: K, value: ExpensesSettings[K]): void {
    settingsRegistry.get(OWNER)?.set(key, value);
  },
  reset(): void {
    settingsRegistry.get(OWNER)?.reset();
  },
  subscribe(fn: () => void): () => void {
    return settingsRegistry.get(OWNER)?.subscribe(fn) ?? (() => {});
  }
};
