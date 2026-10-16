/**
 * @file **Payday income** — a pay schedule, and the income entries it implies.
 *
 * Owner's ask (2026-09-15): *"add an income/expense flag + payday income"*.
 * The flag is `Expense.kind`; this file is the payday half. A schedule is four
 * settings (amount, frequency, first payday, payer) and everything else is
 * derived: which dates are paydays, which of those the ledger is missing, and
 * the income entry to write for each.
 *
 * Pure and Node-safe — no React, no store, no `Date.now()` without a caller
 * passing "today" in. That is what lets `test/expenses-income.test.ts` pin the
 * calendar without mocking a clock.
 *
 * ## Idempotent by id
 *
 * A generated payday's id is a function of its DATE (`inc_payday_20260904`),
 * never of a counter. "Add missing paydays" can therefore run any number of
 * times and only ever add the dates the ledger does not already hold — and a
 * payday the user deleted on purpose stays deleted only until the next fill,
 * which the dialog says in as many words. Editing the amount on one payday
 * (a bonus, a short cheque) is safe: the id is what is checked, not the sum.
 *
 * ## Calendar rules
 *
 * - `weekly` / `biweekly`: every 7 / 14 days from the first payday.
 * - `semimonthly`: the 1st and the 15th of every month, from the first payday
 *   onward (the first payday itself is included whatever its day).
 * - `monthly`: the first payday's day-of-month, clamped to the last day of a
 *   shorter month (anchor on the 31st → Feb 28/29, Apr 30, …).
 *
 * All arithmetic is on UTC calendar days over ISO strings, so no timezone can
 * move a payday across midnight — the same rule `types.ts` states for `date`.
 */

import { uid } from "./id";
import { INCOME_CATEGORY, type Cents, type Expense } from "./types";

export type PayFrequency = "weekly" | "biweekly" | "semimonthly" | "monthly";

export const PAY_FREQUENCIES: readonly { value: PayFrequency; label: string }[] = [
  { value: "weekly", label: "Every week" },
  { value: "biweekly", label: "Every two weeks" },
  { value: "semimonthly", label: "Twice a month (1st & 15th)" },
  { value: "monthly", label: "Once a month" }
];

export interface PaySchedule {
  /** Take-home pay per payday, in cents. */
  amount: Cents;
  every: PayFrequency;
  /** ISO `YYYY-MM-DD` of the first (or any past) payday the schedule counts from. */
  anchor: string;
  /** What the grid shows in the Merchant column — an employer, usually. */
  payer: string;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export const isIsoDate = (s: string): boolean => {
  if (!ISO_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= lastDayOf(y, m);
};

/** A schedule the fill can act on: a positive amount and a real first payday. */
export const scheduleReady = (s: PaySchedule): boolean => s.amount > 0 && isIsoDate(s.anchor);

const lastDayOf = (year: number, month1: number): number => new Date(Date.UTC(year, month1, 0)).getUTCDate();

const toIso = (utcMs: number): string => new Date(utcMs).toISOString().slice(0, 10);

const utcOf = (iso: string): number => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

const DAY = 86_400_000;

/** A hard ceiling so a mistyped anchor year cannot allocate a century of rows. */
const MAX_DATES = 2000;

/**
 * Every payday from the schedule's anchor through `until` (inclusive), oldest
 * first. Empty when the schedule is not ready or the anchor is after `until`.
 */
export function paydayDates(s: PaySchedule, until: string): string[] {
  if (!scheduleReady(s) || !isIsoDate(until) || s.anchor > until) return [];
  const out: string[] = [];

  if (s.every === "weekly" || s.every === "biweekly") {
    const step = (s.every === "weekly" ? 7 : 14) * DAY;
    for (let t = utcOf(s.anchor); out.length < MAX_DATES; t += step) {
      const iso = toIso(t);
      if (iso > until) break;
      out.push(iso);
    }
    return out;
  }

  if (s.every === "semimonthly") {
    out.push(s.anchor);
    let [y, m] = s.anchor.slice(0, 7).split("-").map(Number);
    for (; out.length < MAX_DATES; ) {
      for (const day of [1, 15]) {
        const iso = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        if (iso <= s.anchor) continue;
        if (iso > until) return out;
        out.push(iso);
      }
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    return out;
  }

  // monthly — the anchor's day-of-month, clamped.
  const anchorDay = Number(s.anchor.slice(8, 10));
  let [y, m] = s.anchor.slice(0, 7).split("-").map(Number);
  for (; out.length < MAX_DATES; ) {
    const day = Math.min(anchorDay, lastDayOf(y, m));
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (iso > until) break;
    if (iso >= s.anchor) out.push(iso);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** The first payday strictly after `after`, or null when the schedule is not ready. */
export function nextPayday(s: PaySchedule, after: string): string | null {
  if (!scheduleReady(s)) return null;
  if (s.anchor > after) return s.anchor;
  // Cheap and exact: one more step of the calendar past `after`. A year's
  // horizon covers every frequency with room to spare.
  const horizon = toIso(utcOf(after) + 400 * DAY);
  return paydayDates(s, horizon).find((d) => d > after) ?? null;
}

/** The deterministic id a payday on `date` always gets. */
export const paydayId = (date: string): string => `inc_payday_${date.replace(/-/g, "")}`;

/** The income entry for one payday. `now` stamps `createdAt`/`updatedAt`. */
export function paydayEntry(s: PaySchedule, date: string, now = Date.now()): Expense {
  return {
    id: paydayId(date),
    date,
    merchant: s.payer.trim() || "Payday",
    category: INCOME_CATEGORY,
    kind: "income",
    currency: "USD",
    items: [{ id: uid("li"), description: "Pay", unit: s.amount, qty: 1 }],
    tax: 0,
    tip: 0,
    statedTotal: s.amount,
    source: "payday",
    createdAt: now,
    updatedAt: now
  };
}

/**
 * The paydays through `until` that `list` does not already carry — matched by
 * id, so a payday whose amount was hand-edited still counts as present.
 */
export function missingPaydays(list: readonly Pick<Expense, "id">[], s: PaySchedule, until: string): string[] {
  const have = new Set(list.map((e) => e.id));
  return paydayDates(s, until).filter((d) => !have.has(paydayId(d)));
}

/** Today as ISO in the LOCAL calendar — the same rule `blankExpense` uses. */
export function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
