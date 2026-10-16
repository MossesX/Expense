/**
 * @file Bank-statement import — parsing pasted or exported transactions into
 * ledger entries, and deciding which of them the ledger ALREADY holds.
 *
 * Pure: no React, no store, no `@axf/core`, so it can be exercised by plain
 * Node and the dialog stays a thin skin over it (owner, 2026-10-16: *"import
 * transactions to ledger capital one account remove duplicates use multiple
 * checks to ensure no duplicates even if some fields don't match exactly"*).
 *
 * ## What it reads
 *
 *   - Capital One's CSV export (`Transaction Date,Posted Date,Card No.,
 *     Description,Category,Debit,Credit`), and any CSV whose header names a
 *     date, a description/merchant and either an amount or debit/credit.
 *   - Pasted lines, one transaction each: `2026-10-02  BIG Y 61 GROTON  26.51
 *     Grocery`, tab- or multi-space-separated, the amount anywhere after the
 *     merchant. A line that is ONLY a date (`October 2`, `2026-10-02`) sets
 *     the date for the lines under it — which is exactly what a transcript of
 *     the bank app's grouped list looks like.
 *
 * ## Duplicates — several checks, not one
 *
 * A bank row and a ledger row for the same purchase rarely agree on every
 * field: the ledger's date is the day of purchase and the bank's may be the
 * posting day; the merchant is `Cumberland Farms - Fuel` in the app and
 * `CUMBERLAND FARMS 1234` on the statement; a receipt-entered total can
 * differ from the card total by a tip. So an incoming row is held to be a
 * duplicate when ANY of these holds against an existing entry of the same
 * direction (spend vs. credit):
 *
 *   1. **Exact** — same date, same amount, same normalised merchant.
 *   2. **Posting drift** — same amount, similar merchant, date within
 *      `DATE_SLACK_DAYS` either way.
 *   3. **Merchant rewrite** — same date, same amount, merchant unrelated
 *      (the bank and the person named the shop differently).
 *   4. **Tip / rounding** — similar merchant, date within slack, amount within
 *      `AMOUNT_SLACK_CENTS` OR within 25 % and the entry has a tip.
 *   5. **Fingerprint** — the entry's id is the one this importer would mint for
 *      the row, i.e. the same row was imported before.
 *
 * Each verdict names its check so the review table can say WHY a row is held
 * back, and the person can override any single one. Rows that duplicate each
 * other within the same paste (overlapping screenshots) are collapsed too,
 * with the same visibility.
 */
import { effectiveTotal } from "./math";
import { INCOME_CATEGORY, type Expense, type ExpenseKind } from "./types";

/* ------------------------------------------------------------------ rows --- */

export interface ImportRow {
  /** Stable within a parse — the line number it came from. */
  readonly line: number;
  /** ISO `YYYY-MM-DD`. */
  readonly date: string;
  /** As printed by the bank. */
  readonly merchant: string;
  /** Positive cents. */
  readonly cents: number;
  /** Spend (`expense`) or money coming back (`income`). */
  readonly kind: ExpenseKind;
  /** The bank's own category word, when it gave one. */
  readonly bankCategory: string;
  /** A card payment / autopay — not spending, not income; skipped by default. */
  readonly payment: boolean;
  /** Ledger category id this row would land under. */
  readonly category: string;
}

export interface ParseProblem {
  readonly line: number;
  readonly text: string;
  readonly reason: string;
}

export interface ParseResult {
  readonly rows: ImportRow[];
  readonly problems: ParseProblem[];
}

export interface ParseOptions {
  /** Year for dates that carry none (`October 2`). Defaults to the current year. */
  readonly year?: number;
  /** "Today" — a month/day with no year that would land in the future is
   *  pushed to the previous year (a December statement pasted in January). */
  readonly today?: Date;
}

/* ------------------------------------------------------------- category --- */

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
};

/** The bank's category word → a ledger category id. Lower-cased, trimmed. */
const BANK_CATEGORY: readonly (readonly [RegExp, string])[] = [
  [/^grocer/, "groceries"],
  [/gas|automotive|fuel/, "fuel"],
  [/dining|restaurant|food/, "dining"],
  [/health|pharmac|medical|drug/, "health"],
  [/phone|cable|internet|utilit/, "utilities"],
  [/software|subscription|digital/, "software"],
  [/travel|transit|transport|parking|toll/, "transport"],
  [/cloth|apparel/, "clothing"],
  [/payment|transfer|fee|interest/, "transfers"],
  [/personal|salon|barber|spa/, "personal"],
  [/hardware|home improvement|auto/, "hardware"]
];

/** Merchant words that know better than the bank's bucket — the bank files
 *  a barber under "Other Services" and a pawn shop under "Merchandise". */
const MERCHANT_CATEGORY: readonly (readonly [RegExp, string])[] = [
  [/anthropic|openai|github|netflix|spotify|apple\.com|google \*|microsoft|adobe/i, "software"],
  [/barber|salon|nails|spa\b/i, "personal"],
  [/pawn|loan|venmo|cash app|zelle|paypal \*transfer/i, "transfers"],
  [/home depot|lowe'?s|autozone|advance auto|o'?reilly|napa\b/i, "hardware"],
  [/cumberland|citgo|exxon|mobil|shell|sunoco|gulf|bp\b|speedway|wawa|mini[- ]?mart|7-eleven|variety/i, "fuel"],
  [/stop ?(&|and) ?shop|big y\b|walmart|target\b|aldi|costco|bj'?s\b|whole foods|trader joe|shoprite|price chopper|market basket|wegmans|kroger|publix/i, "groceries"],
  [/burger king|mcdonald|wendy|dunkin|starbucks|taco bell|subway|pizza|domino|chipotle|grill|restaurant|cafe|diner/i, "dining"],
  [/cvs|walgreens|rite aid|pharmacy|dental|medical|clinic/i, "health"],
  [/verizon|t-mobile|at&t|comcast|xfinity|eversource|national grid|water|electric/i, "utilities"],
  [/uber|lyft|amtrak|mta\b|parking|toll/i, "transport"],
  [/old navy|gap\b|h&m|tj ?maxx|marshalls|burlington|kohl|macy/i, "clothing"]
];

export function categoryFor(merchant: string, bankCategory: string, kind: ExpenseKind, payment: boolean): string {
  if (payment) return "transfers";
  if (kind === "income") return INCOME_CATEGORY;
  for (const [re, id] of MERCHANT_CATEGORY) if (re.test(merchant)) return id;
  const word = bankCategory.trim().toLowerCase();
  if (word) for (const [re, id] of BANK_CATEGORY) if (re.test(word)) return id;
  return "other";
}

const PAYMENT_RE = /\b(pymt|payment|autopay|auto ?pay|thank you)\b/i;

/* ------------------------------------------------------------- merchant --- */

/**
 * The merchant reduced to what identifies it: upper-case, processor prefixes
 * (`SQ *`, `TST*`, `SP `), store numbers, punctuation and corporate suffixes
 * gone, whitespace collapsed. `BIG Y 61 GROTON` → `BIG Y GROTON`;
 * `Cumberland Farms - Fuel` → `CUMBERLAND FARMS FUEL`; `SQ *RAUL BARBER.` →
 * `RAUL BARBER`.
 */
export function normalizeMerchant(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/^(SQ|TST|SP|PP|PAYPAL|AMZN|AMAZON MKTPL?)\s*\*\s*/, "")
    .replace(/\*/g, " ")
    .replace(/#\s*\d+/g, " ")
    .replace(/\b\d{2,}\b/g, " ")
    .replace(/\b(LLC|INC|CORP|CO|LTD|STORE|THE)\b\.?/g, " ")
    .replace(/[^A-Z0-9&' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const tokensOf = (norm: string): Set<string> =>
  new Set(norm.split(" ").filter((t) => t.length >= 2 && !/^\d+$/.test(t)));

/**
 * 0..1 — how alike two merchant strings are. Token Jaccard, with "one is a
 * prefix of the other" and "they share a leading word of four letters or
 * more" each counting as a match: statements truncate and the app spells out.
 */
export function merchantSimilarity(a: string, b: string): number {
  const na = normalizeMerchant(a);
  const nb = normalizeMerchant(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.startsWith(nb) || nb.startsWith(na)) return 0.9;
  const ta = tokensOf(na);
  const tb = tokensOf(nb);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const jaccard = shared / (ta.size + tb.size - shared);
  const [fa] = na.split(" ");
  const [fb] = nb.split(" ");
  const leading = fa.length >= 4 && fa === fb ? 0.6 : 0;
  return Math.max(jaccard, leading);
}

/* ---------------------------------------------------------------- dates --- */

const pad2 = (n: number): string => String(n).padStart(2, "0");

export const isoOf = (y: number, m: number, d: number): string => `${y}-${pad2(m)}-${pad2(d)}`;

const validYmd = (y: number, m: number, d: number): boolean => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

/**
 * A date in any of the shapes a statement or a transcript uses:
 * `2026-10-02`, `10/02/2026`, `10/2/26`, `10/02`, `Oct 2`, `October 2, 2026`,
 * `2 Oct 2026`. Null when the text is not a date.
 */
export function parseDate(text: string, opts: ParseOptions = {}): string | null {
  const s = text.trim().replace(/,/g, " ").replace(/\s+/g, " ");
  const today = opts.today ?? new Date();
  const defaultYear = opts.year ?? today.getFullYear();
  const settle = (y: number, m: number, d: number, yearGiven: boolean): string | null => {
    if (!yearGiven) {
      // A month/day with no year that lands after today is last year's.
      const todayIso = isoOf(today.getFullYear(), today.getMonth() + 1, today.getDate());
      if (opts.year === undefined && isoOf(y, m, d) > todayIso) y -= 1;
    }
    return validYmd(y, m, d) ? isoOf(y, m, d) : null;
  };
  let m: RegExpMatchArray | null;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) return settle(+m[1], +m[2], +m[3], true);
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s))) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return settle(y, +m[1], +m[2], true);
  }
  if ((m = /^(\d{1,2})\/(\d{1,2})$/.exec(s))) return settle(defaultYear, +m[1], +m[2], false);
  if ((m = /^([A-Za-z]{3,9})\.? (\d{1,2})(?: (\d{4}))?$/.exec(s))) {
    const mon = MONTHS[m[1].toLowerCase()];
    if (!mon) return null;
    return m[3] ? settle(+m[3], mon, +m[2], true) : settle(defaultYear, mon, +m[2], false);
  }
  if ((m = /^(\d{1,2}) ([A-Za-z]{3,9})\.?(?: (\d{4}))?$/.exec(s))) {
    const mon = MONTHS[m[2].toLowerCase()];
    if (!mon) return null;
    return m[3] ? settle(+m[3], mon, +m[1], true) : settle(defaultYear, mon, +m[1], false);
  }
  return null;
}

/* -------------------------------------------------------------- amounts --- */

/** `$1,234.56`, `-$4,262.07`, `−4262.07`, `(12.00)`, `12.00 CR` → signed cents, or null. */
export function parseAmount(text: string): number | null {
  let s = text.trim().replace(/[−–]/g, "-").replace(/\s+/g, "");
  if (!s) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1); }
  if (/CR$/i.test(s)) { sign = -1; s = s.replace(/CR$/i, ""); }
  if (s.startsWith("-")) { sign = -sign; s = s.slice(1); }
  if (s.startsWith("+")) s = s.slice(1);
  s = s.replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$|^\.\d{1,2}$/.test(s)) return null;
  return sign * Math.round(parseFloat(s) * 100);
}

const AMOUNT_TOKEN = /(?:^|\s)([−–-]?\(?\$?[−–-]?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\)?(?:\s?CR)?)(?=\s|$)/i;

/* ------------------------------------------------------------------ CSV --- */

/** RFC-4180-ish: quoted fields, doubled quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

interface CsvShape {
  date: number;
  merchant: number;
  amount?: number;
  debit?: number;
  credit?: number;
  category?: number;
}

/** Column indexes for a header row, or null when it is not a header we know. */
function csvShape(header: readonly string[]): CsvShape | null {
  const h = header.map((x) => x.trim().toLowerCase());
  const find = (...names: string[]): number => h.findIndex((x) => names.includes(x));
  const date = find("transaction date", "trans date", "date", "transaction_date");
  const merchant = find("description", "merchant", "payee", "name", "memo");
  if (date < 0 || merchant < 0) return null;
  const amount = find("amount", "transaction amount");
  const debit = find("debit", "withdrawal", "withdrawals");
  const credit = find("credit", "deposit", "deposits");
  if (amount < 0 && debit < 0 && credit < 0) return null;
  const category = find("category", "type", "transaction type");
  return {
    date,
    merchant,
    amount: amount >= 0 ? amount : undefined,
    debit: debit >= 0 ? debit : undefined,
    credit: credit >= 0 ? credit : undefined,
    category: category >= 0 ? category : undefined
  };
}

/* ---------------------------------------------------------------- parse --- */

function makeRow(
  line: number,
  date: string,
  merchantRaw: string,
  signedCents: number,
  bankCategory: string
): ImportRow {
  const merchant = merchantRaw.replace(/\s+/g, " ").trim();
  const payment = PAYMENT_RE.test(merchant) || /^payment/i.test(bankCategory);
  const kind: ExpenseKind = signedCents < 0 ? "income" : "expense";
  return {
    line,
    date,
    merchant,
    cents: Math.abs(signedCents),
    kind,
    bankCategory: bankCategory.trim(),
    payment,
    category: categoryFor(merchant, bankCategory, kind, payment)
  };
}

/**
 * Parse pasted text or a CSV export. Decides CSV-vs-lines from the first
 * line: a recognised header makes it CSV; anything else is read line by line.
 */
export function parseImport(text: string, opts: ParseOptions = {}): ParseResult {
  const rows: ImportRow[] = [];
  const problems: ParseProblem[] = [];
  const trimmed = text.replace(/^﻿/, "").trim();
  if (!trimmed) return { rows, problems };

  const firstLine = trimmed.split(/\r?\n/, 1)[0];
  const headerShape = firstLine.includes(",") ? csvShape(parseCsv(firstLine)[0] ?? []) : null;

  if (headerShape) {
    const table = parseCsv(trimmed);
    table.slice(1).forEach((cells, i) => {
      const line = i + 2;
      const text = cells.join(",");
      const date = parseDate(cells[headerShape.date] ?? "", opts);
      if (!date) return void problems.push({ line, text, reason: "no date" });
      const merchant = (cells[headerShape.merchant] ?? "").trim();
      if (!merchant) return void problems.push({ line, text, reason: "no description" });
      let signed: number | null = null;
      if (headerShape.amount !== undefined) {
        const a = parseAmount(cells[headerShape.amount] ?? "");
        // Most card exports print charges negative in a single Amount column;
        // Capital One's debit/credit split is handled below. A single column is
        // read as "negative = spend" when any value is negative, else as-is.
        signed = a === null ? null : a;
      } else {
        const d = headerShape.debit !== undefined ? parseAmount(cells[headerShape.debit] ?? "") : null;
        const c = headerShape.credit !== undefined ? parseAmount(cells[headerShape.credit] ?? "") : null;
        if (d !== null && d !== 0) signed = Math.abs(d);
        else if (c !== null && c !== 0) signed = -Math.abs(c);
      }
      if (signed === null) return void problems.push({ line, text, reason: "no amount" });
      const category = headerShape.category !== undefined ? (cells[headerShape.category] ?? "") : "";
      rows.push(makeRow(line, date, merchant, signed, category));
    });
    if (headerShape.amount !== undefined) {
      // Single Amount column: if the column carries any negative value the
      // export prints charges negative (credits positive); flip to our sign.
      const anyNegative = rows.some((r) => r.kind === "income");
      const anyPositive = rows.some((r) => r.kind === "expense");
      if (anyNegative && anyPositive) {
        // Mixed signs: the larger population is the spending side.
        const negatives = rows.filter((r) => r.kind === "income").length;
        if (negatives > rows.length / 2) flipKinds(rows);
      } else if (anyNegative && !anyPositive) flipKinds(rows);
    }
    return { rows, problems };
  }

  let current: string | null = null;
  trimmed.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const text = raw.trim();
    if (!text) return;
    // A line that is only a date groups the lines beneath it.
    const header = parseDate(text, opts);
    if (header) { current = header; return; }
    // Fields: tabs, or runs of two or more spaces, or " | ".
    let fields = text.split(/\t+|\s{2,}|\s\|\s/).map((f) => f.trim()).filter(Boolean);
    let date: string | null = null;
    if (fields.length && (date = parseDate(fields[0], opts))) fields = fields.slice(1);
    else {
      // A leading date glued to the merchant with one space: `Oct 2 Walmart 58.60`.
      const m = /^((?:\d{4}-\d{1,2}-\d{1,2})|(?:\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)|(?:[A-Za-z]{3,9}\.? \d{1,2}(?:,? \d{4})?))\s+(.*)$/.exec(text);
      if (m && (date = parseDate(m[1], opts))) fields = m[2].split(/\t+|\s{2,}|\s\|\s/).map((f) => f.trim()).filter(Boolean);
      else date = current;
    }
    if (!date) return void problems.push({ line, text, reason: "no date (put a date line above, or start the line with one)" });
    if (!fields.length) return void problems.push({ line, text, reason: "nothing after the date" });

    // The amount is the first field that is purely money, searching from the
    // right; otherwise the last money token inside the merchant field.
    let amountIdx = -1;
    let signed: number | null = null;
    for (let k = fields.length - 1; k >= 0; k--) {
      const a = parseAmount(fields[k]);
      if (a !== null) { amountIdx = k; signed = a; break; }
    }
    let merchant: string;
    let category = "";
    if (amountIdx >= 0 && signed !== null) {
      merchant = fields.slice(0, amountIdx).join(" ");
      category = fields.slice(amountIdx + 1).join(" ");
    } else {
      const joined = fields.join(" ");
      const m = AMOUNT_TOKEN.exec(joined);
      if (!m) return void problems.push({ line, text, reason: "no amount" });
      signed = parseAmount(m[1]);
      if (signed === null) return void problems.push({ line, text, reason: "no amount" });
      merchant = joined.slice(0, m.index).trim();
      category = joined.slice(m.index + m[0].length).trim();
    }
    if (!merchant) return void problems.push({ line, text, reason: "no merchant" });
    rows.push(makeRow(line, date, merchant, signed, category));
  });
  return { rows, problems };
}

function flipKinds(rows: ImportRow[]): void {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const kind: ExpenseKind = r.kind === "income" ? "expense" : "income";
    rows[i] = { ...r, kind, category: categoryFor(r.merchant, r.bankCategory, kind, r.payment) };
  }
}

/* ----------------------------------------------------------- duplicates --- */

export const DATE_SLACK_DAYS = 4;
export const AMOUNT_SLACK_CENTS = 100;
export const MERCHANT_SIMILAR = 0.5;

export type DuplicateCheck =
  | "exact"
  | "posting-drift"
  | "merchant-rewrite"
  | "tip-or-rounding"
  | "fingerprint"
  | "repeated-in-paste";

export interface Verdict {
  readonly row: ImportRow;
  /** Null when the row is new. */
  readonly duplicateOf: Expense | ImportRow | null;
  readonly check: DuplicateCheck | null;
  /** One line for the review table. */
  readonly reason: string;
}

const daysBetween = (a: string, b: string): number =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

const kindOf = (e: Expense): ExpenseKind => (e.kind === "income" ? "income" : "expense");

/** A short, stable hash for the fingerprint id. */
function hash36(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36);
}

/** The id this importer mints for a row — the same row imports to the same id,
 *  so the store's own id check is the last line of defence. `seq` separates
 *  genuinely repeated rows the person chose to keep (two identical charges). */
export const fingerprintId = (row: ImportRow, seq = 0): string =>
  `imp_${hash36(`${row.date}|${row.cents}|${row.kind}|${normalizeMerchant(row.merchant)}|${seq}`)}`;

function against(row: ImportRow, e: Expense): { check: DuplicateCheck; reason: string } | null {
  if (kindOf(e) !== row.kind) return null;
  if (e.id === fingerprintId(row)) return { check: "fingerprint", reason: "this exact row was imported before" };
  const cents = effectiveTotal(e);
  const stated = e.statedTotal ?? cents;
  const sameAmount = cents === row.cents || stated === row.cents;
  const sim = merchantSimilarity(row.merchant, e.merchant);
  const days = daysBetween(row.date, e.date);
  const similar = sim >= MERCHANT_SIMILAR;
  if (sameAmount && days === 0 && similar) return { check: "exact", reason: "same date, amount and merchant" };
  if (sameAmount && similar && days <= DATE_SLACK_DAYS)
    return { check: "posting-drift", reason: `same amount and merchant, ${days} day${days === 1 ? "" : "s"} apart` };
  if (sameAmount && days === 0)
    return { check: "merchant-rewrite", reason: `same date and amount as “${e.merchant}”` };
  if (similar && days <= DATE_SLACK_DAYS) {
    const diff = Math.abs(cents - row.cents);
    const within = diff <= AMOUNT_SLACK_CENTS || (e.tip > 0 && diff <= Math.round(row.cents * 0.25));
    if (within) return { check: "tip-or-rounding", reason: `same merchant within ${days} day${days === 1 ? "" : "s"}, amount differs by ${(diff / 100).toFixed(2)}` };
  }
  return null;
}

/**
 * Every row judged against the ledger and against the rows before it in the
 * same paste. Order is preserved; a row is compared to earlier paste rows
 * only, so of two identical pasted rows the first is "new" and the second is
 * "repeated in paste".
 */
export function judge(rows: readonly ImportRow[], existing: readonly Expense[]): Verdict[] {
  const out: Verdict[] = [];
  const kept: ImportRow[] = [];
  for (const row of rows) {
    let verdict: Verdict | null = null;
    for (const e of existing) {
      const hit = against(row, e);
      if (hit) { verdict = { row, duplicateOf: e, check: hit.check, reason: hit.reason }; break; }
    }
    if (!verdict) {
      const twin = kept.find(
        (k) => k.date === row.date && k.cents === row.cents && k.kind === row.kind &&
          merchantSimilarity(k.merchant, row.merchant) >= MERCHANT_SIMILAR
      );
      if (twin) verdict = { row, duplicateOf: twin, check: "repeated-in-paste", reason: `same as line ${twin.line} of this paste` };
    }
    if (!verdict) { verdict = { row, duplicateOf: null, check: null, reason: "new" }; kept.push(row); }
    out.push(verdict);
  }
  return out;
}

/* --------------------------------------------------------------- entries --- */

export interface EntryOptions {
  readonly paymentMethod: string;
  readonly sourceLabel: string;
  readonly now?: number;
}

/** The ledger entries for the rows the person confirmed, fingerprinted so a
 *  second import of the same paste adds nothing. */
export function toExpenses(rows: readonly ImportRow[], opts: EntryOptions): Expense[] {
  const now = opts.now ?? Date.now();
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const base = fingerprintId(row);
    const seq = seen.get(base) ?? 0;
    seen.set(base, seq + 1);
    const note = [opts.sourceLabel, row.bankCategory, row.payment ? "card payment" : ""]
      .filter(Boolean)
      .join(" · ");
    return {
      id: seq === 0 ? base : fingerprintId(row, seq),
      date: row.date,
      merchant: row.merchant,
      category: row.category,
      note,
      paymentMethod: opts.paymentMethod,
      currency: "USD",
      kind: row.kind,
      items: [{ id: `${base}_li${seq}`, description: row.bankCategory || (row.kind === "income" ? "Credit" : "Purchase"), unit: row.cents, qty: 1 }],
      tax: 0,
      tip: 0,
      statedTotal: row.cents,
      source: "import",
      createdAt: now,
      updatedAt: now
    };
  });
}
