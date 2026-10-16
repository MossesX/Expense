/**
 * @file Module-declared context menus — the decl shape and its validator.
 *
 * A module attaches its context menus the same way it attaches its nav
 * (`ModuleDecl.nav`): as data on the declaration half of the module contract.
 * `ModuleMenusDecl` is groups + areas + items in exactly the shapes `MenuMap`
 * stores, so "attached to a module" and "authored in the map" are the same
 * vocabulary — the manager can edit one and understand the other.
 *
 * THIS FILE IS A NODE LEAF, like `nav/types.ts` and `points.ts`: nothing but
 * type imports and the two band constants from `./types`. The closure resolver
 * imports it under plain Node (native type stripping), where extensionless
 * relative imports into the runtime graph do not resolve — which is why
 * registration lives in `register-menus.ts` instead.
 *
 * Validation is split in two along the line of what each moment can know:
 *
 *   - {@link validateMenusDecl} is PURE and STRUCTURAL: ids, namespacing, role
 *     coherence, group references. It runs at `defineModule` time and in the
 *     closure resolver — places where the command and predicate registries are
 *     NOT populated yet, so name existence cannot be honestly checked.
 *   - Name existence stays with `MenuMap`'s gate at registration
 *     (`registerModuleMenus` → `menu.contribute`), which runs after
 *     `registerCtxCommands()` — the ordering the map's own docblock states.
 */
import type { Area, Group, MenuItem } from "./types";

/**
 * The band an item lands in when neither it nor its area names one. These two
 * LIVE here (the leaf) and `map.ts` imports and re-exports them — the one
 * arrangement where the validator, the map and plain Node all see the same
 * values without this file growing a runtime import.
 */
export const GROUP_DEFAULT = "area";

/** D2's always-last band: the basics every menu carries. */
export const GROUP_UNIVERSAL = "universal";

/** A module's context menus, as data on its declaration. */
export interface ModuleMenusDecl {
  /** Extra bands beyond the two built-ins. Optional. */
  readonly groups?: readonly Group[];
  /**
   * The module's clickable surfaces. Each id must be namespaced
   * `"<moduleId>."` — areas are global, and an unprefixed `row` collides the
   * moment a second module declares one. The module's screen marks the same
   * ids in the DOM with `data-axf-area`.
   */
  readonly areas: readonly Area[];
  /** Authored rows per area id. Every key must be one of `areas`. */
  readonly items: Readonly<Record<string, readonly MenuItem[]>>;
}

const ACTING_ROLES = new Set(["normal", "danger", "toggle"]);
const STRUCTURAL_ROLES = new Set(["separator", "header"]);

/**
 * Structural validation of a menus decl — everything checkable without the
 * command/predicate registries. Returns problems rather than throwing so the
 * closure resolver can report all of them at once; `defineModule` throws on
 * the list.
 *
 * The item rules deliberately restate `MenuMap`'s shape half (roles vs
 * command, submenu children, toggle's checkedWhen): the map checks them at
 * registration inside a running app, this checks them at definition and
 * packaging time under plain Node. Same rules, two moments — a decl that
 * passes here and names only registered commands registers clean.
 */
export function validateMenusDecl(ownerId: string, menus: ModuleMenusDecl): string[] {
  const problems: string[] = [];
  const note = (p: string) => problems.push(p);

  const knownGroups = new Set<string>([GROUP_DEFAULT, GROUP_UNIVERSAL]);
  for (const group of menus.groups ?? []) {
    if (!group.id.trim()) note(`a menu group id must be non-empty`);
    else if (knownGroups.has(group.id)) note(`menu group "${group.id}" is declared twice (or shadows a built-in band)`);
    else knownGroups.add(group.id);
    if (!Number.isFinite(group.order)) note(`menu group "${group.id}" needs a finite order`);
  }

  if (!menus.areas.length) {
    note(`menus declare no areas — a menus block with no clickable surface attaches nothing`);
  }
  const areaIds = new Set<string>();
  for (const area of menus.areas) {
    const where = `menu area "${area.id}"`;
    if (!area.id.trim() || /\s/.test(area.id)) {
      note(`${where} has an unusable id — non-empty, no whitespace`);
      continue;
    }
    if (!area.id.startsWith(`${ownerId}.`)) {
      note(`${where} must be namespaced "${ownerId}.<name>" — areas are global and bare ids collide`);
    }
    if (areaIds.has(area.id)) note(`${where} is declared twice`);
    areaIds.add(area.id);
    if (!area.title?.trim()) note(`${where} needs a title — the manager lists it`);
    if (area.owner !== undefined && area.owner !== ownerId) {
      note(`${where} claims owner "${area.owner}" — a module's areas belong to "${ownerId}" (omit the field)`);
    }
    if (area.group !== undefined && !knownGroups.has(area.group)) {
      note(`${where} defaults its items to group "${area.group}", which this decl does not declare`);
    }
  }

  for (const [areaId, items] of Object.entries(menus.items)) {
    if (!areaIds.has(areaId)) {
      note(`items are keyed to area "${areaId}", which is not one of this module's declared areas`);
      continue;
    }
    const seen = new Set<string>();
    for (const item of items) checkItem(areaId, item, seen, "", knownGroups, note);
  }

  return problems;
}

function checkItem(
  areaId: string,
  item: MenuItem,
  seen: Set<string>,
  trail: string,
  knownGroups: ReadonlySet<string>,
  note: (p: string) => void
): void {
  const where = `area "${areaId}" item "${trail}${item.id}"`;
  if (!item.id?.trim() || /\s/.test(item.id)) {
    note(`${where} has an unusable id — non-empty, no whitespace`);
    return;
  }
  const path = `${trail}${item.id}`;
  if (seen.has(path)) note(`${where} is a duplicate id within its area`);
  seen.add(path);

  const role = item.role ?? "normal";
  if (STRUCTURAL_ROLES.has(role)) {
    if (item.command !== undefined) note(`${where} is a ${role} and cannot carry a command`);
  } else if (ACTING_ROLES.has(role)) {
    if (!item.command?.trim()) note(`${where} is a ${role} row and must name a command`);
  } else if (role === "submenu") {
    if (item.command !== undefined) note(`${where} is a submenu and cannot carry a command — its children act`);
    if (!item.items?.length) note(`${where} is a submenu with no items`);
  }
  if (role !== "submenu" && item.items !== undefined) {
    note(`${where} carries child items but is a ${role}, not a submenu`);
  }
  if (role === "toggle") {
    if (!item.checkedWhen?.trim()) note(`${where} is a toggle and must name a checkedWhen predicate`);
  } else if (item.checkedWhen !== undefined) {
    note(`${where} names checkedWhen but is a ${role}, not a toggle`);
  }
  if (item.marks !== undefined) {
    // Same rule as `checkedWhen`, and for the same reason: a mark describes how
    // to draw a state, so a row with no state cannot carry one.
    if (role !== "toggle") note(`${where} names marks but is a ${role}, not a toggle`);
    else if (item.marks !== "check" && item.marks !== "visibility") {
      note(`${where} names marks "${String(item.marks)}", which is not check|visibility`);
    }
  }
  if (item.group !== undefined && !knownGroups.has(item.group)) {
    note(`${where} names group "${item.group}", which this decl does not declare`);
  }
  if (item.order !== undefined && !Number.isFinite(item.order)) {
    note(`${where} has a non-finite order`);
  }
  for (const child of item.items ?? []) {
    checkItem(areaId, child, seen, `${path}/`, knownGroups, note);
  }
}
