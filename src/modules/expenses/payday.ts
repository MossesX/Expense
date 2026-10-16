/**
 * @file Paydays — a recurring income entry the ledger writes for itself.
 *
 * The schedule is settings (`settings.ts`), the calendar is pure arithmetic
 * here, and the entries it produces carry a FIXED id per date
 * (`inc_payday_2026-10-02` → `inc_payday_20261002`), which is the whole
 * duplicate story: "add missing paydays" can run any number of times and only
 * ever add the dates the ledger does not already hold.
 *
 * **2026-10-16 — the schedule is a weekday, not a date** (owner: *"replace
 * first payday field with day of week payday is and use that to add missing
 * paydays"*). A weekly or two-weekly schedule names the day it lands on; a
 * monthly one names the day of the month; twice-a-month is the 1st and 15th.
 * Two weeks is the one case a weekday alone cannot settle (which Friday?), so
 * it also keeps a REFERENCE payday — any date known to be one — and counts in
 * fourteens from it. The dialog derives that reference from the two most
 * recent occurrences of the weekday rather than asking for a typed date.
 *
 * Where the calendar STARTS is `since`: an explicit date, or, left blank, the
 * earliest entry in the ledger (a ledger that begins in March does not want
 * January's paydays), or the first of the current month when the ledger is
 * empty.
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

/** 0 = Sunday … 6 = Saturday, as `Date#getUTCDay` counts. */
export const WEEKDAYS: readonly { value: number; label: string; short: string }[] = [
  { value: 0, label: "Sunday", short: "Sun" },
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" }
];

export interface PaySchedule {
  /** Take-home per payday, in cents. 0 = schedule off. */
  amount: Cents;
  every: PayFrequency;
  /** Weekly / two-weekly: the day it lands on. */
  weekday: number;
  /** Two-weekly: a date known to be a payday, which settles WHICH week. Blank =
   *  the most recent occurrence of `weekday` on or before today. */
  anchor: string;
  /** Monthly: the day of the month (clamped to short months). */
  dayOfMonth: number;
  /** Generate from this date. Blank = the ledger's earliest entry, else the
   *  first of the current month. */
  since: string;
  payer: string;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export const isIsoDate = (s: string): boolean => {
  if (!ISO_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= lastDayOf(y, m);
};

export const isWeekday = (n: number): boolean => Number.isInteger(n) && n >= 0 && n <= 6;

export const scheduleReady = (s: PaySchedule): boolean => {
  if (!(s.amount > 0)) return false;
  switch (s.every) {
    case "weekly":
      return isWeekday(s.weekday);
    case "biweekly":
      return isWeekday(s.weekday) || isIsoDate(s.anchor);
    case "monthly":
      return Number.isInteger(s.dayOfMonth) && s.dayOfMonth >= 1 && s.dayOfMonth <= 31;
    case "semimonthly":
      return true;
  }
};

const lastDayOf = (year: number, month1: number): number => new Date(Date.UTC(year, month1, 0)).getUTCDate();

const toIso = (utcMs: number): string => new Date(utcMs).toISOString().slice(0, 10);

const utcOf = (iso: string): number => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

const DAY = 86_400_000;

const MAX_DATES = 2000;

export const weekdayOf = (iso: string): number => new Date(utcOf(iso)).getUTCDay();

/** The most recent `weekday` on or before `iso`. */
export function mostRecentWeekday(iso: string, weekday: number): string {
  const t = utcOf(iso);
  const back = (weekdayOf(iso) - weekday + 7) % 7;
  return toIso(t - back * DAY);
}

/** The `n` most recent occurrences of `weekday` on or before `iso`, newest first. */
export function recentWeekdays(iso: string, weekday: number, n: number): string[] {
  const first = mostRecentWeekday(iso, weekday);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(toIso(utcOf(first) - i * 7 * DAY));
  return out;
}

/** The two-weekly reference actually used: the anchor when it is a date, else
 *  the most recent weekday on or before `today`. */
export function biweeklyReference(s: PaySchedule, today: string): string | null {
  if (isIsoDate(s.anchor)) return s.anchor;
  if (isWeekday(s.weekday)) return mostRecentWeekday(today, s.weekday);
  return null;
}

/**
 * Every payday from `from` through `until`, inclusive, for a ready schedule.
 * `today` matters only to a two-weekly schedule with no anchor.
 */
export function paydayDates(s: PaySchedule, from: string, until: string, today = until): string[] {
  if (!scheduleReady(s) || !isIsoDate(from) || !isIsoDate(until) || from > until) return [];
  const out: string[] = [];
  const start = utcOf(from);
  const end = utcOf(until);

  if (s.every === "weekly") {
    const back = (weekdayOf(from) - s.weekday + 7) % 7;
    let t = start + ((7 - back) % 7) * DAY;
    for (; t <= end && out.length < MAX_DATES; t += 7 * DAY) out.push(toIso(t));
    return out;
  }

  if (s.every === "biweekly") {
    const ref = biweeklyReference(s, today);
    if (!ref) return [];
    const r = utcOf(ref);
    // The first date >= start on the same 14-day lattice as the reference.
    const diffDays = Math.round((start - r) / DAY);
    const mod = ((diffDays % 14) + 14) % 14;
    let t = start + ((14 - mod) % 14) * DAY;
    for (; t <= end && out.length < MAX_DATES; t += 14 * DAY) out.push(toIso(t));
    return out;
  }

  // Month-shaped schedules walk the months in range.
  let [y, m] = from.slice(0, 7).split("-").map(Number);
  const [uy, um] = until.slice(0, 7).split("-").map(Number);
  for (; y < uy || (y === uy && m <= um); ) {
    const days = s.every === "semimonthly" ? [1, 15] : [Math.min(s.dayOfMonth, lastDayOf(y, m))];
    for (const day of days) {
      const iso = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (iso < from || iso > until) continue;
      out.push(iso);
      if (out.length >= MAX_DATES) return out;
    }
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** The first payday strictly after `after`, or null for an unready schedule. */
export function nextPayday(s: PaySchedule, after: string): string | null {
  if (!scheduleReady(s) || !isIsoDate(after)) return null;
  const from = toIso(utcOf(after) + DAY);
  const horizon = toIso(utcOf(after) + 400 * DAY);
  return paydayDates(s, from, horizon, after)[0] ?? null;
}

export const paydayId = (date: string): string => `inc_payday_${date.replace(/-/g, "")}`;

export const isPaydayEntry = (e: Pick<Expense, "id">): boolean => e.id.startsWith("inc_payday_");

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

export function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Where the calendar starts for this ledger: the explicit `since`, else the
 *  ledger's earliest entry, else the first of the current month. */
export function calendarStart(list: readonly Pick<Expense, "date">[], s: PaySchedule, today = todayIso()): string {
  if (isIsoDate(s.since)) return s.since;
  let earliest: string | null = null;
  for (const e of list) if (isIsoDate(e.date) && (earliest === null || e.date < earliest)) earliest = e.date;
  return earliest ?? `${today.slice(0, 7)}-01`;
}

/**
 * The paydays through `until` that `list` does not already carry — matched by
 * the fixed id, so a payday the person renamed or re-priced still counts as
 * present, and only a deleted one comes back.
 */
export function missingPaydays(
  list: readonly Pick<Expense, "id" | "date">[],
  s: PaySchedule,
  until: string
): string[] {
  const have = new Set(list.map((e) => e.id));
  const from = calendarStart(list, s, until);
  return paydayDates(s, from, until, until).filter((d) => !have.has(paydayId(d)));
}
