/**
 * @file Live drag-and-drop editing of the chrome's DRAWINGS — hot, unsaved,
 * reversible.
 *
 * Owner request, 2026-08-13: *"put a switch at top of branding page that when
 * on allows real time drag and drop editing of the ui. if i drag a logo or
 * banner and drop on logo or banner or icon it will hot render it but not
 * save."*
 *
 * The gallery at `/brand` is the drag SOURCE; the app's own chrome — the
 * banner's logo, its action icons, the nav menu's icons — is the drop TARGET.
 * That is what makes this "editing the ui" rather than editing a preview: the
 * thing you drop on is the real bar, rendered by the real asset, one element
 * above the page you dragged from.
 *
 * ## Why the override lives here and not in the asset
 *
 * A dropped drawing must repaint immediately and must NOT persist. Writing it
 * into the registered asset would do the opposite of both: `SurfaceRegistry`
 * assets are frozen data seeded from `chrome-assets`, so mutating one would
 * either be lost on the next seed or silently become permanent. So the edit is
 * a separate, additive layer — a small store of `(asset, item) → glyph`
 * overrides that the renderers consult and nothing else reads.
 *
 * Committing an edit is therefore NOT a write-back. It is deriving a new
 * toolbar / nav asset from the old one plus these overrides, which is exactly
 * what the owner asked for in the same breath: *"save it as a new asset with a
 * name user is prompted for and then change the layout to render the new asset
 * instead of old one"*. The studio owns that step (it owns the chrome document
 * and the theme dials); core owns only the live layer, so a peeled app that
 * never ships the gallery carries an idle store and nothing else.
 *
 * ## Why it is safe for SSR
 *
 * The state starts empty on BOTH runtimes and only ever changes in response to
 * a pointer gesture that cannot happen before hydration, so the server snapshot
 * is a frozen `IDLE` constant and the two renders agree by construction — the
 * same arrangement `ThemeStore.serverState` and `PackRegistry.serverResolved`
 * use, for the same reason. Nothing here is persisted, mirrored to a cookie, or
 * restored: an unsaved edit that survived a reload would be a saved edit
 * wearing an "unsaved" label.
 *
 * ## Why the drop zone always renders
 *
 * `GlyphDropZone` wraps its child in a span whether or not editing is on, and
 * paints its state with `outline` (which does not take part in layout). If the
 * wrapper appeared only while editing, flipping the switch would restructure
 * the banner's markup under a running app, and every drawing in it would
 * remount. Same markup, different paint — the rule `NavMenu.tsx` states for the
 * layout dials, applied to this.
 */
"use client";

import * as React from "react";
import Box from "@mui/material/Box";

import { token } from "../theme/apply";

/**
 * The drag payload's type. A custom MIME rather than `text/plain` for a
 * mechanical reason: `dataTransfer.getData()` is unreadable during `dragover`
 * in every browser, but `dataTransfer.types` is — so a drop zone can only
 * decide whether to accept a drag by the TYPE. With `text/plain` it would
 * accept a selected paragraph from another tab.
 */
export const BRAND_DRAG_MIME = "application/x-axf-glyph";

/** Which kind of asset an edit is against. Only these two are editable: they
 *  are the two the layout can be repointed at (`bannerBar`, `navMenu`). */
export type BrandEditKind = "toolbar" | "nav";

/** One editable drawing — an item inside a registered asset. */
export interface BrandEditTarget {
  readonly kind: BrandEditKind;
  /** The registered asset's id, i.e. what a derived copy is derived FROM. */
  readonly asset: string;
  /** The item id within that asset. */
  readonly item: string;
}

export interface BrandEdit extends BrandEditTarget {
  /**
   * The glyph the asset itself declares. Kept so a drop back onto the original
   * cancels the edit rather than recording a no-op one, and so a reviewer can
   * see what is being replaced without holding the asset.
   */
  readonly was: string | undefined;
  /** The glyph that was dropped on it. */
  readonly glyph: string;
}

export interface BrandEditState {
  /** The branding page's switch. Drop zones are inert until it is on. */
  readonly editing: boolean;
  /** Pending overrides, in the order they were made. */
  readonly edits: readonly BrandEdit[];
}

/** The identity of a target, for comparison and for `data-` diagnostics. */
export const brandEditKey = (target: BrandEditTarget): string =>
  `${target.kind}:${target.asset}:${target.item}`;

/** Frozen, and returned by reference — see the SSR note in the file docblock. */
const IDLE: BrandEditState = Object.freeze({ editing: false, edits: Object.freeze([]) });

export class BrandEditStore {
  #editing = false;
  #edits: BrandEdit[] = [];
  #snapshot: BrandEditState | null = IDLE;
  readonly #listeners = new Set<() => void>();

  /**
   * Arm or disarm the drop zones.
   *
   * Disarming deliberately KEEPS pending edits. They are still rendered, the
   * unsaved note still offers Save and Discard, and nothing the operator did is
   * destroyed by flicking a switch — a toggle that quietly threw work away
   * would be the worst of the available behaviours, and "stop accepting drops"
   * is what the switch actually says.
   */
  setEditing(on: boolean): void {
    if (on === this.#editing) return;
    this.#editing = on;
    this.#changed();
  }

  /**
   * Record a drop. One override per target — dropping twice on the same slot
   * replaces, it does not stack.
   *
   * Dropping the drawing the asset already declares REMOVES the entry instead
   * of recording it, so putting something back is an undo rather than a second
   * edit the operator then has to save.
   */
  drop(target: BrandEditTarget, glyph: string, was: string | undefined): void {
    const key = brandEditKey(target);
    const rest = this.#edits.filter((e) => brandEditKey(e) !== key);
    this.#edits = glyph === was ? rest : [...rest, { ...target, was, glyph }];
    this.#changed();
  }

  /** Undo one edit, leaving the others. */
  revert(target: BrandEditTarget): void {
    const key = brandEditKey(target);
    const rest = this.#edits.filter((e) => brandEditKey(e) !== key);
    if (rest.length === this.#edits.length) return;
    this.#edits = rest;
    this.#changed();
  }

  /**
   * Empty the pending list.
   *
   * ONE method for both "the operator pressed Discard" and "the edits have been
   * baked into a saved asset", because they are the same operation: the
   * overrides stop applying. Two names for one behaviour is how the two drift
   * apart later.
   */
  clear(): void {
    if (!this.#edits.length) return;
    this.#edits = [];
    this.#changed();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** Stable between changes — `useSyncExternalStore` requires that. */
  snapshot = (): BrandEditState => {
    this.#snapshot ??= { editing: this.#editing, edits: this.#edits };
    return this.#snapshot;
  };

  /** Always idle. See "Why it is safe for SSR" in the file docblock. */
  serverSnapshot = (): BrandEditState => IDLE;

  #changed(): void {
    this.#snapshot = null;
    for (const listener of this.#listeners) listener();
  }
}

/** The process-wide live-edit store. */
export const brandEdits = new BrandEditStore();

export function useBrandEdits(): BrandEditState {
  return React.useSyncExternalStore(
    brandEdits.subscribe,
    brandEdits.snapshot,
    brandEdits.serverSnapshot
  );
}

/**
 * The drawing a slot should render: the pending override when one exists, the
 * asset's own declaration otherwise.
 *
 * Takes the state rather than reading the store, so a renderer subscribes once
 * for a whole bar instead of once per item.
 */
export function editedGlyph(
  state: BrandEditState,
  target: BrandEditTarget | null,
  declared: string | undefined
): string | undefined {
  if (!target || !state.edits.length) return declared;
  const key = brandEditKey(target);
  return state.edits.find((e) => brandEditKey(e) === key)?.glyph ?? declared;
}

/* ------------------------------------------------------------- dragging --- */

/**
 * Mark a drag as carrying a pack drawing. Called by the gallery's tiles.
 *
 * `text/plain` is set as well, and only as a courtesy to anything outside the
 * app that a drawing might be dropped into — the drop zones here read the
 * custom type and nothing else.
 */
export function setGlyphDrag(event: React.DragEvent, glyph: string): void {
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData(BRAND_DRAG_MIME, glyph);
  event.dataTransfer.setData("text/plain", glyph);
}

/** Whether a drag in flight is one of ours. Readable during `dragover`. */
export function isGlyphDrag(event: React.DragEvent): boolean {
  return Array.prototype.includes.call(event.dataTransfer.types, BRAND_DRAG_MIME);
}

/* ----------------------------------------------------------- the target --- */

/**
 * A slot a drawing can be dropped on.
 *
 * `target` is nullable and a null one is inert on purpose. A `<Toolbar>` mounted
 * on a surface the layout cannot be repointed at (a pane bar, an inline
 * placement) has no dial naming it, so an edit there could be rendered and never
 * saved — and a drop zone that accepts an edit nothing can commit is worse than
 * no drop zone. The renderers pass `null` for those and the wrapper stays
 * markup-identical.
 */
export function GlyphDropZone({
  target,
  declared,
  children
}: {
  target: BrandEditTarget | null;
  /** What the asset declares — the value a drop-back cancels against. */
  declared: string | undefined;
  children: React.ReactNode;
}) {
  const { editing, edits } = useBrandEdits();
  const [over, setOver] = React.useState(false);

  const armed = editing && target !== null;
  const key = target ? brandEditKey(target) : null;
  const edited = key !== null && edits.some((e) => brandEditKey(e) === key);

  const accepts = (event: React.DragEvent): boolean => armed && isGlyphDrag(event);

  return (
    <Box
      component="span"
      data-axf-drop={armed ? (key ?? undefined) : undefined}
      data-axf-drop-edited={edited ? "" : undefined}
      onDragOver={(event: React.DragEvent) => {
        if (!accepts(event)) return;
        // Both are required: without preventDefault the browser refuses the
        // drop outright, and dropEffect is what makes the cursor say "copy"
        // rather than the "no entry" that reads as a broken target.
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event: React.DragEvent) => {
        if (!accepts(event) || !target) return;
        event.preventDefault();
        // A bar's items nest inside the bar; without this a drop on an action
        // icon would also be seen by anything wrapping it.
        event.stopPropagation();
        setOver(false);
        const glyph = event.dataTransfer.getData(BRAND_DRAG_MIME);
        if (glyph) brandEdits.drop(target, glyph, declared);
      }}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        flexShrink: 0,
        lineHeight: 0,
        borderRadius: "var(--axf-radius-tight)",
        // `outline`, never `border`: an outline occupies no space, so arming
        // the editor cannot move a single pixel of the bar it is drawn over.
        outlineOffset: "2px",
        outline: over
          ? `2px solid ${token("accent")}`
          : edited
            ? `1px solid ${token("warn")}`
            : armed
              ? `1px dashed ${token("dim")}`
              : "none"
      }}
    >
      {children}
    </Box>
  );
}
