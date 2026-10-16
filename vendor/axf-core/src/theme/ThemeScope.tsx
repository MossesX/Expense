/**
 * @file `<ThemeScope>` — a subtree rendered in a different theme.
 *
 * The root publisher (`AxfStyleRoot`) owns `:root` and there is exactly one of
 * it, deliberately — two writers of the same property is the race this engine
 * already had once. `ThemeScope` is the sanctioned way to have a second theme on
 * screen without reopening that: it publishes onto its OWN element, so the
 * properties scope to its subtree and never touch the root.
 *
 * What it unlocks, none of which is possible with a root-only publisher:
 *
 * - a live preview of a theme beside the one in force;
 * - a module rendering in its own theme inside an app in another;
 * - side-by-side comparison of rolled themes — which the brand gallery
 *   currently fakes by hand-drawing swatches, and a swatch cannot show what a
 *   radius or a type scale looks like.
 *
 * Writes are diffed (see `publish.ts`), so dragging a slider in a preview
 * touches one property rather than rewriting the set.
 */
"use client";

import * as React from "react";

import { resolveVariables } from "./resolve";
import type { StyleInput } from "./resolve";
import type { ThemeValues } from "./spec";
import { applyVariables, clearVariables } from "./publish";
import type { PublishHandle } from "./publish";

export function ThemeScope({
  values,
  pack = null,
  as: Tag = "div",
  className,
  children,
  ...rest
}: {
  /** The theme this subtree renders in. */
  values: ThemeValues;
  /** Optional pack input, same shape the root resolver takes. */
  pack?: StyleInput | null;
  as?: "div" | "section" | "article";
  className?: string;
  children?: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, "style">) {
  const ref = React.useRef<HTMLElement | null>(null);
  const handle = React.useRef<PublishHandle>({});

  const vars = React.useMemo(() => resolveVariables(values, pack), [values, pack]);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    handle.current = applyVariables(el, vars, handle.current);
  }, [vars]);

  React.useEffect(() => {
    const el = ref.current;
    return () => {
      // Clear AND reset — same StrictMode double-mount trap as AxfStyleRoot:
      // a handle that outlives its cleared properties makes the remounted
      // layout effect diff against writes that no longer exist.
      if (el) clearVariables(el, handle.current);
      handle.current = {};
    };
  }, []);

  return React.createElement(
    Tag,
    {
      ...rest,
      className,
      ref: ref as React.Ref<HTMLElement>,
      // The scope paints itself, or a preview shows the new palette's text on
      // the OUTER theme's background and reads as broken.
      style: {
        background: "var(--axf-page)",
        color: "var(--axf-ink)",
        fontFamily: "var(--axf-sans)",
        fontSize: "var(--axf-size-body)"
      }
    },
    children
  );
}
