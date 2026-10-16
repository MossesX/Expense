/**
 * @file `registerModuleMenus` — the ONE path a module's declared menus take
 * into the process-wide map.
 *
 * Separate from `menus.ts` (the decl shape + validator) because that file is
 * a Node leaf the closure resolver imports, and this one necessarily touches
 * the runtime graph: the map, and the default ctx commands. Hosts call this —
 * the peeled app's generated boot and Studio's subsystem alike — so how a
 * module's menus enter the map is written once, not re-derived per host.
 */
import { registerCtxCommands } from "./commands";
import { menu } from "./map";
import type { ModuleMenusDecl } from "./menus";

/**
 * Register a module's declared menus into the process-wide map. A module with
 * no `menus` costs a single early return.
 *
 * Calls `registerCtxCommands()` first because the map's gate refuses an item
 * naming an unregistered command — the ordering constraint `MenuMap`
 * documents, honoured here so no host has to remember it. Module-specific
 * commands must be registered by the caller BEFORE this runs; the gate names
 * any that are missing.
 *
 * Groups and areas are skipped when already present, so a re-entrant host is
 * tolerated. Items are NOT guarded: contributing twice is a duplicate-id
 * error, and it should be loud.
 */
export function registerModuleMenus(spec: {
  readonly id: string;
  readonly menus?: ModuleMenusDecl;
}): void {
  const menus = spec.menus;
  if (!menus) return;
  registerCtxCommands();
  for (const group of menus.groups ?? []) {
    if (!menu.group(group.id)) menu.declareGroup(group);
  }
  for (const area of menus.areas) {
    if (!menu.area(area.id)) menu.declareArea({ ...area, owner: spec.id });
  }
  for (const [areaId, items] of Object.entries(menus.items)) {
    menu.contribute(areaId, items);
  }
}
