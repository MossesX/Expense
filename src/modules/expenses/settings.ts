"use client";

/**
 * @file The Expense Tracker's settings — typed access over core's module
 * settings store, and the one place the keys are grouped into the sections the
 * rebuilt settings dialog shows.
 *
 * The ROWS (labels, hints, kinds, defaults) live on the decl
 * (`expenses.decl.ts` → `settings`), as core 0.0.20 requires: the decl is data
 * plain Node can import, the registry validates it, and the kv namespace
 * `expenses-settings` persists it per user. This file adds what the decl
 * cannot say: the TypeScript shape, the pay schedule derived from four of the
 * rows, and `SECTIONS`, which the dialog walks so a new row only has to be
 * added in two places (the decl and a section) to appear.
 *
 * Reviewed after the peel (2026-10-16): every row below is read by something in
 * this tree — the default account and category by "Add expense", the start
 * view by the tab strip, the import tolerances by the duplicate checks, the
 * welcome switches by the welcome dialog, the payday rows by the calendar. A
 * setting nothing reads is a lie in a form, so none is declared speculatively.
 */
import { getModuleSettings, settings as settingsRegistry, useModuleSettings } from "@axf/core";

import { PAY_FREQUENCIES, type PayFrequency, type PaySchedule } from "./payday";

export interface ExpensesSettings {
  // General
  confirmDelete: boolean;
  defaultAccount: string;
  defaultCategory: string;
  startView: string;
  toastSeconds: number;
  // Grid & filter
  showHints: boolean;
  denseRows: boolean;
  defaultSort: string;
  defaultSortDir: string;
  filterColumns: string;
  filterMatchAll: boolean;
  statementPeriod: string;
  // Paydays
  paydayAmount: number;
  paydayEvery: string;
  paydayWeekday: string;
  paydayDayOfMonth: number;
  paydayAnchor: string;
  paydaySince: string;
  paydayPayer: string;
  // Welcome
  welcomeEnabled: boolean;
  welcomeMissingPaydays: boolean;
  welcomeMonthSummary: boolean;
  welcomeNextPayday: boolean;
  welcomeOverBudget: boolean;
  welcomeTopCategories: boolean;
  welcomeUnreconciled: boolean;
  welcomeDisputed: boolean;
  welcomeRecentImports: boolean;
  // Import
  importAccount: string;
  importSkipPayments: boolean;
  importDateSlack: number;
  importAmountSlack: number;
  extraAccounts: string;
  // AI
  aiMode: string;
  aiModel: string;
}

export const DEFAULT_SETTINGS: ExpensesSettings = {
  confirmDelete: true,
  defaultAccount: "",
  defaultCategory: "other",
  startView: "remember",
  toastSeconds: 4,
  showHints: true,
  denseRows: false,
  defaultSort: "date",
  defaultSortDir: "desc",
  filterColumns: "",
  filterMatchAll: true,
  statementPeriod: "month",
  paydayAmount: 0,
  paydayEvery: "biweekly",
  paydayWeekday: "5",
  paydayDayOfMonth: 1,
  paydayAnchor: "",
  paydaySince: "",
  paydayPayer: "Payday",
  welcomeEnabled: true,
  welcomeMissingPaydays: true,
  welcomeMonthSummary: true,
  welcomeNextPayday: true,
  welcomeOverBudget: true,
  welcomeTopCategories: false,
  welcomeUnreconciled: false,
  welcomeDisputed: false,
  welcomeRecentImports: false,
  importAccount: "Capital One",
  importSkipPayments: true,
  importDateSlack: 4,
  importAmountSlack: 1,
  extraAccounts: "",
  aiMode: "auto",
  aiModel: "claude-opus-5-5"
};

export type SettingKey = keyof ExpensesSettings;

/** The dialog's sections, in order. Every declared key appears in exactly one. */
export const SECTIONS: readonly { id: string; title: string; blurb: string; keys: readonly SettingKey[] }[] = [
  {
    id: "general",
    title: "General",
    blurb: "What a new entry starts as, which view opens, how long a toast stays.",
    keys: ["confirmDelete", "defaultAccount", "defaultCategory", "startView", "toastSeconds"]
  },
  {
    id: "grid",
    title: "Grid & filter",
    blurb: "The grid's defaults, and how the filter field reads what you type.",
    keys: ["showHints", "denseRows", "defaultSort", "defaultSortDir", "filterMatchAll", "filterColumns", "statementPeriod"]
  },
  {
    id: "paydays",
    title: "Paydays",
    blurb: "The pay schedule. The Paydays dialog edits the same rows with a calendar beside them.",
    keys: ["paydayAmount", "paydayEvery", "paydayWeekday", "paydayDayOfMonth", "paydayAnchor", "paydaySince", "paydayPayer"]
  },
  {
    id: "welcome",
    title: "Welcome",
    blurb: "What the welcome dialog shows when you sign in.",
    keys: [
      "welcomeEnabled",
      "welcomeMissingPaydays",
      "welcomeMonthSummary",
      "welcomeNextPayday",
      "welcomeOverBudget",
      "welcomeTopCategories",
      "welcomeUnreconciled",
      "welcomeDisputed",
      "welcomeRecentImports"
    ]
  },
  {
    id: "import",
    title: "Import",
    blurb: "Defaults for importing bank transactions and how loosely duplicates are matched.",
    keys: ["importAccount", "importSkipPayments", "importDateSlack", "importAmountSlack", "extraAccounts"]
  },
  {
    id: "ai",
    title: "AI",
    blurb: "How the app reaches Claude — for reading statement images and the assistant.",
    keys: ["aiMode", "aiModel"]
  }
];

const OWNER = "expenses";

export function getExpensesSettings(): ExpensesSettings {
  return { ...DEFAULT_SETTINGS, ...getModuleSettings(OWNER) } as ExpensesSettings;
}

export function paySchedule(v: ExpensesSettings = getExpensesSettings()): PaySchedule {
  const every = PAY_FREQUENCIES.some((f) => f.value === v.paydayEvery)
    ? (v.paydayEvery as PayFrequency)
    : "biweekly";
  const weekday = Number(v.paydayWeekday);
  return {
    amount: Math.max(0, Math.round((Number(v.paydayAmount) || 0) * 100)),
    every,
    weekday: Number.isInteger(weekday) && weekday >= 0 && weekday <= 6 ? weekday : 5,
    anchor: String(v.paydayAnchor ?? "").trim(),
    dayOfMonth: Math.min(31, Math.max(1, Math.round(Number(v.paydayDayOfMonth) || 1))),
    since: String(v.paydaySince ?? "").trim(),
    payer: String(v.paydayPayer ?? "").trim() || "Payday"
  };
}

export function useExpensesSettings(): ExpensesSettings {
  const values = useModuleSettings(OWNER);
  return { ...DEFAULT_SETTINGS, ...values } as ExpensesSettings;
}

export const expensesSettings = {
  getState: getExpensesSettings,
  set<K extends SettingKey>(key: K, value: ExpensesSettings[K]): void {
    settingsRegistry.get(OWNER)?.set(key, value);
  },
  reset(): void {
    settingsRegistry.get(OWNER)?.reset();
  },
  subscribe(fn: () => void): () => void {
    return settingsRegistry.get(OWNER)?.subscribe(fn) ?? (() => {});
  }
};
