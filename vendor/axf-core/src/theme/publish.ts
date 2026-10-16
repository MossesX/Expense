/**
 * @file Publishing — the render-scalability half. Pure DOM, no React.
 *
 * Two limits in the original publisher, both invisible at 24 dials and both
 * fatal at 175:
 *
 * **1. It rewrote everything on every change.** Adjusting one dial called
 * `setProperty` for the whole set. Each write is cheap; the cost is that the
 * browser cannot tell "one colour moved" from "the entire design system was
 * replaced", so it invalidates accordingly. `applyVariables` diffs against what
 * it wrote last and touches only what actually changed — usually one property
 * while a designer drags a slider.
 *
 * **2. It could only target `:root`.** So exactly one theme could exist on
 * screen. That forecloses the things a designer needs most: a live preview
 * beside the current theme, a module rendering in its own theme, and a
 * side-by-side comparison. Custom properties already scope to a subtree; only
 * the publisher was refusing to.
 *
 * The gallery works around this today by hand-drawing swatches from each pack's
 * palette, which is fine for colour and useless for anything else — a swatch
 * cannot show what a radius or a type scale looks like.
 */

/** What a previous `applyVariables` wrote, so the next call can diff it. */
export type PublishHandle = Readonly<Record<string, string>>;

/**
 * Write `vars` onto `element`, touching only what changed since `previous`.
 *
 * Returns the new handle. Properties present in `previous` and absent from
 * `vars` are removed, so a theme that drops a token does not leave it behind —
 * a stale property is worse than a missing one, because it renders as a value
 * somebody chose rather than as an obvious gap.
 */
export function applyVariables(
  element: HTMLElement,
  vars: Readonly<Record<string, string>>,
  previous: PublishHandle = {}
): PublishHandle {
  const style = element.style;

  for (const [name, value] of Object.entries(vars)) {
    if (previous[name] !== value) style.setProperty(name, value);
  }
  for (const name of Object.keys(previous)) {
    if (!(name in vars)) style.removeProperty(name);
  }

  return vars;
}

/** Remove everything a handle wrote. For unmount. */
export function clearVariables(element: HTMLElement, handle: PublishHandle): void {
  for (const name of Object.keys(handle)) element.style.removeProperty(name);
}

/**
 * How many properties a change would actually write — for a designer surface,
 * and for proving the diff works rather than assuming it.
 */
export function changeCount(
  vars: Readonly<Record<string, string>>,
  previous: PublishHandle
): { written: number; removed: number; unchanged: number } {
  let written = 0;
  let unchanged = 0;
  for (const [name, value] of Object.entries(vars)) {
    if (previous[name] !== value) written++;
    else unchanged++;
  }
  let removed = 0;
  for (const name of Object.keys(previous)) if (!(name in vars)) removed++;
  return { written, removed, unchanged };
}
