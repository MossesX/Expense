/**
 * @file `ctx.item` — how a PLUGIN puts a row in somebody else's menu.
 *
 * The whole of this file's design decision is in what it does NOT contain:
 * there is no plugin registry here, no `registerMenuContribution()`, no second
 * list of who-contributed-what. A menu contribution is an ordinary
 * {@link Contribution} to an ordinary {@link ExtensionPoint}, routed through the
 * registry core already has, and the plan says why in one line — *"no second
 * mechanism. The bonus is free: the peel closure already understands
 * contributions, so a peeled app carries its menu items with no extra work in
 * the peeler."*
 *
 * That is not a tidiness argument. `Registry.closureOf()` answers "what would
 * this module have to take with it" by walking its points and collecting the
 * assets that contributed to them. A menu system with its own private
 * contribution list would be invisible to that walk, and a peeled app would ship
 * with the rows silently missing — the exact class of failure this package keeps
 * refusing: something that appears to install and then does nothing.
 *
 * ── SCOPING IS THE AREA, AND THAT IS THE POINT ────────────────────────────────
 *
 * A contribution names an AREA, not a module and not a "surface". P3's gate is
 * *an item targeting `module:a` must not appear in `module:b`*, and notice that
 * nothing here implements that rule: it falls out of the resolver. The item is
 * stored against `module:a` in the map, `module:a` only appears on the area path
 * when the click was physically inside that module's DOM, and an area that is
 * not on the path contributes nothing. Scoping is a consequence of where you
 * clicked rather than a check somebody has to remember to write — which is the
 * same reason the whole system resolves by area in the first place.
 *
 * ── IDS ARE NAMESPACED BY THE CONTRIBUTOR ─────────────────────────────────────
 *
 * A contributed item is stored as `<from>.<id>`. Two plugins that each add a row
 * called `export` to one area are not a conflict between them — neither did
 * anything wrong, and neither can see the other. Rejecting the second (which is
 * what the map's duplicate-id gate would do, correctly, for one author's own
 * map) would make a plugin's success depend on which other plugins happen to be
 * installed. Namespacing removes the collision instead of adjudicating it, and
 * leaves `CtxItem.origin.item` naming exactly who put the row there — which is
 * the honest answer to "why is this in my menu", and the key P4's overlay edits
 * against.
 *
 * ── PROBLEMS ARE RETURNED, NOT THROWN ─────────────────────────────────────────
 *
 * {@link MenuMap.contribute} throws, and it is right to: an author's own map is
 * a bug they can fix at the line that caused it. Here the caller is a host boot
 * draining N plugins it did not write, so one bad contribution must not cost the
 * user the other N−1 rows and the shell with them. Every problem is returned AND
 * logged naming the plugin, the area and the item. Refused, reported, survivable
 * — never dropped in silence.
 */
import type { Contribution, ExtensionPoint } from "../points";
import { Registry, registry } from "../registry";
import { MenuMap, menu } from "./map";
import type { MenuItem } from "./types";

/**
 * The point itself.
 *
 * `kind: "command"` because what a contributor supplies is something invocable
 * the host can offer the user — the row is the offer, the named command is the
 * thing. It is not a `ui-surface`: nobody hands over a component, and a menu
 * that rendered arbitrary plugin JSX would be a hole punched straight through
 * the "items are DATA" constraint the rest of this package is built on.
 *
 * `ordering: "declared"` rather than `"priority"`, deliberately. A `MenuItem`
 * already carries `group` and `order`, and `MenuMap.itemsFor` re-sorts by them
 * regardless of what order the contributions arrived in — so a `priority` here
 * would be a dial that looks like it works and does nothing. One ordering
 * system, on the item, where a manager can edit it.
 */
export const CTX_ITEM_POINT: ExtensionPoint = {
  id: "ctx.item",
  title: "Context-menu item",
  description:
    "A row a plugin adds to a named area's context menu. The payload is `{ area, item }`: the " +
    "area id the row attaches to, and the authored MenuItem itself — a name for its command and " +
    "a name for each of its predicates, never a function.",
  kind: "command",
  cardinality: "many",
  requires: ["area", "item"],
  ordering: "declared"
};

/** What a `ctx.item` contribution carries. */
export interface CtxItemPayload {
  /** The area id this row attaches to. Must be declared before installation. */
  readonly area: string;
  /** The row, in exactly the shape the map stores. */
  readonly item: MenuItem;
}

/** A contribution that could not be installed, and why. */
export interface CtxContributionProblem {
  /** The contributing asset. */
  readonly from: string;
  readonly area: string;
  /** The item's authored id, or `"?"` when the payload was too broken to have one. */
  readonly item: string;
  readonly problem: string;
}

export interface InstallCtxOptions {
  /** Which registry to drain. Defaults to the process-wide one. */
  readonly registry?: Registry;
  /** Which map to fill. Defaults to the process-wide one. */
  readonly map?: MenuMap;
  /** Emit a console line per problem. Defaults to true. */
  readonly warn?: boolean;
}

/**
 * How a contributed item is stored. Exported because a test, an inspector and
 * P4's overlay all need to compute the same id, and three copies of a string
 * template is how they stop agreeing.
 */
export function contributedItemId(from: string, itemId: string): string {
  return `${from}.${itemId}`;
}

/**
 * Which assets contributed a menu row to an area that `moduleId` owns.
 *
 * This is the function that makes the plan's claim true rather than merely
 * plausible — *"the peel closure already understands contributions, so a peeled
 * app carries its menu items with no extra work in the peeler."* It very nearly
 * was not: `Registry.closureOf` walks the module's OWN points, and `ctx.item` is
 * core's, so a plugin whose only contribution is a menu row would have been left
 * out of every peel and nobody would have found out until the peeled app opened
 * a menu with a row missing.
 *
 * Attribution runs through {@link Area.owner}, which `registerModuleMenus` sets
 * to the declaring module. An area declared straight onto the map with no owner
 * belongs to nobody and is therefore in no module's closure — correctly, since
 * there is no honest answer to attribute it to.
 */
export function ctxContributorsFor(
  moduleId: string,
  options: { readonly registry?: Registry; readonly map?: MenuMap } = {}
): string[] {
  const reg = options.registry ?? registry;
  const map = options.map ?? menu;
  const owned = new Set(map.areas().filter((a) => a.owner === moduleId).map((a) => a.id));
  if (!owned.size) return [];
  const out = new Set<string>();
  for (const c of reg.contributionsTo<CtxItemPayload>(CTX_ITEM_POINT.id)) {
    if (owned.has(c.payload?.area)) out.add(c.from);
  }
  return [...out].sort();
}

/** Registries that already have a closure source installed, and against which map. */
const closureWired = new WeakMap<Registry, Set<MenuMap>>();

/**
 * Declare `ctx.item` on a registry, and teach that registry to count menu
 * contributions in a module's peel closure.
 *
 * Both halves in one call on purpose. They are the same decision — *route menu
 * rows through the registry* — and splitting them would produce a host that
 * declared the point, worked perfectly in the dev tree, and peeled apps with
 * rows quietly missing. A second call somebody has to remember is not a
 * mechanism; it is a chance to forget.
 *
 * Idempotent, and it has to be: a dev-server remount re-evaluates the module
 * that calls it, and `declarePoint` throws on a re-declared point.
 *
 * Not done at import time, even though it looks like it could be. Core's
 * `package.json` declares `"sideEffects": false`, and a module that mutates a
 * process-wide registry when it is merely imported makes that a lie — a bundler
 * is entitled to drop it, and the point would be missing in exactly the build
 * nobody tests interactively.
 */
export function declareCtxItemPoint(reg: Registry = registry, map: MenuMap = menu): void {
  if (!reg.points().some((p) => p.id === CTX_ITEM_POINT.id)) {
    reg.declarePoint(CTX_ITEM_POINT);
  }
  const maps = closureWired.get(reg) ?? new Set<MenuMap>();
  closureWired.set(reg, maps);
  if (maps.has(map)) return;
  maps.add(map);
  reg.addClosureSource((moduleId) => ctxContributorsFor(moduleId, { registry: reg, map }));
}

/**
 * Build a `ctx.item` contribution. A convenience over the literal, and the
 * reason to prefer it is that it puts the point id in one place: a plugin that
 * writes `point: "ctx-item"` by hand gets a violation at `registry.contribute`
 * and a menu that is one row short.
 */
export function ctxItem(from: string, area: string, item: MenuItem): Contribution<CtxItemPayload> {
  return { from, point: CTX_ITEM_POINT.id, payload: { area, item } };
}

/** The same, for a plugin adding several rows to one area. */
export function ctxItems(
  from: string,
  area: string,
  items: readonly MenuItem[]
): Contribution<CtxItemPayload>[] {
  return items.map((item) => ctxItem(from, area, item));
}

/**
 * Installed keys, per map. Draining twice must not double the rows — a host may
 * call this after each plugin batch, and `MenuMap.contribute` has no idea the
 * second copy came from the same contribution.
 *
 * Keyed by map rather than global so a test's throwaway map does not inherit
 * another test's history, and weak so a discarded map does not pin its keys.
 */
const installed = new WeakMap<MenuMap, Set<string>>();

/** Forget what has been installed into a map — for tests and for a re-scan. */
export function clearInstalledCtxContributions(map: MenuMap = menu): void {
  installed.delete(map);
}

/**
 * Drain every `ctx.item` contribution in the registry into the map.
 *
 * Call it AFTER the areas exist (a contribution to an undeclared area is a
 * problem, not a silent no-op) and after the commands the items name are
 * registered — the ordering constraint `MenuMap` documents for its own gate.
 * Both failures are reported by name rather than guessed at.
 */
export function installCtxContributions(options: InstallCtxOptions = {}): CtxContributionProblem[] {
  const reg = options.registry ?? registry;
  const map = options.map ?? menu;
  const warn = options.warn ?? true;

  const done = installed.get(map) ?? new Set<string>();
  installed.set(map, done);

  const problems: CtxContributionProblem[] = [];
  const note = (p: CtxContributionProblem) => {
    problems.push(p);
    if (warn && typeof console !== "undefined") {
      console.warn(
        `[axf] "${p.from}" contributed a context-menu item to area "${p.area}" that was refused: ` +
          `${p.problem} (item "${p.item}")`
      );
    }
  };

  for (const c of reg.contributionsTo<CtxItemPayload>(CTX_ITEM_POINT.id)) {
    const payload = c.payload;
    // `requires` proved the two FIELDS are present; it cannot prove they hold
    // anything usable, because a point's `requires` is a field-name list and
    // deliberately not a schema (`points.ts` says so). So the shape is checked
    // here, where the values are about to be used.
    const area = typeof payload?.area === "string" ? payload.area.trim() : "";
    const item = payload?.item;
    if (!area) {
      note({ from: c.from, area: String(payload?.area ?? ""), item: "?", problem: "the payload names no area" });
      continue;
    }
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id.trim()) {
      note({ from: c.from, area, item: "?", problem: "the payload carries no item with an id" });
      continue;
    }

    const key = `${c.from} ${area} ${item.id}`;
    if (done.has(key)) continue;

    const qualified: MenuItem = { ...item, id: contributedItemId(c.from, item.id) };
    try {
      map.contribute(area, [qualified]);
      done.add(key);
    } catch (e) {
      note({
        from: c.from,
        area,
        item: item.id,
        problem: e instanceof Error ? e.message : String(e)
      });
    }
  }

  return problems;
}
