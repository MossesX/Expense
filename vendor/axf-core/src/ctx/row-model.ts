/**
 * @file What a row LOOKS like and what it will DO — decided once, in one pure
 * function, before anything is drawn.
 *
 * `CtxItem` is what the resolver produced. {@link RowModel} is what the
 * renderer needs: can this row take focus, can it run, is it a flyout, which
 * tone is it, and — the field this whole package keeps circling back to — what
 * does it say about why it cannot run.
 *
 * ── WHY THIS IS NOT INSIDE THE COMPONENT ─────────────────────────────────────
 *
 * P2's gate includes *a disabled row states why*. Inside a `.tsx` that is only
 * checkable by looking at the screen, and "we looked at it" is the kind of proof
 * `.claude/rules/autonomy-and-verification.md` names as the one that gets
 * skipped. Here it is a value, so the test asserts that a disabled row's model
 * carries its reason, that no row is ever both inert and silent, and that
 * `danger` resolves to the error tone — none of which needs a DOM.
 *
 * It is the same doctrine as the rest of the package: put the guarantee on the
 * chokepoint. `ContextMenu.tsx` has exactly one way to turn an item into a row,
 * and it is this function.
 *
 * ── THE ONE RULE ─────────────────────────────────────────────────────────────
 *
 * **A row that cannot run always says why.** `CtxItem.disabledReason` already
 * makes the ordinary case unrepresentable-without-a-reason. What it does not
 * cover is the row that is inert for a *structural* reason — an acting role
 * that reached the renderer with no command, which is a defect in the map
 * rather than a state of the world. That row gets a synthesised reason naming
 * the defect rather than being silently drawn as live and doing nothing when
 * clicked, because those two are indistinguishable to the person clicking and
 * only one of them is honest.
 */
import type { CtxItem } from "./types";

/**
 * How a row is coloured. A NAME, not a colour — the component maps it through
 * `token()`, so this file stays free of both CSS and the theme.
 */
export type RowTone = "normal" | "danger" | "disabled" | "structural";

export interface RowModel {
  readonly item: CtxItem;
  /** Reachable by the arrow keys. Disabled rows ARE — see below. */
  readonly focusable: boolean;
  /** Activating it runs a command. Mutually exclusive with {@link submenu}. */
  readonly runnable: boolean;
  /** Activating it opens a flyout. */
  readonly submenu: boolean;
  readonly separator: boolean;
  readonly header: boolean;
  readonly tone: RowTone;
  readonly label: string;
  /** Why it cannot run. Never null on a focusable row that is not runnable. */
  readonly reason: string | null;
  /** A `toggle`'s state; null on every other role. */
  readonly checked: boolean | null;
  readonly children: readonly CtxItem[];
}

/**
 * The theme token each tone paints with.
 *
 * `disabled` is `dim` rather than `ink` at low opacity, because opacity fades
 * the reason text too and the reason is the only thing making the greyed row
 * useful.
 */
export function toneToken(tone: RowTone): string {
  switch (tone) {
    case "danger":
      return "err";
    case "disabled":
    case "structural":
      return "dim";
    default:
      return "ink";
  }
}

/**
 * Compile one resolved item into the row the renderer draws.
 *
 * **Disabled rows are focusable, deliberately.** The obvious reading — skip
 * them, they cannot be actioned — makes the reason unreachable from the
 * keyboard, so a keyboard user gets the pre-`disabledReason` experience this
 * package exists to abolish: a row that is there, is inert, and will not say
 * why. They take focus and refuse to run, which is also what the ARIA menu
 * pattern prescribes (`aria-disabled`, not removal from the focus ring).
 */
export function rowModel(item: CtxItem): RowModel {
  const role = item.role ?? "normal";

  if (role === "separator") {
    return {
      item,
      focusable: false,
      runnable: false,
      submenu: false,
      separator: true,
      header: false,
      tone: "structural",
      label: "",
      reason: null,
      checked: null,
      children: []
    };
  }

  if (role === "header") {
    return {
      item,
      focusable: false,
      runnable: false,
      submenu: false,
      separator: false,
      header: true,
      tone: "structural",
      label: item.label,
      reason: null,
      checked: null,
      children: []
    };
  }

  if (role === "submenu") {
    const children = item.items ?? [];
    // The resolver already drops a submenu whose every child was filtered out
    // (`compose.ts`), so an empty one here means a hand-built item rather than
    // a composed one. It still must not open on nothing: greyed with the reason
    // is the same answer this file gives every other inert row.
    const empty = children.length === 0;
    return {
      item,
      focusable: true,
      runnable: false,
      submenu: !empty,
      separator: false,
      header: false,
      tone: empty ? "disabled" : "normal",
      label: item.label,
      reason: empty ? "this submenu has no items" : null,
      checked: null,
      children
    };
  }

  const missingCommand = item.command === undefined || item.command === "";
  const reason =
    item.disabledReason ??
    (missingCommand ? "this row names no command — the map is incomplete" : null);
  const runnable = reason === null;

  return {
    item,
    focusable: true,
    runnable,
    submenu: false,
    separator: false,
    header: false,
    tone: runnable ? (role === "danger" ? "danger" : "normal") : "disabled",
    label: item.label,
    reason,
    checked: role === "toggle" ? item.checked === true : null,
    children: []
  };
}

export function rowModels(items: readonly CtxItem[]): RowModel[] {
  return items.map(rowModel);
}

/** Indexes into `items` the arrow keys may land on, in order. */
export function focusableIndexes(items: readonly CtxItem[]): number[] {
  const out: number[] = [];
  items.forEach((item, i) => {
    if (rowModel(item).focusable) out.push(i);
  });
  return out;
}
