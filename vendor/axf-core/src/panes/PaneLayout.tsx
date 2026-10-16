/**
 * @file `<PaneLayout>` — the split renderer. Its one law: **measure before you
 * latch, and never latch what you did not measure.**
 *
 * GizmoX's LayoutRenderer draws first and measures second, so its first pass
 * prorates weights against a zero extent, clamps every share to its minimum,
 * and persists that — a chat pane latched at its minimum is unusable rather
 * than merely ugly. This renderer makes that failure unrepresentable instead
 * of merely avoided, three ways:
 *
 *   1. **First paint is fractions, not pixels.** Children get `flex-grow`
 *      shares (`panes/model.ts` holds the arithmetic), so the browser does the
 *      proportional math at the container's true size. There is no pixel
 *      conversion before paint, hence nothing a zero extent could corrupt —
 *      and SSR and the hydrating client agree by construction, because a
 *      fraction renders identically on both.
 *   2. **Pixels enter only at an interaction, which measures ITSELF.** A drag
 *      or a separator keypress reads `getBoundingClientRect` at that moment —
 *      a real, current measurement by definition — and `applyDrag` still
 *      refuses a non-positive extent as the pure-form backstop.
 *   3. **Only interactions persist.** The latch is written on pointer-up /
 *      key-up, never from render or from a resize. Merely mounting this
 *      component can never write a byte — which is the exact regression the
 *      geometry probe's reload pass exists to catch.
 *
 * Latches persist per-user through the kv primitive (namespace
 * `panes.<storageKey>`), validated on the way back in against the tree's
 * structural signature — a latch from last month's layout degrades to the
 * declared weights, never to a broken split. No `storageKey`, no persistence:
 * an ephemeral preview stays ephemeral.
 *
 * The probe's hooks: `data-axf-panes` (root, with `data-axf-measured` flipping
 * to "1" when the root observer reports a real extent), `data-axf-split`,
 * `data-axf-pane`, and per-child `data-axf-fraction` / `data-axf-declared` —
 * rendered CSS is asserted against the model, and the model against the
 * declaration.
 *
 * ── MUI (2026-08-10, P2) ─────────────────────────────────────────────────────
 *
 * Every box here is a `Box`; the geometry stays exactly what it was.
 *
 * That split is the whole point and it is worth stating plainly, because the
 * `check:ui` exception for this file says "its CHROME is still MUI; only the
 * geometry is bespoke" and this is the file that has to make that true. MUI has
 * no split-pane component — there is nothing to adopt for the drag, the gutter
 * capture or the `flex: <fraction> 1 0%` share. What there IS a component for is
 * the containers, and those are now `Box`.
 *
 * The `flex` shorthand carrying `shown[i]` stays in `sx` rather than moving to a
 * `style` prop. It is a per-child computed value, so Emotion generates one class
 * per distinct fraction — during a drag that is a class per frame, which sounds
 * expensive and is not: the values repeat within a drag, Emotion caches by
 * serialised style, and the alternative (an inline `style` on an `sx` element)
 * is two styling channels on one node, which is how a value ends up being set
 * in a place nobody looks. Measured, not assumed: see the geometry probe's
 * numbers in this phase's report.
 *
 * ── Floatable panes (2026-08-15, P8) ─────────────────────────────────────────
 *
 * Every LEAF is wrapped in `<Floatable requires="floatable">`, so the per-user
 * "Floatable panes & toolbars" switch pulls a pane out of its split, floats it,
 * snaps it to an edge with the orientation flip, and remembers where it went —
 * without a single module opting in. The wrap is HERE for the reason core's
 * `Toolbar` gives for wrapping in ITS one place: a pane that only floats in the
 * layouts somebody remembered to wrap is a pane that does not float somewhere.
 *
 * Three properties this keeps true, and each one is load-bearing:
 *
 *   1. **Off is byte-identical.** `<Floatable>` renders its children and NO
 *      wrapper element while both mode switches are off, so the `data-axf-pane`
 *      box is still the direct flex child of its slot and every probe hook,
 *      fraction and measurement is exactly what it was. The default is off.
 *   2. **Ephemeral stays ephemeral.** No `storageKey` means no dock id and no
 *      wrap at all. This file's law is *"no `storageKey`, no persistence"*, and
 *      a floated pane IS persisted state — routing it through the dock document
 *      instead would have honoured the letter of the law while breaking it. It
 *      would also collide: two previews rendering the same tree would share one
 *      arrangement, because the pane ids would be identical.
 *   3. **A departed pane leaves no hole.** A pane that is no longer in flow has
 *      its slot collapsed to `flex: 0 0 0%` and its gutters hidden, so the
 *      siblings reflow across the space in their existing proportions — flex
 *      does that arithmetic itself, which is why floating a pane needs no
 *      change to the fraction model and cannot corrupt a latch. The declared
 *      and model fractions are still published on the slot, unchanged: the
 *      pane's share is what it RETURNS to, so overwriting it with the collapse
 *      would make undocking a one-way trip.
 */
"use client";

import * as React from "react";
import Box from "@mui/material/Box";

import { Floatable } from "../dock/Floatable";
import { isInFlow } from "../dock/model";
import { dockLayouts, useDockMode } from "../dock/store";
import { defaultKv } from "../persist/client";
import type { KvTransport } from "../persist/client";
import { isKvName } from "../persist/kv";
import { token } from "../theme/apply";
import {
  DEFAULT_MIN_PANE_PX,
  PANES_FORMAT,
  applyDrag,
  minExtentAlong,
  normalFractions,
  parsePaneDoc,
  treeSignature,
  validatePaneTree
} from "./model";
import type { FractionMap, PaneDirection, PaneNodeSpec, PaneSplitSpec, PaneTree } from "./model";

const DEFAULT_GUTTER_PX = 6;
/** One arrow press moves the boundary this far; Shift multiplies by 4. */
const KEY_STEP_PX = 16;

/**
 * A pane's home is the split it was declared in, and the engine calls a panel's
 * home its `naturalZone`. "top" is the engine's own default and means *docked
 * where the host put it* — a pane docked at home renders in flow, which is the
 * whole of what this constant asks for. It is named rather than left implicit
 * because {@link isInFlow} has to be asked the same question with the same
 * answer, and a bare `"top"` in two files is a disagreement waiting to happen.
 */
const PANE_NATURAL_ZONE = "top" as const;

/** A leaf's dock identity. Scoped by `storageKey`, so the same pane id in two
 *  different layouts is two panels — the arrangement belongs to a pane in a
 *  layout, never to a name that happens to repeat. */
const paneDockId = (storageKey: string, paneId: string): string =>
  `pane:${storageKey}:${paneId}`;

export interface PaneLayoutProps {
  /** A tree from `definePanes` — the chokepoint; literals do not typecheck. */
  tree: PaneTree;
  /** Content for a leaf. An unknown id renders its name, honestly. */
  renderPane: (id: string) => React.ReactNode;
  /**
   * Latch identity — becomes kv namespace `panes.<storageKey>`, so it must
   * pass the kv name guard. Omit for an ephemeral (never-persisted) layout.
   */
  storageKey?: string;
  /** Transport override; defaults to the host route / memory fallback. */
  kv?: KvTransport;
  gutterPx?: number;
  style?: React.CSSProperties;
  className?: string;
}

interface Ctx {
  fractions: FractionMap;
  declared: FractionMap;
  gutterPx: number;
  latch: (path: string, next: number[]) => void;
  /** `storageKey` when this layout persists, else null — and null means the
   *  leaves are not floatable at all. See the header's property 2. */
  dockNs: string | null;
}

const PaneCtx = React.createContext<Ctx | null>(null);

export function PaneLayout({
  tree,
  renderPane,
  storageKey,
  kv,
  gutterPx = DEFAULT_GUTTER_PX,
  style,
  className
}: PaneLayoutProps) {
  // Layer 2 of the chokepoint doctrine: the brand is erased at runtime and an
  // `as` cast sails past it, so the mount re-validates and throws by name.
  validatePaneTree(tree);
  if (storageKey !== undefined && !isKvName(storageKey)) {
    throw new Error(`storageKey "${storageKey}" is not a valid kv name`);
  }

  const signature = treeSignature(tree);
  const ns = storageKey ? `panes.${storageKey}` : null;
  const transport = React.useMemo(() => kv ?? defaultKv(), [kv]);

  // Declared fractions render first — on the server, and on the client until a
  // validated latch arrives one commit later as a normal update. Keyed by the
  // signature so swapping trees swaps defaults atomically.
  const declared = React.useMemo(() => {
    const map: FractionMap = {};
    const collect = (node: PaneNodeSpec, path: string): void => {
      if (node.kind !== "split") return;
      map[path] = normalFractions(node);
      node.children.forEach((child, i) => collect(child, `${path}.${i}`));
    };
    collect(tree, "root");
    return map;
  }, [tree]);

  const [latched, setLatched] = React.useState<FractionMap | null>(null);

  // Restore is read-only: a failed or invalid read leaves the declared weights
  // standing. Nothing in this effect can write — see the file header's law #3.
  React.useEffect(() => {
    if (!ns) return;
    let alive = true;
    transport
      .read(ns)
      .then((doc) => {
        if (!alive) return;
        const fractions = parsePaneDoc(doc, signature);
        if (fractions) setLatched(fractions);
      })
      .catch(() => {
        /* no host route, offline — the declared weights stand */
      });
    return () => {
      alive = false;
    };
  }, [ns, signature, transport]);

  const fractions = React.useMemo(() => ({ ...declared, ...latched }), [declared, latched]);

  const latch = React.useCallback(
    (path: string, next: number[]) => {
      setLatched((prev) => {
        const merged = { ...prev, [path]: next };
        if (ns) {
          transport
            .write(ns, { format: PANES_FORMAT, signature, fractions: merged })
            .catch(() => {
              /* persistence is best-effort; the on-screen layout is already right */
            });
        }
        return merged;
      });
    },
    [ns, signature, transport]
  );

  // The root observer exists for the PROBE and for honesty ("was a real
  // extent ever seen?"), not for layout — paint never waits on it.
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [measured, setMeasured] = React.useState(false);
  React.useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      if (rect.width > 0 && rect.height > 0) setMeasured(true);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const ctx = React.useMemo<Ctx>(
    () => ({ fractions, declared, gutterPx, latch, dockNs: storageKey ?? null }),
    [fractions, declared, gutterPx, latch, storageKey]
  );

  return (
    <PaneCtx.Provider value={ctx}>
      <Box
        ref={rootRef}
        data-axf-panes={storageKey ?? "ephemeral"}
        data-axf-measured={measured ? "1" : "0"}
        className={className}
        // `style` is spread LAST, exactly as before: the caller's override has
        // to win, and it is a `CSSProperties` object from the public props — so
        // it stays on `style` rather than being folded into `sx`, where a
        // caller-supplied value would be re-serialised through Emotion for no
        // gain and a specificity change.
        sx={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, flex: 1 }}
        style={style}
      >
        <NodeView node={tree} path="root" renderPane={renderPane} />
      </Box>
    </PaneCtx.Provider>
  );
}

function useCtx(): Ctx {
  const ctx = React.useContext(PaneCtx);
  if (!ctx) throw new Error("PaneLayout internals rendered outside their context");
  return ctx;
}

function NodeView({
  node,
  path,
  renderPane
}: {
  node: PaneNodeSpec;
  path: string;
  renderPane: (id: string) => React.ReactNode;
}) {
  const ctx = useCtx();

  if (node.kind !== "pane") {
    return <SplitView node={node} path={path} renderPane={renderPane} />;
  }

  const pane = (
    <Box
      data-axf-pane={node.id}
      data-axf-min={node.minSize ?? DEFAULT_MIN_PANE_PX}
      sx={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}
    >
      {renderPane(node.id)}
    </Box>
  );

  // No persistence, no floating — the header's property 2. Returning the pane
  // untouched rather than passing a null id keeps that a structural fact
  // instead of a value the engine has to interpret.
  if (!ctx.dockNs) return pane;

  return (
    <Floatable
      id={paneDockId(ctx.dockNs, node.id)}
      label={node.id}
      naturalZone={PANE_NATURAL_ZONE}
      // Panes wait for the per-user switch: `editing` is the administrator's
      // mode for the app's CHROME, and a pane is the person's own content.
      requires="floatable"
      // A pane is handed a share of a split and is expected to occupy it.
      fill
    >
      {pane}
    </Floatable>
  );
}

function SplitView({
  node,
  path,
  renderPane
}: {
  node: PaneSplitSpec;
  path: string;
  renderPane: (id: string) => React.ReactNode;
}) {
  const ctx = useCtx();
  const row = node.direction === "row";
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const fractions = ctx.fractions[path] ?? normalFractions(node);
  const declared = ctx.declared[path] ?? normalFractions(node);

  /**
   * Which children have left the split — floated, or docked to an edge.
   *
   * ONE subscription for the whole split rather than a hook per child, which is
   * also the only correct shape: `node.children` can change length when a tree
   * is swapped, and a hook per child would change the hook count with it.
   *
   * The mode is part of the question, not a shortcut around it. With the switch
   * off `<Floatable>` is inert and renders in flow no matter what is stored, so
   * a split that collapsed a slot from a remembered arrangement would blank a
   * pane the engine is not even drawing — the arrangement is *remembered, not
   * discarded*, and this is where "remembered" must not mean "applied".
   */
  const dockSnapshot = React.useSyncExternalStore(
    dockLayouts.subscribe,
    dockLayouts.getState,
    dockLayouts.getServerState
  );
  const dockModeState = useDockMode();
  const departed = React.useMemo(
    () =>
      node.children.map((child) => {
        if (!ctx.dockNs || child.kind !== "pane" || !dockModeState.floatable) return false;
        const state = dockSnapshot[paneDockId(ctx.dockNs, child.id)];
        return state ? !isInFlow(state, PANE_NATURAL_ZONE) : false;
      }),
    [node.children, ctx.dockNs, dockModeState.floatable, dockSnapshot]
  );

  /** A gutter is drawn only between two children that are both still here. */
  const gutterShown = (i: number): boolean =>
    i < node.children.length - 1 && !departed[i] && !departed[i + 1];

  /**
   * The children's shared extent along the split axis, measured NOW — called
   * only from an interaction, which is what makes every latch a measured one.
   *
   * The gutters subtracted are the ones actually DRAWN. Subtracting a fixed
   * `children.length - 1` would over-subtract once a pane floated out and its
   * gutters went with it, and the error lands straight in a latch — the one
   * place this file refuses to let an unmeasured number reach.
   */
  const measureExtent = (): number => {
    const el = containerRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const total = row ? rect.width : rect.height;
    let gutters = 0;
    for (let i = 0; i < node.children.length - 1; i += 1) if (gutterShown(i)) gutters += 1;
    return total - ctx.gutterPx * gutters;
  };

  const minPx = (i: number): number => minExtentAlong(node.children[i], node.direction, ctx.gutterPx);

  const dragFrom = (index: number, startPos: number) => {
    const extent = measureExtent();
    const start = [...fractions];
    let last = start;
    return {
      move(pos: number) {
        last = applyDrag(start, index, pos - startPos, extent, minPx(index), minPx(index + 1));
        return last;
      },
      /** The latch — and only if something actually moved. */
      end() {
        if (last !== start && last.some((f, i) => f !== start[i])) ctx.latch(path, last);
        return last;
      }
    };
  };

  // Live fractions during a drag bypass the (async) latch state so the split
  // tracks the pointer frame-by-frame; the latch lands once, at the end.
  const [live, setLive] = React.useState<number[] | null>(null);
  const shown = live ?? fractions;

  const onPointerDown = (index: number) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const gutterEl = e.currentTarget;
    gutterEl.setPointerCapture(e.pointerId);
    const session = dragFrom(index, row ? e.clientX : e.clientY);
    const onMove = (ev: PointerEvent) => setLive(session.move(row ? ev.clientX : ev.clientY));
    const onUp = () => {
      gutterEl.removeEventListener("pointermove", onMove);
      gutterEl.removeEventListener("pointerup", onUp);
      gutterEl.removeEventListener("pointercancel", onUp);
      session.end();
      setLive(null);
    };
    gutterEl.addEventListener("pointermove", onMove);
    gutterEl.addEventListener("pointerup", onUp);
    gutterEl.addEventListener("pointercancel", onUp);
  };

  const onKeyDown = (index: number) => (e: React.KeyboardEvent<HTMLDivElement>) => {
    const towardStart = row ? "ArrowLeft" : "ArrowUp";
    const towardEnd = row ? "ArrowRight" : "ArrowDown";
    if (e.key !== towardStart && e.key !== towardEnd) return;
    e.preventDefault();
    const step = (e.key === towardEnd ? 1 : -1) * KEY_STEP_PX * (e.shiftKey ? 4 : 1);
    const extent = measureExtent();
    const next = applyDrag(fractions, index, step, extent, minPx(index), minPx(index + 1));
    // applyDrag answered with the input untouched (zero extent, clamped-out
    // move): nothing changed, so nothing may latch.
    if (next.some((f, i) => f !== fractions[i])) ctx.latch(path, next);
  };

  return (
    <Box
      ref={containerRef}
      data-axf-split={path}
      data-axf-direction={node.direction}
      sx={{
        display: "flex",
        flexDirection: node.direction,
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden"
      }}
    >
      {node.children.map((child, i) => (
        <React.Fragment key={child.kind === "pane" ? child.id : `${path}.${i}`}>
          <Box
            // The MODEL's fraction, published even while the slot is collapsed:
            // it is the share this pane comes back to, and a probe comparing
            // rendered CSS against the model reads `data-axf-out-of-flow` to
            // know which of the two is currently on screen.
            data-axf-fraction={shown[i].toFixed(4)}
            data-axf-declared={declared[i].toFixed(4)}
            data-axf-out-of-flow={departed[i] ? "1" : undefined}
            sx={{
              // grow=fraction, shrink=1, basis=0: shares are exact and the
              // browser owns the pixel math — see the file header's law #1.
              // A departed pane grows by nothing, so its siblings take the space
              // in their existing proportions with no arithmetic here at all.
              flex: departed[i] ? "0 0 0%" : `${shown[i]} 1 0%`,
              minWidth: 0,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden"
            }}
          >
            <NodeView node={child} path={`${path}.${i}`} renderPane={renderPane} />
          </Box>
          {/* A gutter beside a collapsed slot would be a resize handle for a
              boundary that is not on screen — it would sit flush against its
              neighbour and drag a fraction nobody can see. */}
          {gutterShown(i) && (
            <Box
              data-axf-gutter={`${path}.${i}`}
              role="separator"
              // A separator between row children is a vertical bar, and vice
              // versa — the ARIA orientation names the BAR, not the axis.
              aria-orientation={row ? "vertical" : "horizontal"}
              aria-valuenow={Math.round(shown[i] * 100)}
              tabIndex={0}
              onPointerDown={onPointerDown(i)}
              onKeyDown={onKeyDown(i)}
              // Deliberately NOT MUI's `Divider`: this is an interactive
              // control that captures the pointer and takes arrow keys, and a
              // Divider is a presentational rule. Giving it a tabIndex and a
              // pointer capture would be dressing one thing as another.
              sx={{
                flex: `0 0 ${ctx.gutterPx}px`,
                cursor: row ? "col-resize" : "row-resize",
                background: token("edge"),
                opacity: 0.5,
                touchAction: "none"
              }}
            />
          )}
        </React.Fragment>
      ))}
    </Box>
  );
}
