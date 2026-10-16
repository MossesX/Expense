/**
 * @file What the welcome dialog has to say — computed, not rendered, so the
 * module can ask "is there anything?" before interrupting a sign-in, and the
 * dialog only draws.
 *
 * Every section is gated by its own setting (`welcome*` rows) and present only
 * when it has content; the paydays section is the one with an ACTION (add the
 * ticked dates), the rest are a glance at the month.
 */
import { effectiveTotal, reconcile, sumIncome, sumSpent } from "./math";
import { missingPaydays, nextPayday, scheduleReady, todayIso, type PaySchedule } from "./payday";
import type { ExpensesSettings } from "./settings";
import { CATEGORIES, categoryOf, isIncome, type Expense } from "./types";

export interface WelcomeModel {
  readonly today: string;
  readonly scheduleReady: boolean;
  /** Dates to offer, newest last. Empty when the schedule is off or complete. */
  readonly missingPaydays: readonly string[];
  readonly month: { key: string; spent: number; income: number; net: number; count: number } | null;
  readonly nextPayday: { date: string; days: number } | null;
  readonly overBudget: readonly { id: string; label: string; spent: number; budget: number }[] | null;
  readonly topCategories: readonly { id: string; label: string; spent: number }[] | null;
  readonly unreconciled: number | null;
  readonly disputed: number | null;
  readonly recentImports: number | null;
}

const DAY = 86_400_000;

export function buildWelcome(
  expenses: readonly Expense[],
  settings: ExpensesSettings,
  schedule: PaySchedule,
  today = todayIso(),
  now = Date.now()
): WelcomeModel {
  const ready = scheduleReady(schedule);
  const monthKey = today.slice(0, 7);
  const inMonth = expenses.filter((e) => e.date.startsWith(monthKey));
  const spending = inMonth.filter((e) => !isIncome(e) && !e.disputed);

  const byCategory = new Map<string, number>();
  for (const e of spending) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + effectiveTotal(e));

  const next = ready ? nextPayday(schedule, today) : null;

  return {
    today,
    scheduleReady: ready,
    missingPaydays: settings.welcomeMissingPaydays && ready ? missingPaydays(expenses, schedule, today) : [],
    month: settings.welcomeMonthSummary
      ? { key: monthKey, spent: sumSpent(inMonth), income: sumIncome(inMonth), net: sumIncome(inMonth) - sumSpent(inMonth), count: inMonth.length }
      : null,
    nextPayday:
      settings.welcomeNextPayday && next
        ? { date: next, days: Math.round((Date.parse(`${next}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY) }
        : null,
    overBudget: settings.welcomeOverBudget
      ? CATEGORIES.filter((c) => c.budget > 0 && (byCategory.get(c.id) ?? 0) > c.budget).map((c) => ({
          id: c.id,
          label: c.label,
          spent: byCategory.get(c.id) ?? 0,
          budget: c.budget
        }))
      : null,
    topCategories: settings.welcomeTopCategories
      ? [...byCategory.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([id, spent]) => ({ id, label: categoryOf(id).label, spent }))
      : null,
    unreconciled: settings.welcomeUnreconciled
      ? expenses.filter((e) => !e.disputed && !isIncome(e) && !reconcile(e).ok).length
      : null,
    disputed: settings.welcomeDisputed ? expenses.filter((e) => e.disputed).length : null,
    recentImports: settings.welcomeRecentImports
      ? expenses.filter((e) => e.source === "import" && e.createdAt >= now - 7 * DAY).length
      : null
  };
}

/** True when at least one section would show something. */
export function welcomeHasContent(m: WelcomeModel, settings: ExpensesSettings): boolean {
  if (settings.welcomeMissingPaydays && (m.missingPaydays.length > 0 || !m.scheduleReady)) return true;
  if (m.month) return true;
  if (m.nextPayday) return true;
  if (m.overBudget && m.overBudget.length) return true;
  if (m.topCategories && m.topCategories.length) return true;
  if (m.unreconciled) return true;
  if (m.disputed) return true;
  if (m.recentImports) return true;
  return false;
}
