/**
 * @file The default menu — what a right-click produces ANYWHERE, always.
 *
 * The owner's directive (2026-08-09): every right-click in the project shows a
 * menu, no matter where it lands. A header naming what was clicked, a divider,
 * the clipboard actions that genuinely apply right now, a divider, and Sign in
 * or Sign out in red depending on session status.
 *
 * "Always" is the load-bearing word. This is not a fallback for surfaces that
 * forgot to handle the event — it is the floor. Once `axf-context-menus` lands
 * its area resolver, an area's own groups get composed ABOVE these rows and
 * these rows stay at the bottom, which is what D2 (the universal group) already
 * decided: *"a menu that varies in whether it has the basics is a menu people
 * stop trusting."*
 *
 * Rows are included on the basis of whether they APPLY, and greyed with a
 * reason when they cannot run. The one thing that never happens is a row that
 * does nothing when clicked.
 */
import type { CtxClipboard, CtxItem, CtxTarget } from "./types";

/** Trim a selection down to something that fits on one menu row. */
function quote(text: string, max = 28): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

export interface DefaultMenuInput {
  target: CtxTarget;
  clipboard: CtxClipboard;
  signedIn: boolean;
  user: string | null;
}

export function defaultMenu({ target, clipboard, signedIn, user }: DefaultMenuInput): CtxItem[] {
  const items: CtxItem[] = [
    { id: "header", label: target.label, role: "header" },
    { id: "sep-1", label: "", role: "separator" }
  ];

  const hasSelection = target.selection.length > 0;

  if (hasSelection) {
    items.push({
      id: "cut",
      label: `Cut “${quote(target.selection)}”`,
      command: "ctx.cut",
      // Cut is offered whenever there is a selection, because the owner asked
      // for cut AND copy on highlighted text — but it can only remove text
      // from something that accepts text, so elsewhere it says so instead of
      // pretending.
      disabledReason: target.editable ? undefined : "this text is not editable"
    });
    items.push({
      id: "copy",
      label: `Copy “${quote(target.selection)}”`,
      command: "ctx.copy"
    });
  }

  // Paste appears when the SYSTEM clipboard holds something — from any app.
  // When the browser refused to let us look, the row still appears, disabled,
  // carrying the refusal: "we could not check" must not render as "empty".
  if (clipboard.text) {
    items.push({
      id: "paste",
      label: `Paste “${quote(clipboard.text)}”`,
      command: "ctx.paste",
      disabledReason: target.editable ? undefined : "nothing here accepts text"
    });
  } else if (clipboard.unreadable) {
    items.push({
      id: "paste",
      label: "Paste",
      command: "ctx.paste",
      disabledReason: clipboard.unreadable
    });
  }

  if (hasSelection || clipboard.text || clipboard.unreadable) {
    items.push({ id: "sep-2", label: "", role: "separator" });
  }

  items.push(
    signedIn
      ? { id: "session", label: `Sign out${user ? ` (${user})` : ""}`, role: "danger", command: "session.signOut" }
      : { id: "session", label: "Sign in", role: "danger", command: "session.signIn" }
  );

  return items;
}
