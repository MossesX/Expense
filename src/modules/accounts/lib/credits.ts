/**
 * @file **The AI credit ledger** — platform currency, kept where identity is
 * (P18 of `axf-amberxvid-social`, 2026-08-15).
 *
 * Credits are a property of a PERSON, not of a feature. A member who buys a
 * hundred of them and then spends them in the assistant, in the recorder and in
 * whatever ships next is spending one balance, and the moment there are two
 * ledgers there is an argument about which one is right. So the ledger lives in
 * the accounts module, beside the account it belongs to, and every feature that
 * charges does so through {@link spendCredits}.
 *
 * ## The one design decision worth reading: a balance is a FOLD
 *
 * There is no stored `balance` field anywhere, in any document, ever. The
 * balance is `entries.reduce((n, e) => n + e.delta, 0)` and nothing else.
 *
 * The alternative — a mutable number updated beside an appended entry — is two
 * writes that must agree, and a process that dies between them leaves a studio
 * whose ledger and whose balance disagree with no way to tell which is the lie.
 * With a fold there is one write, the entries ARE the balance, and a crash
 * mid-append leaves the previous document intact (same-dir tmp + rename), which
 * is a ledger one entry short rather than a ledger that is wrong. Short is
 * recoverable by asking the caller to retry; wrong is not recoverable at all.
 *
 * The fold is cached per user ({@link balanceCache}) because it is read far more
 * often than it is written — a banner chip reads it on every mount. The cache is
 * invalidated on append, and, critically, **it is never what a spend is
 * authorised against**: {@link appendEntry} re-reads the file inside the lock and
 * folds it there. A cache that could authorise a write is a cache that can
 * overspend, and the whole reason the fold is cheap is that it is over one small
 * per-member document.
 *
 * ## Concurrency
 *
 * Every append runs inside `withStoreLock` (`./fsCore`, added by this phase) —
 * the whole read-fold-check-append-write, not just the write. Locking the save
 * alone still loses updates, and here a lost update is a lost charge that
 * nobody will ever notice. The lock is named per user, so two members spending
 * at the same moment contend on nothing.
 *
 * ## What this file deliberately does NOT do
 *
 * - **It does not decide who may BUY.** `canBuyCredits` is a row in the
 *   amberxvid policy catalog (`modules/amberxvid/lib/policy.ts`), and that
 *   file's ownership table is explicit: accounts owns the cascade and the
 *   editor, the module owns *where its rows bite*. The row bites at the buy
 *   flow, which is amberxvid's (`modules/amberxvid/lib/credits.ts` →
 *   `startCheckout`), and it bites BEFORE anything reaches
 *   {@link recordPurchase}. Re-asking here would be a second answer to one
 *   question, and the second answer is the one that gets forgotten.
 * - **It does not price anything.** What a turn, a render or a minute costs is
 *   a meter's business (`amberxvid.credits-meter`). The ledger only ever hears
 *   a number and a `ref`.
 * - **It does not refuse a spend for any reason except an insufficient
 *   balance.** Feature entitlement is the permission matrix's and the policy
 *   cascade's job; a member who may not use a feature is refused before the
 *   charge, not by it.
 *
 * Server-only (node imports) — imported by lib files and API routes only.
 */

import { appendJournal, readJsonFile, withStoreLock, writeJsonAtomic } from "./fsCore";
import { creditsFile } from "./paths";
import type { CreditEntry, CreditKind, CreditStatement } from "./types";

export type { CreditEntry, CreditKind, CreditStatement } from "./types";

/** The ledger document. An object rather than a bare array so a future field
 *  (a schema version, a closing note) does not need a migration of every file. */
interface LedgerFile {
  entries: CreditEntry[];
}

/** Entries one statement returns unless the caller asks for fewer. */
export const STATEMENT_DEFAULT_LIMIT = 100;

const norm = (username: string): string => username.trim().toLowerCase();

/* ================================= the fold ================================== */

/**
 * The cached fold, per user. Invalidated on every append.
 *
 * Never consulted by {@link appendEntry} — see the header. It exists for the
 * read path (a banner chip, a settings pane, a meter deciding whether to offer
 * an action), where being one append stale for the microseconds between the
 * write and the invalidation costs nothing.
 */
const balanceCache = new Map<string, number>();

const fold = (entries: readonly CreditEntry[]): number =>
  entries.reduce((n, e) => n + (Number.isFinite(e.delta) ? e.delta : 0), 0);

/**
 * Read one member's ledger from disk. A missing file is an honest empty ledger
 * — a member who has never touched credits has none, and that is not an error.
 * A junk file reads empty too, and the append that follows re-seeds it; the
 * alternative (throwing) would lock a member out of a feature over a mangled
 * document they cannot see.
 */
function readLedger(user: string): CreditEntry[] {
  const parsed = readJsonFile<LedgerFile>(creditsFile(user));
  const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
  return entries.filter(
    (e): e is CreditEntry =>
      !!e && typeof e.delta === "number" && Number.isFinite(e.delta) && typeof e.at === "string"
  );
}

/**
 * A member's balance — the fold, cached.
 *
 * Async despite reading synchronously, because it is the public read API and
 * the store this file replaces the need for could well be remote one day. Every
 * caller already awaits it.
 */
export async function creditBalance(username: string): Promise<number> {
  const user = norm(username);
  const cached = balanceCache.get(user);
  if (cached !== undefined) return cached;
  const balance = fold(readLedger(user));
  balanceCache.set(user, balance);
  return balance;
}

/** Drop a cached fold. Exported for tests and for anything that edits a ledger
 *  file out of band (a restore, a migration) — an unannounced disk edit is the
 *  one thing the cache cannot see. */
export function invalidateCreditBalance(username?: string): void {
  if (username === undefined) balanceCache.clear();
  else balanceCache.delete(norm(username));
}

/**
 * One member's ledger for a surface: the fold plus the newest entries.
 *
 * Newest first because that is the order the question is asked in ("what just
 * happened to my balance"), and `total` rides along so a truncated list can say
 * so rather than implying the history is short.
 */
export async function creditStatement(
  username: string,
  limit = STATEMENT_DEFAULT_LIMIT
): Promise<CreditStatement> {
  const user = norm(username);
  const entries = readLedger(user);
  const balance = fold(entries);
  balanceCache.set(user, balance);
  const newestFirst = [...entries].reverse();
  return {
    user,
    balance,
    entries: limit > 0 ? newestFirst.slice(0, limit) : newestFirst,
    total: entries.length,
  };
}

/* ================================= appending ================================= */

/** What every mutation answers with — the new balance on success, and on a
 *  refusal the balance that caused it, because "insufficient credits" with no
 *  number is a support ticket. */
export type CreditResult =
  | { ok: true; entry: CreditEntry; balance: number }
  | { ok: false; error: string; balance: number };

const entryId = (): string =>
  `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/**
 * THE chokepoint. Every credit that ever moves goes through this function, under
 * the per-user lock, with the balance re-folded from disk inside it.
 *
 * `floor` is what makes a spend safe: the append is refused unless the resulting
 * balance is at least `floor`. Spends pass 0; grants, purchases and refunds pass
 * `-Infinity`, because an administrator revoking more than a member holds is a
 * decision the ledger records rather than second-guesses — the caller clamps
 * first if clamping is what it means.
 */
async function appendEntry(
  input: { user: string; delta: number; kind: CreditKind; ref: string; actor: string },
  floor: number
): Promise<CreditResult> {
  const user = norm(input.user);
  if (!user) return { ok: false, error: "a credit entry needs a member", balance: 0 };
  if (!Number.isFinite(input.delta) || input.delta === 0) {
    return {
      ok: false,
      error: "a credit entry moves a non-zero, finite number of credits",
      balance: await creditBalance(user),
    };
  }
  const delta = Math.round(input.delta);

  return withStoreLock(`credits-${user}`, async () => {
    // Re-read INSIDE the lock. The cache above is a read-path convenience and
    // is never allowed to authorise a write; this fold is the authority.
    const entries = readLedger(user);
    const before = fold(entries);
    const after = before + delta;
    if (after < floor) {
      return {
        ok: false,
        error:
          `not enough credits — this needs ${Math.abs(delta)} and the balance is ${before}. ` +
          `Ask an administrator for a grant, or buy more.`,
        balance: before,
      };
    }

    const entry: CreditEntry = {
      id: entryId(),
      user,
      delta,
      kind: input.kind,
      ref: input.ref,
      at: new Date().toISOString(),
      actor: norm(input.actor) || "system",
    };
    entries.push(entry);
    await writeJsonAtomic(creditsFile(user), { entries } satisfies LedgerFile);
    balanceCache.set(user, after);

    // Audited like every other suite mutation. The journal is the module's
    // audit trail and money is the thing an administrator is most likely to be
    // asked about six months later.
    await appendJournal("edit", `data/accounts/credits/${user}.json`, {
      summary:
        `accounts: ${entry.actor} ${entry.kind} ${delta > 0 ? "+" : ""}${delta} credit(s) ` +
        `for "${user}" (${entry.ref}) — balance ${before} → ${after}`,
      added: delta > 0 ? delta : 0,
      removed: delta < 0 ? -delta : 0,
    });

    return { ok: true, entry, balance: after };
  });
}

/* ================================== verbs ==================================== */

/**
 * **Spend.** The verb every metered feature calls. Refuses below zero, with the
 * balance in the refusal.
 *
 * `amount` is stated positive — a caller passing a negative "spend" means a
 * refund and should say so, and accepting one here is how a bug becomes free
 * money.
 */
export async function spendCredits(
  username: string,
  amount: number,
  ref: string
): Promise<CreditResult> {
  if (!(amount > 0)) {
    return {
      ok: false,
      error: "a spend is a positive number of credits",
      balance: await creditBalance(username),
    };
  }
  return appendEntry(
    { user: username, delta: -Math.round(amount), kind: "spend", ref, actor: username },
    0
  );
}

/**
 * **Refund.** The correction for a spend that did not deliver — a provider that
 * errored after the charge, a cancelled render. A new entry of the opposite
 * sign, never a deletion, so the history keeps both halves and an administrator
 * can see that something went wrong and was made good.
 */
export async function refundCredits(
  username: string,
  amount: number,
  ref: string,
  actor = "system"
): Promise<CreditResult> {
  if (!(amount > 0)) {
    return {
      ok: false,
      error: "a refund is a positive number of credits",
      balance: await creditBalance(username),
    };
  }
  return appendEntry(
    { user: username, delta: Math.round(amount), kind: "refund", ref, actor },
    Number.NEGATIVE_INFINITY
  );
}

/**
 * **Grant / revoke.** An administrator's decision, signed: positive grants,
 * negative revokes. The actor is recorded because a grant nobody can be asked
 * about is indistinguishable from a bug in the ledger.
 *
 * A revoke larger than the balance is CLAMPED to the balance rather than
 * refused or allowed to go negative. Refusing would make an administrator do
 * arithmetic to zero somebody out; going negative would leave a member who is
 * later granted credits still unable to spend them, for a debt they were never
 * told about. Clamping is the only one of the three that does what the
 * administrator meant, and the entry records what actually moved.
 */
export async function grantCredits(
  actor: string,
  username: string,
  delta: number,
  reason: string
): Promise<CreditResult> {
  const rounded = Math.round(delta);
  if (!Number.isFinite(rounded) || rounded === 0) {
    return {
      ok: false,
      error: "a grant moves a non-zero number of credits (negative revokes)",
      balance: await creditBalance(username),
    };
  }
  const ref = reason.trim() || (rounded > 0 ? "administrator grant" : "administrator revoke");
  if (rounded > 0) {
    return appendEntry(
      { user: username, delta: rounded, kind: "grant", ref, actor },
      Number.NEGATIVE_INFINITY
    );
  }
  const balance = await creditBalance(username);
  if (balance <= 0) {
    return { ok: false, error: `"${norm(username)}" already holds ${balance} credits`, balance };
  }
  const clamped = -Math.min(balance, -rounded);
  return appendEntry({ user: username, delta: clamped, kind: "grant", ref, actor }, 0);
}

/**
 * **Purchase.** Money arrived. Called on the RETURN leg of a checkout, never on
 * the way out — a member who opens a payment page and closes it has bought
 * nothing, and a ledger that credited the intent would be free credits for
 * anyone who clicked.
 *
 * The buy-permission question (`canBuyCredits`) is answered before a checkout
 * starts, by the module that owns the row — see the header. This function is the
 * ledger's half and asks nothing.
 */
export async function recordPurchase(
  username: string,
  amount: number,
  ref: string
): Promise<CreditResult> {
  if (!(amount > 0)) {
    return {
      ok: false,
      error: "a purchase is a positive number of credits",
      balance: await creditBalance(username),
    };
  }
  return appendEntry(
    { user: username, delta: Math.round(amount), kind: "purchase", ref, actor: username },
    Number.NEGATIVE_INFINITY
  );
}

/* ============================== cleanup ====================================== */

/**
 * Forget a removed member's ledger. Best-effort, like the rest of the
 * remove-user cascade — the account row is already gone and an orphaned ledger
 * cannot resurrect it.
 *
 * Deliberately NOT wired into `removeUserData` by this phase: the cascade there
 * removes things that would misattribute to a re-used username (relations,
 * grants), and a ledger is a FINANCIAL record. Deleting one on account removal
 * would destroy the evidence for "where did those hundred credits go", which is
 * exactly the question a removal prompts. Exported so an administrator-facing
 * wipe can call it deliberately.
 */
export async function forgetCredits(username: string): Promise<boolean> {
  const user = norm(username);
  const entries = readLedger(user);
  if (entries.length === 0) return false;
  await writeJsonAtomic(creditsFile(user), { entries: [] } satisfies LedgerFile);
  invalidateCreditBalance(user);
  await appendJournal("delete", `data/accounts/credits/${user}.json`, {
    summary: `accounts: credit ledger for "${user}" cleared (${entries.length} entries)`,
    removed: entries.length,
  });
  return true;
}
