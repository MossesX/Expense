/**
 * @file Extension points, declared as DATA — the one genuinely new idea in the
 * AmberX plan (INITIATION-PROMPT.md §4.1) and the reason a peel is computable.
 *
 * GizmoX grew its extension points ad hoc: `shell-docks`, `shell-overlays`,
 * `xtool.tool`, `amberart.tool`, `feature-atlas.action` — each hand-rolled on
 * its own. That survives while a human decides what plugs in where, and it
 * cannot be peeled, because nothing in the system can answer "what are this
 * module's plugins?" The knowledge lives only in someone's head.
 *
 * Here a module DECLARES its points. Once declared, "what plugs in here" has an
 * answer a machine can compute — which is what makes both the peel closure
 * (module → its points → their contributions → their deps) and an honest
 * "what can plug in here" UI possible.
 *
 * Deliberately dependency-free: validation is hand-written rather than pulled
 * from ajv. Core takes a dependency when a module needs it to, not before.
 */

/** What a contribution to a point actually is. */
export type PointKind =
  /** A piece of UI the host renders into a slot. */
  | "ui-surface"
  /** A value the host reads (a default, a limit, a label). */
  | "value"
  /** Something invocable the host can offer the user. */
  | "command";

/** How many contributions a point accepts. */
export type Cardinality = "one" | "many";

/**
 * A declared extension point. This is data, not code — it is serialisable, it
 * ships in a manifest, and it is what a packaging step validates against.
 */
export interface ExtensionPoint {
  /** Unique within its host, conventionally `<host>.<thing>` — `demo.panel`. */
  readonly id: string;
  /** Human title, shown wherever the points are listed. */
  readonly title: string;
  /** One line on what a contributor is expected to provide. */
  readonly description: string;
  readonly kind: PointKind;
  readonly cardinality: Cardinality;
  /**
   * Field names a contribution's payload must carry. A deliberately small
   * stand-in for a JSON Schema: enough to be a real gate today, and shaped so
   * swapping in a schema later changes this file only.
   */
  readonly requires?: readonly string[];
  /** Contributions are sorted by this, ascending, then by id for stability. */
  readonly ordering?: "declared" | "priority";
  /** Whether the host refuses to render with zero contributions. */
  readonly required?: boolean;
}

/** A thing contributed to a point by a plugin, extension or add-on. */
export interface Contribution<P = unknown> {
  /** Id of the asset making the contribution. */
  readonly from: string;
  /** The point being contributed to. */
  readonly point: string;
  /** Sort key when the point orders by priority. Higher renders first. */
  readonly priority?: number;
  /** The payload, whose shape the point's `requires` describes. */
  readonly payload: P;
}

export interface PointViolation {
  readonly point: string;
  readonly from: string;
  readonly problem: string;
}

/**
 * Validate a contribution against its point. Returns the problems rather than
 * throwing, because the caller (a registry, a packaging step, a UI) wants to
 * report all of them at once rather than the first.
 */
export function validateContribution(
  point: ExtensionPoint,
  contribution: Contribution
): PointViolation[] {
  const out: PointViolation[] = [];
  const fail = (problem: string) =>
    out.push({ point: point.id, from: contribution.from, problem });

  if (contribution.point !== point.id) {
    fail(`declares point "${contribution.point}" but was checked against "${point.id}"`);
  }
  const payload = contribution.payload;
  if (payload === null || typeof payload !== "object") {
    fail("payload must be an object");
    return out;
  }
  for (const field of point.requires ?? []) {
    if (!(field in (payload as Record<string, unknown>))) {
      fail(`payload is missing required field "${field}"`);
    }
  }
  return out;
}

/** Sort contributions the way their point says to. */
export function orderContributions<P>(
  point: ExtensionPoint,
  contributions: readonly Contribution<P>[]
): Contribution<P>[] {
  const list = [...contributions];
  if (point.ordering === "priority") {
    list.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.from.localeCompare(b.from));
  }
  return list;
}
