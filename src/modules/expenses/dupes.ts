/**
 * @file Possible duplicates INSIDE the ledger — pairs of entries that may be
 * one purchase recorded twice (owner, 2026-10-16: *"find possible duplicate
 * transactions where not all fields match but price matches"*).
 *
 * The import judge (`import.ts`) compares a NEW row to the ledger; this
 * compares the ledger to itself, after the fact — two imports that each
 * posted the same charge under a different description, a manual entry and
 * the bank's line for it, a receipt scan and a statement scan of one dinner.
 *
 * The algorithm (pure, instant, runs in the browser):
 *
 *   1. **Price gate.** Only pairs with the same effective total and the same
 *      kind are candidates — the one field a bank never rewrites.
 *   2. **Date window.** Within `days` of each other (default 7: a charge
 *      posts up to a few business days after the purchase, and a weekend
 *      stretches that).
 *   3. **Score.** Merchant similarity (token Jaccard with prefix and leading
 *      word credit, from `import.ts`), date distance, same account, same
 *      category, same source — weighted into 0..1 and labelled:
 *      `likely` (≥ 0.75), `possible` (≥ 0.45), `weak` (below — same price and
 *      close dates only, which on a $4.50 coffee means nothing and on a
 *      $1,284.17 transfer means everything; shown last, never pre-ticked).
 *
 * Claude's pass (`DupeDialog`, `/api/expenses/dupes`) then reads the same
 * pairs and says which it believes are one transaction, with a reason — it
 * knows that "AMZN Mktp US" and "Amazon" are one merchant and that a tip
 * added at close-out is not a second dinner; the score does not.
 */
import { merchantSimilarity, normalizeMerchant } from "./import";
import { effectiveTotal } from "./math";
import { isIncome, type Expense } from "./types";

/**
 * Bank spellings of a merchant that the plain normaliser does not fold: the
 * statement says `AMZN Mktp US*2K4XY`, the person typed `Amazon`. Each rule
 * is applied to the already-normalised (upper-case, punctuation-free) text.
 * Order matters only where one rule's output feeds another's input.
 */
const ALIASES: readonly [RegExp, string][] = [
  [/\bAMZN( MKTP?| MARKETPLACE)?( US)?\b|\bAMAZON( MKTP?| MARKETPLACE| COM| PRIME| DIGITAL)?( US)?\b/g, "AMAZON"],
  [/\bWAL ?MART\b|\bWM SUPERCENTER\b|\bWALMART COM\b/g, "WALMART"],
  [/\bTARGET T\b|\bTARGET COM\b/g, "TARGET"],
  [/\bDD ?BR\b|\bDUNKIN DONUTS\b|\bDUNKIN'?\b/g, "DUNKIN"],
  [/\bMCDONALD'?S? F?\b/g, "MCDONALDS"],
  [/\bAPPLE COM BILL\b|\bAPPLE COM\b/g, "APPLE"],
  [/\bGOOGLE (PLAY|STORAGE|ONE|YOUTUBE)?\b/g, "GOOGLE"],
  [/\bUBER ?EATS\b/g, "UBER EATS"],
  [/\bCUMBERLAND FARMS?( FUEL| GAS)?\b/g, "CUMBERLAND FARMS"],
  [/\bSTOP & SHOP\b|\bSTOP AND SHOP\b/g, "STOP SHOP"],
  [/\bEXXON ?MOBIL\b|\bEXXON\b|\bMOBIL\b/g, "EXXONMOBIL"],
  [/\bCITGO( GAS| FOOD MART)?\b/g, "CITGO"],
  [/\b(PURCHASE|POS|DEBIT|CARD|ONLINE|PAYMENT|WWW|COM|LLC|INC)\b/g, " "]
];

/**
 * The merchant as the duplicate scan compares it: normalised, aliased, and
 * with order / terminal codes dropped (a token mixing letters and digits —
 * `2K4XY`, `T1234` — identifies the transaction, not the merchant, so two
 * lines for one purchase DIFFER in it while two purchases SHARE it).
 */
export function canonicalMerchant(raw: string): string {
  let s = normalizeMerchant(raw);
  for (const [re, to] of ALIASES) s = s.replace(re, to);
  return s
    .split(" ")
    .filter((t) => t && !(/\d/.test(t) && /[A-Z]/.test(t)) && !/^\d+$/.test(t))
    .join(" ")
    .trim();
}

/** Similarity on the raw text or the canonical text, whichever is kinder —
 *  the canonical form can only fold spellings together, never apart. */
export function dupeMerchantSimilarity(a: string, b: string): number {
  const ca = canonicalMerchant(a);
  const cb = canonicalMerchant(b);
  const canon = ca && cb ? (ca === cb ? 1 : merchantSimilarity(ca, cb)) : 0;
  return Math.max(merchantSimilarity(a, b), canon);
}

export type DupeTier = "likely" | "possible" | "weak";

export interface DupePair {
  /** Stable within one scan — the dialog and Claude's answer key on it. */
  readonly index: number;
  /** The earlier entry (by date, then creation) — the one kept by default. */
  readonly a: Expense;
  /** The later entry — the one deleted by default when the pair is confirmed. */
  readonly b: Expense;
  readonly score: number;
  readonly tier: DupeTier;
  readonly daysApart: number;
  readonly merchantSimilarity: number;
  readonly sameAccount: boolean;
  /** Short, human — the reasons the score is what it is. */
  readonly why: readonly string[];
}

export interface DupeOptions {
  /** Max days between the two dates. */
  readonly days?: number;
  /** Only pair entries on the same account. */
  readonly sameAccountOnly?: boolean;
  /** Pair a card payment / transfer too (off: they are skipped — a recurring
   *  autopay of the same amount is not a duplicate). */
  readonly includePayments?: boolean;
  /** Hard cap on pairs, so a thousand-row ledger cannot produce a dialog
   *  nobody can read. Highest scores first. */
  readonly limit?: number;
}

const DAY = 86_400_000;

const dayNumber = (iso: string): number => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y || 1970, (m || 1) - 1, d || 1) / DAY;
};

const PAYMENT_WORDS = /\b(PAYMENT|AUTOPAY|THANK YOU|TRANSFER|PMT)\b/i;

const earlier = (x: Expense, y: Expense): boolean =>
  x.date < y.date || (x.date === y.date && (x.createdAt ?? 0) <= (y.createdAt ?? 0));

export function findDuplicatePairs(list: readonly Expense[], opts: DupeOptions = {}): DupePair[] {
  const days = Math.max(0, opts.days ?? 7);
  const limit = Math.max(1, opts.limit ?? 150);
  const byAmount = new Map<string, Expense[]>();
  for (const e of list) {
    if (e.disputed) continue;
    if (!opts.includePayments && PAYMENT_WORDS.test(e.merchant)) continue;
    const cents = effectiveTotal(e);
    if (!cents) continue;
    const key = `${isIncome(e) ? "i" : "e"}:${cents}`;
    const bucket = byAmount.get(key);
    if (bucket) bucket.push(e);
    else byAmount.set(key, [e]);
  }

  const out: Omit<DupePair, "index">[] = [];
  for (const bucket of byAmount.values()) {
    if (bucket.length < 2) continue;
    bucket.sort((x, y) => (earlier(x, y) ? -1 : 1));
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i];
        const b = bucket[j];
        const daysApart = Math.abs(dayNumber(b.date) - dayNumber(a.date));
        if (daysApart > days) continue;
        const sameAccount = (a.paymentMethod ?? "") === (b.paymentMethod ?? "");
        if (opts.sameAccountOnly && !sameAccount) continue;
        const sim = dupeMerchantSimilarity(a.merchant, b.merchant);
        const why: string[] = [];
        let score = 0.25; // same price, same kind, within the window
        if (sim >= 0.99) { score += 0.5; why.push("same merchant"); }
        else if (sim >= 0.5) { score += 0.35; why.push("similar merchant"); }
        else if (sim >= 0.25) { score += 0.15; why.push("merchant shares a word"); }
        else why.push("different merchant text");
        if (daysApart === 0) { score += 0.15; why.push("same day"); }
        else if (daysApart <= 3) { score += 0.08; why.push(`${daysApart} day${daysApart === 1 ? "" : "s"} apart`); }
        else why.push(`${daysApart} days apart`);
        if (sameAccount && (a.paymentMethod || b.paymentMethod)) { score += 0.06; why.push("same account"); }
        else if (!sameAccount) { score -= 0.04; why.push("different accounts"); }
        if (a.category === b.category) score += 0.03;
        if (a.source !== b.source) why.push(`${a.source} + ${b.source}`);
        score = Math.max(0, Math.min(1, score));
        const tier: DupeTier = score >= 0.75 ? "likely" : score >= 0.45 ? "possible" : "weak";
        out.push({ a, b, score, tier, daysApart, merchantSimilarity: sim, sameAccount, why });
      }
    }
  }
  out.sort((x, y) => y.score - x.score || (x.a.date < y.a.date ? 1 : -1));
  return out.slice(0, limit).map((p, index) => ({ ...p, index }));
}

/** What the server route receives per pair — the fields that identify a
 *  purchase and nothing else (no ids, no notes beyond a short clip). */
export interface DupePairWire {
  readonly index: number;
  readonly a: DupeSideWire;
  readonly b: DupeSideWire;
  readonly daysApart: number;
}

export interface DupeSideWire {
  readonly date: string;
  readonly merchant: string;
  readonly amount: string;
  readonly kind: string;
  readonly account: string;
  readonly category: string;
  readonly source: string;
  readonly lines: number;
  readonly note: string;
}

const side = (e: Expense): DupeSideWire => ({
  date: e.date,
  merchant: e.merchant,
  amount: (effectiveTotal(e) / 100).toFixed(2),
  kind: isIncome(e) ? "income" : "expense",
  account: e.paymentMethod ?? "",
  category: e.category,
  source: e.source,
  lines: e.items.length,
  note: (e.note ?? "").slice(0, 80)
});

export const toWire = (pairs: readonly DupePair[]): DupePairWire[] =>
  pairs.map((p) => ({ index: p.index, a: side(p.a), b: side(p.b), daysApart: p.daysApart }));

/** Claude's answer for one pair, as the route returns it. */
export interface DupeVerdict {
  readonly index: number;
  readonly duplicate: boolean;
  /** 0..1 */
  readonly confidence: number;
  readonly reason: string;
}
