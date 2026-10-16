/**
 * @file `ContextMenu` — ONE menu component, for every menu in the framework.
 *
 * The renderer half of `axf-context-menus` (P2). It takes rows the resolver
 * already compiled (`CtxItem[]`, no predicates left, labels final) and draws
 * them: placement, flyouts, hover intent, the full keyboard, and the greyed row
 * that says why.
 *
 * It is deliberately thin, because almost everything that could be got wrong
 * here has been moved somewhere it can be tested:
 *
 * | concern | lives in | why not here |
 * |---|---|---|
 * | flip / clamp at the edges | `place.ts` | four corners must be *asserted*, not eyeballed |
 * | arrows, type-ahead, left/right, enter | `keyboard.ts` | keyboard is the thing always deferred; a pure machine cannot be half-finished |
 * | focusable / runnable / tone / reason | `row-model.ts` | "a disabled row states why" has to be a value a test can read |
 *
 * What is genuinely left is DOM work: measuring, positioning, timers and focus.
 *
 * ── THEMED ENTIRELY THROUGH `var(--axf-*)` ───────────────────────────────────
 *
 * Every colour, font and radius goes through `token()`, which is literally
 * `var(--axf-<name>)`. There is not one literal colour in this file. That is
 * what makes the menu re-theme live with everything else — the theme bridge
 * republishes the variables and the menu follows without re-rendering.
 *
 * ── THE TOP LAYER, WHICH IS THE PORTAL DONE PROPERLY ─────────────────────────
 *
 * P2 asks for a portal "so it escapes overflow". A portal to `document.body`
 * escapes ancestor `overflow`, but it does NOT escape a z-index war with
 * whatever else got portalled there, and it costs core a `react-dom` peer
 * dependency it does not otherwise have (core declares `react` only, on
 * purpose, and `react-dom` is not even installed here — so `createPortal` would
 * not typecheck standalone, let alone resolve).
 *
 * The TOP LAYER is strictly stronger and costs nothing: an element with the
 * `popover` attribute, shown with `showPopover()`, is lifted out of the entire
 * page — above every ancestor's `overflow`, outside every stacking context, and
 * above anything portalled to `body`. It is also immune to the failure the old
 * `ContextMenuRoot` comment predicted for `position: fixed`: an ancestor with a
 * `transform`, `filter` or `contain` becomes the containing block for a fixed
 * child and silently traps it, and a shell WILL grow one of those the first
 * time a pane animates.
 *
 * Support is feature-detected at mount, and a browser without it falls back to
 * plain `position: fixed` — the previous behaviour, no worse than before, and
 * the `popover` attribute is never rendered in that case (an unsupported
 * popover would be `display: none` from the UA sheet, i.e. an invisible menu,
 * which is the one outcome worth engineering around).
 *
 * ── MEASURE ONCE, PLACE ONCE, NO OSCILLATION ─────────────────────────────────
 *
 * A panel's height depends on how many rows survived the resolver, which is not
 * known until it renders — so the first paint is `visibility: hidden`, the
 * layout effect measures and places, and the corrected position lands in the
 * same frame. The loop this pattern usually causes is closed by making the
 * measured size independent of the placement: width is fixed and `max-height`
 * is always the usable viewport height, never the space below the cursor. Place
 * it anywhere and it measures the same, so the effect converges after one pass.
 *
 * ── MUI (2026-08-10, P2) ─────────────────────────────────────────────────────
 *
 * A panel is a `Paper`, a heading is a `ListSubheader`, a rule is a `Divider`
 * and a row is a `ButtonBase`. Those are the components MUI has for these
 * parts, and the owner's rule is that where one exists it is used.
 *
 * Four things it deliberately does NOT adopt, each for a reason about this
 * menu rather than about effort:
 *
 *   - **`Menu` / `Popover`.** Both own placement, and placement is the thing
 *     `place.ts` exists to make assertable at four corners without a screen.
 *     A Popover would also anchor to an element; this menu anchors to a POINT
 *     (the cursor), and a flyout anchors to a row inside a panel whose new
 *     position is not in the DOM yet. Handing that to a library that measures
 *     with `getBoundingClientRect` reintroduces the exact bug the placement
 *     effect documents avoiding.
 *   - **`MenuList`.** It ships its own arrow-key and type-ahead handling,
 *     which would race `keyboard.ts` — two machines driving one selection is
 *     worse than either — and its own focus management, which would fight the
 *     `aria-activedescendant` model the panels use.
 *   - **`MenuItem`, and this one was PAID FOR.** It was the obvious choice and
 *     the first version of this rebuild used it. MUI v9's `MenuItem` calls
 *     `useMenuListContext()` and **throws** — *"MenuListContext is missing.
 *     MenuItems must be placed within Menu or MenuList"* — so every row threw
 *     on render, the app-tier boundary caught it, and right-click anywhere in
 *     the app produced "application failed" instead of a menu. It typechecked
 *     and every source-scanning gate stayed green; only opening the menu in a
 *     browser found it. Adopting `MenuItem` therefore means adopting
 *     `MenuList` too, which is the bullet above. `ButtonBase` is what
 *     `nav/NavMenu` already chose for the same shape of problem, for the same
 *     reason: it contributes focus and keyboard behaviour and contributes no
 *     arrangement.
 *   - **A `disabled` row.** A greyed row here is `aria-disabled` and still
 *     focusable ON PURPOSE (`row-model.ts`: the reason must be reachable from
 *     the keyboard), and it absorbs its click so the menu stays open and keeps
 *     saying why. `disabled` would set `pointer-events: none` and drop the row
 *     from the focus ring — losing the reason both ways.
 *
 * `component="div"` on `ListSubheader` because it defaults to `<li>`, and
 * there is no `<ul>` here: a panel is a `role="menu"` with
 * `aria-activedescendant`, not a list.
 *
 * The `sx` values are still `token()` strings, so the claim above — not one
 * literal colour, everything through `var(--axf-*)` — is unchanged, and
 * `ctx-renderer.test.ts` still scans this file for it.
 */
"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Divider from "@mui/material/Divider";
import ListSubheader from "@mui/material/ListSubheader";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";

import { Glyph } from "../brand/Glyph";
import { token } from "../theme";
import { NAV_INITIAL, itemAt, navFirst, navigate, panelItems } from "./keyboard";
import type { NavState } from "./keyboard";
import type { ToggleMarks } from "./types";
import { MENU_MARGIN, placeAtPoint, placeFlyout } from "./place";
// `Box` here is `place.ts`'s rectangle, and `Box` above is MUI's component.
// The GEOMETRY one is the one that gets aliased: the component keeps the name
// it has in every other core file, so a reader is never wondering whether this
// file's `<Box>` is the same `Box` as NavMenu's.
import type { Box as Rect, Placement } from "./place";
import { focusableIndexes, rowModel, toneToken } from "./row-model";
import type { RowModel } from "./row-model";
import type { CtxItem } from "./types";

/** Fixed, so a long label truncates instead of reflowing the whole menu. */
const WIDTH = 248;

/**
 * Hover intent, in milliseconds.
 *
 * `OPEN` is the pause before a hovered submenu opens — without it, dragging the
 * pointer down a column of submenu rows opens and discards four flyouts.
 * `SWITCH` is the grace period before a hover elsewhere COLLAPSES an open one,
 * and it is the longer of the two on purpose: the pointer's path from a parent
 * row to its flyout is diagonal, so it crosses the rows in between, and
 * collapsing on the first of those is the classic menu that cannot be reached.
 */
const HOVER_OPEN_MS = 180;
const HOVER_SWITCH_MS = 320;

export interface ContextMenuProps {
  /** The resolved rows. Submenu children hang off `CtxItem.items`. */
  readonly items: readonly CtxItem[];
  /** Where the menu was asked for, in viewport coordinates. */
  readonly at: { readonly x: number; readonly y: number };
  /** Run a row's command. Only ever called with a runnable row. */
  readonly onRun: (item: CtxItem) => void;
  readonly onClose: () => void;
  /**
   * Opened from the keyboard, so focus the first row immediately.
   *
   * A mouse-opened menu starts with nothing focused — the pointer is the
   * selection, and pre-highlighting a row it is not over is a lie about what
   * clicking will do.
   */
  readonly fromKeyboard?: boolean;
  readonly ariaLabel?: string;
}

const keyOf = (path: readonly number[]): string => (path.length ? path.join(".") : "root");

/** Every panel currently on screen: the root, then one per open level. */
function panelPaths(open: readonly number[]): number[][] {
  const out: number[][] = [[]];
  for (let i = 0; i < open.length; i++) out.push(open.slice(0, i + 1));
  return out;
}

function samePlacements(a: Record<string, Placement>, b: Record<string, Placement>): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => {
    const x = a[k];
    const y = b[k];
    return !!y && x!.x === y.x && x!.y === y.y && x!.maxHeight === y.maxHeight;
  });
}

/** Open the flyout of `index` in the panel at `panelPath`, focusing its first row. */
function openedAt(
  items: readonly CtxItem[],
  panelPath: readonly number[],
  index: number
): NavState {
  const open = [...panelPath, index];
  const order = focusableIndexes(panelItems(items, open));
  return { open, index: order.length ? order[0]! : -1, typed: "", typedAt: 0 };
}

function supportsTopLayer(): boolean {
  return (
    typeof HTMLElement !== "undefined" &&
    typeof (HTMLElement.prototype as { showPopover?: unknown }).showPopover === "function"
  );
}

export function ContextMenu({
  items,
  at,
  onRun,
  onClose,
  fromKeyboard = false,
  ariaLabel = "Context menu"
}: ContextMenuProps) {
  const [nav, setNav] = React.useState<NavState>(() =>
    fromKeyboard ? navFirst(items) : NAV_INITIAL
  );
  const [places, setPlaces] = React.useState<Record<string, Placement>>({});
  const [topLayer, setTopLayer] = React.useState(supportsTopLayer);

  const hostRef = React.useRef<HTMLDivElement | null>(null);
  // `HTMLElement`, not `HTMLDivElement`: `ButtonBase`/`Paper` are rendered through
  // `component`, so their ref types follow the kit rather than the tag. Every
  // measurement below (`offsetWidth`/`offsetTop`/`scrollTop`/`focus`) is on
  // HTMLElement anyway — narrowing further would buy nothing and cost a cast.
  const panelRefs = React.useRef(new Map<string, HTMLElement>());
  const rowRefs = React.useRef(new Map<string, HTMLElement>());
  const navRef = React.useRef(nav);
  navRef.current = nav;

  const paths = React.useMemo(() => panelPaths(nav.open), [nav.open]);

  /* ------------------------------------------------------------ top layer */
  React.useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !topLayer) return;
    try {
      const el = host as HTMLDivElement & { showPopover(): void };
      if (!host.matches(":popover-open")) el.showPopover();
    } catch {
      // The attribute is rendered from state, so dropping it here is what stops
      // the UA's `display: none` from turning a refused popover into no menu.
      setTopLayer(false);
    }
  }, [topLayer]);

  /* ---------------------------------------------------- measure and place */
  // No dependency array: the panels, their contents and the viewport can all
  // change without a prop changing, and the equality guard below is what makes
  // running every render cheap rather than a loop.
  React.useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const next: Record<string, Placement> = {};

    for (const path of paths) {
      const key = keyOf(path);
      const el = panelRefs.current.get(key);
      if (!el) continue;
      const size = { width: el.offsetWidth || WIDTH, height: el.offsetHeight };

      if (!path.length) {
        next[key] = placeAtPoint(at, size, viewport, MENU_MARGIN);
        continue;
      }

      const parentKey = keyOf(path.slice(0, -1));
      const parent = next[parentKey];
      const parentEl = panelRefs.current.get(parentKey);
      const rowEl = rowRefs.current.get(key);
      if (!parent || !parentEl || !rowEl) continue;

      // The row's box is derived from the parent's NEW placement plus the row's
      // offset inside it, never from `getBoundingClientRect` — the DOM still
      // holds the parent's previous position at this point, and reading it
      // would place the flyout against where the parent used to be.
      const panelBox: Rect = {
        x: parent.x,
        y: parent.y,
        width: parentEl.offsetWidth,
        height: parentEl.offsetHeight
      };
      const rowBox: Rect = {
        x: parent.x,
        y: parent.y + rowEl.offsetTop - parentEl.scrollTop,
        width: parentEl.offsetWidth,
        height: rowEl.offsetHeight
      };
      next[key] = placeFlyout(rowBox, panelBox, size, viewport, MENU_MARGIN);
    }

    setPlaces((prev) => (samePlacements(prev, next) ? prev : next));
  });

  /* ------------------------------------------------------------- keyboard */

  /**
   * Whether this menu is being driven by the keyboard.
   *
   * It decides one thing — whether the menu takes DOM focus — and that is a
   * genuine trade rather than an oversight. Taking focus is what the ARIA menu
   * pattern asks for, and a keyboard user needs it. But it also collapses the
   * document's text selection in a `contenteditable`, and `ctx.paste` /
   * `ctx.cut` reach for exactly that selection when they run
   * (`commands.ts` → `replaceSelection`). A mouse-opened menu must therefore
   * leave focus where it found it, or right-click → Paste stops working in
   * every rich-text surface in the app.
   *
   * So focus moves the moment the keyboard is actually used, and not before.
   */
  const keyboardDriven = React.useRef(fromKeyboard);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const result = navigate(items, navRef.current, e, Date.now());
      if (!result.handled) return;
      e.preventDefault();
      e.stopPropagation();
      keyboardDriven.current = true;
      setNav(result.state);
      if (result.effect.kind === "run") onRun(result.effect.item);
      else if (result.effect.kind === "close") onClose();
    };
    // Capture, so a surface that handles Escape or arrow keys itself does not
    // get them first while a menu is open over the top of it.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [items, onRun, onClose]);

  /* Focus follows the deepest open panel, so a screen reader announces the
     flyout when it opens rather than staying on the menu that spawned it. */
  React.useEffect(() => {
    if (!keyboardDriven.current) return;
    panelRefs.current.get(keyOf(nav.open))?.focus({ preventScroll: true });
  }, [nav.open, nav.index]);

  /* --------------------------------------------------------- hover intent */
  const pending = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearPending = React.useCallback(() => {
    if (pending.current !== null) {
      clearTimeout(pending.current);
      pending.current = null;
    }
  }, []);
  React.useEffect(() => clearPending, [clearPending]);

  const enterRow = React.useCallback(
    (panelPath: readonly number[], index: number, model: RowModel) => {
      clearPending();
      const state = navRef.current;
      const deeper = state.open.length > panelPath.length;

      // The pointer is back on the very row whose flyout is open. Nothing to
      // do — collapsing and reopening it would flicker.
      if (deeper && state.open[panelPath.length] === index) return;

      if (!deeper) {
        setNav((s) => ({ ...s, open: panelPath, index, typed: "", typedAt: 0 }));
        if (model.submenu) {
          pending.current = setTimeout(
            () => setNav(openedAt(items, panelPath, index)),
            HOVER_OPEN_MS
          );
        }
        return;
      }

      // Something deeper is open and the pointer may simply be crossing this row
      // on its way there. Commit only if it stays.
      pending.current = setTimeout(() => {
        setNav(
          model.submenu
            ? openedAt(items, panelPath, index)
            : { open: panelPath, index, typed: "", typedAt: 0 }
        );
      }, HOVER_SWITCH_MS);
    },
    [clearPending, items]
  );

  const clickRow = React.useCallback(
    (panelPath: readonly number[], index: number, model: RowModel) => {
      clearPending();
      if (model.submenu) {
        setNav(openedAt(items, panelPath, index));
        return;
      }
      // A greyed row absorbs the click. It already says why on the row itself,
      // and closing the menu would take that answer away.
      if (!model.runnable) return;
      onRun(model.item);
    },
    [clearPending, items, onRun]
  );

  if (typeof document === "undefined") return null;

  return (
    <Box
      ref={hostRef}
      // `popover` only when the browser has it — see the docblock.
      {...(topLayer ? { popover: "manual" as const } : {})}
      data-axf-ctx="menu"
      role="presentation"
      onContextMenu={(e: React.MouseEvent) => {
        // A right-click inside the menu keeps the menu, rather than resolving a
        // new one against the menu's own DOM.
        e.preventDefault();
        e.stopPropagation();
      }}
      sx={{
        // A zero-size, transparent host: the panels below are each positioned
        // themselves, and a host with no box cannot intercept the outside click
        // that closes the menu.
        position: "fixed",
        inset: "auto",
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        margin: 0,
        padding: 0,
        border: 0,
        overflow: "visible",
        background: "transparent",
        color: token("ink"),
        zIndex: 2147483000
      }}
    >
      {paths.map((path) => {
        const key = keyOf(path);
        const place = places[key];
        const rows = panelItems(items, path);
        // A panel with nothing in it can only happen if `items` changed under an
        // open flyout — the clipboard read landing, say, or a re-resolve. An
        // empty bordered box hanging off the menu reads as something that failed
        // to load, so it is not drawn at all.
        if (!rows.length) return null;
        const focusedIndex = keyOf(nav.open) === key ? nav.index : -1;
        const activeId = focusedIndex >= 0 ? `axf-ctx-${key}-${focusedIndex}` : undefined;

        return (
          <Paper
            key={key}
            // elevation 0: the shadow is the ENGINE's `--axf-shadow`, not MUI's
            // elevation ramp. Both would otherwise stack, and only one of them
            // moves when the theme is rolled.
            elevation={0}
            ref={(el: HTMLElement | null) => {
              if (el) panelRefs.current.set(key, el);
              else panelRefs.current.delete(key);
            }}
            role="menu"
            tabIndex={-1}
            aria-label={path.length ? (itemAt(items, path)?.label ?? ariaLabel) : ariaLabel}
            aria-activedescendant={activeId}
            onMouseEnter={clearPending}
            sx={{
              position: "fixed",
              left: place?.x ?? at.x,
              top: place?.y ?? at.y,
              // Hidden for the one frame between mount and measurement, so the
              // menu never appears in the wrong place and then jumps.
              visibility: place ? "visible" : "hidden",
              width: WIDTH,
              maxHeight: place?.maxHeight,
              overflowY: "auto",
              overflowX: "hidden",
              background: token("panel"),
              border: `1px solid ${token("edge")}`,
              // No literal fallbacks. Both of these are DERIVED variables
              // (`theme/derived.ts`), published on every theme, so a fallback
              // could only ever fire if the bridge were absent — and it would
              // then be the one hard-coded appearance in a file whose whole
              // claim is that it has none. `ctx-renderer.test.ts` scans for
              // exactly that and this line is what it would have caught.
              borderRadius: token("radius-tight"),
              boxShadow: token("shadow"),
              padding: "4px 0",
              fontFamily: token("mono"),
              fontSize: 11,
              lineHeight: 1.3,
              userSelect: "none",
              outline: "none"
            }}
          >
            {rows.map((item, index) => (
              <Row
                key={item.id}
                id={`axf-ctx-${key}-${index}`}
                model={rowModel(item)}
                focused={index === focusedIndex}
                expanded={nav.open.length > path.length && nav.open[path.length] === index}
                registerRef={(el) => {
                  const rowKey = keyOf([...path, index]);
                  if (el) rowRefs.current.set(rowKey, el);
                  else rowRefs.current.delete(rowKey);
                }}
                onEnter={(model) => enterRow(path, index, model)}
                onActivate={(model) => clickRow(path, index, model)}
              />
            ))}
          </Paper>
        );
      })}
    </Box>
  );
}

interface RowProps {
  readonly id: string;
  readonly model: RowModel;
  readonly focused: boolean;
  readonly expanded: boolean;
  readonly registerRef: (el: HTMLElement | null) => void;
  readonly onEnter: (model: RowModel) => void;
  readonly onActivate: (model: RowModel) => void;
}

/**
 * A toggle's state, drawn.
 *
 * Two modes, and the difference is about what the OFF state means rather than
 * about decoration (`types.ts` → `ToggleMarks`):
 *
 *   - `check` — a tick when on, a blank column when off. The off state is the
 *     absence of a choice, so absence is the honest drawing.
 *   - `visibility` — a tick in the OK colour when on, the struck-through eye
 *     when off. Both states are positive facts ("shown" / "hidden"), and a
 *     blank column would read as "this row has no answer".
 *
 * The column keeps ONE width in both modes so labels stay aligned down the
 * menu — a marker that changed the indent per row would make the list look
 * ragged for a reason nobody could name.
 */
function ToggleMark({ checked, marks }: { checked: boolean; marks?: ToggleMarks }) {
  const visibility = marks === "visibility";
  return (
    <Box
      component="span"
      aria-hidden="true"
      sx={{
        width: "13px",
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        alignSelf: "center",
        color: token(visibility && checked ? "ok" : "accent")
      }}
    >
      {checked ? "✓" : visibility ? <Glyph id="icon-eye-off" size={11} title="hidden" /> : ""}
    </Box>
  );
}

function Row({ id, model, focused, expanded, registerRef, onEnter, onActivate }: RowProps) {
  if (model.separator) {
    return (
      <Divider
        ref={registerRef}
        // Left as Divider's default `<hr>`, which carries the implicit
        // `separator` role. Do not pass `component="div"` here to match the
        // other rows: that drops the role and the separator stops being
        // announced, for a tidiness nobody sees.
        sx={{ height: "1px", borderColor: token("edge"), background: token("edge"), my: "4px" }}
      />
    );
  }

  if (model.header) {
    return (
      <ListSubheader
        ref={registerRef}
        component="div"
        // A menu is short and scrolls as one; a heading that sticks to the top
        // of the panel would cover the rows it is labelling.
        disableSticky
        disableGutters
        role="presentation"
        sx={{
          padding: "3px 10px 5px",
          background: "transparent",
          color: token("dim"),
          fontFamily: "inherit",
          fontSize: 9.5,
          lineHeight: 1.3,
          letterSpacing: "0.09em",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis"
        }}
      >
        {model.label}
      </ListSubheader>
    );
  }

  const disabled = model.reason !== null;
  const tone = toneToken(model.tone);

  return (
    <ButtonBase
      ref={registerRef}
      // No ripple: a context-menu row is dismissed the instant it is clicked, so
      // the ripple would animate over a menu that is already gone. This also
      // keeps the click feel identical to the pre-MUI renderer, which is what
      // "behaviour preserved exactly" means here.
      disableRipple
      // `ButtonBase` renders a real <button>, which is tabbable by default.
      // These panels drive selection with `aria-activedescendant` from the
      // PANEL, so a row must never be a tab stop of its own — a menu whose
      // rows are all in the tab ring is a menu Tab walks out the side of.
      tabIndex={-1}
      id={id}
      role={model.checked === null ? "menuitem" : "menuitemcheckbox"}
      // `aria-disabled`, NEVER the `disabled` prop — see the file docblock.
      aria-disabled={disabled || undefined}
      aria-haspopup={model.submenu ? "menu" : undefined}
      aria-expanded={model.submenu ? expanded : undefined}
      aria-checked={model.checked === null ? undefined : model.checked}
      // The reason is on the row as text AND as the title, so it survives both a
      // narrow menu that truncates it and a pointer that hovers instead of reads.
      title={model.reason ?? undefined}
      onMouseEnter={() => onEnter(model)}
      onClick={() => onActivate(model)}
      sx={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "flex-start",
        gap: "8px",
        padding: "4px 10px",
        width: "100%",
        // A <button> centres its text and inherits none of the panel's type.
        // Both are restated rather than assumed — this is the row's whole
        // appearance, and it used to come free from a <div>.
        textAlign: "left",
        font: "inherit",
        cursor: disabled ? "default" : "pointer",
        color: token(tone),
        background: focused ? token("panel2") : "transparent",
        // A focused row is also outlined, not merely tinted: `panel2` against
        // `panel` is a low-contrast difference by design, and it is the only
        // signal a keyboard user has about where they are.
        boxShadow: focused ? `inset 2px 0 0 ${token("accent")}` : "none",
        // Hover and keyboard focus are the SAME state here — `enterRow` sets
        // `nav.index` on mouse enter — so they get the same paint rather than
        // two that can disagree for a frame.
        "&:hover": { background: token("panel2") },
        "&.Mui-focusVisible": { background: token("panel2") }
      }}
    >
      {model.checked !== null && <ToggleMark checked={model.checked} marks={model.item.marks} />}
      <Typography
        component="span"
        sx={{
          font: "inherit",
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontWeight: model.tone === "danger" ? 700 : 400
        }}
      >
        {model.label}
      </Typography>
      {model.reason !== null && (
        <Typography
          component="span"
          sx={{ font: "inherit", fontSize: 9, color: token("dim"), whiteSpace: "nowrap" }}
        >
          {model.reason}
        </Typography>
      )}
      {model.submenu && (
        <Box component="span" aria-hidden="true" sx={{ color: token("dim") }}>
          ▸
        </Box>
      )}
    </ButtonBase>
  );
}
