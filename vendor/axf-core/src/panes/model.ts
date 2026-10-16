/**
 * @file The pane model — the pure half of the split renderer: the tree
 * contract, the fraction arithmetic, the drag clamps and the persisted-latch
 * format. Everything here is testable without a DOM, which is where the math
 * that can be wrong belongs.
 *
 * **The design decision this file exists to hold: sizes are FRACTIONS, never
 * pixels.** GizmoX's LayoutRenderer converts weights into pixel sizes against
 * a measured extent — but it renders BEFORE its ResizeObserver reports, so the
 * first pass computes against an extent of zero, every share clamps to its
 * minimum, and the split latches there. A chat pane latched at its minimum is
 * unusable, not merely ugly. A fraction needs no extent to be correct: CSS
 * flex does the proportional math at whatever size the container really has,
 * so first paint cannot mis-latch because nothing is converted to pixels
 * before paint at all. Pixels enter exactly once — converting a DRAG into new
 * fractions — and a drag carries its own measurement by definition
 * ({@link applyDrag} refuses a zero extent even so). Recorded in
 * AXF_CAPABILITIES (`pane-layout`).
 *
 * `definePanes` is the chokepoint, per the enforcement doctrine: it validates
 * and BRANDS the tree, a hand-written literal does not typecheck where a
 * `PaneTree` is required, and the renderer re-validates at mount because a
 * brand is erased at runtime and an `as` cast sails past it.
 */

export type PaneDirection = "row" | "column";

export interface PaneLeafSpec {
  kind: "pane";
  /** Names the pane for `renderPane` and for the persisted latch. */
  id: string;
  /** Smallest extent (px) a DRAG may leave this pane, along the parent split's
   *  axis. Never a first-paint input — see the file header. */
  minSize?: number;
}

export interface PaneSplitSpec {
  kind: "split";
  direction: PaneDirection;
  /** ≥ 2 entries. */
  children: PaneNodeSpec[];
  /** Relative shares, one per child; equal shares when omitted. */
  weights?: number[];
}

export type PaneNodeSpec = PaneLeafSpec | PaneSplitSpec;

declare const PANE_TREE_BRAND: unique symbol;

/** A validated pane tree — only {@link definePanes} produces one. */
export type PaneTree = PaneNodeSpec & { readonly [PANE_TREE_BRAND]: true };

export class PaneDefinitionError extends Error {
  constructor(message: string) {
    super(`pane tree: ${message}`);
    this.name = "PaneDefinitionError";
  }
}

/** A drag may not shrink a pane below this unless it declares its own floor. */
export const DEFAULT_MIN_PANE_PX = 48;

function walk(node: PaneNodeSpec, seen: Set<string>): void {
  if (node.kind === "pane") {
    if (typeof node.id !== "string" || node.id.length === 0) {
      throw new PaneDefinitionError("a pane needs a non-empty id");
    }
    if (seen.has(node.id)) {
      throw new PaneDefinitionError(
        `pane id "${node.id}" appears twice — the latch and renderPane both key on it`
      );
    }
    seen.add(node.id);
    if (node.minSize !== undefined && (!Number.isFinite(node.minSize) || node.minSize < 0)) {
      throw new PaneDefinitionError(`pane "${node.id}" declares an invalid minSize`);
    }
    return;
  }
  if (node.kind !== "split") {
    throw new PaneDefinitionError(`unknown node kind "${(node as { kind?: unknown }).kind}"`);
  }
  if (node.direction !== "row" && node.direction !== "column") {
    throw new PaneDefinitionError(`unknown split direction "${node.direction}"`);
  }
  if (!Array.isArray(node.children) || node.children.length < 2) {
    throw new PaneDefinitionError("a split needs at least two children");
  }
  if (node.weights !== undefined) {
    if (node.weights.length !== node.children.length) {
      throw new PaneDefinitionError(
        `${node.weights.length} weights for ${node.children.length} children`
      );
    }
    if (node.weights.some((w) => !Number.isFinite(w) || w <= 0)) {
      throw new PaneDefinitionError("weights must all be finite and positive");
    }
  }
  for (const child of node.children) walk(child, seen);
}

/**
 * Validate and brand a pane tree. Throws {@link PaneDefinitionError} naming
 * the violated constraint — at definition time, where the author is.
 */
export function definePanes(spec: PaneNodeSpec): PaneTree {
  walk(spec, new Set());
  return spec as PaneTree;
}

/** The renderer's runtime re-validation — layer 2 of the doctrine. */
export function validatePaneTree(tree: PaneNodeSpec): void {
  walk(tree, new Set());
}

/** A split's weights as fractions summing to 1 (equal when undeclared). */
export function normalFractions(split: PaneSplitSpec): number[] {
  const weights = split.weights ?? split.children.map(() => 1);
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => w / total);
}

/**
 * The structure of a tree as a stable string — direction, arity and pane ids,
 * deliberately NOT weights: a persisted latch keyed on structure survives the
 * author retuning default weights, and dies (correctly) when a pane is added,
 * removed or renamed.
 */
export function treeSignature(node: PaneNodeSpec): string {
  return node.kind === "pane"
    ? node.id
    : `${node.direction}[${node.children.map(treeSignature).join(",")}]`;
}

/**
 * The smallest extent (px) `node` can honestly be, measured along `axis` —
 * what a drag clamp uses when the neighbour it is squeezing is itself a split.
 * Along a split's own axis the floors add up (plus a gutter each boundary);
 * across it the deepest single floor governs.
 */
export function minExtentAlong(node: PaneNodeSpec, axis: PaneDirection, gutterPx: number): number {
  if (node.kind === "pane") return node.minSize ?? DEFAULT_MIN_PANE_PX;
  const mins = node.children.map((c) => minExtentAlong(c, axis, gutterPx));
  return node.direction === axis
    ? mins.reduce((a, b) => a + b, 0) + gutterPx * (node.children.length - 1)
    : Math.max(...mins);
}

/** Persisted latches, keyed by split path ("root", "root.1", …). */
export type FractionMap = Record<string, number[]>;

export const PANES_FORMAT = "axf-panes/1";

/** What the latch namespace holds. */
export interface PaneDoc extends Record<string, unknown> {
  format: typeof PANES_FORMAT;
  signature: string;
  fractions: FractionMap;
}

/**
 * Move the boundary between children `index` and `index + 1` by `deltaPx`.
 *
 * Pure pixel→fraction conversion, clamped so neither neighbour goes below its
 * floor. `extentPx` is the measured extent the CHILDREN share (container minus
 * gutters). **A non-positive extent returns the input untouched** — that is
 * the "measure before you latch" rule in its pure form, and the renderer's
 * callers keep it structurally true by measuring at the interaction itself.
 */
export function applyDrag(
  fractions: readonly number[],
  index: number,
  deltaPx: number,
  extentPx: number,
  minPxA: number,
  minPxB: number
): number[] {
  const input = [...fractions];
  if (!(extentPx > 0) || index < 0 || index >= fractions.length - 1) return input;
  const a = fractions[index];
  const b = fractions[index + 1];
  const pair = a + b;
  const minA = Math.min(minPxA / extentPx, pair);
  const minB = Math.min(minPxB / extentPx, pair);
  const next = Math.max(minA, Math.min(a + deltaPx / extentPx, pair - minB));
  input[index] = next;
  input[index + 1] = pair - next;
  return input;
}

/**
 * A persisted latch document, validated against the tree it claims to arrange:
 * right format, matching signature, and per-path fraction lists that are
 * positive and sum to ~1. Anything else answers null and the declared weights
 * stand — a stale latch must degrade to the default, never to a broken split.
 */
export function parsePaneDoc(doc: unknown, signature: string): FractionMap | null {
  if (typeof doc !== "object" || doc === null) return null;
  const d = doc as Partial<PaneDoc>;
  if (d.format !== PANES_FORMAT || d.signature !== signature) return null;
  if (typeof d.fractions !== "object" || d.fractions === null) return null;
  const out: FractionMap = {};
  for (const [path, fractions] of Object.entries(d.fractions)) {
    if (!Array.isArray(fractions) || fractions.length < 2) return null;
    if (fractions.some((f) => typeof f !== "number" || !Number.isFinite(f) || f <= 0)) return null;
    const sum = fractions.reduce((x, y) => x + y, 0);
    if (Math.abs(sum - 1) > 0.01) return null;
    out[path] = fractions;
  }
  return out;
}
