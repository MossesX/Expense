/**
 * @file The admin dashboard canvas's PURE half — placement in grid cells, the
 * move/resize plan, and the orientation flip.
 *
 * Same split the dock engine itself draws (`core/dock/model.ts` is geometry,
 * `Floatable.tsx` is the only part that touches a pointer): everything here is
 * numbers in and numbers out, so the maths that can be wrong is the maths that
 * can be checked without a DOM.
 *
 * ## The flip IS `decide()`, and that is not decoration
 *
 * The step this canvas was built for says a card "flips between wide and tall
 * orientations when dragged into differently-shaped slots (the engine's
 * `decide()` answers orientation)". {@link orientationOfSlot} is that sentence,
 * literally: it asks the engine which edge of the slot is nearest its centre.
 *
 * That is exactly the shape question, and it falls out of the geometry rather
 * than being a second rule beside it. At the centre of a slot `W × H` the four
 * edge distances are `H/2, H/2, W/2, W/2`. A **wide** slot's nearest edges are
 * the top and bottom, and `orientationFor("top")` is `horizontal`. A **tall**
 * slot's are the left and right, and those answer `vertical`. A square slot is
 * a tie, and the engine's documented tie order (top → bottom → left → right,
 * strict less-than keeps the first) makes it `horizontal` — deterministic, and
 * pinned by the engine's own contract rather than by a coin-flip here.
 *
 * The snap range is passed as `max(W, H)` so the nearest edge always wins and
 * the answer can never be "no zone". That is the one adaptation the canvas
 * makes, and it is the honest one: `decide()`'s default range exists to let a
 * drag MISS every edge and float, and a slot's centre is never trying to miss.
 *
 * ## Cells are the unit, everywhere
 *
 * Placements are 1-based grid cells, not pixels, for the reason the pane engine
 * learned the hard way: a pixel computed before anything is measured latches at
 * whatever the container happened to be. A cell survives a resize, a font
 * change and a monitor swap. Pixels appear in exactly one place — turning a
 * pointer delta into a cell delta — and are gone again by the next line.
 *
 * {@link clampDockPosition} is reused for the clamp, which works because it is
 * pure `min`/`max` over one consistent unit and says nothing about pixels.
 */

import { clampDockPosition, decide, type DockOrientation, type DockRect } from "@axf/core";

/* ================================= placement ================================== */

/** Where one card sits, in 1-based grid cells. */
export interface Slot {
  col: number;
  row: number;
  w: number;
  h: number;
}

export type CanvasLayout = Record<string, Slot>;

/** Columns the canvas runs. Six rather than the user dashboard's four because
 *  an admin card is a gauge, not a panel — six lets a wide card be genuinely
 *  wide (3 cells) while two tall cards still stand beside it. */
export const CANVAS_COLUMNS = 6;

/** One row's height in px. A card is one, two or three of these tall. */
export const CANVAS_ROW_UNIT = 132;

/** Gap between cells, px. */
export const CANVAS_GAP = 12;

/** The tallest a card may be dragged or grown to. A card taller than this is
 *  a page, and a page is a tab. */
export const CANVAS_MAX_ROWS = 12;

const clampInt = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Math.round(n)));

/** Two slots share at least one cell. */
export function overlaps(a: Slot, b: Slot): boolean {
  return (
    a.col < b.col + b.w && b.col < a.col + a.w && a.row < b.row + b.h && b.row < a.row + a.h
  );
}

/**
 * A slot forced inside the canvas: never off the left or the top, never past
 * the last column, never taller than the ceiling.
 *
 * The horizontal half goes through the dock engine's own clamp, in cells. The
 * vertical half does not, and the asymmetry is deliberate: the canvas has a
 * fixed number of COLUMNS and an open number of ROWS — it grows downward as
 * cards are added — so clamping a row against a container height would be
 * inventing a bottom the canvas does not have.
 */
export function clampSlot(slot: Slot): Slot {
  const w = clampInt(slot.w, 1, CANVAS_COLUMNS);
  const h = clampInt(slot.h, 1, CANVAS_MAX_ROWS);
  // Zero-based for the engine, one-based on the way back out.
  const { x } = clampDockPosition(
    { x: slot.col - 1, y: 0 },
    { width: w, height: h },
    { width: CANVAS_COLUMNS, height: CANVAS_MAX_ROWS }
  );
  return { col: Math.round(x) + 1, row: Math.max(1, Math.round(slot.row)), w, h };
}

/* ================================ the flip ==================================== */

/**
 * Which way a card in this slot runs — the automatic flip, answered by the dock
 * engine.
 *
 * `cellW`/`cellH` are the measured pixel size of ONE cell including its gap;
 * the slot's real extent is what decides, so a canvas rendered narrow flips its
 * cards exactly as a person would expect from looking at it rather than from
 * counting cells.
 *
 * A degenerate measurement (before the canvas has laid out) answers from the
 * cell counts instead, which is the same question asked of a square grid — and
 * is never `null`, because a card always has to render something.
 */
export function orientationOfSlot(slot: Slot, cellW: number, cellH: number): DockOrientation {
  const width = cellW > 0 ? slot.w * cellW : slot.w;
  const height = cellH > 0 ? slot.h * cellH : slot.h;
  const rect: DockRect = { x: 0, y: 0, width, height };
  return decide(
    { x: width / 2, y: height / 2 },
    rect,
    // Big enough that the nearest edge always wins — see the docblock.
    Math.max(width, height)
  ).orientation;
}

/* =============================== move / resize ================================ */

/**
 * What a gesture would do. A plan rather than a mutation, so the renderer can
 * paint the outcome (and the refusal) while the pointer is still down.
 *
 * `blocked` is a real outcome and not an error: a card dropped across two other
 * cards has asked for something the canvas cannot honour, and saying so with a
 * red ghost is better than silently choosing one of the several rearrangements
 * that would satisfy it. Nobody can predict which one it picked.
 */
export type CanvasPlan =
  | { ok: true; layout: CanvasLayout; swapped: string | null }
  | { ok: false; reason: "blocked" };

/**
 * Move `id` to `target`.
 *
 * Three cases, in order:
 * - nothing is in the way → it lands;
 * - **exactly one** card is in the way and it fits in the slot being vacated →
 *   the two swap, which is the gesture everybody means when they drag one card
 *   onto another;
 * - anything else → blocked.
 *
 * The swap is conditioned on the vacated slot FITTING, not on the shapes being
 * equal: dragging a 1×1 onto a 3×2 should not silently squash the big card, and
 * checking the fit is how that refusal happens by arithmetic instead of by a
 * special case.
 */
export function planMove(id: string, target: Slot, layout: CanvasLayout): CanvasPlan {
  const from = layout[id];
  if (!from) return { ok: false, reason: "blocked" };
  const want = clampSlot(target);

  const hit = Object.entries(layout).filter(([key, slot]) => key !== id && overlaps(want, slot));
  if (hit.length === 0) {
    return { ok: true, layout: { ...layout, [id]: want }, swapped: null };
  }
  if (hit.length > 1) return { ok: false, reason: "blocked" };

  const [otherId, other] = hit[0];
  const moved = clampSlot({ col: from.col, row: from.row, w: other.w, h: other.h });
  // The vacated slot has to hold the other card WITHOUT growing into a third,
  // and without being silently clamped into a different place than the one it
  // was offered — a clamp that moved it would be the canvas choosing for you.
  if (moved.col !== from.col || moved.row !== from.row || moved.w !== other.w || moved.h !== other.h) {
    return { ok: false, reason: "blocked" };
  }
  // **The two halves of the swap must not overlap EACH OTHER.** For cards of
  // equal shape that is free, which is why it is easy to leave out — and it is
  // exactly what a PARTIAL overlap breaks: drag a 2-wide card one column onto
  // its neighbour and both rectangles want the shared column. Without this the
  // plan is accepted and the canvas paints two cards on top of one another.
  if (overlaps(want, moved)) return { ok: false, reason: "blocked" };
  for (const [key, slot] of Object.entries(layout)) {
    if (key === id || key === otherId) continue;
    if (overlaps(moved, slot)) return { ok: false, reason: "blocked" };
  }
  return { ok: true, layout: { ...layout, [id]: want, [otherId]: moved }, swapped: otherId };
}

/**
 * Resize `id` to `w × h`, anchored at its own top-left.
 *
 * There is no give-way rule here, unlike the user dashboard's column cards: an
 * admin card that shrank a neighbour to make room would change a gauge nobody
 * touched, and a gauge that changed size on its own is a gauge whose reading
 * you stop trusting. A resize into an occupied cell is blocked, and the ghost
 * says so.
 */
export function planResize(id: string, w: number, h: number, layout: CanvasLayout): CanvasPlan {
  const from = layout[id];
  if (!from) return { ok: false, reason: "blocked" };
  const want = clampSlot({ col: from.col, row: from.row, w, h });
  for (const [key, slot] of Object.entries(layout)) {
    if (key === id) continue;
    if (overlaps(want, slot)) return { ok: false, reason: "blocked" };
  }
  return { ok: true, layout: { ...layout, [id]: want }, swapped: null };
}

/* ============================== persisted shape =============================== */

/**
 * Validate a stored layout back into cells, dropping anything that is not a
 * slot. Junk reads as "nobody arranged this", which is the defaults path —
 * the same posture `parseDockState` takes for exactly the same reason: a
 * persisted document is the one input this code does not control.
 *
 * A slot for a card that no longer exists is dropped by the CALLER (it holds
 * the registry, this file does not), and a card with no stored slot falls back
 * to its declared default. Neither is an error; both happen every time the card
 * set changes.
 */
export function parseCanvasLayout(raw: unknown): CanvasLayout {
  if (typeof raw !== "object" || raw === null) return {};
  const out: CanvasLayout = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) continue;
    const v = value as Record<string, unknown>;
    const nums = [v.col, v.row, v.w, v.h].map((n) => Number(n));
    if (nums.some((n) => !Number.isFinite(n) || n < 1)) continue;
    out[id] = clampSlot({ col: nums[0], row: nums[1], w: nums[2], h: nums[3] });
  }
  return out;
}

/** Pixel size of one cell INCLUDING its gap, from the canvas's measured width.
 *  The gap is folded in so a cell delta and a pointer delta are the same
 *  quantity — the pane engine's lesson about measuring before dividing. */
export function canvasCellMetrics(
  canvasWidth: number,
  columns = CANVAS_COLUMNS,
  gap = CANVAS_GAP,
  rowUnit = CANVAS_ROW_UNIT
): { cellW: number; cellH: number } {
  const usable = Math.max(0, canvasWidth - gap * (columns - 1));
  return { cellW: usable / columns + gap, cellH: rowUnit + gap };
}
