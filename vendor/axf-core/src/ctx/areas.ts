/**
 * @file The area walk — how a click becomes a PATH.
 *
 * This is the half of the resolver that touches the DOM, and it is the whole of
 * what it touches: from the element the event landed on, walk `parentElement`
 * upwards collecting `data-axf-area` markers into a path, innermost first —
 * `["cell", "row", "table", "pane:library", "module:claude", "shell"]`. The path
 * IS the menu. Composing items from it is {@link ./compose}'s job; nothing here
 * knows what an item is.
 *
 * WHY A WALK RATHER THAN A HANDLER. GizmoX's failure was never bad menus, it was
 * INCONSISTENT COVERAGE — forty modules each hand-wrote `useCtx`, so coverage was
 * a habit, and habits have holes. A surface here marks itself and stops thinking
 * about menus. Nothing can forget to handle an event it never handles.
 *
 * ── O(depth), AND NO LAYOUT READS ─────────────────────────────────────────────
 *
 * A menu that is slow to open reads as a menu that is broken, so this is the one
 * part of the system with a stated performance contract. Two claims, and neither
 * is left as a promise:
 *
 * 1. **O(depth).** One upward pass, each node examined exactly once. The proof is
 *    not a stopwatch — {@link AreaPath.visited} reports the number of nodes
 *    examined, and the test asserts it equals the tree depth exactly. A stopwatch
 *    tells you a walk is fast on this machine today; a visit count tells you the
 *    algorithm is linear. (Both are measured; see the recorded numbers below.)
 *
 * 2. **No layout reads.** Enforced by the type, not by review: the walk takes
 *    {@link AreaElement}, which exposes `dataset` and `parentElement` and nothing
 *    else. `getBoundingClientRect`, `offsetHeight`, `getComputedStyle` and the
 *    rest are not merely unused here — they are not reachable from the parameter
 *    type, so reintroducing one does not compile. That is the same doctrine the
 *    rest of this package uses: put the guarantee on the chokepoint, because a
 *    rule you are supposed to remember is not a rule.
 *
 * MEASURED 2026-08-09 (Windows 11, Node v26.4.0, `ctx-resolver.test.ts`, 2000
 * walks per depth after a 200-walk warm-up, one area every 8 nodes). Ranges are
 * across four runs — three isolated, one under the full 66-test suite, which is
 * the slower end of each spread:
 *
 * | tree depth | nodes visited | per walk          | per node   |
 * |---|---|---|---|
 * | 8    | 8    | 0.0006 – 0.0010 ms | 79 – 131 ns |
 * | 64   | 64   | 0.0012 – 0.0017 ms | 19 – 27 ns  |
 * | 512  | 512  | 0.0081 – 0.0176 ms | 16 – 34 ns  |
 * | 4096 | 4096 | 0.0683 – 0.1187 ms | 17 – 29 ns  |
 *
 * Per-node cost is FLAT: ~19 ns at depth 64 against ~17 ns at depth 4096, over a
 * 64× range of depths. That is what linear looks like — quadratic would have put
 * roughly 64× the per-node cost on the bottom row. (Depth 8's ~85 ns is fixed
 * call overhead amortised over eight nodes, not a slower walk, which is why the
 * assertion compares 64 against 4096 and ignores the shallowest row.)
 *
 * A realistic DOM is 20–40 deep, which puts a real right-click at well under a
 * microsecond — four orders of magnitude inside the ~16 ms frame it has to fit
 * in. Even the absurd 4096-deep tree resolves in a tenth of a millisecond. Run
 * the numbers again with studio's `npm test`; the test prints the table.
 */
import { MAX_CONTRIBUTING_AREAS, MenuMap, menu } from "./map";

/** The attribute a surface marks itself with. */
export const AREA_ATTR = "data-axf-area";

/** `AREA_ATTR` as `dataset` spells it. */
const AREA_KEY = "axfArea";

/** Prefix on the dataset keys this harvests — `data-axf-row-id` → `axfRowId`. */
const DATA_PREFIX = "axf";

/**
 * A cycle in `parentElement` cannot happen in a real DOM, but {@link AreaElement}
 * is a structural type and a hand-built node can loop. A bound turns that from a
 * hung tab into a console line naming the problem.
 */
const MAX_WALK = 10_000;

/**
 * The only thing the walk is allowed to see.
 *
 * `HTMLElement` and `SVGElement` both satisfy it (`dataset` comes from the
 * `HTMLOrSVGElement` mixin), which matters more than it looks: icons are drawn in
 * SVG, so a right-click on one lands on an `SVGElement`, and a resolver typed to
 * `HTMLElement` would drop the entire area path for a very ordinary click.
 *
 * It is also what makes the walk testable without a DOM — a plain object with
 * `dataset` and `parentElement` is a valid node, so the deep-tree measurement
 * runs under `node --test` with no jsdom and no new dependency.
 */
export interface AreaElement {
  readonly dataset: DOMStringMap;
  readonly parentElement: AreaElement | null;
}

/** One area found on the way up. */
export interface AreaHit {
  readonly id: string;
  /**
   * Whether a module declared this area (D1). An undeclared id is almost always
   * a typo in a marker, and a typo'd marker is otherwise an invisible menu.
   */
  readonly declared: boolean;
  /** Nodes walked to reach it; 0 is the event target itself. */
  readonly depth: number;
  /** Whether it is within the contribution cap and may therefore add rows. */
  readonly contributes: boolean;
}

/** Everything the walk learned, in one value. */
export interface AreaPath {
  /** Every area found, innermost first, uncapped. */
  readonly areas: readonly AreaHit[];
  /** {@link areas} as bare ids — what {@link MenuContext.path} carries. */
  readonly path: readonly string[];
  /** The nearest declared areas, capped. These are the ones that add rows. */
  readonly contributing: readonly string[];
  /** Ids marked in the DOM that no module declared. */
  readonly undeclared: readonly string[];
  /** `data-axf-*` values harvested on the way up, innermost winning. */
  readonly data: Readonly<Record<string, string>>;
  /** Nodes examined. The O(depth) claim, as a number rather than an adjective. */
  readonly visited: number;
}

export interface ResolveAreaOptions {
  /** Which map decides whether an area is declared. Defaults to the singleton. */
  readonly map?: MenuMap;
  /** Contribution cap. Defaults to {@link MAX_CONTRIBUTING_AREAS} (D3). */
  readonly cap?: number;
  /** Emit the undeclared-area warning. Defaults to {@link inDevelopment}. */
  readonly warn?: boolean;
}

/**
 * Are we in development?
 *
 * Unknown counts as development, deliberately. The failure this whole file
 * exists to prevent is a silent one, so an environment that cannot say what it
 * is gets the warning rather than the silence. Only an explicit `production`
 * turns it off.
 *
 * `process` is declared locally rather than pulled from `@types/node`: core
 * takes a dependency when a module needs it to, and needing to read one string
 * is not that.
 */
declare const process: { env?: { NODE_ENV?: string } } | undefined;

export function inDevelopment(): boolean {
  try {
    return typeof process === "undefined" || process?.env?.NODE_ENV !== "production";
  } catch {
    return true;
  }
}

/**
 * Ids already warned about, so the console carries each typo once rather than
 * once per right-click. A warning that repeats forever is a warning people learn
 * to scroll past, which is the same as not having one.
 */
const warned = new Set<string>();

/** Forget what has been warned about — for tests, and for a manager re-checking. */
export function clearUndeclaredAreaWarnings(): void {
  warned.clear();
}

/**
 * Walk up from `from`, collecting the area path and the data along it.
 *
 * @param from the element the `contextmenu` event landed on
 */
export function resolveAreaPath(
  from: AreaElement | null,
  options: ResolveAreaOptions = {}
): AreaPath {
  const map = options.map ?? menu;
  const cap = options.cap ?? MAX_CONTRIBUTING_AREAS;
  const warn = options.warn ?? inDevelopment();

  const areas: AreaHit[] = [];
  const undeclared: string[] = [];
  const data: Record<string, string> = {};
  const contributing: string[] = [];
  const seen = new Set<string>();

  let node: AreaElement | null = from;
  let visited = 0;

  while (node) {
    if (visited >= MAX_WALK) {
      if (typeof console !== "undefined") {
        console.warn(
          `[axf] area walk stopped after ${MAX_WALK} nodes — the parent chain does not terminate`
        );
      }
      break;
    }
    visited++;

    const dataset = node.dataset;
    if (dataset) {
      // Harvested from EVERY node on the way up, not only from the ones that are
      // areas. P0's `MenuContext.data` docblock says "the area chain", and this
      // is a deliberate widening of that wording: the fact a predicate wants —
      // a row's id, a task's status — is frequently marked on the element that
      // was clicked rather than on the ancestor that happens to carry the area
      // marker, and a predicate that can only see half the chain sends authors
      // straight back to reading the DOM, which is what this context replaces.
      //
      // Innermost wins, so an inner node's `data-axf-id` shadows an outer one's.
      for (const key in dataset) {
        if (key === AREA_KEY || !key.startsWith(DATA_PREFIX)) continue;
        const value = dataset[key];
        if (value === undefined) continue;
        const name = key.charAt(DATA_PREFIX.length).toLowerCase() + key.slice(DATA_PREFIX.length + 1);
        if (!name || name in data) continue;
        data[name] = value;
      }

      const id = dataset[AREA_KEY];
      if (id) {
        // A repeated id up the chain is one area nested in itself — a component
        // rendered inside itself, usually. It is one area, and counting it twice
        // would spend a cap slot on a duplicate group.
        if (!seen.has(id)) {
          seen.add(id);
          const declared = map.area(id) !== undefined;
          if (!declared) {
            undeclared.push(id);
            if (warn && !warned.has(id) && typeof console !== "undefined") {
              warned.add(id);
              console.warn(
                `[axf] ${AREA_ATTR}="${id}" is marked in the DOM but no module declared it — ` +
                  `it contributes no menu rows. Declare it with menu.declareArea({ id: "${id}", … }) ` +
                  `or fix the marker.`
              );
            }
          }
          // D3 (owner, 2026-08-07): the nearest four areas contribute; the rest
          // stay in the path for context and simply add no rows. Six levels each
          // adding a group is a thirty-item menu, which is this design's
          // characteristic failure mode — the generosity that fixes inconsistent
          // coverage produces an unusable menu if nothing bounds it.
          //
          // The cap counts DECLARED areas only. Two reasons, and the second is
          // the one that decided it. An undeclared area adds no rows, so letting
          // it spend a slot would push a real area out of contribution and make
          // one typo cost twice — invisible rows on top of an invisible menu.
          // And declaration is a static fact, so which areas contribute is fixed
          // by the markup rather than by whichever predicates happened to hold,
          // which keeps the same click producing the same menu.
          const contributes = declared && contributing.length < cap;
          if (contributes) contributing.push(id);
          areas.push({ id, declared, depth: visited - 1, contributes });
        }
      }
    }

    node = node.parentElement;
  }

  return {
    areas,
    path: areas.map((a) => a.id),
    contributing,
    undeclared,
    data,
    visited
  };
}
