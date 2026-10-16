/**
 * @file **The per-user policy cascade** — the restriction layer, its site-
 * defaults cascade, and the guards that make each row bite (P2 of
 * `axf-accounts-admin-suite`).
 *
 * ## What this is
 *
 * A catalog of typed ROWS, a three-tier resolution, and one guard per row. An
 * administrator sets the site posture once; a member who needs to differ gets
 * an override. Nothing here decides which MODULES anybody may open — see
 * §"Module access is not here".
 *
 * ## The three tiers, and the absent-vs-pinned distinction
 *
 * ```
 *   row.defaultValue        the shipped posture — what a studio nobody has
 *                           configured behaves like
 *        ↓ overlaid by
 *   policy/_site.json       the SITE posture, set once by an administrator
 *        ↓ overlaid by
 *   policy/<user>.json      that member's overrides
 * ```
 *
 * At every tier, **an absent field and a present field are different
 * statements**, and the difference is the whole reason the documents are
 * sparse:
 *
 * - **absent** = *follow whatever the tier above says*, including as it CHANGES.
 *   Raise the site quota and this member's quota rises with it.
 * - **present** = *pinned to this value*. Raise the site quota and this member
 *   stays exactly where an administrator put them.
 *
 * This is the same distinction the module assistant's `moduleAgents` map
 * documents (`src/plugins/module-assistant/store.ts`), for the same reason:
 * "follows the default" and "is pinned to the default's current value" look
 * identical the day they are written and diverge on the day the default moves.
 * A cascade that stored the resolved value everywhere would silently convert
 * every follower into a pin the first time anybody pressed Save.
 *
 * `""` (a text row) and `0` (a number row) are therefore VALUES, not absences —
 * `0` is this catalog's spelling of "no limit", and it is a pin like any other.
 *
 * ## Module access is NOT here — deliberately
 *
 * Which modules a member may open stays with the **permission matrix**
 * (`./permissions`, `permissions.json`), and this file adds nothing to it.
 * {@link policyWithAccess} reads it THROUGH so the admin suite can render both
 * halves on one screen, and that is the whole of the relationship.
 *
 * Merging them was considered and refused:
 *
 * - The matrix is **grants-shaped**, not row-shaped. Its unit is
 *   `(user, moduleId) → allowed`, over a module list that is discovered at
 *   runtime and different on every install. This catalog's unit is a declared
 *   row with a label, a hint, a kind and a default. Forcing the matrix into
 *   rows would mean synthesising a row per module per install — a catalog whose
 *   contents nobody wrote.
 * - The matrix **already has its confirm surface** (`PermissionMatrix.tsx`) and
 *   its own `default-allow` semantics, where absent means allowed and an
 *   explicit `true` means "this member joined" (see `requestModuleGrant`). That
 *   is a three-state vocabulary this catalog's two-state absent/pinned cannot
 *   express without losing the middle one.
 * - Duplicating it would create **two answers to one question**. The moment two
 *   stores can both say "no" to opening a module, an administrator who turns
 *   one off and watches nothing change has to be told which of the two they
 *   were looking at. One store, one answer, one screen that shows both.
 *
 * ## The two capabilities that DO overlap, and how that is one answer
 *
 * `canMessage` and `canEditProfile` exist as rows here AND as capabilities in
 * the grants record, because the grants record is the older store and already
 * has an editor. They are not two answers: {@link effectivePolicy} resolves
 * them as the **conjunction** of this cascade and `effectivePermissions()`, so
 * there is exactly one function that answers "may this member message?" and
 * every consumer calls it. What the cascade adds is the SITE tier the grants
 * record never had — the grants file has no way to say "nobody may message
 * until an administrator says otherwise", because its unit is one user.
 *
 * Deny wins in both directions, which is the only composition a refusal can
 * safely have: a grant that could OVERRIDE a site prohibition would make the
 * site tier advisory, and an administrator who set it would be wrong about
 * what they had done.
 *
 * ## Every write is audited
 *
 * {@link setPolicyValue} and {@link clearPolicyValue} are the ONLY writers, and
 * both go through `auditFieldChange` in `./admin` with actor, subject, field
 * and old → new. There is no third writer to forget: the document is not
 * exported and the write functions hold the lock.
 *
 * ## The foreign-row seam
 *
 * Other modules contribute rows through {@link registerPolicyRows} — amberxvid
 * already declares thirteen against this exact shape
 * (`amberxvid/lib/policy.ts`, wired by its `installVaultStorage`). **This file
 * imports no other module, ever**, in either direction: rows arrive by
 * registration and the cascade is handed back out as a function. That is what
 * lets the accounts module be peeled without dragging the studio with it.
 *
 * Server-only (node imports) — imported by lib files and API routes only.
 */

import type { SettingKind, SettingOption, SettingValue } from "@axf/core";

import { auditFieldChange } from "./admin";
import { findAccount, requireAdmin } from "./accounts";
import { readJsonFile, withStoreLock, writeJsonAtomic } from "./fsCore";
import { SITE_POLICY_SUBJECT, policyFile } from "./paths";
import { effectivePermissions } from "./permissions";
import { checkQuota, type StorageVerdict } from "./storage";
import type { Account, EffectivePermissions } from "./types";

/* ============================== the catalog ================================== */

/** The group headings the editor files rows under, in render order. */
export const POLICY_GROUPS = ["Quotas", "Capabilities", "Rate limits", "Account state"] as const;

export type PolicyGroup = (typeof POLICY_GROUPS)[number];

/**
 * One catalog row.
 *
 * The field names are **core's `SettingRow`** (`packages/core/src/settings/decl.ts`)
 * deliberately — the editor P4 builds is generic over that vocabulary, so a row
 * that renamed `defaultValue` would need editor code to read it, which is the
 * per-row screen this design exists to avoid. Two fields are added:
 * {@link PolicyRow.group} (which heading it files under) and
 * {@link PolicyRow.siteOnly}.
 */
export interface PolicyRow {
  /** Stable key. camelCase identifier — it is a field name in the documents. */
  readonly key: string;
  /** The heading the editor files this under. */
  readonly group: string;
  readonly label: string;
  /** WHY this is a policy. Every row justifies itself, as core's rows do — and
   *  a hint is what an administrator reads before changing somebody's life. */
  readonly hint: string;
  readonly kind: SettingKind;
  /** The SITE default: what every member gets until an administrator differs. */
  readonly defaultValue: SettingValue;
  /** `number` only, and both together — an unbounded dial is a typo amplifier. */
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** `select` only: the closed set. */
  readonly options?: readonly SettingOption[];
  /**
   * This row may be pinned on the SITE subject only; a per-user override is
   * refused by {@link setPolicyValue} rather than silently ignored.
   *
   * Exactly one row needs it, and the reason is specific: a limiter that is
   * consulted BEFORE the caller has authenticated cannot read the caller's own
   * document, because reading a document named by an unauthenticated string is
   * both an account-enumeration oracle and a disk read an attacker chooses.
   * Rather than ship a per-user override that quietly never binds, the row
   * declares that it has no per-user tier.
   */
  readonly siteOnly?: boolean;
}

/**
 * The rows this module owns.
 *
 * **Every default reproduces today's behaviour exactly.** A studio that adopts
 * the cascade must behave identically until an administrator moves a dial —
 * the capabilities default permissive because the permission matrix they extend
 * is default-allow (`./permissions`: "a single-operator studio stays fully open
 * until an administrator says otherwise"), the limits default to `0`, which is
 * this catalog's spelling of "no cap", and `maxAvatarMB` is set equal to the
 * store's existing `AVATAR_IMAGE_MAX`. A catalog that shipped with opinions
 * would lock every member of every existing studio out of something on the day
 * it landed, and nobody would connect the two events.
 */
export const ACCOUNTS_POLICY_ROWS: readonly PolicyRow[] = [
  /* -------------------------------- quotas -------------------------------- */
  {
    key: "storageQuotaMB",
    group: "Quotas",
    label: "Storage quota (MB)",
    hint: "Total bytes this member may occupy across every per-user data root. 0 means no limit. Measured by the storage ledger, which is authoritative only as far back as its last rescan — a member who has never been scanned is not refused, because nothing can honestly say they are over.",
    kind: "number",
    defaultValue: 0,
    min: 0,
    max: 1_048_576,
    step: 1,
  },
  {
    key: "maxUploadMB",
    group: "Quotas",
    label: "Largest single write (MB)",
    hint: "The cap on ONE write, whatever the member's remaining quota. A different question from the quota: this refuses one oversized document, the quota refuses a member who is full. 0 means no per-write cap. Fractions are allowed and are the point on routes whose transport cap is already small — a floor of 1 MB would make this row unable to refuse anything the 64 KB body cap had not refused first.",
    kind: "number",
    defaultValue: 0,
    min: 0,
    max: 4_096,
    step: 0.01,
  },
  {
    key: "maxAvatarMB",
    group: "Quotas",
    label: "Largest avatar (MB)",
    hint: "The per-image cap on an avatar. Its own row rather than a case of the write cap because an avatar is stored INSIDE the profile document and is re-read on every profile render, so its size is paid for far more often than its bytes suggest. Policy NARROWS the store's 256 KB structural cap and never widens it, so the useful range is below the 0.25 default — raising it is inert and the refusal says so.",
    kind: "number",
    defaultValue: 0.25,
    // The floor is well below the structural cap ON PURPOSE. Set equal to it
    // (0.25), this row could only ever be RAISED, raising is inert because the
    // store's own cap still refuses, and the result is a control an
    // administrator can move while nothing whatsoever changes. There is no `0`
    // escape hatch here as there is on the write cap: 0 would mean a zero-byte
    // allowance that refuses every avatar, and "no limit" is already what the
    // structural cap means.
    min: 0.01,
    max: 8,
    step: 0.01,
  },
  {
    key: "maxSessions",
    group: "Quotas",
    label: "Concurrent sessions",
    hint: "How many live app connections this member may hold at once — a second browser, a second machine. 0 means no limit. Counted as open presence streams, which is what being signed in actually costs the server.",
    kind: "number",
    defaultValue: 0,
    min: 0,
    max: 64,
    step: 1,
  },

  /* ----------------------------- capabilities ----------------------------- */
  {
    key: "canMessage",
    group: "Capabilities",
    label: "May send messages",
    hint: "Off, this member reads their conversations but sends nothing. Composed with the permission matrix's own capability of the same name: either saying no is a no.",
    kind: "switch",
    defaultValue: true,
  },
  {
    key: "canEditProfile",
    group: "Capabilities",
    label: "May edit their profile",
    hint: "Off, this member's bio and custom fields are frozen; an administrator can still edit them. Composed with the permission matrix's capability of the same name.",
    kind: "switch",
    defaultValue: true,
  },
  {
    key: "canChangeAvatar",
    group: "Capabilities",
    label: "May change their avatar",
    hint: "Narrower than the row above, and separate because it is a different moderation decision: an avatar is the one part of a profile that appears beside every message this member has ever sent, so it is the part that gets abused first.",
    kind: "switch",
    defaultValue: true,
  },
  {
    key: "canCreateContent",
    group: "Capabilities",
    label: "May create content",
    hint: "The general write grant a module checks before letting this member author something of their own. Off, they keep read access to everything they already have.",
    kind: "switch",
    defaultValue: true,
  },
  {
    key: "canUseAssistant",
    group: "Capabilities",
    label: "May use the AI assistant",
    hint: "Off, assistant surfaces refuse for this member. Separate from the credit ledger on purpose — a balance of zero is a member who has spent theirs, this is a member who was never meant to have any.",
    kind: "switch",
    defaultValue: true,
  },
  {
    key: "canSeeDirectory",
    group: "Capabilities",
    label: "May browse the member directory",
    hint: "Off, this member can still reach people they already know but cannot list everybody. The lever for an account that should not be able to enumerate the roster.",
    kind: "switch",
    defaultValue: true,
  },
  {
    key: "invitesAllowed",
    group: "Capabilities",
    label: "May invite new members",
    hint: "Off, an invitation from this member creates no account. An invite is the one action that adds a ROW to the roster, so it is the one capability whose abuse an administrator has to clean up by hand.",
    kind: "switch",
    defaultValue: true,
  },

  /* ------------------------------ rate limits ----------------------------- */
  {
    key: "messagesPerMinute",
    group: "Rate limits",
    label: "Messages per minute",
    hint: "How fast this member may send. 0 means no cap. A thread is ONE document rewritten per send, so a fast sender costs disk rather than bandwidth — this is the dial that stops one account rewriting a large thread hundreds of times a minute.",
    kind: "number",
    defaultValue: 0,
    min: 0,
    max: 600,
    step: 1,
  },
  {
    key: "loginAttemptsPerHour",
    group: "Rate limits",
    label: "Login attempts per hour",
    hint: "How many sign-in attempts one username may make per hour. 0 means no cap, which is today's behaviour — the door is currently defended by a 400 ms delay alone, so a deployment that faces the internet should set this (30 is a generous human allowance). SITE-WIDE only: it is checked before anybody has proved who they are, so there is no member whose document could be consulted.",
    kind: "number",
    defaultValue: 0,
    min: 0,
    max: 1_000,
    step: 1,
    siteOnly: true,
  },

  /* ----------------------------- account state ---------------------------- */
  {
    key: "suspended",
    group: "Account state",
    label: "Suspended",
    hint: "On, this member cannot sign in and is told why. Distinct from disabling the account: a suspension is stated, dated and reversible, and the member's data is untouched.",
    kind: "switch",
    defaultValue: false,
  },
  {
    key: "suspendedReason",
    group: "Account state",
    label: "Suspension reason",
    hint: "Shown to the member verbatim when they are turned away. Write it as something a person can act on — a refusal with no reason becomes a support ticket the same day.",
    kind: "text",
    defaultValue: "",
  },
  {
    key: "suspendedUntil",
    group: "Account state",
    label: "Suspended until (ISO date)",
    hint: "When the suspension lapses on its own, e.g. 2026-09-01. Empty means indefinite. A date in the PAST means the suspension has already lapsed and the member signs in normally — a timed suspension nobody has to remember to lift is the only kind that gets used.",
    kind: "text",
    defaultValue: "",
  },
  {
    key: "forcePasswordReset",
    group: "Account state",
    label: "Must change password",
    hint: "On, this member's next sign-in lands in the change-password screen. It does NOT refuse the sign-in — a refusal would leave them with no session to change the password with, which is the reason the temp-password flow works the way it does.",
    kind: "switch",
    defaultValue: false,
  },
  {
    key: "loginDisabled",
    group: "Account state",
    label: "Sign-in disabled",
    hint: "On, this member cannot sign in at all, with no date and no reason offered beyond this. The blunt instrument; prefer a suspension, which tells them something.",
    kind: "switch",
    defaultValue: false,
  },
] as const;

/** The native keys, as a union — a typo in a guard is a compile error. */
export type AccountsPolicyKey =
  | "storageQuotaMB"
  | "maxUploadMB"
  | "maxAvatarMB"
  | "maxSessions"
  | "canMessage"
  | "canEditProfile"
  | "canChangeAvatar"
  | "canCreateContent"
  | "canUseAssistant"
  | "canSeeDirectory"
  | "invitesAllowed"
  | "messagesPerMinute"
  | "loginAttemptsPerHour"
  | "suspended"
  | "suspendedReason"
  | "suspendedUntil"
  | "forcePasswordReset"
  | "loginDisabled";

/** The native half of a resolved answer, typed. */
export interface AccountsPolicyValues {
  storageQuotaMB: number;
  maxUploadMB: number;
  maxAvatarMB: number;
  maxSessions: number;
  canMessage: boolean;
  canEditProfile: boolean;
  canChangeAvatar: boolean;
  canCreateContent: boolean;
  canUseAssistant: boolean;
  canSeeDirectory: boolean;
  invitesAllowed: boolean;
  messagesPerMinute: number;
  loginAttemptsPerHour: number;
  suspended: boolean;
  suspendedReason: string;
  suspendedUntil: string;
  forcePasswordReset: boolean;
  loginDisabled: boolean;
}

/**
 * Compile-time pin: the value type has exactly the declared keys. Adding a row
 * without its field (or the reverse) fails HERE, at the type, rather than at
 * the first `undefined` a guard reads at runtime.
 */
type _KeysAgree = [AccountsPolicyKey] extends [keyof AccountsPolicyValues]
  ? [keyof AccountsPolicyValues] extends [AccountsPolicyKey]
    ? true
    : never
  : never;
const _keysAgree: _KeysAgree = true;
void _keysAgree;

/**
 * A fully resolved policy: the native fields, typed, plus whatever rows other
 * modules registered. The index signature is what lets a foreign module read
 * its own key back out without this file knowing the key exists.
 */
export type ResolvedPolicy = AccountsPolicyValues & Record<string, SettingValue>;

/* --------------------------- the foreign-row seam ---------------------------- */

const NATIVE_KEYS = new Set<string>(ACCOUNTS_POLICY_ROWS.map((r) => r.key));

/** Rows contributed by other modules, keyed so a re-registration replaces. */
const FOREIGN = new Map<string, PolicyRow>();

const KEY_RE = /^[a-z][a-zA-Z0-9]*$/;

/**
 * Structural validation of a contributed row, mirroring core's
 * `validateSettingsDecl` rules. Returns problems rather than throwing so the
 * registrar can name whose row failed.
 */
function validatePolicyRow(row: PolicyRow): string[] {
  const at = `policy row "${row.key}"`;
  const problems: string[] = [];
  if (!KEY_RE.test(row.key)) problems.push(`${at}: key must be a camelCase identifier`);
  if (!row.group?.trim()) problems.push(`${at}: group is empty`);
  if (!row.label?.trim()) problems.push(`${at}: label is empty`);
  if (!row.hint?.trim()) problems.push(`${at}: hint is empty — every row states its reason`);

  if (row.kind === "select") {
    if (typeof row.defaultValue !== "string") problems.push(`${at}: a select default must be a string`);
    if (!row.options || row.options.length < 2) problems.push(`${at}: a select needs at least two options`);
    else if (!row.options.some((o) => o.value === row.defaultValue)) {
      problems.push(`${at}: default "${String(row.defaultValue)}" is not among its options`);
    }
  } else {
    if (row.options) problems.push(`${at}: options belong to "select" rows only`);
    const want =
      row.kind === "switch" ? "boolean" : row.kind === "number" ? "number" : "string";
    if (typeof row.defaultValue !== want) {
      problems.push(`${at}: kind "${row.kind}" but default is ${typeof row.defaultValue}`);
    }
  }

  if (row.kind === "number") {
    const hasMin = typeof row.min === "number";
    const hasMax = typeof row.max === "number";
    if (hasMin !== hasMax) problems.push(`${at}: min and max come together or not at all`);
    else if (hasMin && hasMax) {
      if ((row.min as number) >= (row.max as number)) problems.push(`${at}: min must be below max`);
      const d = row.defaultValue as number;
      if (d < (row.min as number) || d > (row.max as number)) {
        problems.push(`${at}: default ${d} is outside [${row.min}, ${row.max}]`);
      }
    }
  } else if (row.min !== undefined || row.max !== undefined || row.step !== undefined) {
    problems.push(`${at}: min/max/step belong to "number" rows only`);
  }
  return problems;
}

/**
 * **The registration seam.** Another module contributes its rows; the editor
 * renders them with no editor change, and the cascade resolves them with no
 * cascade change.
 *
 * A FUNCTION rather than an exported mutable array, which the consuming side
 * (`amberxvid/lib/vault-registration.ts`) already prefers when both are
 * offered, and for the reason it states: a function can validate and an array
 * push cannot. Three things it refuses, each because the silent version is
 * worse than the loud one:
 *
 * 1. **A malformed row** — reported by key, and skipped. A row the editor
 *    cannot render is a control an administrator will look for and not find.
 * 2. **A native key.** A module cannot redefine `storageQuotaMB`; that would
 *    let a plugin rewrite the meaning of the accounts module's own quota.
 * 3. Nothing else — a re-registration REPLACES that module's rows by key, so a
 *    reload cannot end up rendering each one twice.
 *
 * Returns the problems it found (empty on a clean registration) rather than
 * throwing, because a bad row from one module must not take the studio down.
 */
export function registerPolicyRows(rows: readonly PolicyRow[]): string[] {
  const problems: string[] = [];
  for (const row of rows) {
    if (NATIVE_KEYS.has(row.key)) {
      problems.push(`policy row "${row.key}" is owned by the accounts module and cannot be redefined`);
      continue;
    }
    const bad = validatePolicyRow(row);
    if (bad.length > 0) {
      problems.push(...bad);
      continue;
    }
    FOREIGN.set(row.key, row);
  }
  return problems;
}

/** Drop contributed rows by key — for tests and for a module being unwired. */
export function unregisterPolicyRows(keys: readonly string[]): void {
  for (const key of keys) FOREIGN.delete(key);
}

/** The whole catalog: native rows first, then contributed ones. */
export function policyCatalog(): PolicyRow[] {
  return [...ACCOUNTS_POLICY_ROWS, ...FOREIGN.values()];
}

const rowByKey = (key: string): PolicyRow | undefined =>
  ACCOUNTS_POLICY_ROWS.find((r) => r.key === key) ?? FOREIGN.get(key);

/** One row by key, for a refusal that wants to quote its label. */
export const policyRow = rowByKey;

/* ============================== the documents ================================ */

/** An override document. Sparse: only the fields somebody PINNED are present. */
export interface PolicyOverrides {
  version: 1;
  subject: string;
  values: Record<string, SettingValue>;
  updatedAt: string;
}

const norm = (u: string): string => u.trim().toLowerCase();

/** Coerce one stored value onto its row, or drop it. A junk override becomes an
 *  ABSENCE rather than a value — the document is trusted to have been written
 *  by the editor, not to have survived a hand-edit. */
function coerce(row: PolicyRow, raw: unknown): SettingValue | undefined {
  if (row.kind === "switch") return typeof raw === "boolean" ? raw : undefined;
  if (row.kind === "text") return typeof raw === "string" ? raw : undefined;
  if (row.kind === "select") {
    if (typeof raw !== "string") return undefined;
    return row.options?.some((o) => o.value === raw) ? raw : undefined;
  }
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  const min = row.min ?? Number.NEGATIVE_INFINITY;
  const max = row.max ?? Number.POSITIVE_INFINITY;
  const clamped = Math.min(max, Math.max(min, raw));
  // Snap to the row's step, so a fractional row (maxAvatarMB) keeps its
  // hundredths while an integer row cannot end up holding 3.7 sessions.
  //
  // The `toFixed` is not cosmetic: a fractional step is a float, and
  // `Math.round(0.25 / 0.05) * 0.05` is 0.25000000000000006. Stored, that value
  // is not equal to the row's own default, so `setPolicyValue`'s no-op check
  // would miss, the audit would record a change from 0.25 to 0.25, and the
  // editor would render a pin where the member is following. Six places is far
  // beyond any step this catalog allows and well inside float precision.
  const step = row.step ?? 1;
  if (!(step > 0)) return clamped;
  return Number((Math.round(clamped / step) * step).toFixed(6));
}

/** Read one subject's overrides. Absent or junk reads as "nothing pinned",
 *  which is the same answer a fresh install gives — degrade never crash. */
export function readOverrides(subject: string): PolicyOverrides {
  const key = norm(subject);
  const empty: PolicyOverrides = {
    version: 1,
    subject: key,
    values: {},
    updatedAt: new Date(0).toISOString(),
  };
  const raw = readJsonFile<PolicyOverrides>(policyFile(key));
  if (raw?.version !== 1 || typeof raw.values !== "object" || raw.values === null) return empty;

  const values: Record<string, SettingValue> = {};
  for (const [k, v] of Object.entries(raw.values)) {
    const row = rowByKey(k);
    // A key nobody declares is kept OUT of the resolved answer but is NOT
    // deleted from disk: it is almost always a row whose module has not loaded
    // yet, and dropping it would silently discard an administrator's decision
    // because of an import order.
    if (!row) continue;
    const value = coerce(row, v);
    if (value !== undefined) values[k] = value;
  }
  return {
    version: 1,
    subject: key,
    values,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : empty.updatedAt,
  };
}

/** Every row's declared default — the shipped posture, derived, never listed
 *  twice. */
export function policyDefaults(): Record<string, SettingValue> {
  const doc: Record<string, SettingValue> = {};
  for (const row of policyCatalog()) doc[row.key] = row.defaultValue;
  return doc;
}

/* ============================== resolution =================================== */

/** Which tier a resolved value actually came from — what the editor renders as
 *  "following" versus "pinned", and at which level. */
export type PolicyTier = "default" | "site" | "user";

export interface PolicyDetail {
  subject: string;
  /** The resolved answer, every key present. */
  values: ResolvedPolicy;
  /** key → the tier that supplied it. */
  tiers: Record<string, PolicyTier>;
  /** The catalog, so a surface renders labels/hints without a second call. */
  rows: PolicyRow[];
  /** What the site tier holds, for an editor showing "the default is X". */
  site: Record<string, SettingValue>;
}

/**
 * Resolve one subject through the whole cascade, and say where each value came
 * from. The editor's read; {@link effectivePolicy} is the guards' read.
 *
 * The two capability rows that overlap the grants record are composed HERE, so
 * a caller cannot accidentally read the un-composed value: there is one
 * resolved document and it already holds the true answer.
 */
export async function policyDetail(username: string): Promise<PolicyDetail> {
  const subject = norm(username);
  const rows = policyCatalog();
  const values: Record<string, SettingValue> = {};
  const tiers: Record<string, PolicyTier> = {};

  const site = readOverrides(SITE_POLICY_SUBJECT).values;
  const user = subject === SITE_POLICY_SUBJECT ? {} : readOverrides(subject).values;

  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(user, row.key)) {
      values[row.key] = user[row.key];
      tiers[row.key] = "user";
    } else if (Object.prototype.hasOwnProperty.call(site, row.key)) {
      values[row.key] = site[row.key];
      tiers[row.key] = "site";
    } else {
      values[row.key] = row.defaultValue;
      tiers[row.key] = "default";
    }
  }

  // The overlap, composed. Deny wins; see the header. Skipped for the site
  // pseudo-subject, which is not a member and has no grants record.
  if (subject !== SITE_POLICY_SUBJECT) {
    const grants = await effectivePermissions(subject);
    for (const key of ["canMessage", "canEditProfile"] as const) {
      if (values[key] === true && grants[key] === false) {
        values[key] = false;
        // The grants record is the tier that actually refused, and an editor
        // showing "following the default" beside a member who cannot message
        // would be wrong. `user` is the honest tier: it is a per-user decision.
        tiers[key] = "user";
      }
    }
  }

  return { subject, values: values as ResolvedPolicy, tiers, rows, site };
}

/**
 * **THE resolved answer for one member** — the read every guard and every
 * consuming module makes.
 *
 * This is the function `amberxvid/lib/vault-registration.ts` names as the
 * accounts policy seam (`effectivePolicy(user)`), and its shape is that seam's:
 * a flat record carrying `storageQuotaMB` alongside every other resolved key.
 * One function because it is one question — a module asking the cascade twice
 * for two subsets of one document is two chances to disagree.
 */
export async function effectivePolicy(username: string): Promise<ResolvedPolicy> {
  return (await policyDetail(username)).values;
}

/**
 * **The read-through to the permission matrix.** Both halves of "what may this
 * member do" in one call, so the admin suite renders one screen — and neither
 * store has been merged into the other.
 *
 * See the header for why they are separate. The shape says it too: `access` is
 * the matrix's own verdict type, handed over unchanged, so this file cannot
 * quietly become a second place module access is decided.
 */
export async function policyWithAccess(
  username: string,
): Promise<{ policy: PolicyDetail; access: EffectivePermissions }> {
  const [policy, access] = await Promise.all([
    policyDetail(username),
    effectivePermissions(username),
  ]);
  return { policy, access };
}

/** The three suspension rows, composed into the object the step describes.
 *  Three ROWS because the editor is generic over scalars; one OBJECT here
 *  because "suspended until when, and why" is one fact. */
export function suspensionOf(values: ResolvedPolicy): {
  on: boolean;
  reason: string;
  until: string | null;
  /** True when `until` is set and already past — the suspension has lapsed. */
  lapsed: boolean;
} {
  const until = values.suspendedUntil.trim();
  const when = until ? Date.parse(until) : NaN;
  // An unparseable date is treated as INDEFINITE, not as lapsed: a typo in a
  // date must not quietly un-suspend somebody.
  const lapsed = Number.isFinite(when) && when <= Date.now();
  return { on: values.suspended, reason: values.suspendedReason.trim(), until: until || null, lapsed };
}

/* ================================ mutation =================================== */

export type PolicyWriteResult =
  | { ok: true; subject: string; key: string; from?: SettingValue; to?: SettingValue }
  | { ok: false; error: string; status: number };

const deny = (status: number, error: string): PolicyWriteResult => ({ ok: false, error, status });

/** Admin gate + subject resolution, shared by both writers. The site tier is a
 *  legal subject and is NOT looked up as an account. */
async function gateWrite(
  actor: string,
  subject: string,
): Promise<{ ok: true; actor: string; subject: string; account: Account | null } | PolicyWriteResult> {
  const gate = await requireAdmin(actor);
  if (!gate.ok) return deny(gate.status, gate.error);
  const key = norm(subject);
  if (key === SITE_POLICY_SUBJECT) {
    return { ok: true, actor: gate.account.username, subject: key, account: null };
  }
  const account = await findAccount(key);
  if (!account) return deny(404, "no such account");
  return { ok: true, actor: gate.account.username, subject: norm(account.username), account };
}

/**
 * The lock-out guard, mirroring `updateUser`'s in `./accounts` verbatim in
 * shape: **you cannot suspend or disable sign-in for your own account.**
 *
 * Same reasoning as there — only an administrator can undo it, so an
 * administrator who does it to themselves has stranded the store. Another
 * administrator still can, which is what keeps a rogue administrator
 * suspendable; this only refuses the one case nobody can recover from.
 */
const SELF_LOCKOUT_KEYS = new Set<string>(["suspended", "loginDisabled"]);

function selfLockout(actor: string, subject: string, key: string, to: SettingValue | undefined): string | null {
  if (norm(actor) !== norm(subject)) return null;
  if (!SELF_LOCKOUT_KEYS.has(key)) return null;
  // Clearing it, or setting it false, is always allowed — that is the recovery.
  if (to === false || to === undefined) return null;
  return `you cannot ${key === "suspended" ? "suspend" : "disable sign-in for"} your own account — another administrator must`;
}

/**
 * **Pin one field.** Admin-only, validated against the row, written under the
 * subject's own lock, and audited with old → new.
 *
 * The whole read-modify-write is inside the lock, never just the save — the
 * lesson `.claude/rules/concurrent-builds.md` records, and the reason two
 * administrators editing the same member cannot lose each other's field.
 */
export async function setPolicyValue(
  actor: string,
  subject: string,
  key: string,
  value: SettingValue,
): Promise<PolicyWriteResult> {
  const row = rowByKey(key);
  if (!row) return deny(400, `"${key}" is not a policy row`);

  const gate = await gateWrite(actor, subject);
  if (!("account" in gate)) return gate;

  if (row.siteOnly && gate.subject !== SITE_POLICY_SUBJECT) {
    return deny(
      400,
      `"${row.label}" is a site-wide row and has no per-user override — set it on the site posture instead`,
    );
  }

  const coerced = coerce(row, value);
  if (coerced === undefined) {
    return deny(400, `${JSON.stringify(value)} is not a valid value for "${row.label}"`);
  }
  const lockout = selfLockout(gate.actor, gate.subject, key, coerced);
  if (lockout) return deny(409, lockout);

  return withStoreLock(`policy-${gate.subject}`, async () => {
    const doc = readOverrides(gate.subject);
    const from = Object.prototype.hasOwnProperty.call(doc.values, key) ? doc.values[key] : undefined;
    if (from === coerced) {
      // A no-op is a clean success and is NOT audited — an audit trail padded
      // with lines where nothing moved is one nobody reads.
      return { ok: true, subject: gate.subject, key, from, to: coerced } as PolicyWriteResult;
    }
    doc.values[key] = coerced;
    doc.updatedAt = new Date().toISOString();
    await writeJsonAtomic(policyFile(gate.subject), doc);
    await auditFieldChange({
      actor: gate.actor,
      subject: gate.subject,
      field: key,
      from,
      to: coerced,
      file: policyFile(gate.subject),
    });
    return { ok: true, subject: gate.subject, key, from, to: coerced } as PolicyWriteResult;
  });
}

/**
 * **Un-pin one field** — this subject goes back to FOLLOWING the tier above,
 * including as that tier changes. The other half of the absent-vs-pinned
 * distinction, and the reason the editor needs a control that is not "set it
 * to the default's current value": those two produce identical documents today
 * and diverge the day the default moves.
 */
export async function clearPolicyValue(
  actor: string,
  subject: string,
  key: string,
): Promise<PolicyWriteResult> {
  if (!rowByKey(key)) return deny(400, `"${key}" is not a policy row`);
  const gate = await gateWrite(actor, subject);
  if (!("account" in gate)) return gate;

  return withStoreLock(`policy-${gate.subject}`, async () => {
    const doc = readOverrides(gate.subject);
    if (!Object.prototype.hasOwnProperty.call(doc.values, key)) {
      return { ok: true, subject: gate.subject, key, from: undefined, to: undefined } as PolicyWriteResult;
    }
    const from = doc.values[key];
    delete doc.values[key];
    doc.updatedAt = new Date().toISOString();
    await writeJsonAtomic(policyFile(gate.subject), doc);
    await auditFieldChange({
      actor: gate.actor,
      subject: gate.subject,
      field: key,
      from,
      to: undefined,
      file: policyFile(gate.subject),
    });
    return { ok: true, subject: gate.subject, key, from, to: undefined } as PolicyWriteResult;
  });
}

/**
 * **The one write that is not admin-gated**, and the narrow reason it exists.
 *
 * `forcePasswordReset` sends a member into the change-password screen. Nothing
 * would ever take them back out of it: they cannot clear their own policy pin
 * (this is an administrator's catalog), so the flag they have just satisfied
 * would send them straight back on the next sign-in, forever. That is a loop,
 * not a policy.
 *
 * So this is called by the change-password path AFTER the member has re-proved
 * their current password — the same proof `changePassword` itself demands, on
 * the grounds that possession of a session alone never rewrites a credential.
 * Three things keep it safe to expose:
 *
 * 1. **It touches exactly one row**, by name, and no argument can change which.
 * 2. **It only ever relaxes**, never grants — the resulting value is `false`.
 * 3. **It is audited like every other write**, with `system` as the actor, so
 *    an administrator reading the trail sees the flag being satisfied rather
 *    than finding it silently gone.
 *
 * When the pin came from the SITE tier, clearing the member's own field is not
 * enough — they would still resolve `true` and loop. A user-level `false` is
 * written instead, which is the honest record ("this member has done it") and
 * is visible in the editor as a pin an administrator can undo.
 */
export async function clearForcedPasswordReset(username: string): Promise<void> {
  const subject = norm(username);
  if (subject === SITE_POLICY_SUBJECT) return;
  const key = "forcePasswordReset";

  await withStoreLock(`policy-${subject}`, async () => {
    const doc = readOverrides(subject);
    const from = Object.prototype.hasOwnProperty.call(doc.values, key) ? doc.values[key] : undefined;
    const site = readOverrides(SITE_POLICY_SUBJECT).values[key] === true;
    const to: SettingValue | undefined = site ? false : undefined;

    if (from === to) return;
    if (to === undefined) delete doc.values[key];
    else doc.values[key] = to;
    doc.updatedAt = new Date().toISOString();
    await writeJsonAtomic(policyFile(subject), doc);
    await auditFieldChange({
      actor: "system",
      subject,
      field: key,
      from,
      to,
      file: policyFile(subject),
    });
  });
}

/* ================================ verdicts =================================== */

/**
 * What a guard answers.
 *
 * A refusal carries the ROW and the effective VALUE as data, not only inside
 * the sentence: the sentence is for the member, the fields are for the
 * administrator who gets asked about it ten minutes later. "You may not do
 * this", with no row named, is an admin ticket.
 */
export type PolicyVerdict =
  | { ok: true }
  | { ok: false; error: string; status: number; row: string; value: SettingValue };

const refuseSwitch = (key: string, what: string): PolicyVerdict => ({
  ok: false,
  status: 403,
  row: key,
  value: false,
  error:
    `${what} — an administrator has turned "${rowByKey(key)?.label ?? key}" off for this ` +
    `account (policy \`${key}\`). Ask them to turn it back on.`,
});

/* ------------------------------ capabilities ---------------------------------- */

/** The capability rows a guard may be asked about by name. */
export type CapabilityKey =
  | "canMessage"
  | "canEditProfile"
  | "canChangeAvatar"
  | "canCreateContent"
  | "canUseAssistant"
  | "canSeeDirectory"
  | "invitesAllowed";

/** The refusal sentence each capability gets. Written per row rather than
 *  generated from the label, because a refusal a person reads should be in the
 *  second person and a label is a noun phrase. */
const CAPABILITY_SENTENCE: Record<CapabilityKey, string> = {
  canMessage: "you cannot send messages",
  canEditProfile: "you cannot edit this profile",
  canChangeAvatar: "you cannot change this avatar",
  canCreateContent: "you cannot create content",
  canUseAssistant: "you cannot use the assistant",
  canSeeDirectory: "you cannot browse the member directory",
  invitesAllowed: "you cannot invite new members",
};

/**
 * ONE capability guard for all seven rows, so a new capability is a row plus a
 * sentence rather than a new function nobody calls.
 *
 * Three of the seven — `canCreateContent`, `canUseAssistant` and
 * `invitesAllowed` — have **no enforcement point inside this module**: their
 * consumers are the module assistant plugin, the invite path in amberxvid, and
 * whatever authors content. Those live behind their own routes and this file
 * imports no other module, so the guard is offered and called from there, the
 * same way amberxvid's own rows are enforced in amberxvid. That is stated
 * rather than left to be discovered: a row nothing calls is a row an
 * administrator will set and watch do nothing.
 */
export async function assertCapability(
  username: string,
  key: CapabilityKey,
): Promise<PolicyVerdict> {
  const policy = await effectivePolicy(username);
  return policy[key] ? { ok: true } : refuseSwitch(key, CAPABILITY_SENTENCE[key]);
}

/* --------------------------------- the door ----------------------------------- */

/**
 * What the login door does with this member.
 *
 * Three outcomes, not two, and the third is the one that matters: a member who
 * must change their password is **let in with a forced flow**, never refused.
 * Refusing would leave them with no session to change the password WITH, which
 * is exactly why the temp-password flow already works that way
 * (`app/api/accounts/session/route.ts`).
 */
export type LoginGate =
  | { verdict: "allow" }
  | { verdict: "force-password-change"; reason: string }
  | { verdict: "refuse"; error: string; status: number; row: string; until: string | null };

/**
 * The policy half of the sign-in door.
 *
 * **Called only AFTER the password has been verified**, and that placement is
 * load-bearing. A suspension notice handed to somebody who has not proved they
 * own the account is an enumeration oracle: it distinguishes "this name exists
 * and is suspended" from "no such name", which the shared 400 ms delay and the
 * dummy-hash burn in `verifyLogin` exist to make indistinguishable. Once the
 * password is right, the caller IS the member and telling them why they are
 * being turned away costs nothing and saves a support ticket.
 *
 * The one case that placement does not serve is a MIGRATED account with no
 * usable password at all; that member never reaches here. They are already
 * served by `countForcedResets()` on the login card, which answers with a
 * count rather than a name for this same reason.
 */
export async function loginGate(username: string): Promise<LoginGate> {
  const values = await effectivePolicy(username);

  if (values.loginDisabled) {
    return {
      verdict: "refuse",
      status: 403,
      row: "loginDisabled",
      until: null,
      error: "sign-in is disabled for this account. An administrator has to re-enable it.",
    };
  }

  const suspension = suspensionOf(values);
  if (suspension.on && !suspension.lapsed) {
    const until = suspension.until;
    const when = until ? ` until ${until}` : " indefinitely";
    const why = suspension.reason ? ` — ${suspension.reason}` : "";
    return {
      verdict: "refuse",
      status: 403,
      row: "suspended",
      until,
      error: `this account is suspended${when}${why}.`,
    };
  }

  if (values.forcePasswordReset) {
    return {
      verdict: "force-password-change",
      reason: "an administrator has asked you to choose a new password before continuing.",
    };
  }

  return { verdict: "allow" };
}

/* ------------------------------- rate limits ---------------------------------- */

/**
 * Sliding-window counters, IN MEMORY and per process.
 *
 * That is a deliberate limit, not an oversight. A rate limiter that wrote to
 * disk would cost a read-modify-write on the hot path of the very action it is
 * throttling, which is a worse denial of service than the one it prevents. The
 * studio runs as one Node process (`presence.ts` keeps its whole connection
 * registry the same way, for the same reason), so per-process IS site-wide
 * here; a future multi-process deployment needs a shared counter and this is
 * the note that says so.
 *
 * Timestamps are pruned on every touch and empty keys are dropped, so the map
 * is bounded by the number of members active within one window rather than by
 * the number that have ever acted.
 */
const WINDOWS = new Map<string, number[]>();

function windowHit(
  key: string,
  windowMs: number,
  limit: number,
): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  const cutoff = now - windowMs;
  const kept = (WINDOWS.get(key) ?? []).filter((t) => t > cutoff);
  if (kept.length >= limit) {
    // The oldest hit in the window is what has to age out before there is room.
    const retryAfterSec = Math.max(1, Math.ceil((kept[0] + windowMs - now) / 1000));
    WINDOWS.set(key, kept);
    return { ok: false, retryAfterSec };
  }
  kept.push(now);
  WINDOWS.set(key, kept);
  return { ok: true };
}

/** Forget a member's counters — used when an account is removed, and by tests. */
export function forgetRateWindows(username: string): void {
  const suffix = `:${norm(username)}`;
  for (const key of [...WINDOWS.keys()]) {
    if (key.endsWith(suffix)) WINDOWS.delete(key);
  }
}

/**
 * Count one send against `messagesPerMinute`.
 *
 * **Counts only when it allows.** A refused send did not rewrite the thread,
 * so charging it would let a client that keeps retrying extend its own
 * lock-out indefinitely — a limiter that punishes the retry rather than the
 * work is one that never lets anybody back in.
 */
export async function assertMessageRate(username: string): Promise<PolicyVerdict> {
  const limit = (await effectivePolicy(username)).messagesPerMinute;
  if (limit <= 0) return { ok: true };
  const hit = windowHit(`msg:${norm(username)}`, 60_000, limit);
  if (hit.ok) return { ok: true };
  return {
    ok: false,
    status: 429,
    row: "messagesPerMinute",
    value: limit,
    error: `you are sending too fast — your limit is ${limit} message${limit === 1 ? "" : "s"} a minute. Try again in ${hit.retryAfterSec}s.`,
  };
}

/**
 * Count one sign-in attempt against `loginAttemptsPerHour`.
 *
 * Reads the **SITE tier only** — see {@link PolicyRow.siteOnly}: this runs
 * before anybody has proved who they are, so there is no member whose document
 * could honestly be consulted, and consulting one named by an unauthenticated
 * string would be both an oracle and an attacker-chosen disk read.
 *
 * Counts EVERY attempt, unlike the message limiter, because here the attempt
 * itself is the thing being limited — that is what a login limiter is.
 */
export function assertLoginRate(username: string): PolicyVerdict {
  const site = readOverrides(SITE_POLICY_SUBJECT).values;
  const declared = ACCOUNTS_POLICY_ROWS.find((r) => r.key === "loginAttemptsPerHour");
  const raw = site.loginAttemptsPerHour ?? declared?.defaultValue ?? 0;
  const limit = typeof raw === "number" ? raw : 0;
  if (limit <= 0) return { ok: true };
  const hit = windowHit(`login:${norm(username)}`, 3_600_000, limit);
  if (hit.ok) return { ok: true };
  return {
    ok: false,
    status: 429,
    row: "loginAttemptsPerHour",
    value: limit,
    error: `too many sign-in attempts for that account. Try again in ${Math.ceil(hit.retryAfterSec / 60)} minute(s).`,
  };
}

/* --------------------------------- sessions ----------------------------------- */

/**
 * Is there room for one more live connection? `current` is how many the member
 * holds RIGHT NOW, passed in rather than read here, so this file needs no
 * import of the presence registry and a test can exercise the refusal with a
 * number.
 */
export async function assertSessionSlot(username: string, current: number): Promise<PolicyVerdict> {
  const limit = (await effectivePolicy(username)).maxSessions;
  if (limit <= 0 || current < limit) return { ok: true };
  return {
    ok: false,
    status: 409,
    row: "maxSessions",
    value: limit,
    error: `you already have ${current} session${current === 1 ? "" : "s"} open and your limit is ${limit}. Sign out somewhere else and try again.`,
  };
}

/* ---------------------------------- avatars ----------------------------------- */

const MB = 1024 * 1024;

/**
 * Is this avatar within the member's cap?
 *
 * `structuralCapBytes` is the STORE's own hard limit (`AVATAR_IMAGE_MAX`, 256
 * KB). Policy **narrows** it and never widens it, and the refusal names
 * whichever one actually bit — an administrator who allowed 4 MB on a store
 * that caps at 256 KB needs to be told it was the store, not their row, or
 * they will raise the row again.
 */
export async function assertAvatarBytes(
  username: string,
  bytes: number,
  structuralCapBytes: number,
): Promise<PolicyVerdict> {
  const policyMB = (await effectivePolicy(username)).maxAvatarMB;
  const policyBytes = policyMB * MB;
  if (bytes <= Math.min(policyBytes, structuralCapBytes)) return { ok: true };
  const asMB = (bytes / MB).toFixed(2);
  if (policyBytes < structuralCapBytes) {
    return {
      ok: false,
      status: 413,
      row: "maxAvatarMB",
      value: policyMB,
      error: `that avatar is ${asMB} MB and your limit is ${policyMB} MB (policy \`maxAvatarMB\`). Ask an administrator to raise it.`,
    };
  }
  return {
    ok: false,
    status: 413,
    row: "maxAvatarMB",
    value: policyMB,
    error:
      `that avatar is ${asMB} MB and this studio caps avatars at ` +
      `${Math.round(structuralCapBytes / 1024)} KB — a store limit, below your ${policyMB} MB ` +
      `policy allowance, so raising the policy will not help.`,
  };
}

/* ---------------------------------- storage ----------------------------------- */

/** A storage refusal carries the ledger's own verdict, so the caller can put it
 *  in the response — "you are over quota" without the numbers is a message a
 *  member cannot act on. */
export type StorageGuard =
  | { ok: true; verdict: StorageVerdict }
  | { ok: false; error: string; status: number; row: string; value: SettingValue; verdict: StorageVerdict };

/**
 * **The per-user storage write guard.** Two questions, in the order that makes
 * the cheaper refusal first:
 *
 * 1. Is this ONE write bigger than `maxUploadMB`? Answered without touching the
 *    ledger at all.
 * 2. Would it put the member over `storageQuotaMB`? Answered by P1's
 *    {@link checkQuota}, whose verdict is handed back verbatim.
 *
 * **A member with no index is ALLOWED**, and the verdict says so. P1's contract
 * is explicit that `no-index` is an honest answer rather than an error, and
 * that the caller decides what an unmeasured member may do — refusing everybody
 * who has never been rescanned would mean a fresh studio in which nobody can
 * save anything until an administrator finds the reconcile button. The verdict
 * travels in the response so the surface can say the number is unmeasured
 * rather than implying it was checked.
 */
export async function guardStorageWrite(username: string, wantBytes: number): Promise<StorageGuard> {
  const want = Math.max(0, Math.round(Number(wantBytes) || 0));
  const values = await effectivePolicy(username);

  const uploadMB = values.maxUploadMB;
  if (uploadMB > 0 && want > uploadMB * MB) {
    return {
      ok: false,
      status: 413,
      row: "maxUploadMB",
      value: uploadMB,
      error: `that is ${(want / MB).toFixed(2)} MB and single writes are capped at ${uploadMB} MB for this account (policy \`maxUploadMB\`).`,
      verdict: { kind: "no-index", wantBytes: want },
    };
  }

  const quotaMB = values.storageQuotaMB;
  const limitBytes = quotaMB > 0 ? Math.round(quotaMB * MB) : null;
  const verdict = await checkQuota(username, want, limitBytes);

  if (verdict.kind === "over-quota") {
    return {
      ok: false,
      status: 507,
      row: "storageQuotaMB",
      value: quotaMB,
      error:
        `that would put you ${(verdict.overBy / MB).toFixed(2)} MB over your ${quotaMB} MB storage ` +
        `quota (policy \`storageQuotaMB\`; using ${(verdict.usedBytes / MB).toFixed(2)} MB). ` +
        `Delete something, or ask an administrator to raise it.`,
      verdict,
    };
  }
  return { ok: true, verdict };
}
