/**
 * @file The handlers behind the framework's own menu rows, registered by NAME —
 * the default menu's floor, and (since P3) D2's universal group.
 *
 * The universal group's DATA lives in `universal.ts` as authored items in the
 * map; only its behaviour is here. That split is the same one the whole package
 * runs on and it is worth keeping deliberate: this is the file allowed to touch
 * the DOM, the clipboard and the location, and everything else stays pure and
 * serialisable on the other side of a command name.
 *
 * The menu is data (`default-menu.ts`); this is where the behaviour lives, and
 * the two only meet through the command registry. That indirection is why the
 * menu can later be edited, reordered or contributed to by a UI without any of
 * this moving.
 *
 * Registration is idempotent because `CommandRegistry.register` throws on a
 * duplicate name — correct for real conflicts, fatal under a dev-server
 * remount, which would otherwise take down the shell the second time the
 * module evaluated. So each name is taken once and the unregister functions
 * are kept for a host that genuinely tears down.
 *
 * NO DEFAULT HOTKEYS ON THE CLIPBOARD ROWS, and this is a decision rather than
 * an omission. `Command.hotkey` is consumed by the hotkey system, which binds
 * it globally; declaring `Ctrl+C` here would take the chord away from the
 * browser's own copy and break text editing everywhere in the app to serve a
 * menu row that already works. A command only claims a chord it can honestly
 * own.
 *
 * NO ICONS ON THEM EITHER, for a checkable reason: `icon` names an id in the
 * glyph CONTRACT (`brand/requirements.ts`), and there is no `icon-copy`,
 * `icon-cut` or `icon-paste` in it. Naming one anyway would draw nothing and go
 * red on the coverage card. Adding three drawings is the branding pack's job,
 * not this file's. `icon-account` is in the contract, so the session rows use
 * it and the field is exercised rather than merely declared.
 */
import { commands } from "../commands";
import { session } from "../auth/session";
import { hostedModule, settings, settingsUi } from "../settings/store";
import { toolbarPrefsUi } from "../toolbar/prefs";
import { predicates } from "./predicates";
import { activeContext, activeTarget } from "./resolve";

/**
 * Where the bar's id shows up in a resolved context.
 *
 * `<Toolbar>` marks `data-axf-toolbar="<id>"`; the walk harvests every
 * `data-axf-*` it passes and names it with the `axf` prefix dropped and the
 * next letter lowercased (`areas.ts`), so `data-axf-toolbar` arrives as
 * `data.toolbar`. Spelled once here because the command and the predicate must
 * agree about it, and a second string literal is how they stop agreeing.
 */
const TOOLBAR_DATA_KEY = "toolbar";

/** Put text on the system clipboard, falling back to the legacy path. */
async function write(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // `execCommand` is deprecated but still the only route when the async API
    // is refused, and a copy that silently does nothing is worse than a
    // deprecation.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } finally {
      ta.remove();
    }
  }
}

/** Replace the current selection inside an editable target with `text`. */
function replaceSelection(text: string): void {
  const t = activeTarget();
  const el = t?.element ?? null;
  if (!el) return;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    el.value = el.value.slice(0, start) + text + el.value.slice(end);
    const caret = start + text.length;
    el.setSelectionRange(caret, caret);
    // React listens for `input`, not for a programmatic value assignment.
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  if (el.isContentEditable) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    sel.collapseToEnd();
  }
}

let registered = false;

/** Take the default menu's command names. Safe to call more than once. */
export function registerCtxCommands(): void {
  if (registered) return;
  registered = true;

  commands.register({
    id: "ctx.copy",
    title: "Copy",
    run: () => {
      const t = activeTarget();
      if (t?.selection) void write(t.selection);
    }
  });

  commands.register({
    id: "ctx.cut",
    title: "Cut",
    run: () => {
      const t = activeTarget();
      if (!t?.selection) return;
      void write(t.selection).then(() => replaceSelection(""));
    }
  });

  commands.register({
    id: "ctx.paste",
    title: "Paste",
    run: () => {
      void navigator.clipboard
        .readText()
        .then((text) => {
          if (text) replaceSelection(text);
        })
        .catch(() => {
          // The row is only enabled when a prior read succeeded, so a failure
          // here means permission was revoked between opening the menu and
          // clicking. Nothing to do but leave the field untouched.
        });
    }
  });

  /* ------------------------------------- D2's universal group (P3) ------- */

  commands.register({
    id: "ctx.copyValue",
    title: "Copy value",
    run: () => {
      const value = activeTarget()?.value;
      if (value) void write(value);
    }
  });

  commands.register({
    id: "ctx.copyPath",
    title: "Copy path",
    run: () => {
      const ctx = activeContext();
      // The AREA path, not a CSS selector and not the URL. It is the address
      // this whole system resolves by, so it is the one string that is worth
      // pasting into a bug report, a map file or a question — a selector
      // describes a DOM that will have changed by tomorrow.
      const path = ctx?.path ?? [];
      const text = path.length
        ? path.join(" < ")
        : // A click that landed in no declared area still has an answer, and the
          // route is it. Copying nothing would look like the row failed.
          (typeof window !== "undefined" ? window.location.pathname : "/");
      void write(text);
    }
  });

  commands.register({
    id: "ctx.inspect",
    title: "Inspect",
    run: () => {
      // A page cannot open the browser's devtools — there is no API for it and
      // there should not be. What this row CAN honestly do is print everything
      // the resolver worked out about the click, which is the half a person
      // actually wants when they reach for Inspect inside this app: the area
      // path, the harvested data, and what the target was taken to be.
      const ctx = activeContext();
      const target = activeTarget();
      if (typeof console === "undefined") return;
      console.group?.("[axf] context");
      console.log("area path", ctx?.path ?? []);
      console.log("data", ctx?.data ?? {});
      console.log("target", {
        label: target?.label ?? "",
        value: target?.value ?? "",
        selection: target?.selection ?? "",
        editable: target?.editable ?? false
      });
      console.log("element", target?.element ?? null);
      console.groupEnd?.();
    }
  });

  commands.register({
    id: "ctx.reload",
    title: "Reload",
    icon: "icon-reload",
    run: () => {
      if (typeof window !== "undefined") window.location.reload();
    }
  });

  /* ----------------------------- module settings (0.0.20) ---------------- */

  commands.register({
    id: "module.settings.open",
    title: "Module settings",
    run: () => {
      // The hosted-module seam first (set by ModuleHost, covers every click on
      // a module route), the area path second (covers a `module:<id>` area a
      // surface marked itself, e.g. inside a portal on a non-module route).
      const mod = hostedModule();
      if (mod) {
        settingsUi.open(mod.id);
        return;
      }
      const fromPath = activeContext()
        ?.path.find((a) => a.startsWith("module:"))
        ?.slice("module:".length);
      if (fromPath) settingsUi.open(fromPath);
    }
  });

  predicates.register({
    id: "module.settings.here",
    title: "This surface has module settings",
    test: (ctx) => {
      const mod = hostedModule();
      const id =
        mod?.id ?? ctx.path.find((a) => a.startsWith("module:"))?.slice("module:".length) ?? null;
      if (!id) return "no module is hosted here";
      if (!settings.has(id)) return `"${id}" declares no settings`;
      return true;
    }
  });

  /* ---------------------------- toolbar settings (0.0.21) ---------------- */

  commands.register({
    id: "toolbar.settings.open",
    title: "Toolbar settings",
    icon: "icon-gear",
    run: () => {
      // `data-axf-toolbar` on the bar, harvested by the area walk from
      // whatever depth the click landed at — an icon inside a drop zone inside
      // a button is three elements below the marker, and reading the DOM back
      // here would be re-implementing the walk that already ran.
      const id = activeContext()?.data[TOOLBAR_DATA_KEY];
      if (id) toolbarPrefsUi.open(id);
    }
  });

  predicates.register({
    id: "toolbar.here",
    title: "The click landed inside a toolbar",
    test: (ctx) => (ctx.data[TOOLBAR_DATA_KEY] ? true : "the pointer is not over a toolbar")
  });

  commands.register({
    id: "session.signIn",
    title: "Sign in",
    icon: "icon-account",
    run: () => session.signIn()
  });

  commands.register({
    id: "session.signOut",
    title: "Sign out",
    icon: "icon-account",
    run: () => session.signOut()
  });
}
