/**
 * @file Reading the click: what was targeted, what is selected, what is on the
 * clipboard — plus the invocation context commands read when they run.
 *
 * Commands are `() => void` (see `../commands`), which is deliberate: a handler
 * that takes the event would be a handler that can only be called from a menu.
 * So the engine parks the resolved target here immediately before running a
 * command, and clipboard handlers read it. One module-level slot, written at
 * one place, cleared when the menu closes.
 */
import type { MenuContext } from "./predicates";
import type { CtxClipboard, CtxTarget } from "./types";

/* ------------------------------------------------------------------ target */

const EDITABLE_INPUTS = new Set([
  "text", "search", "url", "tel", "email", "password", "number", "date",
  "datetime-local", "month", "week", "time"
]);

/** Does this element accept typed text — i.e. can cut and paste apply to it? */
export function isEditable(el: HTMLElement | null): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return !(el as HTMLTextAreaElement).readOnly && !(el as HTMLTextAreaElement).disabled;
  if (tag === "INPUT") {
    const input = el as HTMLInputElement;
    return EDITABLE_INPUTS.has(input.type) && !input.readOnly && !input.disabled;
  }
  return false;
}

/**
 * Name the click as specifically as the DOM allows.
 *
 * Walks up looking for something a person would recognise, in descending order
 * of how deliberate it is: an explicit `data-axf-ctx-label`, then the area
 * markers the resolver will use once `axf-context-menus` lands (reading them
 * now costs nothing and means a module that declares areas early gets a better
 * header for free), then accessible names, then the element's own short text.
 *
 * Falls back to the route, never to "Menu" — a header that says nothing is
 * worse than no header, because it occupies the line that should orient you.
 */
export function labelFor(el: HTMLElement | null): string {
  let node: HTMLElement | null = el;
  let depth = 0;
  while (node && depth++ < 12) {
    const explicit = node.dataset?.axfCtxLabel;
    if (explicit) return explicit;
    const area = node.getAttribute?.("data-axf-area");
    if (area) return area;
    const aria = node.getAttribute?.("aria-label");
    if (aria) return aria;
    node = node.parentElement;
  }
  const path = typeof window !== "undefined" ? window.location.pathname : "/";
  return path === "/" ? "Console" : path;
}

/** Text highlighted anywhere in the document, trimmed of trailing whitespace. */
export function selectionText(): string {
  try {
    return (window.getSelection()?.toString() ?? "").trim();
  } catch {
    return "";
  }
}

/**
 * What the clicked element HOLDS — the value D2's Copy value row copies.
 *
 * Three sources, most deliberate first, and the last one is bounded on purpose:
 *
 * 1. `data-axf-value`, when a surface has named its own value. Always wins,
 *    because a surface that says what it holds knows better than this function.
 * 2. A form control's `value`.
 * 3. A LEAF element's text. `childElementCount === 0` is doing real work here:
 *    without it, a right-click on the page background resolves to `<body>` and
 *    "Copy value" quietly copies the entire application. A container does not
 *    have a value; it contains things that do. So the row greys with a reason
 *    instead, which is the honest answer.
 */
export function valueFor(el: HTMLElement | null): string {
  if (!el) return "";
  const explicit = el.dataset?.axfValue;
  if (explicit !== undefined) return explicit;
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  ) {
    return el.value;
  }
  return el.childElementCount === 0 ? (el.textContent ?? "").trim() : "";
}

export function resolveTarget(el: HTMLElement | null): CtxTarget {
  return {
    element: el,
    label: labelFor(el),
    selection: selectionText(),
    editable: isEditable(el),
    value: valueFor(el)
  };
}

/* --------------------------------------------------------------- clipboard */

/**
 * Ask the system clipboard what it holds.
 *
 * `navigator.clipboard.readText()` reaches the WHOLE machine's clipboard, not
 * a copy this app made — which is the requirement ("if clipboard is loaded
 * from anywhere not just the application"). It is also the call most likely to
 * be refused, so every rejection is turned into a sentence a person can act
 * on rather than a swallowed exception.
 */
export async function readClipboard(): Promise<CtxClipboard> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.readText) {
    return { text: null, unreadable: "this browser exposes no clipboard read" };
  }
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return { text: null, unreadable: "clipboard needs a secure context (https or localhost)" };
  }
  try {
    const text = await navigator.clipboard.readText();
    return { text: text || null, unreadable: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      text: null,
      unreadable: /denied|permission/i.test(msg)
        ? "clipboard read not permitted — allow it for this site"
        : `clipboard unreadable (${msg.slice(0, 60)})`
    };
  }
}

/* ------------------------------------------------- the invocation context */

let active: CtxTarget | null = null;
let activeMenu: MenuContext | null = null;

/** Set by the engine immediately before a command runs; cleared on close. */
export function setActiveTarget(t: CtxTarget | null): void {
  active = t;
}

/** What the running command is acting on. Null outside an invocation. */
export function activeTarget(): CtxTarget | null {
  return active;
}

/**
 * The whole resolved menu context, parked beside the target (P3).
 *
 * The target alone was enough while every command acted on the clicked element.
 * D2's universal band broke that: Copy path copies the AREA PATH and Inspect
 * prints the resolved context, and neither fact is on {@link CtxTarget} — they
 * are what the resolver learned on the way up. Handing them to the command
 * would mean commands taking arguments, which `../commands` rules out for a
 * reason that has not changed: a handler that takes the click is a handler only
 * a menu can call, and the same behaviour has to be reachable from a hotkey and
 * a toolbar button.
 */
export function setActiveContext(ctx: MenuContext | null): void {
  activeMenu = ctx;
}

/** The context of the menu the running command came from. Null outside one. */
export function activeContext(): MenuContext | null {
  return activeMenu;
}
