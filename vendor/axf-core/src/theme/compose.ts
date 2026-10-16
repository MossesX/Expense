/**
 * @file Theme composition — the design-scalability half.
 *
 * A theme with 24 dials can be authored by hand. A theme with 175 cannot, and
 * that is the number GizmoX's engine reached. What breaks first is not the
 * engine, it is the AUTHORING: every new theme becomes a 175-line file that is
 * 90% identical to the last one, so nobody writes a fourth, and the ones that
 * exist drift because a fix applied to one is not applied to the others.
 *
 * The fix is layering. A theme states a base and only what it CHANGES:
 *
 *     base "axf-dark"          →  24 values
 *     "axf-dark-high-contrast" →  extends axf-dark, 3 values
 *     "acme-brand"             →  extends axf-dark-high-contrast, 5 values
 *
 * Three themes, 32 authored values instead of 72 — and a fix to the base
 * reaches all three, which is the part that actually matters at 175 dials.
 *
 * Deliberately NOT a cascade of CSS custom properties: layers resolve to one
 * flat value map BEFORE publishing, so what reaches the DOM is a single set with
 * no inheritance to reason about at render time. Cascades are wonderful until
 * something is wrong and you have to work out which layer won.
 */
import { defaultValues } from "./spec";
import type { ThemeValues } from "./spec";

export interface ThemeLayer {
  readonly id: string;
  readonly title: string;
  /** Id of the layer this builds on. Omitted means it builds on the defaults. */
  readonly extends?: string;
  /** Only what this layer CHANGES. Everything else comes from the base. */
  readonly values: Partial<ThemeValues>;
  /** One line: what this layer is for. */
  readonly note?: string;
}

export class ThemeCompositionError extends Error {}

export interface ResolvedLayer {
  readonly id: string;
  /** Base-first, so index 0 is the root of the chain. */
  readonly chain: readonly string[];
  readonly values: ThemeValues;
  /** Per dial: which layer in the chain supplied the winning value. */
  readonly provenance: Readonly<Record<string, string>>;
}

/**
 * Flatten a layer and its ancestors into one value map.
 *
 * Returns **provenance** as well as values, because the question a designer
 * actually asks at 175 dials is not "what is this set to" — the screen shows
 * that — it is "which layer set it, and can I change it here". Without that,
 * layering trades one authoring problem for a debugging one.
 */
export function composeTheme(
  layerId: string,
  layers: readonly ThemeLayer[]
): ResolvedLayer {
  const byId = new Map(layers.map((l) => [l.id, l]));

  // Walk to the root, refusing a cycle by naming its participants rather than
  // overflowing the stack.
  const chain: string[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined = layerId;
  while (cursor) {
    if (seen.has(cursor)) {
      throw new ThemeCompositionError(
        `theme layer cycle: ${[...chain, cursor].join(" → ")}`
      );
    }
    const layer = byId.get(cursor);
    if (!layer) {
      throw new ThemeCompositionError(
        `theme layer "${cursor}" extends nothing that is registered` +
          (chain.length ? ` (reached from ${chain[chain.length - 1]})` : "")
      );
    }
    seen.add(cursor);
    chain.push(cursor);
    cursor = layer.extends;
  }
  chain.reverse();

  const values: ThemeValues = defaultValues();
  const provenance: Record<string, string> = {};
  for (const id of Object.keys(values)) provenance[id] = "(default)";

  for (const id of chain) {
    const layer = byId.get(id)!;
    for (const [dial, value] of Object.entries(layer.values)) {
      if (value === undefined) continue;
      values[dial] = value;
      provenance[dial] = id;
    }
  }

  return { id: layerId, chain, values, provenance };
}

/**
 * What a layer would have to state to reproduce a value map on top of a base —
 * i.e. the diff, dropping everything the base already provides.
 *
 * This is what turns a hand-tuned theme back into a small layer: roll or design
 * freely, then `diffAgainst` the base and keep only what actually moved. Without
 * it, every saved theme is a full 175-value snapshot and layering exists on
 * paper only.
 */
export function diffAgainst(values: ThemeValues, base: ThemeValues): Partial<ThemeValues> {
  const out: Partial<ThemeValues> = {};
  for (const [dial, value] of Object.entries(values)) {
    if (base[dial] !== value) out[dial] = value;
  }
  return out;
}

/** The shipped root layer. Everything else extends this or a descendant. */
export const BASE_LAYER: ThemeLayer = {
  id: "axf-base",
  title: "AmberX base",
  note: "The shipped defaults. Every other layer builds on this or a descendant.",
  values: {}
};
