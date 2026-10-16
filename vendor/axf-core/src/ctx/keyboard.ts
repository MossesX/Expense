/**
 * @file The keyboard, as a pure state machine over the resolved menu.
 *
 * P2's step says it plainly: *"Keyboard is in this phase and gated precisely
 * because it is the thing always deferred."* It is always deferred because in a
 * component it is a pile of `onKeyDown` branches entangled with refs, timers
 * and focus, which is untestable and therefore unfinished — the arrows get
 * done, type-ahead does not, and left/right out of a submenu never does.
 *
 * So it is not in the component. {@link navigate} takes the menu, the current
 * navigation state and a keystroke, and returns the next state plus what should
 * happen. No DOM, no React, no timers — `now` is a parameter, so even the
 * type-ahead buffer's expiry is deterministic. Every key in the gate is a test
 * case rather than a click-through.
 *
 * ── THE STATE ────────────────────────────────────────────────────────────────
 *
 * `open` is the path of the deepest OPEN panel: `[]` is the root menu, `[3]` is
 * the flyout of root row 3, `[3, 1]` is the flyout of that flyout's row 1.
 * `index` is the focused row *within that panel*. Focus therefore always lives
 * in the deepest open panel, which is the invariant that makes left/right
 * trivial and is why the two are not stored as one path: a focus path and an
 * open path that can disagree is a menu that can focus a row in a panel that is
 * no longer on screen.
 *
 * ── WHAT COUNTS AS HANDLED ───────────────────────────────────────────────────
 *
 * {@link NavResult.handled} is the component's answer to whether to call
 * `preventDefault`. Keys this machine does not use come back unhandled and pass
 * through to the page, deliberately: a menu that swallows every keystroke while
 * open is a menu that has stolen the browser's find-in-page and the screen
 * reader's own navigation.
 */
import { focusableIndexes, rowModel } from "./row-model";
import type { CtxItem } from "./types";

/** How long a type-ahead buffer survives between keystrokes. */
export const TYPEAHEAD_RESET_MS = 700;

export interface NavState {
  /** Path of the deepest open panel. `[]` is the root menu. */
  readonly open: readonly number[];
  /** Focused row within that panel. `-1` is nothing focused. */
  readonly index: number;
  readonly typed: string;
  readonly typedAt: number;
}

export const NAV_INITIAL: NavState = { open: [], index: -1, typed: "", typedAt: 0 };

/** A keystroke, reduced to what the machine actually consults. */
export interface NavKey {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
}

export type NavEffect =
  | { readonly kind: "none" }
  | { readonly kind: "run"; readonly item: CtxItem; readonly path: readonly number[] }
  | { readonly kind: "close" };

export interface NavResult {
  readonly state: NavState;
  readonly effect: NavEffect;
  /** Whether the machine consumed the key — i.e. whether to `preventDefault`. */
  readonly handled: boolean;
}

const NONE: NavEffect = { kind: "none" };

/** The items of the panel at `path`; `[]` if the path does not lead to one. */
export function panelItems(items: readonly CtxItem[], path: readonly number[]): readonly CtxItem[] {
  let level: readonly CtxItem[] = items;
  for (const i of path) {
    const child = level[i]?.items;
    if (!child) return [];
    level = child;
  }
  return level;
}

/** The item at an absolute path, or null. */
export function itemAt(items: readonly CtxItem[], path: readonly number[]): CtxItem | null {
  if (!path.length) return null;
  const parent = panelItems(items, path.slice(0, -1));
  return parent[path[path.length - 1] as number] ?? null;
}

/** The absolute path of the focused row, or `[]` when nothing is focused. */
export function focusPath(state: NavState): readonly number[] {
  return state.index < 0 ? [] : [...state.open, state.index];
}

/** The row the arrow keys would act on, or null. */
export function focusedItem(items: readonly CtxItem[], state: NavState): CtxItem | null {
  if (state.index < 0) return null;
  return panelItems(items, state.open)[state.index] ?? null;
}

function step(order: readonly number[], from: number, delta: number): number {
  if (!order.length) return -1;
  const at = order.indexOf(from);
  if (at < 0) return delta > 0 ? (order[0] as number) : (order[order.length - 1] as number);
  return order[(at + delta + order.length) % order.length] as number;
}

function moved(state: NavState, index: number): NavState {
  // Any deliberate move ends the type-ahead run. Keeping the buffer across an
  // arrow key would mean the next letter searched from a word the user has
  // already navigated away from.
  return { ...state, index, typed: "", typedAt: 0 };
}

/**
 * Open the flyout of the focused row and land on its first focusable child.
 *
 * Returns null when the focused row is not a submenu, which is how ArrowRight
 * and Enter tell each other apart from "there is nothing to open here".
 */
function openSubmenu(items: readonly CtxItem[], state: NavState): NavState | null {
  const item = focusedItem(items, state);
  if (!item) return null;
  const model = rowModel(item);
  if (!model.submenu) return null;
  const open = [...state.open, state.index];
  const order = focusableIndexes(panelItems(items, open));
  return { open, index: order.length ? (order[0] as number) : -1, typed: "", typedAt: 0 };
}

/** Collapse one level, landing focus back on the row that opened it. */
function closeSubmenu(state: NavState): NavState {
  return {
    open: state.open.slice(0, -1),
    index: state.open[state.open.length - 1] as number,
    typed: "",
    typedAt: 0
  };
}

function isPrintable(k: NavKey): boolean {
  return k.key.length === 1 && !k.ctrlKey && !k.metaKey && !k.altKey;
}

/**
 * Type-ahead, to the convention every desktop menu uses.
 *
 * One letter jumps to the next row starting with it and repeating the letter
 * cycles through them; two or more DIFFERENT letters build a prefix and search
 * from the current row, so "co" refines "c" rather than skipping past the match
 * "c" just found.
 */
function typeAhead(items: readonly CtxItem[], state: NavState, key: string, now: number): NavResult {
  const expired = now - state.typedAt > TYPEAHEAD_RESET_MS;
  const buffer = (expired ? "" : state.typed) + key.toLowerCase();
  const panel = panelItems(items, state.open);
  const order = focusableIndexes(panel);
  const typedState: NavState = { ...state, typed: buffer, typedAt: now };

  if (!order.length) return { state: typedState, effect: NONE, handled: true };

  // A run of one repeated character is a request to cycle, not to match a
  // literal "aaa" — no label starts with that, and cycling is what the user
  // pressing `a` three times means.
  const repeated = buffer.length > 1 && new Set(buffer).size === 1;
  const needle = repeated ? (buffer[0] as string) : buffer;
  const cycling = repeated || buffer.length === 1;

  const at = order.indexOf(state.index);
  const start = at < 0 ? 0 : cycling ? at + 1 : at;

  for (let n = 0; n < order.length; n++) {
    const i = order[(start + n) % order.length] as number;
    const label = (panel[i]?.label ?? "").trim().toLowerCase();
    if (label.startsWith(needle)) {
      return { state: { ...typedState, index: i }, effect: NONE, handled: true };
    }
  }

  // No match. The buffer is KEPT rather than discarded: the user is most likely
  // mid-word, and clearing it would make the next keystroke start a new search
  // from a letter that was never meant to stand alone.
  return { state: typedState, effect: NONE, handled: true };
}

/**
 * Apply one keystroke.
 *
 * @param items the whole resolved menu, root panel first
 * @param now   milliseconds, for the type-ahead buffer's expiry only
 */
export function navigate(
  items: readonly CtxItem[],
  state: NavState,
  key: NavKey,
  now: number
): NavResult {
  const panel = panelItems(items, state.open);
  const order = focusableIndexes(panel);

  switch (key.key) {
    case "ArrowDown":
      return { state: moved(state, step(order, state.index, 1)), effect: NONE, handled: true };

    case "ArrowUp":
      return { state: moved(state, step(order, state.index, -1)), effect: NONE, handled: true };

    case "Home":
      return {
        state: moved(state, order.length ? (order[0] as number) : -1),
        effect: NONE,
        handled: true
      };

    case "End":
      return {
        state: moved(state, order.length ? (order[order.length - 1] as number) : -1),
        effect: NONE,
        handled: true
      };

    case "ArrowRight": {
      const opened = openSubmenu(items, state);
      return opened
        ? { state: opened, effect: NONE, handled: true }
        : { state, effect: NONE, handled: false };
    }

    case "ArrowLeft":
      return state.open.length
        ? { state: closeSubmenu(state), effect: NONE, handled: true }
        : { state, effect: NONE, handled: false };

    case "Escape":
      return state.open.length
        ? { state: closeSubmenu(state), effect: NONE, handled: true }
        : { state, effect: { kind: "close" }, handled: true };

    case "Tab":
      // Tab means "I am done with this menu and moving on", so it closes rather
      // than cycling focus through rows that are not tab stops.
      return { state, effect: { kind: "close" }, handled: true };

    case " ":
      // Space activates, EXCEPT mid-type-ahead, where it is a word break in a
      // multi-word label. The buffer's own expiry decides which, so a pause
      // hands the key back to activation with no separate rule.
      if (state.typed && now - state.typedAt <= TYPEAHEAD_RESET_MS) {
        return typeAhead(items, state, " ", now);
      }
    // falls through
    case "Enter": {
      const opened = openSubmenu(items, state);
      if (opened) return { state: opened, effect: NONE, handled: true };

      const item = focusedItem(items, state);
      if (!item) return { state, effect: NONE, handled: true };

      const model = rowModel(item);
      // A disabled row consumes the key and does NOTHING — it does not run, and
      // it does not close the menu either. Closing would hide the reason at the
      // exact moment the user asked what the row was for.
      if (!model.runnable) return { state, effect: NONE, handled: true };

      return {
        state,
        effect: { kind: "run", item, path: focusPath(state) },
        handled: true
      };
    }

    default:
      if (isPrintable(key)) return typeAhead(items, state, key.key, now);
      return { state, effect: NONE, handled: false };
  }
}

/**
 * The state a menu opens in when it was opened FROM THE KEYBOARD.
 *
 * The context-menu key has no cursor behind it, so there is nothing to hover
 * and the first row must already be focused — otherwise the first ArrowDown is
 * spent selecting what the user could reasonably expect was already selected.
 */
export function navFirst(items: readonly CtxItem[]): NavState {
  const order = focusableIndexes(items);
  return { ...NAV_INITIAL, index: order.length ? (order[0] as number) : -1 };
}
