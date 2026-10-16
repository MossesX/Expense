/**
 * @file **Reports** — a statement turned into a document that leaves the app.
 *
 * The Statements tab is a live derivation: it recomputes from the ledger every
 * render, and that is exactly right for looking at. A REPORT is the other
 * thing — a frozen document with a date on it that can be saved, reopened,
 * mailed and printed. The owner asked for both halves in one sentence: *"new
 * report which opens in a new tab … open report that opens from saved
 * directory"*.
 *
 * ## Why the HTML is self-contained
 *
 * A report is rendered in a **sandboxed iframe** inside the app and may also be
 * opened straight off disk in a browser. Neither of those inherits the studio's
 * stylesheet or its `--axf-*` custom properties, so a report that referenced
 * them would render unstyled in the one place it is most likely to be read.
 * Every value is therefore BAKED at generation time, from the live theme
 * ({@link capturePalette}) — the report looks like the app looked the day it
 * was made, which is the honest thing for a frozen document to do.
 *
 * No script tags, no external requests, no fonts to fetch. The iframe that
 * shows it runs with `sandbox` and nothing to escape with.
 *
 * ## Node-safe on purpose
 *
 * No `"use client"` and no React: the scan route imports {@link REPORT_MARKER}
 * from here so the marker has ONE definition. A second copy in the route is a
 * string that agrees today and diverges the first time it is edited.
 */

import { categoryOf, isIncome, type Expense } from "./types";
import { effectiveTotal, money, statementMarkdown, type Statement } from "./math";

/**
 * Stamped into every generated report, and the strong signal the "find saved
 * reports" scan looks for. It survives a rename, which the filename heuristic
 * does not — that is the whole reason it exists.
 */
export const REPORT_MARKER = "axf-report:expenses";

/** The handful of theme values a report bakes. */
export interface ReportPalette {
  page: string;
  panel: string;
  ink: string;
  dim: string;
  edge: string;
  accent: string;
  ok: string;
  warn: string;
  err: string;
  mono: string;
  sans: string;
}

/** What a report is generated FROM — everything the header needs to be true. */
export interface ReportInput {
  statement: Statement;
  /** Free-text title; defaults to "Expense statement — <period>". */
  title?: string;
  /** Baked colours. Omit to use {@link FALLBACK_PALETTE}. */
  palette?: ReportPalette;
  /** Who/what generated it, shown in the footer. */
  generator?: string;
}

/**
 * Used when there is no document to read a theme off — a server render, a test,
 * or a browser that has not painted yet. Deliberately the studio's dark default
 * rather than a neutral grey: a report that looks like a different application
 * reads as a different application's document.
 */
export const FALLBACK_PALETTE: ReportPalette = {
  page: "#100c07",
  panel: "#191308",
  ink: "#f6ecdd",
  dim: "#a2907a",
  edge: "#453521",
  accent: "#f0982e",
  ok: "#57bd8a",
  warn: "#ffd23f",
  err: "#e5545b",
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
  sans: "Inter, system-ui, sans-serif"
};

/**
 * Read the live theme off `:root`.
 *
 * The custom properties are what the theme engine publishes
 * (`AxfStyleRoot`), so this is the applied theme including any preview in
 * force — which is correct: what you see is what the report gets. Every value
 * falls back individually, so a pack that publishes only half the roles still
 * produces a legible document instead of a black-on-black one.
 */
export function capturePalette(): ReportPalette {
  if (typeof document === "undefined") return FALLBACK_PALETTE;
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string): string => {
    const value = style.getPropertyValue(`--axf-${name}`).trim();
    return value || fallback;
  };
  return {
    page: read("page", FALLBACK_PALETTE.page),
    panel: read("panel", FALLBACK_PALETTE.panel),
    ink: read("ink", FALLBACK_PALETTE.ink),
    dim: read("dim", FALLBACK_PALETTE.dim),
    edge: read("edge", FALLBACK_PALETTE.edge),
    accent: read("accent", FALLBACK_PALETTE.accent),
    ok: read("ok", FALLBACK_PALETTE.ok),
    warn: read("warn", FALLBACK_PALETTE.warn),
    err: read("err", FALLBACK_PALETTE.err),
    mono: read("mono", FALLBACK_PALETTE.mono),
    sans: read("sans", FALLBACK_PALETTE.sans)
  };
}

/** HTML-escape. Every interpolation below goes through it — merchant names are
 *  user text, and user text in a document is how a report grows a script tag. */
export function esc(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** `2026-08-12 18:40` — local, because a report is read where it was made. */
function stamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * A filesystem-safe name for a report, matching the API's name guard.
 *
 * Includes the generation minute, so generating twice in a session produces two
 * files rather than silently overwriting the first — a report is a record, and
 * a record that replaces its predecessor without asking is a lost record.
 */
export function reportFileName(statement: Statement, at = Date.now()): string {
  const period = statement.period.key.replace(/[^A-Za-z0-9-]/g, "-");
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  const when = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  return `expenses-${period}-${when}.html`;
}

/** A ledger snapshot's filename — the Save half of Save/Load. */
export function saveFileName(at = Date.now()): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `ledger-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}

/* ------------------------------------------------------------- the document */

const money2 = (c: number): string => money(c);

function rows(cells: (string | number)[][], align: string[]): string {
  return cells
    .map(
      (row) =>
        `<tr>${row
          .map((cell, i) => `<td class="${align[i] === "r" ? "num" : ""}">${cell}</td>`)
          .join("")}</tr>`
    )
    .join("");
}

/**
 * Build the report as ONE self-contained HTML document.
 *
 * Structure mirrors the Statements tab deliberately — headline figures, the
 * category split, budget variance, top merchants, unreconciled receipts, then
 * every expense. A report that reorganises the data is a second thing to
 * reconcile against the screen; this is the same statement, frozen.
 */
export function buildReportHtml(input: ReportInput): string {
  const { statement: s } = input;
  const palette = input.palette ?? FALLBACK_PALETTE;
  const title = input.title?.trim() || `Expense statement — ${s.period.label}`;
  const generator = input.generator ?? "AmberX Studio · Expense Tracker";

  const headline: [string, string][] = [
    ["Opening balance", money2(s.opening)],
    ["Subtotal", money2(s.subtotal)],
    ["Tax", money2(s.tax)],
    ["Tip / service", money2(s.tip)],
    ["Spent", money2(s.total)],
    ["Income", money2(s.income)],
    ["Net", `${s.net > 0 ? "+" : ""}${money2(s.net)}`],
    ["Closing balance", money2(s.closing)]
  ];
  if (s.changePct !== null) {
    headline.push(["vs. previous period", `${s.changePct > 0 ? "+" : ""}${s.changePct}%`]);
  }

  const categoryRows = rows(
    s.categories.map((c) => [
      `<span class="dot" style="background:${esc(categoryOf(c.key).color)}"></span>${esc(c.label)}`,
      c.count,
      money2(c.total),
      `${c.share}%`
    ]),
    ["l", "r", "r", "r"]
  );

  const varianceRows = s.variance.length
    ? `<h2>Budget variance</h2>
    <table><thead><tr><th>Category</th><th class="num">Budget</th><th class="num">Spent</th><th class="num">Delta</th><th class="num">Used</th></tr></thead>
    <tbody>${rows(
      s.variance.map((v) => [
        esc(v.label),
        v.budget ? money2(v.budget) : "—",
        money2(v.spent),
        `<span class="${v.delta > 0 && v.budget ? "bad" : ""}">${v.delta > 0 ? "+" : ""}${money2(v.delta)}</span>`,
        v.usedPct === null ? "—" : `${v.usedPct}%`
      ]),
      ["l", "r", "r", "r", "r"]
    )}</tbody></table>`
    : "";

  const unreconciledRows = s.unreconciled.length
    ? `<h2>Unreconciled receipts <span class="count">${s.unreconciled.length}</span></h2>
    <table><thead><tr><th>Date</th><th>Merchant</th><th class="num">Printed − lines</th></tr></thead>
    <tbody>${rows(
      s.unreconciled.map((u) => [
        esc(u.expense.date),
        esc(u.expense.merchant),
        `<span class="warn">${u.delta > 0 ? "+" : ""}${money2(u.delta)}</span>`
      ]),
      ["l", "l", "r"]
    )}</tbody></table>`
    : "";

  const expenseRows = rows(
    s.expenses.map((e: Expense) => [
      esc(e.date),
      `<span class="${e.disputed ? "struck" : ""}">${esc(e.merchant)}</span>`,
      esc(categoryOf(e.category).label),
      esc(e.paymentMethod ?? "—"),
      isIncome(e) ? `<span class="in">+${money2(effectiveTotal(e))}</span>` : money2(effectiveTotal(e))
    ]),
    ["l", "l", "l", "l", "r"]
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="${REPORT_MARKER}">
<meta name="axf-period" content="${esc(s.period.key)}">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px;
    background: ${palette.page}; color: ${palette.ink};
    font: 13px/1.5 ${palette.sans};
  }
  header { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 4px; }
  h1 { font-size: 21px; margin: 0; font-weight: 700; }
  .sub { color: ${palette.dim}; font-size: 11.5px; }
  h2 {
    font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase;
    color: ${palette.dim}; margin: 26px 0 8px; font-weight: 600;
  }
  .count { color: ${palette.dim}; font-weight: 400; }
  .tiles { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
  .tile {
    border: 1px solid ${palette.edge}; border-radius: 6px;
    background: ${palette.panel}; padding: 8px 14px; min-width: 120px;
  }
  .tile .v { font: 700 15px/1.2 ${palette.mono}; font-variant-numeric: tabular-nums; }
  .tile .k { font-size: 9.5px; letter-spacing: .08em; text-transform: uppercase; color: ${palette.dim}; margin-top: 2px; }
  table { border-collapse: collapse; width: 100%; margin: 0; }
  th {
    text-align: left; font-size: 10px; letter-spacing: .07em; text-transform: uppercase;
    color: ${palette.dim}; font-weight: 600; padding: 5px 8px;
    border-bottom: 1px solid ${palette.edge};
  }
  td { padding: 4px 8px; border-bottom: 1px solid ${palette.edge}; font-size: 12.3px; }
  td.num, th.num { text-align: right; font-family: ${palette.mono}; font-variant-numeric: tabular-nums; }
  tbody tr:last-child td { border-bottom: 0; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 7px; vertical-align: baseline; }
  .warn { color: ${palette.warn}; }
  .bad { color: ${palette.err}; }
  .in { color: ${palette.ok}; }
  .struck { text-decoration: line-through; opacity: .6; }
  footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid ${palette.edge}; color: ${palette.dim}; font-size: 10.5px; }
  /* Printing on a dark page wastes an entire cartridge and reads worse. */
  @media print {
    :root { color-scheme: light; }
    body { background: #fff; color: #111; padding: 0; }
    .tile { background: #fff; border-color: #ccc; }
    th, td { border-color: #ddd; }
    .tile .k, .sub, h2, footer { color: #555; }
  }
</style>
</head>
<body>
<header>
  <h1>${esc(title)}</h1>
  <span class="sub">${esc(s.period.from)} → ${esc(s.period.to)} · ${s.expenses.length} entr${s.expenses.length === 1 ? "y" : "ies"}</span>
</header>

<div class="tiles">
${headline.map(([k, v]) => `  <div class="tile"><div class="v">${esc(v)}</div><div class="k">${esc(k)}</div></div>`).join("\n")}
</div>

<h2>By category <span class="count">${s.categories.length}</span></h2>
<table><thead><tr><th>Category</th><th class="num">Expenses</th><th class="num">Total</th><th class="num">Share</th></tr></thead>
<tbody>${categoryRows}</tbody></table>

${varianceRows}

<h2>Top merchants <span class="count">${s.merchants.length}</span></h2>
<table><thead><tr><th>Merchant</th><th class="num">Expenses</th><th class="num">Total</th><th class="num">Share</th></tr></thead>
<tbody>${rows(
    s.merchants.map((m) => [esc(m.label), m.count, money2(m.total), `${m.share}%`]),
    ["l", "r", "r", "r"]
  )}</tbody></table>

${unreconciledRows}

<h2>Entries <span class="count">${s.expenses.length}</span></h2>
<table><thead><tr><th>Date</th><th>Merchant</th><th>Category</th><th>Account</th><th class="num">Amount</th></tr></thead>
<tbody>${expenseRows}</tbody></table>

<footer>Generated ${esc(stamp(s.generatedAt))} · ${esc(generator)} · every figure computed in integer cents.</footer>
</body>
</html>`;
}

/** The same statement as markdown — kept here so both report formats have one
 *  home, even though the markdown itself is `math.ts`'s. */
export function buildReportMarkdown(statement: Statement): string {
  return statementMarkdown(statement);
}

/**
 * A ledger snapshot — what Save writes and Load reads.
 *
 * Versioned, and Load refuses a version it does not know: silently accepting an
 * unknown shape is how a "restore" empties a ledger.
 */
export interface LedgerSnapshot {
  v: 1;
  kind: "axf-expenses-ledger";
  title: string;
  savedAt: number;
  count: number;
  expenses: Expense[];
}

export function buildSnapshot(expenses: readonly Expense[], title: string): LedgerSnapshot {
  return {
    v: 1,
    kind: "axf-expenses-ledger",
    title,
    savedAt: Date.now(),
    count: expenses.length,
    expenses: [...expenses]
  };
}

/** Parse a snapshot, or explain why it is not one. Never throws. */
export function readSnapshot(text: string): { expenses: Expense[] } | { error: string } {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { error: "that file is not JSON" };
  }
  const d = doc as Partial<LedgerSnapshot>;
  if (d?.kind !== "axf-expenses-ledger") return { error: "that JSON is not an expense-ledger snapshot" };
  if (d.v !== 1) return { error: `snapshot version ${String(d.v)} is newer than this build understands` };
  if (!Array.isArray(d.expenses)) return { error: "the snapshot carries no expense list" };
  return { expenses: d.expenses as Expense[] };
}
