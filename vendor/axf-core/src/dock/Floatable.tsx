/**
 * @file `<Floatable>` — the dock engine's RENDERER: drag by a handle, free
 * float, snap to an edge with the automatic orientation flip previewed while
 * the drag is still in flight, and a way back for anyone who overshoots.
 *
 * `model.ts` decides WHERE (pure, testable without a DOM), `store.ts` decides
 * whether any of it is live and where the answer is kept. This file is the only
 * part that touches a pointer.
 *
 * ## Inert until asked, and inert means ZERO markup
 *
 * With `editing` and `floatable` both off — the default, and the state of every
 * app that never opts in — this component returns its children untouched. Not a
 * wrapper `div` with no styles: nothing. That is what makes "OFF is today's
 * static studio, exactly" a checkable claim rather than a hope, because a
 * wrapper element around the banner would already have changed the layout.
 *
 * ## Docked, and the one honest compromise
 *
 * A panel docked to its NATURAL zone renders in flow, exactly where the host
 * put it — the banner at the top of the shell column is the banner at the top
 * of the shell column, with a handle in front of it. Docked anywhere else it is
 * `position: fixed` against the viewport, because core cannot reorder a host's
 * layout from inside one of its children: moving the banner to the left edge of
 * `AppShell` would mean `AppShell` knowing about docking, and then every host
 * would. A fixed edge strip is what IDE chrome does, it is honest about what it
 * is, and it costs the host nothing.
 *
 * `naturalZone` is therefore the host's statement of "where this thing already
 * is", not a preference.
 *
 * ## The flip is `decide()`, and it is announced
 *
 * Every pointer move calls `decide()`, so the ghost previews the flipped shape
 * before release. The orientation is published two ways: on
 * `data-axf-dock-orientation` for CSS and probes, and through
 * {@link DockOrientationContext} for a child that has to lay itself out
 * differently — which core's own `Toolbar` reads, so a bar snapped to the left
 * edge runs vertically without the host arranging anything.
 *
 * An `aria-live` region announces the zone and orientation as they change,
 * because a drag preview is a purely visual affordance and the flip is the one
 * thing about this interaction somebody could not otherwise know had happened.
 *
 * ## Escape, arrows, and the two defences against a lost panel
 *
 * Escape during a drag restores the state the drag started from — a drag has to
 * be abandonable or a mis-grab is a rearrangement. Arrow keys nudge a floating
 * panel through `nudged()`, which is what makes the handle a real control
 * rather than a mouse target.
 *
 * A panel can still be put somewhere awkward, so there are two defences and
 * they are different in kind: the CLAMP (`clampDockPosition`, applied on every
 * move and on every container resize) keeps a float inside the viewport, and
 * the RESET (`resetLayout`) is the way back when the clamp was not enough — an
 * affordance in the handle's own row, so it travels with the thing that can be
 * lost.
 */
"use client";

import * as React from "react";

import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Tooltip from "@mui/material/Tooltip";

import { Glyph } from "../brand/Glyph";
import { token } from "../theme/apply";
import {
  DOCK_DEFAULT_FLOAT_SIZE,
  DOCK_MIN_FLOAT,
  clampDockPosition,
  decide,
  dockTo,
  floatAt,
  isInFlow,
  nudged,
  orientationFor
} from "./model";
import type { DockDecision, DockOrientation, DockRect, DockState, DockZone } from "./model";
import { dockLayouts, useDockMode, useDockState } from "./store";

/**
 * The orientation the nearest enclosing `<Floatable>` is running at, or null
 * outside one. A CONTEXT rather than a prop, because the thing that needs it —
 * a toolbar asset's renderer — is mounted by a host that has no idea it is
 * inside a floatable, and threading a prop through would make every host learn.
 */
export const DockOrientationContext = React.createContext<DockOrientation | null>(null);

/** The orientation forced by an enclosing `<Floatable>`, or null. A consumer
 *  falls back to its own default — never assumes horizontal. */
export function useDockOrientation(): DockOrientation | null {
  return React.useContext(DockOrientationContext);
}

/** The viewport, as a rect the model can reason about. The container for
 *  chrome-level panels; a pane inside a screen passes its own element. */
function viewportRect(): DockRect {
  return {
    x: 0,
    y: 0,
    width: typeof window === "undefined" ? 0 : window.innerWidth,
    height: typeof window === "undefined" ? 0 : window.innerHeight
  };
}

/** Where a docked-away-from-home panel pins itself. */
const edgeSx = (zone: DockZone) =>
  zone === "top"
    ? { top: 0, left: 0, right: 0 }
    : zone === "bottom"
      ? { bottom: 0, left: 0, right: 0 }
      : zone === "left"
        ? { top: 0, bottom: 0, left: 0 }
        : { top: 0, bottom: 0, right: 0 };

export interface FloatableProps {
  /** Stable id — the key the arrangement persists under. Changing it is a new
   *  panel with a fresh default, never the same panel moved. */
  id: string;
  /** What the handle and the announcements call this. */
  label: string;
  /**
   * Where the host already renders this panel. A panel docked HERE renders in
   * flow and costs the layout nothing; docked anywhere else it pins to that
   * viewport edge. See the docblock.
   */
  naturalZone?: DockZone;
  /**
   * Let this panel float even when only `editing` is on. Chrome (the command
   * bar, module toolbars) is arranged in edit mode; ordinary panes wait for the
   * per-user `floatable` switch. Default: either switch enables it.
   */
  requires?: "editing" | "floatable" | "either";
  /**
   * Does this panel FILL the slot the host gave it, or sit at its own intrinsic
   * size inside it?
   *
   * A bar is intrinsic — it is as tall as a bar, and a wrapper that stretched it
   * would change the chrome the moment the engine was switched on. A pane is
   * not: it is handed a share of a split and is expected to occupy all of it, so
   * an intrinsic wrapper would collapse its content to whatever height it
   * happened to want. Hence a prop rather than a guess, defaulting to the bar
   * case, which is what every panel wrapped before panes existed relied on.
   *
   * It applies ONLY in flow — a floating or edge-docked panel is sized by the
   * engine, and there is no host slot left to fill.
   */
  fill?: boolean;
  children: React.ReactNode;
}

export function Floatable({
  id,
  label,
  naturalZone = "top",
  requires = "either",
  fill = false,
  children
}: FloatableProps) {
  const mode = useDockMode();
  const state = useDockState(id, { mode: "docked", zone: naturalZone });

  /**
   * The two switches differ in SCOPE, not in what they grant.
   *
   * Both make a panel arrangeable; they disagree about which panels. The admin
   * `Edit UI` mode is about the app's own chrome, the per-user `Floatable panes
   * & toolbars` switch is about a person's own panes and bars, and a bar that
   * is both is reachable either way. So `active` and `arrangeable` are the same
   * question — a mode that showed a placement it would not let you change would
   * be a layout nobody could get out of.
   *
   * With both off the panel is INERT: no wrapper element, and the stored
   * arrangement is not applied. The arrangement is not deleted either — that is
   * the rule GizmoX's floatable panes already state, *"a floated layout is
   * remembered, not discarded, while it is off"* — so turning a switch back on
   * restores what was there rather than starting from the defaults.
   */
  const active =
    requires === "editing"
      ? mode.editing
      : requires === "floatable"
        ? mode.floatable
        : mode.editing || mode.floatable;
  const arrangeable = active;

  /** Live drag, or null. Held in state (not a ref) because the ghost renders
   *  from it — the preview IS the drag's visible half. */
  const [drag, setDrag] = React.useState<{
    /** Pointer offset inside the panel, so it does not jump to the cursor. */
    grab: { x: number; y: number };
    decision: DockDecision;
    /** What Escape restores. */
    from: DockState;
  } | null>(null);

  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const stateRef = React.useRef(state);
  stateRef.current = state;

  /* ── the clamp, on every container resize ─────────────────────────────── */
  React.useEffect(() => {
    if (!active) return;
    const onResize = () => {
      const v = viewportRect();
      dockLayouts.clampInto(id, { width: v.width, height: v.height });
    };
    window.addEventListener("resize", onResize);
    // Once on mount too: a layout saved on a wide monitor and restored on a
    // narrow one is exactly the stale-pixel case `clampDockPosition` exists for.
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, [active, id]);

  /* ── the drag ─────────────────────────────────────────────────────────── */

  const beginDrag = React.useCallback(
    (e: React.PointerEvent) => {
      if (!arrangeable) return;
      const rect = rootRef.current?.getBoundingClientRect();
      const from = stateRef.current;
      const grab = rect
        ? { x: e.clientX - rect.left, y: e.clientY - rect.top }
        : { x: 0, y: 0 };
      setDrag({ grab, decision: decide({ x: e.clientX, y: e.clientY }, viewportRect()), from });
      // Capture on the handle, so a fast drag that outruns the pointer keeps
      // receiving moves instead of silently ending over another element.
      e.currentTarget.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    },
    [arrangeable]
  );

  const moveDrag = React.useCallback(
    (e: React.PointerEvent) => {
      if (!drag) return;
      const point = { x: e.clientX, y: e.clientY };
      const decision = decide(point, viewportRect());
      setDrag((d) => (d ? { ...d, decision } : d));

      if (decision.zone === null) {
        // Outside snap range: it is floating, and it follows the hand. The
        // clamp runs here rather than only on release, so the panel cannot be
        // dragged past the edge and released out of reach.
        const size = stateRef.current.size ?? DOCK_DEFAULT_FLOAT_SIZE;
        const v = viewportRect();
        const position = clampDockPosition(
          { x: point.x - drag.grab.x, y: point.y - drag.grab.y },
          size,
          { width: v.width, height: v.height }
        );
        dockLayouts.set(id, {
          ...floatAt(stateRef.current, position, size),
          z: stateRef.current.mode === "floating" ? stateRef.current.z : dockLayouts.nextZ()
        });
      }
    },
    [drag, id]
  );

  const endDrag = React.useCallback(
    (e: React.PointerEvent) => {
      if (!drag) return;
      const zone = drag.decision.zone;
      if (zone) dockLayouts.set(id, dockTo(stateRef.current, zone));
      setDrag(null);
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    },
    [drag, id]
  );

  /* ── keyboard: Escape abandons, arrows nudge ──────────────────────────── */

  const onHandleKey = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape" && drag) {
        dockLayouts.set(id, drag.from);
        setDrag(null);
        e.preventDefault();
        return;
      }
      const step = e.shiftKey ? 16 : 4;
      const delta =
        e.key === "ArrowLeft"
          ? { x: -step, y: 0 }
          : e.key === "ArrowRight"
            ? { x: step, y: 0 }
            : e.key === "ArrowUp"
              ? { x: 0, y: -step }
              : e.key === "ArrowDown"
                ? { x: 0, y: step }
                : null;
      if (!delta || !arrangeable) return;
      const v = viewportRect();
      const current = stateRef.current;
      // An arrow on a DOCKED panel floats it first — otherwise the keyboard can
      // reach half the states the mouse can, which is not an accessibility
      // floor, it is a different feature.
      const base =
        current.mode === "floating"
          ? current
          : floatAt(current, { x: 24, y: 24 }, current.size ?? DOCK_DEFAULT_FLOAT_SIZE);
      dockLayouts.set(id, nudged(base, delta.x, delta.y, { width: v.width, height: v.height }));
      e.preventDefault();
    },
    [arrangeable, drag, id]
  );

  /* ── resize, while floating ───────────────────────────────────────────── */

  const beginResize = React.useCallback(
    (e: React.PointerEvent, dx: -1 | 0 | 1, dy: -1 | 0 | 1) => {
      e.stopPropagation();
      e.preventDefault();
      const start = { x: e.clientX, y: e.clientY };
      const from = stateRef.current;
      const size = from.size ?? DOCK_DEFAULT_FLOAT_SIZE;
      const position = from.position ?? { x: 0, y: 0 };
      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture?.(e.pointerId);

      const onMove = (ev: PointerEvent) => {
        const mx = ev.clientX - start.x;
        const my = ev.clientY - start.y;
        // A west/north grip moves the origin as well as the extent, and the
        // minimum has to bind BOTH or a panel dragged past its floor starts
        // walking backwards across the screen.
        const width = Math.max(DOCK_MIN_FLOAT.width, size.width + dx * mx);
        const height = Math.max(DOCK_MIN_FLOAT.height, size.height + dy * my);
        dockLayouts.set(id, {
          ...from,
          mode: "floating",
          size: { width, height },
          position: {
            x: dx < 0 ? position.x + (size.width - width) : position.x,
            y: dy < 0 ? position.y + (size.height - height) : position.y
          }
        });
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [id]
  );

  /* ── inert ────────────────────────────────────────────────────────────── */

  if (!active) return <>{children}</>;

  const floating = state.mode === "floating";
  const zone = state.zone ?? naturalZone;
  const orientation: DockOrientation = drag
    ? drag.decision.orientation
    : floating
      ? "horizontal"
      : orientationFor(zone);
  // `isInFlow` rather than the predicate spelled out here: a host that lays out
  // around this panel has to reach the same verdict (see `model.ts`).
  const inFlow = isInFlow(state, naturalZone);
  const size = state.size ?? DOCK_DEFAULT_FLOAT_SIZE;
  const ghost = drag?.decision.ghostRect ?? null;

  const handle = arrangeable ? (
    <Box
      sx={{
        display: "flex",
        flexDirection: orientation === "vertical" ? "column" : "row",
        alignItems: "center",
        gap: "2px",
        flexShrink: 0,
        background: token("panel2"),
        borderRadius: "var(--axf-radius-tight)"
      }}
    >
      <Tooltip title={`Drag to move or dock “${label}”`}>
        <ButtonBase
          aria-label={`Move ${label}`}
          onPointerDown={beginDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onHandleKey}
          sx={{
            cursor: drag ? "grabbing" : "grab",
            touchAction: "none",
            px: "3px",
            py: "3px",
            color: token("dim"),
            "&:focus-visible": { outline: `2px solid ${token("accent")}` }
          }}
        >
          <Glyph id="icon-grid" size={12} />
        </ButtonBase>
      </Tooltip>
      {/* The way back, beside the thing that can be lost. Rendered whenever the
          panel can be moved rather than only once it HAS been, so somebody who
          has just dragged a bar off the edge does not have to find a menu. */}
      <Tooltip title={`Reset “${label}” to its default place`}>
        <ButtonBase
          aria-label={`Reset ${label} layout`}
          onClick={() => dockLayouts.resetLayout(id)}
          sx={{ px: "3px", py: "3px", color: token("dim"), "&:focus-visible": { outline: `2px solid ${token("accent")}` } }}
        >
          <Glyph id="icon-undo" size={12} />
        </ButtonBase>
      </Tooltip>
    </Box>
  ) : null;

  return (
    <>
      <Box
        ref={rootRef}
        data-axf-dock={id}
        data-axf-dock-mode={state.mode}
        data-axf-dock-zone={floating ? undefined : zone}
        data-axf-dock-orientation={orientation}
        sx={{
          display: "flex",
          flexDirection: orientation === "vertical" ? "row" : "column",
          minWidth: 0,
          ...(inFlow
            ? fill
              ? { flex: 1, minHeight: 0 }
              : { flexShrink: 0 }
            : {
                position: "fixed",
                zIndex: 1200 + state.z,
                ...(floating
                  ? {
                      left: 0,
                      top: 0,
                      // `transform` rather than left/top so a drag composites
                      // instead of relaying out the whole shell every frame.
                      transform: `translate(${state.position?.x ?? 0}px, ${state.position?.y ?? 0}px)`,
                      width: size.width,
                      height: size.height,
                      background: token("panel"),
                      border: `1px solid ${token("edge")}`,
                      borderRadius: "var(--axf-radius)",
                      boxShadow: "var(--axf-shadow)",
                      overflow: "hidden"
                    }
                  : { ...edgeSx(zone), background: token("panel"), boxShadow: "var(--axf-shadow)" })
              }),
          ...(arrangeable ? { outline: `1px dashed ${token("accent")}`, outlineOffset: -1 } : {})
        }}
        onPointerDown={() => {
          // Raise on focus, in the pointer sense: a click anywhere in a floating
          // panel brings it forward. Docked panels have no stacking to fight.
          if (floating) dockLayouts.set(id, { ...stateRef.current, z: dockLayouts.nextZ() });
        }}
      >
        {handle && (
          <Box
            sx={{
              display: "flex",
              flexDirection: orientation === "vertical" ? "column" : "row",
              alignItems: "center",
              gap: "4px",
              px: orientation === "vertical" ? 0 : "4px",
              py: orientation === "vertical" ? "4px" : 0,
              flexShrink: 0
            }}
          >
            {handle}
          </Box>
        )}
        <DockOrientationContext.Provider value={orientation}>
          <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
            {children}
          </Box>
        </DockOrientationContext.Provider>

        {/* Eight grips, while floating. A loop rather than eight blocks: eight
            hand-written grips is how three of them end up with the wrong
            minimum. */}
        {floating &&
          arrangeable &&
          (
            [
              [-1, -1, "nwse-resize"],
              [0, -1, "ns-resize"],
              [1, -1, "nesw-resize"],
              [1, 0, "ew-resize"],
              [1, 1, "nwse-resize"],
              [0, 1, "ns-resize"],
              [-1, 1, "nesw-resize"],
              [-1, 0, "ew-resize"]
            ] as [-1 | 0 | 1, -1 | 0 | 1, string][]
          ).map(([dx, dy, cursor]) => (
            <Box
              key={`${dx}:${dy}`}
              role="presentation"
              onPointerDown={(e) => beginResize(e, dx, dy)}
              sx={{
                position: "absolute",
                cursor,
                touchAction: "none",
                width: dx === 0 ? "calc(100% - 12px)" : 6,
                height: dy === 0 ? "calc(100% - 12px)" : 6,
                left: dx === 0 ? 6 : dx < 0 ? 0 : undefined,
                right: dx > 0 ? 0 : undefined,
                top: dy === 0 ? 6 : dy < 0 ? 0 : undefined,
                bottom: dy > 0 ? 0 : undefined
              }}
            />
          ))}
      </Box>

      {/* The ghost — where it WOULD land, in the shape it would land in. Drawn
          outside the panel so a fixed strip preview is not clipped by a
          floating panel's own overflow. */}
      {ghost && (
        <Box
          aria-hidden
          sx={{
            position: "fixed",
            left: ghost.x,
            top: ghost.y,
            width: ghost.width,
            height: ghost.height,
            zIndex: 2000,
            pointerEvents: "none",
            background: token("accent"),
            opacity: 0.18,
            border: `2px solid ${token("accent")}`
          }}
        />
      )}

      {/* The flip, said out loud. A preview nobody can see is a preview that
          does not exist for whoever is not looking at it. */}
      <Box
        aria-live="polite"
        sx={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
          whiteSpace: "nowrap"
        }}
      >
        {drag
          ? drag.decision.zone
            ? `${label} will dock ${drag.decision.zone}, running ${drag.decision.orientation}`
            : `${label} will float`
          : ""}
      </Box>
    </>
  );
}

/**
 * The four edges of a container, drawn as drop targets while a rearrangement is
 * possible.
 *
 * Purely an affordance: `decide()` already answers for any point, so a drop
 * works whether or not this is mounted. It exists because an edge you cannot
 * see is an edge you do not know is there — the same reason the ghost exists,
 * one step earlier in the interaction.
 */
export function DockZones({ show }: { show?: boolean }) {
  const mode = useDockMode();
  if (!(show ?? mode.editing)) return null;
  const common = {
    position: "fixed" as const,
    zIndex: 1100,
    pointerEvents: "none" as const,
    background: token("accent"),
    opacity: 0.1
  };
  return (
    <>
      <Box aria-hidden sx={{ ...common, top: 0, left: 0, right: 0, height: 4 }} />
      <Box aria-hidden sx={{ ...common, bottom: 0, left: 0, right: 0, height: 4 }} />
      <Box aria-hidden sx={{ ...common, top: 0, bottom: 0, left: 0, width: 4 }} />
      <Box aria-hidden sx={{ ...common, top: 0, bottom: 0, right: 0, width: 4 }} />
    </>
  );
}
