/**
 * @file Expense-tracker data model.
 *
 * Deliberately receipt-shaped rather than ledger-shaped: an **expense** owns
 * its line items, because that is what a receipt is and because the tree view,
 * the statement generator and the reconciliation math all need the breakdown.
 * A hand-entered expense is simply one with a single line item and no receipt.
 *
 * Money is stored in **whole cents as integers**, never floats. `19.99 + 0.01`
 * is not `20.00` in IEEE-754, and a statement that is a cent out is a statement
 * nobody trusts. Every display path divides by 100 exactly once, at the edge.
 */

/** Cents. Always an integer; negative means a credit/refund. */
export type Cents = number;

export interface LineItem {
  id: string;
  description: string;
  /** Unit price in cents. */
  unit: Cents;
  qty: number;
  /** Category override; falls back to the expense's category. */
  category?: string;
  /** True for a line the parser was unsure about — surfaced for correction. */
  uncertain?: boolean;
}

export type ExpenseSource = "manual" | "receipt" | "seed" | "import" | "payday";

/**
 * Which way the money moved. **Absent means `"expense"`** — every record
 * written before 2026-09-15 has no `kind`, and reading them as spending is
 * exactly right; no migration touches the stored ledger.
 *
 * An income entry keeps the receipt shape (line items, a printed total) so the
 * grid edits it with the same cells, but the math treats it as money IN:
 * `flow()` gives it a positive sign, the running balance and the statement's
 * opening/closing figures are net (income − spending), and it is kept OUT of
 * every spending rollup — category shares, merchants, budget variance.
 */
export type ExpenseKind = "expense" | "income";

export interface Expense {
  id: string;
  /** ISO date, `YYYY-MM-DD`. Kept as a string so grouping is pure string work
   *  and no timezone can shift an expense into the wrong month. */
  date: string;
  merchant: string;
  category: string;
  /** Free-text note; the statement generator ignores it. */
  note?: string;
  paymentMethod?: string;
  currency: string;
  /** See {@link ExpenseKind}. Omitted on every pre-existing record. */
  kind?: ExpenseKind;
  items: LineItem[];
  /** Tax in cents, as printed on the receipt. */
  tax: Cents;
  /** Tip/service in cents. */
  tip: Cents;
  /**
   * Total in cents **as printed on the receipt**. Kept separately from the
   * computed sum on purpose: the difference between the two is the
   * reconciliation signal the grid flags. Null means "trust the computation".
   */
  statedTotal: Cents | null;
  source: ExpenseSource;
  /** Receipt image, when one was imported. */
  receipt?: ReceiptRef;
  /** Parse confidence 0–1 when `source === "receipt"`. */
  confidence?: number;
  reimbursable?: boolean;
  /**
   * A charge the user disputes as not theirs (fraud, wrong card, duplicate).
   * A disputed expense stays in the grid but contributes **zero** to every
   * total — see {@link effectiveTotal}. `disputeNote` is the free-text reason
   * captured from the line-item sub-grid's "Not my charge" action.
   */
  disputed?: boolean;
  disputeNote?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ReceiptRef {
  /** Repo-relative path the parse route saved the upload to. */
  path: string;
  filename: string;
  bytes: number;
  /** Which engine produced the draft. */
  engine: "claude-vision" | "manual";
  parsedAt: number;
}

/** What the parse route returns before the user accepts it. */
export interface ReceiptDraft {
  merchant: string;
  date: string;
  currency: string;
  category: string;
  items: { description: string; unit: Cents; qty: number; uncertain?: boolean }[];
  tax: Cents;
  tip: Cents;
  statedTotal: Cents | null;
  confidence: number;
  /** Anything the parser wants the human to look at. */
  warnings: string[];
  raw?: string;
}

export interface Category {
  id: string;
  label: string;
  color: string;
  /** Monthly budget in cents; 0 = untracked. */
  budget: Cents;
}

/**
 * Personal-spending categories, derived from the REAL ledger this module
 * imports (the Data Grid store), not from a demo scenario — chosen 2026-07-28
 * with the user. Budgets are monthly cents, editable in spirit (0 = untracked).
 */
export const CATEGORIES: Category[] = [
  { id: "fuel", label: "Fuel & convenience", color: "#FFB020", budget: 40000 },
  { id: "groceries", label: "Groceries", color: "#34D399", budget: 60000 },
  { id: "dining", label: "Dining & takeout", color: "#F87171", budget: 15000 },
  { id: "transfers", label: "Transfers & loans", color: "#9A9AA6", budget: 0 },
  { id: "personal", label: "Personal care", color: "#F472B6", budget: 10000 },
  { id: "clothing", label: "Clothing", color: "#A78BFA", budget: 15000 },
  { id: "software", label: "Software & subscriptions", color: "#60A5FA", budget: 30000 },
  { id: "utilities", label: "Phone & utilities", color: "#22D3EE", budget: 20000 },
  { id: "transport", label: "Transport", color: "#38BDF8", budget: 10000 },
  { id: "hardware", label: "Hardware & auto", color: "#FB923C", budget: 20000 },
  { id: "health", label: "Health & pharmacy", color: "#4ADE80", budget: 15000 },
  { id: "pending", label: "Pending / uncleared", color: "#F59E0B", budget: 0 },
  { id: "income", label: "Income", color: "#2DD4BF", budget: 0 },
  { id: "other", label: "Other", color: "#8A8A96", budget: 0 }
];

export const categoryOf = (id: string): Category =>
  CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[CATEGORIES.length - 1];

/** The one category an income entry lands in. Budget 0: nothing to overspend. */
export const INCOME_CATEGORY = "income";

/** True for money in. Absent `kind` is an expense — see {@link ExpenseKind}. */
export const isIncome = (e: Pick<Expense, "kind">): boolean => e.kind === "income";

/** The accounts that actually appear in the imported ledger's Source column. */
export const PAYMENT_METHODS = ["Discover", "Capital One", "Cash App", "Venmo", "Cash", "Drawer"];
