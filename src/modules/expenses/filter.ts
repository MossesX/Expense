/**
 * @file The ledger filter — a line of text against the columns a person chose.
 *
 * Pure, so the header field, the advanced dialog and any view can share one
 * meaning of "matches". The query is split into words; with `matchAll` every
 * word must be found somewhere in the chosen columns, otherwise any one word
 * suffices. A word is matched case-insensitively against the column's TEXT —
 * the category's label as well as its id, the money as it is printed as well
 * as its raw digits — because people type what they see.
 *
 * No columns chosen means ALL columns (owner, 2026-10-16: the advanced
 * dialog's switches start with none selected, and the plain field must still
 * find things).
 */
import { effectiveTotal, money } from "./math";
import { categoryOf, isIncome, type Expense } from "./types";

export type FilterColumn =
  | "date"
  | "kind"
  | "merchant"
  | "category"
  | "account"
  | "note"
  | "lines"
  | "amount"
  | "source";

export const FILTER_COLUMNS: readonly { id: FilterColumn; label: string; hint: string }[] = [
  { id: "date", label: "Date", hint: "YYYY-MM-DD, so “2026-09” finds a month" },
  { id: "merchant", label: "Merchant", hint: "The merchant as entered" },
  { id: "category", label: "Category", hint: "Label or id — “fuel”, “Groceries”" },
  { id: "amount", label: "Amount", hint: "Printed or raw — “26.51”, “$26.51”, “2651”" },
  { id: "account", label: "Account", hint: "The payment method column" },
  { id: "note", label: "Note", hint: "Notes, dispute notes, import provenance" },
  { id: "lines", label: "Line items", hint: "Every line item's description" },
  { id: "kind", label: "Kind", hint: "“expense” or “income”" },
  { id: "source", label: "Source", hint: "manual, import, payday, receipt" }
];

export interface FilterSpec {
  readonly text: string;
  /** Empty = every column. */
  readonly columns: readonly FilterColumn[];
  readonly matchAll: boolean;
}

export const EMPTY_FILTER: FilterSpec = { text: "", columns: [], matchAll: true };

export const filterActive = (f: FilterSpec): boolean => f.text.trim().length > 0;

/** The searchable text of one column. */
export function columnText(e: Expense, column: FilterColumn): string {
  switch (column) {
    case "date":
      return e.date;
    case "kind":
      return isIncome(e) ? "income" : "expense";
    case "merchant":
      return e.merchant;
    case "category": {
      const c = categoryOf(e.category);
      return `${c.label} ${c.id} ${e.category}`;
    }
    case "account":
      return e.paymentMethod ?? "";
    case "note":
      return [e.note, e.disputeNote].filter(Boolean).join(" ");
    case "lines":
      return e.items.map((i) => i.description).join(" ");
    case "amount": {
      const cents = effectiveTotal(e);
      const stated = e.statedTotal ?? cents;
      return `${money(cents)} ${(cents / 100).toFixed(2)} ${cents} ${money(stated)} ${(stated / 100).toFixed(2)}`;
    }
    case "source":
      return e.source;
  }
}

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);

export function matchesFilter(e: Expense, f: FilterSpec): boolean {
  const terms = words(f.text);
  if (!terms.length) return true;
  const columns = f.columns.length ? f.columns : FILTER_COLUMNS.map((c) => c.id);
  const hay = columns.map((c) => columnText(e, c).toLowerCase()).join(" \u0000 ");
  return f.matchAll ? terms.every((t) => hay.includes(t)) : terms.some((t) => hay.includes(t));
}

export const applyFilter = (list: readonly Expense[], f: FilterSpec): Expense[] =>
  filterActive(f) ? list.filter((e) => matchesFilter(e, f)) : [...list];

/** Columns ↔ the comma-separated setting that persists them. */
export function parseColumns(raw: string): FilterColumn[] {
  const valid = new Set<string>(FILTER_COLUMNS.map((c) => c.id));
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is FilterColumn => valid.has(s));
}

export const serializeColumns = (columns: readonly FilterColumn[]): string => columns.join(",");
