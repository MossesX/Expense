/**
 * @file INLINE TOOLBARS — write a toolbar asset's id into the markup and the
 * renderer draws the real bar there.
 *
 * Owner, 2026-08-13: *"add method to rendering engine that allows insert
 * toolbar assets inline simply by putting toolbars asset id inline in the
 * html"*.
 *
 * ## The two spellings, and why both
 *
 * ```html
 * <axf-toolbar id="taskman-lists-bar"></axf-toolbar>
 * <div data-axf-toolbar-asset="taskman-lists-bar"></div>
 * ```
 *
 * The custom tag is the one the request describes — an id, inline, in HTML. It
 * is what a string of markup coming from somewhere else can carry: a docgen
 * page, a note body, an `dangerouslySetInnerHTML` block, anything the app did
 * not author in JSX. The data attribute exists because JSX has opinions about
 * unknown tags and a plain `<Box data-axf-toolbar-asset="…" />` typechecks
 * everywhere with no ambient declaration; it is the same mechanism wearing an
 * attribute.
 *
 * Both are PLACEHOLDERS, not renderers. {@link InlineToolbars} — mounted once,
 * by `AppShell` — finds them and portals a real `<Toolbar asset="…">` into
 * each. That indirection is what makes this work at all: a toolbar item is a
 * live control that fires commands through the registry, so it has to be React
 * inside the React tree, not markup pasted into a container.
 *
 * ## Why a document scan rather than a parser
 *
 * The alternative was to teach every markup-rendering surface to recognise the
 * tag on its way through. That is one edit per surface, forever, and the ones
 * written next year would not know to make it — which is precisely the
 * "coverage by habit" failure the context-menu engine was built to end. A
 * single document-level observer covers markup from any source, including
 * sources that do not exist yet, and costs one mount.
 *
 * The observer is the same shape `ContextMenuRoot` uses for right-clicks: ONE
 * listener at the top, so a surface participates by MARKING itself rather than
 * by remembering to wire something up.
 *
 * ## What it deliberately does not do
 *
 * No content, no fills. An inline bar is arrangement plus commands; a `slot`
 * item in one renders nothing, because the host that would fill it is not in
 * this conversation. A bar meant to carry live host content belongs on a
 * surface, mounted by that host, which is what `<Toolbar surface="…">` is for.
 */
"use client";

import * as React from "react";
import { createPortal } from "react-dom";

import { commands } from "../commands";
import { Toolbar } from "./Toolbar";

/** The attribute spelling. `data-axf-toolbar-asset="<id>"`. */
export const INLINE_TOOLBAR_ATTR = "data-axf-toolbar-asset";

/** The tag spelling. `<axf-toolbar id="<id>">`. */
export const INLINE_TOOLBAR_TAG = "axf-toolbar";

/** Marks a placeholder as claimed, so a second observer pass ignores it. */
const CLAIMED_ATTR = "data-axf-toolbar-mounted";

const SELECTOR = `[${INLINE_TOOLBAR_ATTR}], ${INLINE_TOOLBAR_TAG}`;

/**
 * The asset id a placeholder names, or `null` when it names nothing.
 *
 * Exported because it is the whole contract between the markup and the
 * renderer, and a test that had to re-derive it from a regex here would be
 * testing its own copy.
 */
export function inlineToolbarId(element: Element): string | null {
  const raw =
    element.getAttribute(INLINE_TOOLBAR_ATTR) ??
    (element.tagName.toLowerCase() === INLINE_TOOLBAR_TAG ? element.getAttribute("id") : null);
  const id = raw?.trim();
  return id ? id : null;
}

/** Every unclaimed placeholder under `root`, including `root` itself. */
export function findInlineToolbars(root: ParentNode & Element): Element[] {
  const found: Element[] = [];
  if (root.matches?.(SELECTOR)) found.push(root);
  for (const el of root.querySelectorAll(SELECTOR)) found.push(el);
  return found.filter((el) => !el.hasAttribute(CLAIMED_ATTR) && inlineToolbarId(el) !== null);
}

interface Mount {
  /** Stable across re-scans — the portal's React key. */
  readonly key: string;
  readonly host: Element;
  readonly id: string;
}

let counter = 0;

/**
 * Mount ONCE, at the app root. Renders nothing of its own; every bar it draws
 * is portalled into the placeholder that asked for it.
 *
 * Placement in the tree is irrelevant to where the bars appear (a portal goes
 * where its host element is) but not irrelevant otherwise: it must be inside
 * the providers a `Toolbar` needs — the theme root and the MUI provider — which
 * is why `AppShell` mounts it beside `ContextMenuRoot` rather than at the very
 * top of the document.
 */
export function InlineToolbars() {
  const [mounts, setMounts] = React.useState<Mount[]>([]);

  React.useEffect(() => {
    /** Claim every placeholder currently in the document. */
    const scan = (): void => {
      const fresh: Mount[] = [];
      for (const host of findInlineToolbars(document.body)) {
        const id = inlineToolbarId(host);
        if (!id) continue;
        host.setAttribute(CLAIMED_ATTR, id);
        fresh.push({ key: `axf-inline-${(counter += 1)}`, host, id });
      }
      if (fresh.length) setMounts((previous) => [...previous, ...fresh]);
    };

    /** Forget mounts whose host has left the document — otherwise a route
     *  change leaks a portal per placeholder it rendered. */
    const prune = (): void =>
      setMounts((previous) => {
        const alive = previous.filter((m) => m.host.isConnected);
        return alive.length === previous.length ? previous : alive;
      });

    scan();

    // One observer for the whole document. A placeholder that arrives with a
    // route change, a lazy pane or a string of markup is picked up with no
    // involvement from whatever put it there — which is the point of the file.
    const observer = new MutationObserver((records) => {
      let touched = false;
      for (const record of records) {
        if (record.addedNodes.length || record.removedNodes.length) touched = true;
      }
      if (!touched) return;
      prune();
      scan();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (!mounts.length) return null;

  return (
    <>
      {mounts.map((mount) =>
        createPortal(
          <Toolbar
            asset={mount.id}
            // An inline bar has no host, so its commands go straight to the
            // registry — which is where a toolbar item's command was always
            // resolved; the surface-mounted case only routes through `onCommand`
            // so a host can intercept first.
            onCommand={(command) => void commands.run(command)}
          />,
          mount.host,
          mount.key
        )
      )}
    </>
  );
}
