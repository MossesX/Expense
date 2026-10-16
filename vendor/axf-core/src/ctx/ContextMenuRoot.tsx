/**
 * @file `ContextMenuRoot` — one document-level listener, one menu, every route.
 *
 * Mounted once by `AppShell`, which is what makes "a menu anywhere, always"
 * true by construction rather than by every surface remembering to opt in.
 * Nothing else in the app handles `contextmenu`, and no surface has to: the
 * listener is on the document, so a new module gets a working menu the day it
 * renders, with no line of code.
 *
 * That is the same reasoning `axf-context-menus` is built on — GizmoX's actual
 * failure was not bad menus but INCONSISTENT COVERAGE, forty modules each
 * hand-writing a handler, which made coverage a habit, and habits have holes.
 * A listener that cannot be forgotten has none.
 *
 * ── WHAT THIS FILE IS NOW ────────────────────────────────────────────────────
 *
 * It is the WIRING, and nothing else. Three separate things meet here and each
 * of them lives somewhere it can be tested on its own:
 *
 * 1. **The walk** — `areas.ts` turns the clicked element into an area path.
 * 2. **The composition** — `compose.ts` turns that path plus the map into rows,
 *    then `default-menu.ts` appends the always-present floor beneath them.
 * 3. **The drawing** — `ContextMenu.tsx`, with its geometry, keyboard and row
 *    model factored out into `place.ts`, `keyboard.ts` and `row-model.ts`.
 *
 * P1 deliberately did NOT wire the resolver in, because the renderer at the
 * time drew a flat list and would have silently dropped every submenu it was
 * handed — `compose.ts` says so in its own docblock. P2 is the phase that fixes
 * that, so this is the phase the wiring belongs in.
 *
 * ── AREA ROWS ABOVE, THE FLOOR BELOW ─────────────────────────────────────────
 *
 * The composed area groups go on top, most-specific-first; the default menu's
 * header, clipboard rows and session row stay at the bottom. That ordering is
 * D2, decided before any of this was built: *"a menu that varies in whether it
 * has the basics is a menu people stop trusting."*
 *
 * P3 filled in the band between them. D2's universal group is now a real,
 * declared, suppressible AREA that plugins can contribute to (`universal.ts`),
 * so a menu is four bands:
 *
 *     [innermost area] … [outermost area] [universal] [floor]
 *
 * and the promise the last version of this docblock made was kept — nothing had
 * to be undone. The floor stays exactly where it was, and stays unsuppressible,
 * because the owner's directive is that a right-click ALWAYS produces a menu and
 * an area that could empty it would break that in one line.
 */
"use client";

import * as React from "react";

import { commands } from "../commands";
import { session } from "../auth/session";
import { resolveAreaPath } from "./areas";
import type { AreaPath } from "./areas";
import { registerCtxCommands } from "./commands";
import { composeMenu, menuContextFor } from "./compose";
import type { ComposeInput } from "./compose";
import { ContextMenu } from "./ContextMenu";
import { defaultMenu } from "./default-menu";
import { installCtxOverlay } from "./overlay-store";
import { readClipboard, resolveTarget, setActiveContext, setActiveTarget } from "./resolve";
import type { CtxClipboard, CtxItem, CtxTarget } from "./types";
import { declareUniversalArea, universalMenu } from "./universal";

const EMPTY_CLIPBOARD: CtxClipboard = { text: null, unreadable: null };

interface OpenState {
  readonly x: number;
  readonly y: number;
  readonly target: CtxTarget;
  /** The whole walk, kept intact — composition reads four different fields. */
  readonly area: AreaPath;
  /** Opened by the context-menu key rather than the pointer. */
  readonly fromKeyboard: boolean;
}

/**
 * Where a keyboard-opened menu points.
 *
 * There is no cursor, so the anchor is the focused element's bottom-left corner
 * — the same place a browser's own context menu appears for the Menu key. Inset
 * slightly so the menu overlaps the element it belongs to rather than floating
 * free of it.
 */
function anchorFor(el: Element | null): { x: number; y: number } {
  if (!el || typeof el.getBoundingClientRect !== "function") return { x: 0, y: 0 };
  const r = el.getBoundingClientRect();
  // A focused element with no box (a detached or `display: none` activeElement)
  // would put the menu in the top-left corner, which reads as a bug. The centre
  // of the viewport is at least an honest "we do not know where".
  if (r.width === 0 && r.height === 0) {
    return { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) };
  }
  return { x: Math.round(r.left + 2), y: Math.round(r.bottom - 2) };
}

export function ContextMenuRoot() {
  const [open, setOpen] = React.useState<OpenState | null>(null);
  const [clipboard, setClipboard] = React.useState<CtxClipboard>(EMPTY_CLIPBOARD);

  const sessionState = React.useSyncExternalStore(
    session.subscribe,
    session.state,
    session.serverState
  );

  // Order is load-bearing, not stylistic: the map refuses an item naming an
  // unregistered command at registration, and the universal group's four rows
  // name four of the commands the line above takes. Reversed, the shell would
  // throw on mount — which is the gate doing its job, in the wrong place.
  //
  // The overlay goes LAST, and that is the same kind of ordering rather than a
  // tidiness preference. It binds a person's edits to the map and sweeps them
  // for stale entries, and both an area that has not been declared YET and an
  // area that no longer exists are the same absence — so a sweep run before the
  // registrations would report every edit in the document as drift and teach
  // people to ignore the warning. Modules register their menus in the
  // subsystem's `start()`, before the shell mounts, so by here the map is whole.
  React.useEffect(() => {
    registerCtxCommands();
    declareUniversalArea();
    installCtxOverlay();
  }, []);

  /* ------------------------------------------------------------- opening */
  const openAt = React.useCallback(
    (x: number, y: number, el: HTMLElement | null, fromKeyboard: boolean) => {
      const target = resolveTarget(el);
      // The walk is O(depth) and touches no layout (`areas.ts`), so it is safe
      // to do synchronously in the event handler — which it must be, because
      // the DOM under the cursor can change the moment the menu opens.
      const area = resolveAreaPath(el);
      setClipboard(EMPTY_CLIPBOARD);
      setOpen({ x, y, target, area, fromKeyboard });
      // Reading the clipboard is async and may prompt, so the menu opens
      // immediately and the Paste row appears when the answer arrives rather
      // than the whole menu waiting on a permission dialog.
      void readClipboard().then(setClipboard);
    },
    []
  );

  const close = React.useCallback(() => {
    setOpen(null);
    // Both slots, together. `activeContext` was added in P3 for Copy path and
    // Inspect, and a context left parked after the menu closes is worse than no
    // context: the same commands are reachable from a hotkey and a toolbar
    // button, where they would answer about the last place someone right-clicked
    // and look correct doing it.
    setActiveTarget(null);
    setActiveContext(null);
  }, []);

  React.useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      // Always. The owner's directive is that a right-click anywhere produces
      // this menu, so the native one never wins — including over the shell
      // chrome, empty page background and text fields.
      e.preventDefault();
      openAt(e.clientX, e.clientY, e.target instanceof HTMLElement ? e.target : null, false);
    };
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, [openAt]);

  /**
   * The context-menu KEY, and Shift+F10.
   *
   * Named in P2's step and easy to mistake for a nicety. It is the only way to
   * open this menu without a pointer, so without it every row the framework
   * puts here — including Sign out — is mouse-only. Shift+F10 is included
   * because a great many keyboards have no Menu key at all, which is the
   * ordinary reason the Menu key alone is not enough.
   *
   * Windows reports the key as `ContextMenu`; some layouts still emit `Apps`.
   */
  const isOpen = open !== null;
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const wanted = e.key === "ContextMenu" || e.key === "Apps" || (e.shiftKey && e.key === "F10");
      if (!wanted || e.ctrlKey || e.altKey || e.metaKey) return;
      e.preventDefault();
      // Pressing it again over an open menu closes it, rather than resolving a
      // second menu against the first one's own DOM.
      if (isOpen) {
        close();
        return;
      }
      const el = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const at = anchorFor(el);
      openAt(at.x, at.y, el, true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openAt, close, isOpen]);

  /* ------------------------------------------------------------- closing */
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target;
      // The menu lives in the top layer, so it is NOT inside any container this
      // component could hold a ref to — `closest` on the marker attribute is
      // what identifies a click that landed on the menu itself.
      if (el instanceof Element && el.closest("[data-axf-ctx='menu']")) return;
      close();
    };
    // Scroll closes rather than follows: a menu anchored to a point that has
    // moved is pointing at the wrong thing.
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [open, close]);

  /**
   * Everything the click told us, in the shape the resolver takes. Built once
   * and used three times — the area rows, the universal band and the context
   * parked for the running command all have to describe the SAME click, and
   * three separate constructions of it are three chances for them to disagree.
   */
  const input: ComposeInput | null = React.useMemo(
    () =>
      open
        ? {
            path: open.area,
            target: open.target,
            clipboard,
            signedIn: sessionState.signedIn,
            user: sessionState.user
          }
        : null,
    [open, clipboard, sessionState]
  );

  const items: CtxItem[] = React.useMemo(() => {
    if (!open || !input) return [];
    const area = composeMenu(input);
    // D2: the basics, always last of what the map contributes, and off entirely
    // when the area the click was rooted in suppresses them.
    const universal = universalMenu(input);
    const floor = defaultMenu({
      target: open.target,
      clipboard,
      signedIn: sessionState.signedIn,
      user: sessionState.user
    });

    const out: CtxItem[] = [...area];
    // A separator only ever goes BETWEEN two bands that both have rows. The
    // alternative — appending one per band and trimming afterwards — is how a
    // menu ends up opening on a divider, which reads as content that failed to
    // load rather than as a menu with fewer rows.
    const join = (rows: CtxItem[], key: string) => {
      if (!rows.length) return;
      if (out.length) out.push({ id: `sep:${key}`, label: "", role: "separator" as const });
      out.push(...rows);
    };
    join(universal, "universal");
    join(floor, "floor");
    return out;
  }, [open, input, clipboard, sessionState]);

  const run = React.useCallback(
    (item: CtxItem) => {
      if (!item.command || item.disabledReason || !open || !input) return;
      // The context is parked before the handler runs — commands take no
      // arguments by contract, so this is how a clipboard handler knows what
      // it is acting on, and how Copy path and Inspect reach the area path.
      setActiveTarget(open.target);
      setActiveContext(menuContextFor(input));
      commands.run(item.command);
      close();
    },
    [open, input, close]
  );

  if (!open || typeof document === "undefined") return null;

  return (
    <ContextMenu
      items={items}
      at={{ x: open.x, y: open.y }}
      onRun={run}
      onClose={close}
      fromKeyboard={open.fromKeyboard}
      ariaLabel={open.target.label}
    />
  );
}
