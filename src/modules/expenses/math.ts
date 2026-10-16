/**
 * @file The expense math engine.
 *
 * Everything numeric in the plugin goes through this file, and nothing here
 * touches React or the DOM — it is pure, which is what makes the grid, the
 * tree, the statement generator and the receipt reviewer agree on every figure.
 *
 * Three rules the whole engine obeys:
 *
 * 1. **Integer cents, always.** Currency arithmetic never uses floats. The only
 *    division is `/100` at the formatting edge.
 * 2. **Reconciliation is reported, never silently corrected.** When a receipt's
 *    printed total disagrees with the sum of its lines, the difference is
 *    surfaced as {@link reconcile}'s `delta`. Quietly overwriting one with the
 *    other is how a mis-parsed receipt becomes an invisible error in a
 *    statement.
 * 3. **Rounding happens once.** Percentage splits round each share and give the
 *    remainder to the largest share, so a breakdown always sums back to the
 *    total it split.
 */

import { CATEGORIES, categoryOf, isIncome, type Cents, type Expense, type LineItem } from "./types";

/* --------------------------------- money ----------------------------------- */

export const toCents = (value: number): Cents => Math.round(value * 100);

export const fromCents = (c: Cents): number => c / 100;

/** `$1,234.56`, negatives as `-$12.00` rather than `$-12.00`. */
export function money(c: Cents, currency = "USD"): string {
  const sign = c < 0 ? "-" : "";
  const abs = Math.abs(c);
  const symbol = currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : "";
  const body = (abs / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}${symbol}${body}${symbol ? "" : ` ${currency}`}`;
}

/**
 * Evaluate an amount expression typed into a money field.
 *
 * Accountants type `12.99*3` and `40+8.50` into totals boxes, so the grid
 * accepts it. Deliberately NOT `eval`: only digits, the four operators,
 * parentheses and a decimal point are allowed through, and anything else
 * returns null so the caller can keep the previous value. The evaluator is a
 * hand-rolled shunting-yard over that restricted grammar — no dynamic code
 * execution anywhere.
 */
export function evalAmount(input: string): Cents | null {
  const src = input.trim().replace(/[$,\s]/g, "");
  if (!src) return null;
  if (!/^[0-9+\-*/().]+$/.test(src)) return null;

  const tokens = src.match(/\d+\.?\d*|[+\-*/()]/g);
  if (!tokens) return null;

  const prec: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2 };
  const out: (number | string)[] = [];
  const ops: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (/^\d/.test(t)) {
      out.push(Number(t));
    } else if (t === "(") {
      ops.push(t);
    } else if (t === ")") {
      while (ops.length && ops[ops.length - 1] !== "(") out.push(ops.pop() as string);
      if (!ops.length) return null; // unbalanced
      ops.pop();
    } else {
      // Unary minus: a `-` in operand position folds into the next number.
      const prev = tokens[i - 1];
      if (t === "-" && (i === 0 || prev === "(" || prev in prec)) {
        const next = tokens[i + 1];
        if (next && /^\d/.test(next)) {
          out.push(-Number(next));
          i++;
          continue;
        }
        return null;
      }
      while (ops.length && ops[ops.length - 1] !== "(" && prec[ops[ops.length - 1]] >= prec[t]) {
        out.push(ops.pop() as string);
      }
      ops.push(t);
    }
  }
  while (ops.length) {
    const op = ops.pop() as string;
    if (op === "(") return null;
    out.push(op);
  }

  const stack: number[] = [];
  for (const tok of out) {
    if (typeof tok === "number") {
      stack.push(tok);
      continue;
    }
    const b = stack.pop();
    const a = stack.pop();
    if (a === undefined || b === undefined) return null;
    if (tok === "+") stack.push(a + b);
    else if (tok === "-") stack.push(a - b);
    else if (tok === "*") stack.push(a * b);
    else if (tok === "/") {
      if (b === 0) return null;
      stack.push(a / b);
    }
  }
  if (stack.length !== 1 || !Number.isFinite(stack[0])) return null;
  return toCents(stack[0]);
}

/* ------------------------------ per-expense -------------------------------- */

export const lineTotal = (item: LineItem): Cents => Math.round(item.unit * item.qty);

export const subtotal = (e: Expense): Cents => e.items.reduce((n, i) => n + lineTotal(i), 0);

/** Subtotal + tax + tip — what the receipt *should* total. */
export const computedTotal = (e: Expense): Cents => subtotal(e) + e.tax + e.tip;

/** The figure everything else spends: the printed total when there is one,
 *  otherwise the computed one. A **disputed** ("not my charge") expense counts
 *  as zero so it drops out of every rollup — grid total, running balance,
 *  category shares and statements alike — while still showing in the grid. */
export const effectiveTotal = (e: Expense): Cents => (e.disputed ? 0 : e.statedTotal ?? computedTotal(e));

/**
 * The SIGNED movement: income is money in (+), an expense is money out (−).
 *
 * `effectiveTotal` stays a magnitude on purpose — the grid's Total column, a
 * category share and a receipt's printed total are all magnitudes, and a
 * negative receipt is a refund, not an income. The sign lives in one place, so
 * the running balance, the statement's opening/closing figures and the
 * headline "net" agree by construction.
 */
export const flow = (e: Expense): Cents => (isIncome(e) ? effectiveTotal(e) : -effectiveTotal(e));

export interface Reconciliation {
  computed: Cents;
  stated: Cents | null;
  /** stated − computed. Positive: the receipt says more than the lines add up
   *  to (a missed line); negative: the lines over-count. */
  delta: Cents;
  ok: boolean;
}

/** Reported, never auto-corrected — see the file header. */
export function reconcile(e: Expense): Reconciliation {
  const computed = computedTotal(e);
  const stated = e.statedTotal;
  const delta = stated === null ? 0 : stated - computed;
  return { computed, stated, delta, ok: delta === 0 };
}

/** Effective tax rate against the subtotal, as a percentage. */
export function taxRate(e: Expense): number {
  const sub = subtotal(e);
  return sub === 0 ? 0 : (e.tax / sub) * 100;
}

/* -------------------------------- rollups ---------------------------------- */

export const sumTotals = (list: Expense[]): Cents => list.reduce((n, e) => n + effectiveTotal(e), 0);

/** The spending half of a ledger — what every category/merchant/budget rollup
 *  is over. Income has no category share and no budget. */
export const spending = (list: readonly Expense[]): Expense[] => list.filter((e) => !isIncome(e));

export const incomes = (list: readonly Expense[]): Expense[] => list.filter((e) => isIncome(e));

export const sumSpent = (list: readonly Expense[]): Cents => sumTotals(spending(list));

export const sumIncome = (list: readonly Expense[]): Cents => sumTotals(incomes(list));

/** Income − spending. Positive: ahead; negative: spending outran income. */
export const net = (list: readonly Expense[]): Cents => list.reduce((n, e) => n + flow(e), 0);

export interface Bucket {
  key: string;
  label: string;
  count: number;
  total: Cents;
  /** Share of the parent total, 0–100, rounded so a set sums to exactly 100. */
  share: number;
}

/** Group and total, then apply the largest-remainder share split. */
export function bucketBy(
  list: Expense[],
  keyOf: (e: Expense) => string,
  labelOf: (key: string) => string = (k) => k
): Bucket[] {
  const map = new Map<string, { count: number; total: Cents }>();
  for (const e of list) {
    const k = keyOf(e);
    const cur = map.get(k) ?? { count: 0, total: 0 };
    cur.count += 1;
    cur.total += effectiveTotal(e);
    map.set(k, cur);
  }
  const buckets = [...map.entries()]
    .map(([key, v]) => ({ key, label: labelOf(key), count: v.count, total: v.total, share: 0 }))
    .sort((a, b) => b.total - a.total);
  return withShares(buckets);
}

/**
 * Assign each bucket its percentage share, rounded to one decimal, with the
 * rounding remainder handed to the largest bucket. Without this a five-way
 * split routinely renders as 99.9% or 100.1%, which readers notice.
 */
export function withShares(buckets: Bucket[]): Bucket[] {
  const total = buckets.reduce((n, b) => n + b.total, 0);
  if (total === 0) return buckets.map((b) => ({ ...b, share: 0 }));
  const raw = buckets.map((b) => (b.total / total) * 100);
  const rounded = raw.map((r) => Math.round(r * 10) / 10);
  const drift = Math.round((100 - rounded.reduce((n, r) => n + r, 0)) * 10) / 10;
  const out = buckets.map((b, i) => ({ ...b, share: rounded[i] }));
  if (drift !== 0 && out.length) out[0].share = Math.round((out[0].share + drift) * 10) / 10;
  return out;
}

export const byCategory = (list: Expense[]): Bucket[] =>
  bucketBy(list, (e) => e.category, (k) => categoryOf(k).label);

export const byMerchant = (list: Expense[]): Bucket[] => bucketBy(list, (e) => e.merchant);

export const byMonth = (list: Expense[]): Bucket[] =>
  bucketBy(list, (e) => e.date.slice(0, 7)).sort((a, b) => a.key.localeCompare(b.key));

/* ------------------------------- variance ---------------------------------- */

export interface Variance {
  categoryId: string;
  label: string;
  budget: Cents;
  spent: Cents;
  /** spent − budget. Positive is over. */
  delta: Cents;
  /** Percentage of budget used; Infinity is impossible — an untracked budget
   *  reports null instead. */
  usedPct: number | null;
}

/** Budget variance for one month's expenses (budgets are per month). */
export function variance(monthExpenses: Expense[]): Variance[] {
  const spent = new Map<string, Cents>();
  for (const e of monthExpenses) spent.set(e.category, (spent.get(e.category) ?? 0) + effectiveTotal(e));
  return CATEGORIES.map((c) => {
    const s = spent.get(c.id) ?? 0;
    return {
      categoryId: c.id,
      label: c.label,
      budget: c.budget,
      spent: s,
      delta: s - c.budget,
      usedPct: c.budget > 0 ? Math.round((s / c.budget) * 1000) / 10 : null
    };
  }).filter((v) => v.spent > 0 || v.budget > 0);
}

/* ---------------------------- running balance ------------------------------ */

export interface BalanceRow {
  expense: Expense;
  /** The magnitude — what the row's Total column shows. */
  amount: Cents;
  /** The signed movement this row made — see {@link flow}. */
  delta: Cents;
  balance: Cents;
}

/**
 * Running balance in date order — NET, since income arrived (2026-09-15):
 * every payday adds, every expense subtracts, so the column reads like a
 * chequebook. A ledger with no income entries therefore runs negative, which
 * is the honest figure rather than a spending subtotal wearing a balance's
 * name.
 *
 * Ties are broken by `createdAt` so two expenses on the same day always
 * accumulate in a stable order — otherwise the same data renders a different
 * balance column on each load, which reads as a bug even though the end total
 * is identical.
 */
export function runningBalance(list: Expense[], opening: Cents = 0): BalanceRow[] {
  const ordered = [...list].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  let bal = opening;
  return ordered.map((e) => {
    const delta = flow(e);
    bal += delta;
    return { expense: e, amount: effectiveTotal(e), delta, balance: bal };
  });
}

/* -------------------------------- periods ---------------------------------- */

export type PeriodKind = "month" | "quarter" | "year";

export interface Period {
  kind: PeriodKind;
  /** `2026-07`, `2026-Q3`, `2026`. */
  key: string;
  label: string;
  /** Inclusive ISO date bounds. */
  from: string;
  to: string;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const lastDay = (year: number, month1: number) => new Date(Date.UTC(year, month1, 0)).getUTCDate();

export function periodOf(kind: PeriodKind, isoDate: string): Period {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  if (kind === "year") {
    return { kind, key: String(year), label: String(year), from: `${year}-01-01`, to: `${year}-12-31` };
  }
  if (kind === "quarter") {
    const q = Math.floor((month - 1) / 3) + 1;
    const startM = (q - 1) * 3 + 1;
    const endM = startM + 2;
    return {
      kind,
      key: `${year}-Q${q}`,
      label: `Q${q} ${year}`,
      from: `${year}-${String(startM).padStart(2, "0")}-01`,
      to: `${year}-${String(endM).padStart(2, "0")}-${lastDay(year, endM)}`
    };
  }
  return {
    kind,
    key: `${year}-${String(month).padStart(2, "0")}`,
    label: `${MONTHS[month - 1]} ${year}`,
    from: `${year}-${String(month).padStart(2, "0")}-01`,
    to: `${year}-${String(month).padStart(2, "0")}-${lastDay(year, month)}`
  };
}

/** Every period of `kind` that has at least one expense, oldest first. */
export function periodsIn(list: Expense[], kind: PeriodKind): Period[] {
  const map = new Map<string, Period>();
  for (const e of list) {
    const p = periodOf(kind, e.date);
    map.set(p.key, p);
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export const inPeriod = (e: Expense, p: Period): boolean => e.date >= p.from && e.date <= p.to;

/* -------------------------------- statement -------------------------------- */

export interface Statement {
  period: Period;
  generatedAt: number;
  /** Every entry in the period, income included, date-ordered. */
  expenses: Expense[];
  /** Net balance (income − spending) of everything strictly before the period. */
  opening: Cents;
  /** `opening + net`. */
  closing: Cents;
  subtotal: Cents;
  tax: Cents;
  tip: Cents;
  /** Spending in the period — the figure the category split sums to. */
  total: Cents;
  /** Money in during the period. */
  income: Cents;
  /** `income − total`. */
  net: Cents;
  categories: Bucket[];
  merchants: Bucket[];
  variance: Variance[];
  /** Expenses whose printed total disagrees with their lines. */
  unreconciled: { expense: Expense; delta: Cents }[];
  /** Same period one step earlier, for the change line. */
  previousTotal: Cents | null;
  changePct: number | null;
}

/**
 * Build a full statement for one period.
 *
 * `opening` is the sum of everything strictly before the period, so the closing
 * balance is a real cumulative figure rather than a period subtotal wearing a
 * different name.
 */
export function buildStatement(all: Expense[], period: Period): Statement {
  const expenses = all.filter((e) => inPeriod(e, period)).sort((a, b) => a.date.localeCompare(b.date));
  const opening = net(all.filter((e) => e.date < period.from));
  // Disputed ("not my charge") expenses count as zero everywhere, so keep them
  // out of subtotal/tax/tip too — otherwise Subtotal + Tax + Tip ≠ the total.
  // Income is out of the spending figures by definition.
  const spent = spending(expenses);
  const active = spent.filter((e) => !e.disputed);
  const sub = active.reduce((n, e) => n + subtotal(e), 0);
  const tax = active.reduce((n, e) => n + e.tax, 0);
  const tip = active.reduce((n, e) => n + e.tip, 0);
  const total = sumTotals(spent);
  const income = sumIncome(expenses);

  const prevPeriod = previousPeriod(period);
  const prevList = spending(all.filter((e) => inPeriod(e, prevPeriod)));
  const previousTotal = prevList.length ? sumTotals(prevList) : null;

  return {
    period,
    generatedAt: Date.now(),
    expenses,
    opening,
    closing: opening + income - total,
    subtotal: sub,
    tax,
    tip,
    total,
    income,
    net: income - total,
    categories: byCategory(spent),
    merchants: byMerchant(spent).slice(0, 10),
    variance: period.kind === "month" ? variance(spent) : [],
    unreconciled: active
      .map((e) => ({ expense: e, delta: reconcile(e).delta }))
      .filter((r) => r.delta !== 0),
    previousTotal,
    changePct:
      previousTotal && previousTotal !== 0
        ? Math.round(((total - previousTotal) / previousTotal) * 1000) / 10
        : null
  };
}

/** The period immediately before `p`, same kind. */
export function previousPeriod(p: Period): Period {
  if (p.kind === "year") {
    const y = Number(p.key) - 1;
    return periodOf("year", `${y}-01-01`);
  }
  if (p.kind === "quarter") {
    const [ys, qs] = p.key.split("-Q");
    let y = Number(ys);
    let q = Number(qs) - 1;
    if (q === 0) {
      q = 4;
      y -= 1;
    }
    return periodOf("quarter", `${y}-${String((q - 1) * 3 + 1).padStart(2, "0")}-01`);
  }
  const y = Number(p.key.slice(0, 4));
  const m = Number(p.key.slice(5, 7));
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return periodOf("month", `${py}-${String(pm).padStart(2, "0")}-01`);
}

/** The statement as markdown — the export the plugin puts on the clipboard. */
export function statementMarkdown(s: Statement): string {
  const L: string[] = [];
  L.push(`# Expense statement — ${s.period.label}`, "");
  L.push(`_${s.period.from} to ${s.period.to} · ${s.expenses.length} entr${s.expenses.length === 1 ? "y" : "ies"} · generated by the Expense Tracker module_`, "");
  L.push("| | |", "|---|---|");
  L.push(`| Opening balance | ${money(s.opening)} |`);
  L.push(`| Subtotal | ${money(s.subtotal)} |`);
  L.push(`| Tax | ${money(s.tax)} |`);
  L.push(`| Tip / service | ${money(s.tip)} |`);
  L.push(`| **Spent** | **${money(s.total)}** |`);
  L.push(`| Income | ${money(s.income)} |`);
  L.push(`| **Net** | **${s.net > 0 ? "+" : ""}${money(s.net)}** |`);
  L.push(`| Closing balance | ${money(s.closing)} |`);
  if (s.changePct !== null) {
    L.push(`| vs. previous period | ${s.changePct > 0 ? "+" : ""}${s.changePct}% |`);
  }
  L.push("");
  L.push("## By category", "", "| Category | Expenses | Total | Share |", "|---|---:|---:|---:|");
  for (const c of s.categories) L.push(`| ${c.label} | ${c.count} | ${money(c.total)} | ${c.share}% |`);
  if (s.variance.length) {
    L.push("", "## Budget variance", "", "| Category | Budget | Spent | Delta | Used |", "|---|---:|---:|---:|---:|");
    for (const v of s.variance) {
      L.push(
        `| ${v.label} | ${v.budget ? money(v.budget) : "—"} | ${money(v.spent)} | ${v.delta > 0 ? "+" : ""}${money(v.delta)} | ${v.usedPct === null ? "—" : `${v.usedPct}%`} |`
      );
    }
  }
  if (s.unreconciled.length) {
    L.push("", "## Unreconciled receipts", "");
    for (const u of s.unreconciled) {
      L.push(`- ${u.expense.date} · ${u.expense.merchant} — printed total differs by ${money(u.delta)}`);
    }
  }
  L.push("", "## Entries", "", "| Date | Merchant | Category | Kind | Amount |", "|---|---|---|---|---:|");
  for (const e of s.expenses) {
    const amount = isIncome(e) ? `+${money(effectiveTotal(e))}` : money(effectiveTotal(e));
    L.push(`| ${e.date} | ${e.merchant} | ${categoryOf(e.category).label} | ${isIncome(e) ? "income" : "expense"} | ${amount} |`);
  }
  return L.join("\n");
}
