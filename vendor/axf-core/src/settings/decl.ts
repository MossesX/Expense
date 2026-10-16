/**
 * @file The module-settings declaration — settings as DATA on the module
 * contract, the way `menus` and `nav` already are.
 *
 * This closes the gap `module.ts`'s own header has named since 0.0.1:
 * *"persisted settings (a module needs a value to survive reload)"*. Four
 * modules answered it by hand — four structurally identical `SettingsStore`
 * classes over four `localStorage` keys, each with its own `SETTING_ROWS`
 * array and its own `Dialog` — and every one of their docblocks says a
 * framework should replace it (`TaskmanSui.tsx`: *"When AmberX grows a
 * shell-owned sui affordance, this button is what gets deleted"*). This is
 * that framework.
 *
 * ── THE CEILING STANDS ────────────────────────────────────────────────────────
 *
 * Standing owner directive (2026-08-11, `.claude/rules/amberx-bound-builds.md`):
 * suis are MINIMAL — a setting earns its place only when the surface cannot
 * work properly without it. This file makes declaring a setting cheap; it does
 * not make declaring one free. None of GizmoX's contract comes across: no
 * `chromeGroup()`, no override cascade, no cui, no level/ceiling machinery.
 * A decl is rows; a row is one value with a label and a reason.
 *
 * ── NODE LEAF ─────────────────────────────────────────────────────────────────
 *
 * Like `ctx/menus.ts` and `nav/types.ts`, this file is imported by the closure
 * resolver under plain Node with native type stripping, where extensionless
 * relative RUNTIME imports do not resolve. It therefore imports NOTHING. The
 * kv-name pattern is restated here as a literal rather than imported from
 * `persist/kv.ts` for exactly that reason — the two regexes are pinned equal
 * by test rather than by an import edge Node cannot follow.
 */

/** What a settings value can be. Deliberately scalar — a setting that needs a
 *  structure is a document, and documents belong to the module's own store. */
export type SettingValue = boolean | number | string;

export type SettingKind = "switch" | "number" | "text" | "select";

export interface SettingOption {
  readonly value: string;
  readonly label: string;
}

/**
 * One setting: one value, one control, declared once so the surface cannot
 * show a control the store does not have, or miss one it does — the exact
 * property the four hand-rolled `SETTING_ROWS` arrays each maintained alone.
 */
export interface SettingRow {
  /** Stable key inside the module's namespace. Identifier-shaped. */
  readonly key: string;
  readonly label: string;
  /** WHY this is a setting — the ceiling makes every row justify itself. */
  readonly hint: string;
  readonly kind: SettingKind;
  readonly defaultValue: SettingValue;
  /** `number` only. Both required when either appears — an unbounded dial is
   *  a typo amplifier, not a freedom. */
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** `select` only: the closed set of values. */
  readonly options?: readonly SettingOption[];
  /**
   * A named GATE deciding whether this row is offered at all (`settings/
   * gates.ts`). A NAME rather than a predicate function for the reason every
   * other behaviour in this codebase is a name: a decl is data, read by the
   * closure resolver under plain Node, and a closure here would make the row
   * uneditable except by editing this file.
   *
   * Unregistered gates FAIL OPEN — the row shows. Hiding a row is not a
   * security boundary here any more than a hidden nav row was; whatever the
   * setting controls refuses on its own terms.
   */
  readonly gate?: string;
}

export interface ModuleSettingsDecl {
  /**
   * The kv namespace this module's settings persist under. Conventionally
   * `<moduleId>-settings`. Must satisfy the kv name rule below — the same
   * fence `persist/kv.ts` holds, restated because this is a Node leaf.
   */
  readonly ns: string;
  /**
   * What to call this owner in the dialog's heading. Optional, and only ever
   * needed by an owner that is NOT a module: `SettingsDialog` asks the module
   * registry first, which is the right answer for the four modules this was
   * built for and no answer at all for a PLUGIN — the tab bar's dialog headed
   * itself "tab-bar settings" until this existed. A module that supplies it
   * anyway is overriding its own registered title, so the dialog prefers the
   * registry and falls back here.
   */
  readonly title?: string;
  readonly rows: readonly SettingRow[];
}

/** Mirrors `isKvName` in `persist/kv.ts`; `settings-decl.test.ts` pins them equal. */
const KV_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

const KEY_RE = /^[a-z][a-zA-Z0-9]*$/;

function kindOf(v: SettingValue): SettingKind | "other" {
  switch (typeof v) {
    case "boolean":
      return "switch";
    case "number":
      return "number";
    case "string":
      return "text"; // `select` defaults are also strings; checked separately
    default:
      return "other";
  }
}

/**
 * Structural validation, pure, callable from `defineModule` and from the
 * closure resolver alike. Returns problems rather than throwing so a caller
 * can prefix them with WHOSE they are.
 */
export function validateSettingsDecl(ownerId: string, decl: ModuleSettingsDecl): string[] {
  const problems: string[] = [];
  if (!KV_NAME_RE.test(decl.ns)) {
    problems.push(`settings ns "${decl.ns}" is not a valid kv namespace`);
  }
  if (!decl.rows.length) {
    problems.push(`"${ownerId}" declares settings with zero rows — omit the field instead`);
  }
  if (decl.title !== undefined && !decl.title.trim()) {
    problems.push(`"${ownerId}" declares an empty settings title — omit the field instead`);
  }
  const seen = new Set<string>();
  for (const row of decl.rows) {
    const at = `settings row "${row.key}"`;
    if (!KEY_RE.test(row.key)) problems.push(`${at}: key must be a camelCase identifier`);
    if (seen.has(row.key)) problems.push(`${at}: declared twice`);
    seen.add(row.key);
    if (!row.label.trim()) problems.push(`${at}: label is empty`);
    if (!row.hint.trim()) {
      problems.push(`${at}: hint is empty — the ceiling makes every row state its reason`);
    }
    if (row.gate !== undefined && (!row.gate.trim() || /\s/.test(row.gate))) {
      problems.push(`${at}: gate must be a non-empty name with no whitespace`);
    }
    const valueKind = kindOf(row.defaultValue);
    if (row.kind === "select") {
      if (typeof row.defaultValue !== "string") {
        problems.push(`${at}: a select default must be a string`);
      }
      if (!row.options || row.options.length < 2) {
        problems.push(`${at}: a select needs at least two options`);
      } else if (!row.options.some((o) => o.value === row.defaultValue)) {
        problems.push(`${at}: default "${String(row.defaultValue)}" is not among its options`);
      }
      const optSeen = new Set<string>();
      for (const opt of row.options ?? []) {
        if (optSeen.has(opt.value)) problems.push(`${at}: option "${opt.value}" declared twice`);
        optSeen.add(opt.value);
      }
    } else {
      if (valueKind !== row.kind) {
        problems.push(`${at}: kind "${row.kind}" but default is ${typeof row.defaultValue}`);
      }
      if (row.options) problems.push(`${at}: options belong to "select" rows only`);
    }
    if (row.kind === "number") {
      const hasMin = typeof row.min === "number";
      const hasMax = typeof row.max === "number";
      if (hasMin !== hasMax) {
        problems.push(`${at}: min and max come together or not at all`);
      } else if (hasMin && hasMax) {
        if ((row.min as number) >= (row.max as number)) {
          problems.push(`${at}: min must be below max`);
        }
        const d = row.defaultValue as number;
        if (d < (row.min as number) || d > (row.max as number)) {
          problems.push(`${at}: default ${d} is outside [${row.min}, ${row.max}]`);
        }
      }
    } else if (row.min !== undefined || row.max !== undefined || row.step !== undefined) {
      problems.push(`${at}: min/max/step belong to "number" rows only`);
    }
  }
  return problems;
}

/** The default document a decl resolves to — every row's declared default. */
export function settingsDefaults(decl: ModuleSettingsDecl): Record<string, SettingValue> {
  const doc: Record<string, SettingValue> = {};
  for (const row of decl.rows) doc[row.key] = row.defaultValue;
  return doc;
}
