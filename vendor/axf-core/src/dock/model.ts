/**
 * @file The dock model — the pure half of the dock/float engine: the state
 * contract, the snap decision, the clamps and the persisted-state parser.
 * Everything here is testable without a DOM (same posture as `panes/model.ts`),
 * which is where the math that can be wrong belongs.
 *
 * **The design decision this file exists to hold: `decide()` IS the automatic
 * flip.** A drag point near the top or bottom edge answers `horizontal`; near
 * the left or right edge it answers `vertical`. The renderer calls it on every
 * pointer move, so the panel knows which way it will run WHILE the drag is
 * still in flight — the ghost previews the flipped shape before anything is
 * released, and the flip is a total function of the zone rather than a second
 * rule a component could get wrong. Recorded in AXF_CAPABILITIES
 * (`dock-float-engine`).
 *
 * Coordinates are any ONE consistent space — in practice the renderer passes
 * client space (`getBoundingClientRect` + `clientX/Y`) and the `ghostRect`
 * comes back in that same space. Nothing here reads the DOM, so a unit test
 * passes plain numbers.
 *
 * Floating positions are PIXELS, unlike pane sizes, and that is not a
 * contradiction of the fraction-first lesson: a float exists only because a
 * drag created it, and a drag carries its own measurement by definition. The
 * pane bug was pixels computed BEFORE anything measured; here nothing is a
 * pixel until an interaction has already measured itself. The one place a
 * stale pixel can still lie — a container that shrank since the state was
 * saved — is what {@link clampDockPosition} exists for, applied on restore and
 * on every move.
 */

export type DockZone = "top" | "bottom" | "left" | "right";
export type DockOrientation = "horizontal" | "vertical";
export type DockMode = "docked" | "floating";

export interface DockPoint {
  x: number;
  y: number;
}

export interface DockSize {
  width: number;
  height: number;
}

export interface DockRect extends DockPoint, DockSize {}

/** One panel's whole dock/float situation — the unit the adapter persists. */
export interface DockState {
  mode: DockMode;
  /** Which container edge, while docked. Undefined while floating. */
  zone?: DockZone;
  /** Which way the content runs. Docked: a total function of the zone
   *  ({@link orientationFor}); floating: horizontal, the free-panel default. */
  orientation: DockOrientation;
  /** Container-relative top-left, while floating. */
  position?: DockPoint;
  /** Floating extent. A docked panel is sized by the zone's own layout. */
  size?: DockSize;
  /** Stacking order among floating panels; raised on focus. */
  z: number;
}

/** What {@link decide} answers on every pointer move of a drag. */
export interface DockDecision {
  /** The edge the panel would snap to on release, or null → it would float. */
  zone: DockZone | null;
  /** The orientation that zone implies — THE automatic flip. `horizontal`
   *  when `zone` is null, because a released float runs horizontal. */
  orientation: DockOrientation;
  /** Where the ghost preview draws, in the caller's coordinate space.
   *  Null exactly when `zone` is null. */
  ghostRect: DockRect | null;
}

/** How close (px) a drag point must be to an edge before it snaps. */
export const DOCK_SNAP_RANGE_PX = 48;

/** Ghost strip thickness (px) — a preview, not the mounted panel's real
 *  extent, which the zone's layout decides from the content. */
export const DOCK_GHOST_PX = 56;

/** A resize may not shrink a floating panel below this. */
export const DOCK_MIN_FLOAT: DockSize = { width: 120, height: 48 };

/** What a float measures when nothing was ever resized. */
export const DOCK_DEFAULT_FLOAT_SIZE: DockSize = { width: 320, height: 220 };

/** The orientation a zone implies. Top/bottom run horizontal, left/right run
 *  vertical; a floating panel (null) runs horizontal. */
export const orientationFor = (zone: DockZone | null): DockOrientation =>
  zone === "left" || zone === "right" ? "vertical" : "horizontal";

/**
 * The snap decision — pure, called on every pointer move.
 *
 * The nearest edge within `snapRangePx` wins, measured from the DRAG POINT
 * (the pointer), not the panel: snapping follows the hand, so a large panel
 * cannot snap to an edge the pointer never approached. A point outside the
 * container answers null — that is "undock by dragging out" falling out of
 * the geometry rather than being a special case.
 *
 * Ties (a corner, exactly equidistant) resolve in evaluation order
 * top → bottom → left → right: strict less-than keeps the first, so the
 * answer is deterministic and a test can pin it.
 *
 * A degenerate container (zero or negative extent) answers null, for the same
 * reason `applyDrag` refuses a zero extent in the pane model — math against
 * nothing produces latches, not layouts.
 */
export function decide(
  dragPoint: DockPoint,
  containerRect: DockRect,
  snapRangePx: number = DOCK_SNAP_RANGE_PX,
  ghostPx: number = DOCK_GHOST_PX
): DockDecision {
  const none: DockDecision = { zone: null, orientation: "horizontal", ghostRect: null };
  if (!(containerRect.width > 0) || !(containerRect.height > 0)) return none;

  const { x, y } = dragPoint;
  const right = containerRect.x + containerRect.width;
  const bottom = containerRect.y + containerRect.height;
  if (x < containerRect.x || x > right || y < containerRect.y || y > bottom) return none;

  const edges: { zone: DockZone; distance: number }[] = [
    { zone: "top", distance: y - containerRect.y },
    { zone: "bottom", distance: bottom - y },
    { zone: "left", distance: x - containerRect.x },
    { zone: "right", distance: right - x }
  ];
  let nearest = edges[0];
  for (const e of edges) if (e.distance < nearest.distance) nearest = e;
  if (nearest.distance > snapRangePx) return none;

  const zone = nearest.zone;
  // A ghost never previews more than half the container — a strip that
  // swallows the content it is about to sit beside reads as a takeover.
  const thickness =
    zone === "left" || zone === "right"
      ? Math.min(ghostPx, containerRect.width / 2)
      : Math.min(ghostPx, containerRect.height / 2);

  const ghostRect: DockRect =
    zone === "top"
      ? { x: containerRect.x, y: containerRect.y, width: containerRect.width, height: thickness }
      : zone === "bottom"
        ? { x: containerRect.x, y: bottom - thickness, width: containerRect.width, height: thickness }
        : zone === "left"
          ? { x: containerRect.x, y: containerRect.y, width: thickness, height: containerRect.height }
          : { x: right - thickness, y: containerRect.y, width: thickness, height: containerRect.height };

  return { zone, orientation: orientationFor(zone), ghostRect };
}

/**
 * Keep a floating panel inside its container. When the panel fits, the whole
 * of it stays visible; when the container is smaller than the panel, it pins
 * to the origin rather than clamping into negative space — the handle is at
 * the top-left, and a reachable handle is the one property a clamp must never
 * cost.
 */
export function clampDockPosition(
  position: DockPoint,
  size: DockSize,
  container: DockSize
): DockPoint {
  return {
    x: Math.min(Math.max(0, position.x), Math.max(0, container.width - size.width)),
    y: Math.min(Math.max(0, position.y), Math.max(0, container.height - size.height))
  };
}

/** Arrow-key movement of a floating panel. Docked panels do not nudge — their
 *  place is the zone's, not a coordinate — so the state comes back unchanged. */
export function nudged(
  state: DockState,
  dx: number,
  dy: number,
  container?: DockSize
): DockState {
  if (state.mode !== "floating") return state;
  const size = state.size ?? DOCK_DEFAULT_FLOAT_SIZE;
  const raw = {
    x: (state.position?.x ?? 0) + dx,
    y: (state.position?.y ?? 0) + dy
  };
  const position = container ? clampDockPosition(raw, size, container) : raw;
  return { ...state, position };
}

/**
 * Does this panel still render where its host put it?
 *
 * "In flow" is the one question a HOST has to be able to ask, and the reason it
 * lives here rather than inside `<Floatable>`: the renderer needs it to choose
 * between `flexShrink` and `position: fixed`, and a host laying panels out
 * around it needs the same answer to collapse the slot a departed panel left
 * behind (`panes/PaneLayout.tsx` does exactly that). Two definitions of "is it
 * still there" would disagree the moment one of them grew a case, and the
 * disagreement would be a hole in a layout that nothing reported.
 *
 * A panel docked to its natural zone is in flow; floating, or docked to any
 * other edge, is not. An absent `zone` reads as the natural one — that is the
 * defaults path, i.e. nobody has moved it.
 */
export function isInFlow(state: DockState, naturalZone: DockZone): boolean {
  return state.mode !== "floating" && (state.zone ?? naturalZone) === naturalZone;
}

/** The dock transition. Orientation follows the zone — the flip, again, as the
 *  same total function rather than a second opinion. */
export function dockTo(state: DockState, zone: DockZone): DockState {
  return { ...state, mode: "docked", zone, orientation: orientationFor(zone) };
}

/** The float transition. The zone is dropped, not remembered — a re-dock is a
 *  new decision by a new drag, never a restore of a stale edge. */
export function floatAt(state: DockState, position: DockPoint, size?: DockSize): DockState {
  return {
    ...state,
    mode: "floating",
    zone: undefined,
    orientation: "horizontal",
    position,
    size: size ?? state.size ?? DOCK_DEFAULT_FLOAT_SIZE
  };
}

/**
 * The defaults path — what "revert" reverts TO. A caller's partial wins over
 * the engine's baseline (docked to the top, horizontal), and the result is
 * always internally consistent: a docked default gets its zone's orientation
 * whatever the partial said, and a floating default always has a position and
 * size to draw at.
 */
export function resolveDockDefault(partial?: Partial<DockState>): DockState {
  const mode: DockMode = partial?.mode ?? "docked";
  const zone: DockZone | undefined = mode === "docked" ? (partial?.zone ?? "top") : undefined;
  return {
    mode,
    zone,
    orientation: mode === "docked" ? orientationFor(zone ?? "top") : "horizontal",
    position:
      mode === "floating" ? (partial?.position ?? { x: 24, y: 24 }) : partial?.position,
    size: partial?.size ?? (mode === "floating" ? DOCK_DEFAULT_FLOAT_SIZE : undefined),
    z: partial?.z ?? 1
  };
}

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const isPoint = (v: unknown): v is DockPoint =>
  typeof v === "object" && v !== null && isFiniteNumber((v as DockPoint).x) && isFiniteNumber((v as DockPoint).y);

const isSize = (v: unknown): v is DockSize =>
  typeof v === "object" &&
  v !== null &&
  isFiniteNumber((v as DockSize).width) &&
  (v as DockSize).width > 0 &&
  isFiniteNumber((v as DockSize).height) &&
  (v as DockSize).height > 0;

/**
 * Validate a persisted value back into a `DockState`, or null.
 *
 * Junk answers null rather than throwing, because a persisted doc is the ONE
 * input the engine does not control — a hand-edited file, an older format, a
 * truncated write — and the correct reading of all of them is "nobody decided",
 * which is the defaults path. Same posture as the permission store's "a junk
 * file reads as nothing recorded".
 *
 * Repairs rather than rejects where the fix is unambiguous: a docked state's
 * orientation is recomputed from its zone (the flip is not something a stored
 * doc gets a vote on), and a floating state missing its geometry gets the
 * defaults. Rejects where it is not: an unknown mode, a docked state with an
 * unknown zone.
 */
export function parseDockState(raw: unknown): DockState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.mode !== "docked" && r.mode !== "floating") return null;
  const z = isFiniteNumber(r.z) && r.z >= 0 ? r.z : 1;

  if (r.mode === "docked") {
    if (r.zone !== "top" && r.zone !== "bottom" && r.zone !== "left" && r.zone !== "right") {
      return null;
    }
    return {
      mode: "docked",
      zone: r.zone,
      orientation: orientationFor(r.zone),
      position: isPoint(r.position) ? r.position : undefined,
      size: isSize(r.size) ? r.size : undefined,
      z
    };
  }

  return {
    mode: "floating",
    orientation: "horizontal",
    position: isPoint(r.position) ? r.position : { x: 24, y: 24 },
    size: isSize(r.size) ? r.size : DOCK_DEFAULT_FLOAT_SIZE,
    z
  };
}
