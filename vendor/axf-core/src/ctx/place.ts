/**
 * @file Placement — where a menu panel goes, as arithmetic rather than as CSS.
 *
 * Opening near an edge is where menus embarrass themselves: the bottom-right
 * corner is the one every menu gets wrong, and it is the one nobody notices
 * until a user right-clicks there. So the geometry lives HERE, as pure
 * functions over numbers, and the component (`ContextMenu.tsx`) does nothing
 * but hand them a measured size and apply the answer.
 *
 * That split is the whole point. "Tested at each corner, not eyeballed" — P2's
 * words — is only possible if the corner cases can be *asserted*, and they can
 * only be asserted if flipping and clamping are a function rather than four
 * lines tangled into a layout effect. There is no DOM in this file and no React
 * either, so `ctx-renderer.test.ts` drives all four corners, a viewport smaller
 * than the menu, and a flyout with no room on either side, under `node --test`
 * with no jsdom and no new dependency.
 *
 * ── FLIP, THEN CLAMP, AND REPORT WHICH ────────────────────────────────────────
 *
 * Flipping is preferred because it keeps the menu next to what was clicked;
 * clamping is the fallback that keeps it on screen when flipping does not help
 * (a menu taller than the viewport has no good side). Both happen, in that
 * order, on both axes independently — a click in the bottom-right corner flips
 * both, a click on the right edge halfway down flips one.
 *
 * {@link Placement} reports which of the two applied on each axis. Not for the
 * renderer, which only needs `x`/`y`: for the test, so an assertion can say
 * *"the bottom-right corner FLIPPED"* rather than merely *"the result is
 * on screen"*, which a function that always returned `{x: 6, y: 6}` would also
 * satisfy.
 */

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A measured rectangle — `DOMRect` satisfies it, so do plain objects. */
export interface Box extends Point, Size {}

/** How much of the viewport the panel may never touch. */
export const MENU_MARGIN = 6;

/**
 * How far a flyout slides back over its parent panel.
 *
 * A submenu flush against the parent's edge reads as a second window; a few
 * pixels of overlap reads as one menu that grew. It also means the diagonal
 * mouse path from a parent row to its flyout never crosses a gap, which is what
 * makes hover intent forgiving rather than fussy.
 */
export const FLYOUT_OVERLAP = 4;

/** Vertical nudge so a flyout's first row lines up with the row that opened it. */
export const FLYOUT_LIFT = 4;

export interface Placement {
  readonly x: number;
  readonly y: number;
  /**
   * The tallest the panel may be. Always the usable viewport height, so a
   * panel's measured height never depends on where it was placed — which is
   * what stops measure → place → re-measure from oscillating.
   */
  readonly maxHeight: number;
  readonly flippedX: boolean;
  readonly flippedY: boolean;
  readonly clampedX: boolean;
  readonly clampedY: boolean;
}

interface AxisResult {
  readonly value: number;
  readonly flipped: boolean;
  readonly clamped: boolean;
}

/**
 * One axis: take `prefer`, fall back to `alt` when `prefer` overflows, then
 * clamp whatever survived into the usable band.
 *
 * The flip condition is `alt >= min` and NOT also `alt <= max`, which is the
 * subtlety this function was first written without. A click at the very right
 * edge flips to `x - width`, whose right edge is still the cursor and therefore
 * still inside the margin — so the flipped candidate ALSO needs clamping, by
 * exactly the margin. Requiring it to be clean meant refusing to flip there,
 * and since clamping the unflipped candidate lands on the same coordinate, the
 * placement was right while `flippedX` said `false`. A flag that is only wrong
 * where the geometry is hardest is worse than no flag: it is what a corner test
 * would have been reading.
 *
 * The `Math.max(min, max)` guard is the other degenerate case — a panel larger
 * than the viewport makes `max < min`, and clamping to a band that runs
 * backwards would push it off the *near* edge instead of the far one. Pinning
 * to `min` keeps the top-left of the panel visible, which is where its first
 * rows are.
 */
function axis(prefer: number, alt: number, size: number, extent: number, margin: number): AxisResult {
  const min = margin;
  const max = extent - size - margin;

  let value = prefer;
  let flipped = false;
  if (prefer > max && alt >= min) {
    value = alt;
    flipped = true;
  }

  const clampedValue = Math.min(Math.max(value, min), Math.max(min, max));
  return { value: clampedValue, flipped, clamped: clampedValue !== value };
}

/**
 * Place a root menu at the cursor.
 *
 * Preferred is down-and-right of the point, the direction every desktop menu
 * opens. The alternative is up-and-left, which is what a corner click gets.
 */
export function placeAtPoint(
  at: Point,
  size: Size,
  viewport: Size,
  margin: number = MENU_MARGIN
): Placement {
  const h = axis(at.x, at.x - size.width, size.width, viewport.width, margin);
  const v = axis(at.y, at.y - size.height, size.height, viewport.height, margin);
  return {
    x: h.value,
    y: v.value,
    maxHeight: Math.max(0, viewport.height - margin * 2),
    flippedX: h.flipped,
    flippedY: v.flipped,
    clampedX: h.clamped,
    clampedY: v.clamped
  };
}

/**
 * Place a submenu beside the row that opened it.
 *
 * Horizontally it hangs off the parent PANEL (so every flyout at a level starts
 * at the same x, rather than jittering with each row's text), vertically it
 * aligns to the ROW (so the first child sits next to its parent).
 *
 * The vertical alternative is bottom-aligning the flyout to the row rather than
 * flipping it above: a submenu that jumps to the other side of the cursor has
 * lost its connection to the row that opened it, and the row is the only thing
 * explaining why the flyout exists.
 */
export function placeFlyout(
  row: Box,
  panel: Box,
  size: Size,
  viewport: Size,
  margin: number = MENU_MARGIN,
  overlap: number = FLYOUT_OVERLAP
): Placement {
  const h = axis(
    panel.x + panel.width - overlap,
    panel.x - size.width + overlap,
    size.width,
    viewport.width,
    margin
  );
  const v = axis(
    row.y - FLYOUT_LIFT,
    row.y + row.height - size.height + FLYOUT_LIFT,
    size.height,
    viewport.height,
    margin
  );
  return {
    x: h.value,
    y: v.value,
    maxHeight: Math.max(0, viewport.height - margin * 2),
    flippedX: h.flipped,
    flippedY: v.flipped,
    clampedX: h.clamped,
    clampedY: v.clamped
  };
}

/**
 * Is the placed panel entirely inside the viewport's usable band?
 *
 * The single assertion every corner case in the test ends with. It is exported
 * rather than written into the test because it is also the honest definition of
 * "placed correctly", and a definition that lives in one test file is a
 * definition the next test file gets subtly wrong.
 *
 * A panel too large for the viewport can never satisfy it — that case asserts
 * on `clamped` and on the top-left corner instead.
 */
export function isOnScreen(
  placement: Placement,
  size: Size,
  viewport: Size,
  margin: number = MENU_MARGIN
): boolean {
  return (
    placement.x >= margin &&
    placement.y >= margin &&
    placement.x + size.width <= viewport.width - margin &&
    placement.y + size.height <= viewport.height - margin
  );
}
