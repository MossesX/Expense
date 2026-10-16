/**
 * @file **THE ADMIN DASHBOARD** — the platform's gauges on a card canvas, and
 * the admin landing P8 points sign-in at (`/accounts?surface=admin&tab=dashboard`).
 *
 * This replaces the administrator overview that used to be the suite's Dashboard
 * tab. `AdminPane`'s docblock said the overview was staying *"until it is
 * genuinely replaced"* — this is that. Nothing was lost on the way: the counts
 * are cards, the online roster is a card, the per-account storage table is the
 * top-consumers card, and the one destructive control the overview carried —
 * `remove-user-data` — moved to `./RemoveDataDialog` and is fired from the
 * Storage card, beside the numbers that make somebody want it.
 *
 * ## The canvas is the dock engine's geometry, not its renderer
 *
 * P6 ships two things: `<Floatable>` (one panel, dragged around a container,
 * docking to its four edges) and the pure model underneath it. A canvas of
 * seven cards is not seven `<Floatable>`s — four edge zones cannot arrange seven
 * panels, and every card would be `position: fixed` fighting the others for the
 * same strip. So this screen uses the MODEL: `decide()` answers the flip,
 * `clampDockPosition` clamps the placement, and `./adminCanvas` holds both
 * behind a cells-in, cells-out API that can be reasoned about without a DOM.
 *
 * The user dashboard, whose cards genuinely are one panel each, uses
 * `<Floatable>` directly. Same engine, two consumers, and the difference is the
 * shape of the surface rather than a preference.
 *
 * ## The flip, and what a card is allowed to say about it
 *
 * Drag a card into a differently-shaped slot and it re-composes: a wide slot
 * runs `horizontal`, a tall one runs `vertical`, and `decide()` is what answers
 * (see `./adminCanvas` for why that is the shape question and not a second rule
 * beside it). A card that genuinely has only one composition declares `shapes`
 * and keeps it, with `wide only` / `tall only` in its header — **the refusal is
 * visible**. A card that silently rendered its wide layout in a one-cell column
 * would look like a bug in the canvas rather than a decision by the card.
 *
 * ## Per-admin persistence, through the settings spine
 *
 * The arrangement is one kv document (`admin-dashboard`) on the same per-user
 * transport every settings document rides — `/api/axf/kv/<ns>`, keyed off the
 * `axs_session` cookie by `kvUser()`. So it follows the administrator across
 * browsers rather than living in one profile's `localStorage`, exactly as P8's
 * dock layouts do.
 *
 * It is deliberately NOT stored through `dockLayouts`: that store's unit is a
 * `DockState` — a mode, an edge and a pixel rect — and a canvas slot is four
 * integers in cells. Encoding cells into a `position`/`size` meant for pixels
 * would be a lie the next reader has to decode, and `clampInto` would then
 * "helpfully" clamp cell counts against a viewport. One small document of the
 * right shape beats reusing one of the wrong shape.
 *
 * Reads happen in an effect, never during render, and the server render shows
 * the shipped arrangement — the standing hydration rule. Writes are debounced,
 * so a drag is one request rather than one per frame.
 */
"use client";

import * as React from "react";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Boundary, Glyph, defaultKv, token, type DockOrientation } from "@axf/core";

import { onAccountsCtx } from "./accounts.commands";
import { ADMIN_CARDS, type AdminCardSpec } from "./adminCards";
import {
  CANVAS_COLUMNS,
  CANVAS_GAP,
  CANVAS_ROW_UNIT,
  canvasCellMetrics,
  orientationOfSlot,
  parseCanvasLayout,
  planMove,
  planResize,
  type CanvasLayout,
  type Slot,
} from "./adminCanvas";
import { fetchDashboardFacts, type DashboardFacts } from "./adminDashboardApi";

/* ================================ persistence ================================= */

/** The kv namespace holding THIS administrator's canvas arrangement. */
const LAYOUT_NS = "admin-dashboard";
const LAYOUT_VERSION = 1;
/** Long enough that a drag is one write; short enough that closing the tab
 *  straight after a drag still keeps it. Same figure, same reasoning, as the
 *  dock adapter's own debounce. */
const WRITE_DEBOUNCE_MS = 250;

/** How often the snapshot re-reads itself. Long, because these are gauges and
 *  not a live feed — and because the route reads every member's storage index
 *  to answer, which is not a thing to do every second. */
const REFRESH_MS = 60_000;

/* ================================== the card ================================== */

/** Which grip a pointer grabbed. `move` is the whole card. */
type Grip = "move" | "e" | "s" | "se";

interface Gesture {
  grip: Grip;
  id: string;
  x: number;
  y: number;
  from: Slot;
  /** Measured once at pointer-down: the canvas cannot change width mid-drag,
   *  and re-measuring per move would read a width the draft had already moved. */
  cellW: number;
  cellH: number;
}

/** The shipped arrangement — every card at its declared place. */
const seedLayout = (): CanvasLayout =>
  Object.fromEntries(ADMIN_CARDS.map((c) => [c.id, { ...c.place }]));

/** The composition a card will actually render: the slot's answer, unless the
 *  card declared it only has one. */
function compositionOf(spec: AdminCardSpec, slotSays: DockOrientation): DockOrientation {
  if (spec.shapes === "wide") return "horizontal";
  if (spec.shapes === "tall") return "vertical";
  return slotSays;
}

/* ================================ the screen ================================== */

export default function AdminDashboard() {
  const [layout, setLayout] = React.useState<CanvasLayout>(seedLayout);
  const [facts, setFacts] = React.useState<DashboardFacts | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  /* ── the snapshot ───────────────────────────────────────────────────────── */

  const load = React.useCallback(async () => {
    setBusy(true);
    const answer = await fetchDashboardFacts();
    if (answer.ok) {
      setFacts(answer.data);
      setError(null);
    } else {
      // The stale snapshot stays on screen beside the error: a dashboard that
      // blanks itself on one failed poll has thrown away the last thing it knew.
      setError(answer.error);
    }
    setBusy(false);
  }, []);

  React.useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  /* ── the arrangement ────────────────────────────────────────────────────── */

  const hydrated = React.useRef(false);
  const writeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read AFTER mount, never during render — the server has no user and a
  // layout applied during hydration tears the tree.
  React.useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const doc = await defaultKv().read(LAYOUT_NS);
        if (!live || !doc || doc.v !== LAYOUT_VERSION) return;
        const stored = parseCanvasLayout((doc as { slots?: unknown }).slots);
        // Merge over the seed rather than replace it: a card added since the
        // document was written must appear at its declared place, and a slot
        // for a card that no longer exists must not linger in the grid.
        setLayout({ ...seedLayout(), ...pickKnown(stored) });
      } catch {
        // Unreadable storage: the shipped arrangement stands, and is not
        // written back over whatever is really there.
      } finally {
        if (live) hydrated.current = true;
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const persist = React.useCallback((next: CanvasLayout) => {
    if (!hydrated.current) return;
    if (writeTimer.current) clearTimeout(writeTimer.current);
    writeTimer.current = setTimeout(() => {
      void defaultKv()
        .write(LAYOUT_NS, { v: LAYOUT_VERSION, slots: next })
        .catch(() => {
          // Route down: the arrangement holds for the session.
        });
    }, WRITE_DEBOUNCE_MS);
  }, []);

  const commit = React.useCallback(
    (next: CanvasLayout) => {
      setLayout(next);
      persist(next);
    },
    [persist]
  );

  /** Back to the shipped arrangement. The way out for somebody who has dragged
   *  a card somewhere it will not go back from. */
  const resetLayout = () => commit(seedLayout());

  /**
   * The card menu's three arrangement rows (P10).
   *
   * All three go through `commit`, which is the persist path the drag already
   * uses — so a menu-driven change is remembered exactly like a dragged one and
   * there is no second way for the canvas to end up in a state the document
   * disagrees with.
   *
   * **Flip** swaps the slot's cells and asks the canvas, not the card. The
   * composition a card renders is `orientationOfSlot()`'s answer about the slot
   * it is in (`./adminCanvas`), so the honest way to flip a card is to change
   * the slot's shape and let the same `decide()` that answers a drag answer this
   * — a row that flipped the COMPOSITION directly would be a second source of
   * truth about orientation, and the first thing to disagree with it would be
   * the next drag. A flip blocked by a neighbour is refused rather than forced,
   * the same refusal `planResize` gives a drag: an admin card that shrank a
   * neighbour to make room would change a gauge nobody touched.
   *
   * **Reset this card** puts one card back at its declared place, and is
   * likewise refused if something has since moved into it. Both refusals are
   * silent because the card visibly does not move, which is the whole message.
   */
  React.useEffect(
    () =>
      onAccountsCtx((s) => {
        if (s.kind === "layout-reset") {
          resetLayout();
          return;
        }
        if (s.kind === "card-flip") {
          const slot = layout[s.card];
          if (!slot) return;
          const plan = planResize(s.card, slot.h, slot.w, layout);
          if (plan.ok) commit(plan.layout);
          return;
        }
        if (s.kind === "card-reset") {
          const spec = ADMIN_CARDS.find((c) => c.id === s.card);
          if (!spec) return;
          const plan = planMove(s.card, { ...spec.place }, layout);
          if (plan.ok) commit(plan.layout);
        }
      }),
    [layout, commit],
  );

  /* ── the gesture ────────────────────────────────────────────────────────── */

  const canvasRef = React.useRef<HTMLDivElement | null>(null);
  const [gesture, setGesture] = React.useState<Gesture | null>(null);
  /** The arrangement the live gesture would produce, painted while the pointer
   *  is down. Null while the gesture is BLOCKED — the card stays put and the
   *  outline goes red. */
  const [draft, setDraft] = React.useState<CanvasLayout | null>(null);
  const [blocked, setBlocked] = React.useState(false);
  /** The draft, readable synchronously: `pointerup` must commit what the last
   *  `pointermove` computed, and both can arrive in one task. */
  const draftRef = React.useRef<CanvasLayout | null>(null);

  const putDraft = React.useCallback((next: CanvasLayout | null, isBlocked: boolean) => {
    draftRef.current = next;
    setDraft(next);
    setBlocked(isBlocked);
  }, []);

  const startGesture = (grip: Grip, id: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // A grab that landed on a control inside the card belongs to the control.
    if (
      grip === "move" &&
      (e.target as HTMLElement).closest("button,a,input,select,textarea,[role='button']")
    ) {
      return;
    }
    const from = layout[id];
    const width = canvasRef.current?.getBoundingClientRect().width ?? 0;
    if (!from || width <= 0) return;
    e.preventDefault();
    e.stopPropagation();
    const { cellW, cellH } = canvasCellMetrics(width);
    setGesture({ grip, id, x: e.clientX, y: e.clientY, from, cellW, cellH });
    putDraft(layout, false);
  };

  React.useEffect(() => {
    if (!gesture) return;
    const { grip, id, x, y, from, cellW, cellH } = gesture;

    const onMove = (e: PointerEvent) => {
      const dCol = Math.round((e.clientX - x) / cellW);
      const dRow = Math.round((e.clientY - y) / cellH);
      const plan =
        grip === "move"
          ? planMove(id, { ...from, col: from.col + dCol, row: from.row + dRow }, layout)
          : planResize(
              id,
              grip === "s" ? from.w : from.w + dCol,
              grip === "e" ? from.h : from.h + dRow,
              layout
            );
      if (plan.ok) putDraft(plan.layout, false);
      else putDraft(null, true);
    };

    const finish = () => {
      const d = draftRef.current;
      if (d) commit(d);
      putDraft(null, false);
      setGesture(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    const prevSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      document.body.style.userSelect = prevSelect;
    };
  }, [gesture, layout, commit, putDraft]);

  const shown = draft ?? layout;

  /** Cell metrics for the ORIENTATION question — measured, so the flip follows
   *  what the canvas actually looks like rather than what its column count
   *  implies. Zero before the first layout, which `orientationOfSlot` handles. */
  const [cell, setCell] = React.useState({ cellW: 0, cellH: CANVAS_ROW_UNIT + CANVAS_GAP });
  React.useEffect(() => {
    const el = canvasRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setCell(canvasCellMetrics(el.getBoundingClientRect().width));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ── the grip ───────────────────────────────────────────────────────────── */

  const grip = (g: "e" | "s" | "se", id: string) => (
    <Box
      component="span"
      key={g}
      className="axs-admin-grip"
      onPointerDown={startGesture(g, id)}
      sx={{
        position: "absolute",
        zIndex: 2,
        opacity: 0,
        transition: "opacity 120ms",
        background: token("accent"),
        borderRadius: "2px",
        ...(g === "e" ? { top: 8, bottom: 8, right: -1, width: 4, cursor: "ew-resize" } : null),
        ...(g === "s" ? { left: 8, right: 8, bottom: -1, height: 4, cursor: "ns-resize" } : null),
        ...(g === "se"
          ? { right: -1, bottom: -1, width: 12, height: 12, cursor: "nwse-resize" }
          : null),
      }}
    />
  );

  /* ── render ─────────────────────────────────────────────────────────────── */

  return (
    <Stack sx={{ gap: 1.5, minHeight: 0 }}>
      <style>{`
        .axs-admin-card:hover .axs-admin-grip { opacity: 0.55; }
        .axs-admin-card[data-dragging="true"] .axs-admin-grip { opacity: 0.55; }
      `}</style>

      {/* The canvas toolbar. */}
      <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <Typography sx={{ fontSize: 13.5, fontWeight: 700 }}>Administration</Typography>
        <Typography sx={{ fontSize: 10.5, color: token("dim"), fontFamily: token("mono") }}>
          {facts ? `read ${new Date(facts.generatedAt).toLocaleTimeString()}` : "reading…"}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Every card back to its shipped place">
          <Button
            variant="outlined"
            size="small"
            startIcon={<Glyph id="icon-reload" size={13} />}
            onClick={resetLayout}
          >
            Reset layout
          </Button>
        </Tooltip>
        <Tooltip title="Re-read every gauge">
          <span>
            <Button
              variant="outlined"
              size="small"
              disabled={busy}
              startIcon={busy ? <CircularProgress size={12} /> : <Glyph id="icon-sync" size={13} />}
              onClick={() => void load()}
            >
              Refresh
            </Button>
          </span>
        </Tooltip>
      </Stack>

      {error && (
        <Alert severity="error" variant="outlined" sx={{ fontSize: 12 }}>
          {error}
          {facts ? " — the figures below are the last good read." : ""}
        </Alert>
      )}

      {/* The grid. Positioned tracks, fixed row unit: one row is one drag step. */}
      <Box
        ref={canvasRef}
        // The canvas itself carries no area — `accounts.suite` is one level up
        // and already covers the empty space between cards, and a third nested
        // area here would spend a slot of `MAX_CONTRIBUTING_AREAS` on rows that
        // are the suite's anyway. The CARDS are the surface with rows of their
        // own; see `accounts.decl.ts` on the cap.
        data-axs-admin-canvas=""
        sx={{
          display: "grid",
          gridTemplateColumns: `repeat(${CANVAS_COLUMNS}, minmax(0, 1fr))`,
          gridAutoRows: `${CANVAS_ROW_UNIT}px`,
          gap: `${CANVAS_GAP}px`,
        }}
      >
        {ADMIN_CARDS.map((spec) => {
          const slot = shown[spec.id] ?? spec.place;
          const dragging = gesture?.id === spec.id;
          const slotSays = orientationOfSlot(slot, cell.cellW, cell.cellH);
          const composition = compositionOf(spec, slotSays);
          const refusing = spec.shapes !== "both" && composition !== slotSays;

          return (
            <Paper
              key={spec.id}
              component="section"
              elevation={0}
              className="axs-admin-card"
              data-axs-admin-card={spec.id}
              // The card area, and the card the rows act on (P10).
              data-axf-area="accounts.card"
              data-axf-card={spec.id}
              data-axf-dock-orientation={composition}
              data-dragging={dragging || undefined}
              sx={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                gridColumn: `${slot.col} / span ${slot.w}`,
                gridRow: `${slot.row} / span ${slot.h}`,
                p: 1.25,
                background: token("panel"),
                backgroundImage: "none",
                border: `1px solid ${
                  dragging && blocked ? token("err") : dragging ? token("accent") : token("edge")
                }`,
                borderRadius: token("radius"),
                zIndex: dragging ? 3 : undefined,
                boxShadow: dragging ? token("shadow") : "none",
                transition: dragging ? "none" : "border-color 120ms, box-shadow 120ms",
              }}
            >
              {/* Drag by the header. */}
              <Stack
                direction="row"
                onPointerDown={startGesture("move", spec.id)}
                sx={{
                  alignItems: "center",
                  gap: 0.75,
                  mb: 0.75,
                  flexShrink: 0,
                  cursor: dragging ? "grabbing" : "grab",
                  touchAction: "none",
                }}
              >
                <Glyph id={spec.glyph} size={14} />
                <Tooltip title={spec.description}>
                  <Typography
                    component="span"
                    sx={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: token("dim"),
                    }}
                  >
                    {spec.title}
                  </Typography>
                </Tooltip>
                {refusing && (
                  <Tooltip
                    title={`This card only has a ${spec.shapes} composition, so it keeps it in a ${
                      slotSays === "vertical" ? "tall" : "wide"
                    } slot.`}
                  >
                    <Typography
                      component="span"
                      sx={{ fontSize: 9.5, color: token("warn"), fontFamily: token("mono") }}
                    >
                      {spec.shapes} only
                    </Typography>
                  </Tooltip>
                )}
                <Box sx={{ flex: 1 }} />
                <Typography
                  component="span"
                  aria-hidden
                  sx={{ color: token("dim"), opacity: 0.5, fontSize: 11, letterSpacing: "1px" }}
                >
                  ⋮⋮
                </Typography>
              </Stack>

              {/* One card failing is one gauge lost, never the dashboard. */}
              <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                <Boundary tier="contribution" source={`admin-dashboard → ${spec.id}`} compact>
                  {spec.render({ facts, orientation: composition, reload: () => void load() })}
                </Boundary>
              </Box>

              {(["e", "s", "se"] as const).map((g) => grip(g, spec.id))}
            </Paper>
          );
        })}
      </Box>

      <Typography sx={{ fontSize: 10.5, color: token("dim") }}>
        Drag a card by its header, resize from its edges. A card dropped in a differently-shaped
        slot re-composes; one that only has a single shape says so and keeps it. The arrangement is
        yours alone and follows you between browsers.
      </Typography>
    </Stack>
  );
}

/** Stored slots for cards that still exist. A card removed since the document
 *  was written leaves a slot behind, and a leftover slot in the grid is a hole
 *  nothing renders into. */
function pickKnown(stored: CanvasLayout): CanvasLayout {
  const known = new Set(ADMIN_CARDS.map((c) => c.id));
  return Object.fromEntries(Object.entries(stored).filter(([id]) => known.has(id)));
}
