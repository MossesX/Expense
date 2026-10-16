/**
 * @file Composition — turning an area path plus the map into the rows to draw.
 *
 * {@link ./areas} answered *where the click landed*. This answers *what the menu
 * therefore is*: each contributing area on the path hands over its items, the
 * names on them (`when`, `enabledWhen`, `checkedWhen`, `command`) are evaluated
 * against one context resolved at the moment of the click, and what comes out is
 * `CtxItem[]` — final labels, no predicates, nothing left to look up.
 *
 * This is the `MenuItem[] → CtxItem[]` compile step `types.ts` names as the
 * resolver's job, and it is the only place a NAME becomes a VALUE.
 *
 * ── ORDER ─────────────────────────────────────────────────────────────────────
 *
 * Most specific first: the innermost area's rows sit at the top, then the next
 * one out, dividers between. Within an area, `MenuMap.itemsFor` has already
 * sorted by group order, then item order, then item id — a total order, so the
 * same map always draws the same menu. A group with a title also opens with a
 * heading; an untitled group is just a divider, which is what `Group.title` says.
 *
 * Bands are AREA-MAJOR, and it is worth being explicit about what that means for
 * a group shared across areas: it does not merge. Group order sorts the bands
 * *within* one area; the path sorts the areas. D2's universal group is the one
 * band that genuinely spans the whole menu, and it is composed by the shell after
 * this walk rather than inside it (P3) — precisely because it is the exception.
 *
 * ── WHAT IS NOT HERE ──────────────────────────────────────────────────────────
 *
 * The edits-only overlay is P4, and it composes ON TOP of this — nothing here
 * has to be undone for it.
 *
 * P3 landed as predicted and cost this file three lines: plugin contributions
 * arrive through `contributions.ts` as ordinary items in the ordinary map, so
 * nothing here can tell a plugin's row from an author's; and D2's universal
 * group turned out to be an AREA (`universal.ts`), so it needed the per-area
 * loop rather than a special case — which is why that loop is now
 * {@link composeArea} and is called from two places instead of one.
 */
import { commands } from "../commands";
import type { AreaPath } from "./areas";
import { inDevelopment } from "./areas";
import { GROUP_DEFAULT, MenuMap, menu } from "./map";
import { predicates } from "./predicates";
import type { MenuContext } from "./predicates";
import type { CtxClipboard, CtxItem, CtxTarget, MenuItem } from "./types";

/** Everything the click told us, before the map is consulted. */
export interface ComposeInput {
  readonly path: AreaPath;
  readonly target: CtxTarget;
  readonly clipboard: CtxClipboard;
  readonly signedIn: boolean;
  readonly user: string | null;
}

export interface ComposeOptions {
  /** Which map to compose from. Defaults to the singleton. */
  readonly map?: MenuMap;
  /**
   * Append the undeclared-area notice. Defaults to {@link inDevelopment}.
   *
   * D1's warning has to be *visible*, not merely logged: a console line is read
   * by whoever has devtools open, and a typo'd marker is most often noticed by
   * whoever does not. So in development the menu itself says so, as a `header`
   * row — structural, unfocusable, impossible to click and therefore impossible
   * to turn into a dead row.
   */
  readonly noticeUndeclared?: boolean;
}

/**
 * Build the context every predicate on this menu is evaluated against.
 *
 * Resolved ONCE per menu, not per predicate: two rows asking "is anything
 * selected" must get the same answer, and a context recomputed per row could
 * disagree with itself halfway down a menu.
 */
export function menuContextFor(input: ComposeInput): MenuContext {
  return {
    // The FULL path, uncapped — D3 bounds which areas contribute rows, not what
    // a predicate may know. A row that wants to check it is inside a particular
    // module still can, however deep it sits.
    path: input.path.path,
    area: input.path.path[0] ?? null,
    target: input.target,
    clipboard: input.clipboard,
    signedIn: input.signedIn,
    user: input.user,
    data: input.path.data
  };
}

/**
 * The per-row context: the menu's, plus the row's own command id under `command`.
 *
 * `command` is a RESERVED key in `MenuContext.data` — the built-in
 * `command.available` predicate reads it, and it is injected here, last, so it
 * wins over a harvested `data-axf-command` should a surface ever mark one.
 */
function withCommand(ctx: MenuContext, command: string | undefined): MenuContext {
  return { ...ctx, data: { ...ctx.data, command: command ?? "" } };
}

let sequence = 0;

/** A divider. Ids are unique per composed menu because the renderer keys on them. */
function separator(key: string): CtxItem {
  return { id: `sep:${key}:${sequence++}`, label: "", role: "separator" };
}

/**
 * Compile one authored item into a drawn row, or `null` if it does not belong in
 * this menu at all.
 */
function resolveItem(item: MenuItem, ctx: MenuContext, areaId: string): CtxItem | null {
  const rowCtx = withCommand(ctx, item.command);

  // Presence. The reason a `when` gives is discarded — a row that is absent
  // needs no explanation on screen. (It is still available to an inspector
  // answering "why is this row not in my menu", which is a question the manager
  // will be asked.)
  if (item.when !== undefined && !predicates.holds(item.when, rowCtx)) return null;

  const role = item.role ?? "normal";
  const base = {
    id: `${areaId}:${item.id}`,
    label: item.label,
    role,
    origin: { area: areaId, item: item.id }
  };

  if (role === "separator" || role === "header") return base;

  if (role === "submenu") {
    const children = (item.items ?? [])
      .map((child) => resolveItem(child, ctx, areaId))
      .filter((child): child is CtxItem => child !== null);
    // Every child was filtered out by its `when`, so the flyout would open on
    // nothing. Dropping the parent is the only option that is not a dead row:
    // a submenu that opens empty is a click that does nothing, wearing a
    // disclosure arrow that promised it would not be.
    if (!children.length) return null;
    return { ...base, items: children };
  }

  let disabledReason: string | undefined;
  if (item.command !== undefined && !commands.has(item.command)) {
    // Checked unconditionally rather than only when the author remembered to
    // name `command.available` in `enabledWhen`. The plan's rule — *caught at
    // package time, reported at run time as a disabled row naming the missing
    // command, never a row that does nothing when clicked* — is a guarantee, and
    // a guarantee that depends on every author opting in is a habit. This
    // reason outranks the author's own because it names a defect somebody needs
    // to fix, where `enabledWhen` only describes a state.
    disabledReason = `the command "${item.command}" is no longer registered`;
  } else if (item.enabledWhen !== undefined) {
    const verdict = predicates.evaluate(item.enabledWhen, rowCtx);
    if (verdict !== true) disabledReason = verdict;
  }

  const row: CtxItem = { ...base, command: item.command, disabledReason };
  if (role === "toggle" && item.checkedWhen !== undefined) {
    row.checked = predicates.holds(item.checkedWhen, rowCtx);
    // Carried only alongside a real state. `marks` on a row with no `checked`
    // would tell the renderer how to draw something it has not been given.
    if (item.marks !== undefined) row.marks = item.marks;
  }
  return row;
}

/**
 * Compose ONE area's rows — every item it holds, resolved, with its internal
 * band dividers and group headings, and no leading or trailing separator.
 *
 * Extracted from {@link composeMenu} in P3 rather than copied, because D2's
 * universal group is an area too (`universal.ts`): it is simply the one area
 * that is never marked in the DOM, so the engine appends it instead of finding
 * it on the way up. Everything about how an area becomes rows — the `when`
 * filter, the disabled reason, the toggle state, the band dividers — has to be
 * identical for it, and the only way to guarantee identical is to be the same
 * function. A second copy would drift, and it would drift silently: two menus
 * that are subtly ordered differently look like a rendering bug, not like two
 * implementations.
 */
export function composeArea(areaId: string, ctx: MenuContext, map: MenuMap = menu): CtxItem[] {
  const fallbackGroup = map.area(areaId)?.group ?? GROUP_DEFAULT;
  const rows: CtxItem[] = [];
  let band: string | null = null;

  for (const item of map.itemsFor(areaId)) {
    const resolved = resolveItem(item, ctx, areaId);
    if (!resolved) continue;

    const group = item.group ?? fallbackGroup;
    if (band !== null && group !== band) rows.push(separator(`${areaId}:${group}`));
    if (group !== band) {
      const title = map.group(group)?.title;
      if (title) rows.push({ id: `head:${areaId}:${group}`, label: title, role: "header" });
    }
    band = group;
    rows.push(resolved);
  }

  return rows;
}

/**
 * Compose the rows the area path contributes.
 *
 * Returns only the area-derived portion of the menu. The target header, the
 * clipboard rows and D2's universal band are the shell's (see `default-menu.ts`
 * and P3) — this function's answer to "what does this click mean" is exactly the
 * areas' answer and nothing else, which is what makes it testable against a map
 * rather than against an app.
 */
export function composeMenu(input: ComposeInput, options: ComposeOptions = {}): CtxItem[] {
  const map = options.map ?? menu;
  const notice = options.noticeUndeclared ?? inDevelopment();
  const ctx = menuContextFor(input);
  const out: CtxItem[] = [];

  for (const areaId of input.path.contributing) {
    const rows = composeArea(areaId, ctx, map);

    // An area whose every row was filtered out adds nothing — including the
    // divider that would have introduced it. A menu with two dividers and no rows
    // between them looks like something failed to load, and something did.
    if (!rows.length) continue;
    if (out.length) out.push(separator(areaId));
    out.push(...rows);
  }

  if (notice && input.path.undeclared.length) {
    if (out.length) out.push(separator("undeclared"));
    for (const id of input.path.undeclared) {
      out.push({
        id: `undeclared:${id}`,
        label: `⚠ area "${id}" is not declared — no rows`,
        role: "header"
      });
    }
  }

  return out;
}

/**
 * The whole resolve, for a caller that has an element and wants rows.
 *
 * Kept as a thin composition of the two halves rather than as the only entry
 * point: the walk and the composition are separately useful — the manager wants
 * a path without a menu, and a test wants a menu without a DOM.
 */
export function resolveMenu(
  input: ComposeInput,
  options: ComposeOptions = {}
): { context: MenuContext; items: CtxItem[] } {
  return { context: menuContextFor(input), items: composeMenu(input, options) };
}
