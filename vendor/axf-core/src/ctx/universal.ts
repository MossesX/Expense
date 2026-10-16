/**
 * @file D2's universal group — the basics every menu carries.
 *
 * The decision, verbatim (owner, 2026-08-07): *"The shell DOES inject a
 * universal group on every menu (copy value, copy path, inspect, reload),
 * always last, always suppressible per area. A menu that varies in whether it
 * has the basics is a menu people stop trusting."*
 *
 * ── IT IS AN AREA, NOT A HARD-CODED BLOCK ─────────────────────────────────────
 *
 * The one design decision here worth defending. These four rows could have been
 * a `CtxItem[]` built in code, the way `default-menu.ts` builds the floor — and
 * that would have been three fewer indirections and one more exception.
 *
 * Instead the universal group is an ordinary AREA (`universal`) with ordinary
 * authored items in the ordinary map. It is simply an area that is never marked
 * in the DOM: the engine appends it to every menu rather than finding it on the
 * way up. Everything else follows from that for free —
 *
 * - a plugin adds a universal row through `ctx.item` like any other row, with no
 *   second mechanism and no special case in `contributions.ts`;
 * - P4's overlay can hide, rename and reorder these rows with no new code, since
 *   they carry an `origin` exactly like every other row;
 * - the manager (P5's successor project) lists them beside everything else,
 *   rather than needing to know that four rows live somewhere it cannot edit;
 * - the map's registration gate covers them, so a universal row naming a command
 *   nobody registered is refused where it is written.
 *
 * The floor in `default-menu.ts` genuinely cannot be data — its labels quote the
 * live selection and the clipboard, and a `MenuItem` label is a static string.
 * That is the real dividing line between the two, and it is worth stating plainly
 * because "why are there two bottom bands" is otherwise a fair question.
 *
 * ── WHAT "ALWAYS LAST" MEANS, PRECISELY ───────────────────────────────────────
 *
 * Last of everything the MAP contributes: after every area's groups, however
 * deep the click was. Beneath it sits the floor — the target header, the
 * clipboard rows and Sign in / Sign out — which is not an area's contribution at
 * all but the chrome the owner's 2026-08-09 directive puts on every right-click
 * in the project unconditionally. So the ordering is
 *
 *     [innermost area] … [outermost area] [universal] [floor]
 *
 * and `suppressUniversal` governs the third band only. It deliberately cannot
 * reach the fourth: an area suppressing the floor could produce a right-click
 * with no menu at all, which is the one outcome the directive rules out — and it
 * would take Sign out with it, which no surface should be able to do.
 */
import type { AreaPath } from "./areas";
import { composeArea, menuContextFor } from "./compose";
import type { ComposeInput, ComposeOptions } from "./compose";
import { GROUP_UNIVERSAL, MenuMap, menu } from "./map";
import type { Area, CtxItem, MenuItem } from "./types";

/**
 * The area the universal band lives in.
 *
 * It shares its id with {@link GROUP_UNIVERSAL} — the band and the area are the
 * same idea seen from two angles, and giving them different names would mean
 * remembering which one a given call site wanted.
 */
export const AREA_UNIVERSAL = "universal";

export const UNIVERSAL_AREA: Area = {
  id: AREA_UNIVERSAL,
  title: "Universal",
  description:
    "The basics every menu carries. Never marked in the DOM — the engine appends it to every " +
    "menu, last, unless the area the click was rooted in suppresses it.",
  owner: "ctx",
  group: GROUP_UNIVERSAL
};

/**
 * The four rows D2 names.
 *
 * NO ICONS except Reload's, and that is a check rather than an oversight. `icon`
 * names an id in the glyph CONTRACT (`brand/requirements.ts`); `icon-reload` is
 * in it and means exactly "re-read from source". There is no `icon-copy`, no
 * `icon-path` and no `icon-inspect`, and naming one anyway would draw nothing
 * and take the pack's coverage card red. Adding those drawings is the branding
 * pack's job, not this file's — the same rule `ctx/commands.ts` already applies
 * to Cut, Copy and Paste.
 */
export const UNIVERSAL_ITEMS: readonly MenuItem[] = [
  {
    id: "copy-value",
    label: "Copy value",
    command: "ctx.copyValue",
    // Greyed WITH a reason rather than hidden, because "there is nothing here to
    // copy" is a fact about this click that the reader benefits from seeing — a
    // row that appears and disappears teaches people the menu is unpredictable.
    enabledWhen: "target.hasValue",
    order: 10
  },
  {
    id: "copy-path",
    label: "Copy path",
    command: "ctx.copyPath",
    order: 20
  },
  {
    id: "inspect",
    label: "Inspect",
    command: "ctx.inspect",
    order: 30
  },
  {
    id: "reload",
    label: "Reload",
    icon: "icon-reload",
    command: "ctx.reload",
    order: 40
  },
  {
    // The fifth row (0.0.20): every module's settings, from every right-click
    // on that module — the context-menu half of the shell-owned sui
    // affordance. `when` rather than `enabledWhen`, deliberately: on a route
    // hosting no module, or one declaring no settings, the row is ABSENT
    // rather than greyed — "no settings exist here" is not a temporary state
    // a reason could explain, it is the surface's shape. `icon-gear` is in
    // the glyph contract (the command bar's gear draws it).
    id: "module-settings",
    label: "Module settings",
    icon: "icon-gear",
    command: "module.settings.open",
    when: "module.settings.here",
    order: 50
  },
  {
    // The sixth row (0.0.21, owner: *"a settings dialog opened by right
    // clicking the toolbar and selecting settings"*).
    //
    // It lives on the UNIVERSAL band rather than in an area of its own, and
    // that is the decision worth defending. A `toolbar` area would need
    // `<Toolbar>` to mark itself in the DOM, would need declaring by a host,
    // and would still only cover the bars that remembered the marker. The
    // universal band is on every menu already, and `data-axf-toolbar` — which
    // every bar has carried since the asset kind existed — is harvested by the
    // walk from any depth. So one row, `when`-gated on that data, gives every
    // toolbar asset the dialog: the banner, a pane bar, a rail, an inline
    // placement, and the ones nobody has written yet.
    //
    // `when` rather than `enabledWhen`, exactly as the module-settings row
    // above: away from a bar the row is ABSENT, not greyed. "You are not
    // pointing at a toolbar" is not a temporary state a reason could explain.
    id: "toolbar-settings",
    label: "Toolbar settings",
    icon: "icon-gear",
    command: "toolbar.settings.open",
    when: "toolbar.here",
    order: 60
  }
];

/**
 * Put the universal area and its rows into a map. Idempotent.
 *
 * MUST run after `registerCtxCommands()`: the map refuses an item naming an
 * unregistered command at registration, which is the gate P0 built and which
 * these four rows are subject to exactly like everyone else's.
 */
export function declareUniversalArea(map: MenuMap = menu): void {
  if (map.area(AREA_UNIVERSAL)) return;
  map.declareArea(UNIVERSAL_AREA);
  map.contribute(AREA_UNIVERSAL, UNIVERSAL_ITEMS);
}

/**
 * Which area suppressed the universal band, or `null` if none did.
 *
 * The area the menu is ROOTED in decides — the innermost DECLARED area on the
 * path — and an outer one cannot impose it. That direction is the whole of the
 * rule: `shell` is on every path, so an outer veto would strip the basics from
 * the entire app in one line, and a container cannot know that an inner
 * surface's basics do not apply. The surface you actually clicked can.
 *
 * Returning the id rather than a boolean so an inspector, and P4's "why is this
 * row not in my menu", can name who did it.
 */
export function universalSuppressedBy(path: AreaPath, map: MenuMap = menu): string | null {
  const root = path.contributing[0];
  if (!root) return null;
  return map.area(root)?.suppressUniversal ? root : null;
}

/**
 * The universal band for one click: the four basics plus whatever plugins
 * contributed to `universal`, resolved through exactly the same predicate and
 * command machinery as every other row.
 *
 * Empty when the rooting area suppresses it, and empty when nothing is declared
 * — a host that never called {@link declareUniversalArea} gets no rows rather
 * than a crash, which matters because `ContextMenuRoot` composes this on every
 * right-click and a menu must open.
 */
export function universalMenu(input: ComposeInput, options: ComposeOptions = {}): CtxItem[] {
  const map = options.map ?? menu;
  if (universalSuppressedBy(input.path, map)) return [];
  return composeArea(AREA_UNIVERSAL, menuContextFor(input), map);
}
