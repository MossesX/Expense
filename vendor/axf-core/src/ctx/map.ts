/**
 * @file The map: area → items, as data — and the gate that keeps it honest.
 *
 * This is the file the whole design is arranged around. Because every
 * behavioural field on an item is a NAME (`command`, `when`, `enabledWhen`,
 * `checkedWhen`) and never a function, the map is serialisable, diffable,
 * shippable in a manifest, validatable at packaging time, and editable by a UI
 * that never opens a source file. A map with closures in it can only be edited
 * by editing the file it lives in, which is the thing being escaped.
 *
 * THE GATE (P0's stated gate, and the reason this class exists rather than a
 * plain `Record<string, MenuItem[]>`): an item naming a command or a predicate
 * that is not registered is REFUSED AT REGISTRATION, with a message naming the
 * area, the item and the missing name. Not warned about, not dropped at render
 * time. A dropped row is invisible — the author sees a menu that is one row
 * short and has no reason to suspect the map rather than their own predicate.
 *
 * THE ORDERING CONSTRAINT THIS BUYS, STATED PLAINLY. Validating at registration
 * means the registries must be populated first:
 *
 *     registerCtxCommands();          // commands exist
 *     menu.declareArea({ … });        // areas exist
 *     menu.contribute("row", [ … ]);  // NOW the items can be checked
 *
 * That is a real cost and it is worth paying. The alternative — validate later,
 * on a `menu.validate()` the kernel calls — moves the error away from the code
 * that caused it, which is exactly the distance that turns an error into a
 * mystery. {@link MenuMap.validate} still exists for the packaging pass, where
 * the question is different: it re-checks the WHOLE map against the registries
 * as they finally stand, and so catches the other direction — a command that was
 * unregistered after the map was built.
 *
 * WHAT IS NOT HERE, ON PURPOSE:
 * - The area RESOLVER (walking `data-axf-area` up from the event target) is P1.
 *   This file holds the map it will read; it does not read the DOM.
 * - Plugin contributions go through the extension-point registry already in core
 *   (a `ctx.item` point) in P3 — no second mechanism, and the peel closure then
 *   understands menu contributions for free. So an item here carries no `from`
 *   provenance yet: `Contribution` already has that field, and inventing a
 *   second, half-used one now would guarantee they disagree later.
 * - The edits-only OVERLAY (hidden, reordered, renamed) is P4. Note what that
 *   means for this file: the map is DERIVED from declarations in source and is
 *   never itself persisted. A stored copy of a scanned structure goes stale
 *   silently, and you find out when a menu fires a command that no longer exists.
 *
 * WHAT P4 ADDED, AND WHERE (2026-08-09). The overlay is applied HERE, on read,
 * rather than by the composer — because this is the chokepoint. `itemsFor` is
 * the one function that hands out an area's rows, `composeArea` is its only
 * caller in the engine, and everything else (the universal band, plugin
 * contributions, the manager's own preview) arrives through the same door. Put
 * the overlay one level up, in `compose.ts`, and every future caller of
 * `itemsFor` would silently get the unedited menu — which is the "a rule you are
 * supposed to remember is not a rule" failure this package keeps designing out.
 *
 * The authored items are still stored EXACTLY as declared and are never mutated:
 * {@link MenuMap.defaultItemsFor} returns them untouched, {@link MenuMap.itemsFor}
 * returns them with the overlay laid over, and dropping the overlay makes the two
 * identical. That is the phase's gate, and it is a property of this arrangement
 * rather than something the store has to be careful about.
 */
import { commands } from "../commands";
import { GROUP_DEFAULT, GROUP_UNIVERSAL } from "./menus";
import { applyAreaEdit, applyItemEdits, isEmptyOverlay } from "./overlay";
import type { MenuOverlay } from "./overlay";
import { predicates } from "./predicates";
import type { Area, Group, MenuItem } from "./types";

// Re-exported from here because this is where every existing consumer imports
// them; they LIVE in menus.ts — a Node leaf the closure resolver can import
// (extensionless runtime imports do not resolve under native type stripping),
// and importing them back here is what keeps the two files from drifting.
export { GROUP_DEFAULT, GROUP_UNIVERSAL };

/**
 * D3 (owner, 2026-08-07): the nearest four areas contribute items; the rest of
 * the path is still resolved, and predicates can still read it, they simply add
 * no rows.
 *
 * Six levels each adding a group is a thirty-item menu, which is this design's
 * characteristic failure mode — the same generosity that fixes GizmoX's
 * inconsistent coverage produces an unusable menu if nothing bounds it. The cap
 * is a constant with a test, not a guideline. It lives here, beside the map it
 * bounds, so the resolver (P1) imports the number rather than restating it.
 */
export const MAX_CONTRIBUTING_AREAS = 4;

export class MenuMapError extends Error {}

/** A problem found by the packaging-time pass. */
export interface MenuMapViolation {
  readonly area: string;
  readonly item: string;
  readonly problem: string;
}

/** The map in the shape it serialises to — what a manifest or a diff sees. */
export interface MenuMapSnapshot {
  readonly groups: readonly Group[];
  readonly areas: readonly Area[];
  readonly items: Readonly<Record<string, readonly MenuItem[]>>;
}

/** Roles that act, and therefore must name a command. */
const ACTING_ROLES = new Set(["normal", "danger", "toggle"]);
/** Roles that are structure, and therefore must not. */
const STRUCTURAL_ROLES = new Set(["separator", "header"]);

export class MenuMap {
  readonly #groups = new Map<string, Group>();
  readonly #areas = new Map<string, Area>();
  readonly #items = new Map<string, MenuItem[]>();
  /**
   * The human edits laid over the scanned map, or `null` when there are none.
   *
   * An overlay whose every entry is empty is normalised to `null` by
   * {@link setOverlay}, so "an overlay with no edits" is not a second state that
   * has to be proved equivalent to "no overlay" — it IS that state.
   */
  #overlay: MenuOverlay | null = null;

  constructor() {
    // The two bands the design itself names. Declared at construction for the
    // same reason the built-in predicates are: an item contributed before them
    // would be refused for naming an undeclared group, and which happened first
    // would come down to module evaluation order.
    this.declareGroup({ id: GROUP_DEFAULT, order: 100 });
    this.declareGroup({ id: GROUP_UNIVERSAL, order: 900 });
  }

  /* ----------------------------------------------------------- declaring */

  declareGroup(group: Group): this {
    if (!group.id.trim()) throw new MenuMapError("a group id must be non-empty");
    if (this.#groups.has(group.id)) {
      throw new MenuMapError(`group "${group.id}" is already declared`);
    }
    if (!Number.isFinite(group.order)) {
      throw new MenuMapError(`group "${group.id}" needs a finite order — it is what sorts the bands`);
    }
    this.#groups.set(group.id, group);
    return this;
  }

  /**
   * Declare an area (D1). Costs one line and buys the manager a real list
   * instead of a guess, plus the resolver's ability to warn about a
   * `data-axf-area` nobody declared — which is how a typo becomes a message
   * rather than an invisible menu.
   */
  declareArea(area: Area): this {
    if (!area.id.trim() || /\s/.test(area.id)) {
      throw new MenuMapError(`an area id must be non-empty and contain no whitespace (got "${area.id}")`);
    }
    if (!area.title.trim()) {
      throw new MenuMapError(`area "${area.id}" needs a title — the manager lists it`);
    }
    if (this.#areas.has(area.id)) {
      throw new MenuMapError(`area "${area.id}" is already declared`);
    }
    if (area.group !== undefined && !this.#groups.has(area.group)) {
      throw new MenuMapError(
        `area "${area.id}" defaults its items to group "${area.group}", which is not declared`
      );
    }
    this.#areas.set(area.id, area);
    return this;
  }

  /**
   * Add items to an area, validating every one before ANY of them is stored.
   *
   * All-or-nothing on purpose: a partially applied contribution leaves the map
   * in a state no source file describes, and the next person to read the map to
   * work out what went wrong is reading a state that only ever existed in
   * memory.
   */
  contribute(areaId: string, items: readonly MenuItem[]): this {
    const area = this.#areas.get(areaId);
    if (!area) {
      throw new MenuMapError(
        `cannot contribute to area "${areaId}": no area is declared under that id`
      );
    }
    const existing = this.#items.get(areaId) ?? [];
    const seen = new Set(existing.map((i) => i.id));
    for (const item of items) {
      this.#check(areaId, item, seen, "");
    }
    this.#items.set(areaId, [...existing, ...items]);
    return this;
  }

  /**
   * Validate one item and everything under it, throwing on the first problem
   * with a message that names where it is.
   *
   * `seen` is shared across the whole contribution so two items with one id are
   * caught even when one is nested; `trail` names the submenu chain, because
   * "item `open`" is not a location when three submenus each have one.
   */
  #check(areaId: string, item: MenuItem, seen: Set<string>, trail: string): void {
    const where = `area "${areaId}" item "${trail}${item.id}"`;
    const fail = (problem: string): never => {
      throw new MenuMapError(`${where} ${problem}`);
    };

    if (!item.id?.trim() || /\s/.test(item.id)) {
      fail(`has an unusable id — it must be non-empty and contain no whitespace`);
    }
    const path = `${trail}${item.id}`;
    if (seen.has(path)) fail(`is a duplicate id within its area`);
    seen.add(path);

    const role = item.role ?? "normal";

    if (STRUCTURAL_ROLES.has(role)) {
      // A separator or header that carries a command is a row somebody expects
      // to be clickable and the renderer will never focus. Refusing it here is
      // cheaper than explaining it later.
      if (item.command !== undefined) fail(`is a ${role} and cannot carry a command`);
    } else if (ACTING_ROLES.has(role)) {
      if (!item.command?.trim()) fail(`is a ${role} row and must name a command`);
      // ── THE GATE ──
      if (!commands.has(item.command as string)) {
        fail(`names command "${item.command}", which is not registered`);
      }
    } else if (role === "submenu") {
      if (item.command !== undefined) fail(`is a submenu and cannot carry a command — its children act`);
      if (!item.items?.length) fail(`is a submenu with no items`);
    }

    if (role !== "submenu" && item.items !== undefined) {
      fail(`carries child items but is a ${role}, not a submenu`);
    }
    if (role === "toggle") {
      if (!item.checkedWhen?.trim()) {
        fail(`is a toggle and must name a checkedWhen predicate — a checkmark nothing computed is a lie`);
      }
    } else if (item.checkedWhen !== undefined) {
      fail(`names checkedWhen but is a ${role}, not a toggle`);
    }

    // ── THE GATE, predicate half ──
    for (const field of ["when", "enabledWhen", "checkedWhen"] as const) {
      const id = item[field];
      if (id === undefined) continue;
      if (!id.trim()) fail(`has an empty ${field} — omit the field or name a predicate`);
      if (!predicates.has(id)) fail(`names ${field} predicate "${id}", which is not registered`);
    }

    if (item.group !== undefined && !this.#groups.has(item.group)) {
      fail(`names group "${item.group}", which is not declared`);
    }
    if (item.order !== undefined && !Number.isFinite(item.order)) {
      fail(`has a non-finite order`);
    }

    for (const child of item.items ?? []) {
      this.#check(areaId, child, seen, `${path}/`);
    }
  }

  /* ------------------------------------------------------------ overlay */

  /**
   * Lay a set of human edits over the scanned map, or drop them with `null`.
   *
   * Deliberately a plain setter with no persistence and no listeners: this class
   * knows what an edit MEANS, and `OverlayStore` (`overlay-store.ts`) knows where
   * one is kept. A map that read `localStorage` could not be constructed in a
   * test, and a store that applied edits would be a second place the semantics
   * live.
   */
  setOverlay(overlay: MenuOverlay | null | undefined): this {
    this.#overlay = overlay && !isEmptyOverlay(overlay) ? overlay : null;
    return this;
  }

  /** The edits currently in force, or `null` when the map is at its defaults. */
  overlay(): MenuOverlay | null {
    return this.#overlay;
  }

  #areaEdit(id: string) {
    return this.#overlay?.areas[id];
  }

  /* ------------------------------------------------------------ reading */

  /** Every area, with any overlay edits applied. What a manager lists. */
  areas(): Area[] {
    return [...this.#areas.keys()]
      .sort((a, b) => a.localeCompare(b))
      .map((id) => this.area(id) as Area);
  }

  /** Every area exactly as source declared it — the drift sweep's reference. */
  declaredAreas(): Area[] {
    return [...this.#areas.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * One area, with any overlay edits applied — the EFFECTIVE record.
   *
   * An overlay can rename an area and can flip its `suppressUniversal`; it can
   * never make one disappear. `areas.ts` decides whether a `data-axf-area` marker
   * is declared by asking this, and an overlay that could answer "no" would turn
   * a deliberate hide into the undeclared-marker warning that exists to catch
   * typos — two very different facts, reported identically. Hiding is
   * {@link itemsFor}'s business: the area stays declared and contributes nothing.
   */
  area(id: string): Area | undefined {
    const area = this.#areas.get(id);
    if (!area) return undefined;
    return applyAreaEdit(area, this.#areaEdit(id));
  }

  /** One area exactly as source declared it, overlay ignored. */
  declaredArea(id: string): Area | undefined {
    return this.#areas.get(id);
  }

  groups(): Group[] {
    return [...this.#groups.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  }

  group(id: string): Group | undefined {
    return this.#groups.get(id);
  }

  /**
   * One area's items AS THEY RENDER: the authored rows with any overlay edits
   * laid over, sorted by group order, then the item's own order, then id.
   *
   * Sorting by id last makes the order TOTAL. Two items with the same group and
   * no explicit order would otherwise sit in insertion order, which is module
   * evaluation order, which is a menu that can rearrange itself between a dev
   * build and a production one.
   *
   * The sort recurses into submenu children (P4). It did not before, and the
   * difference is not cosmetic: `order` is one of the four dials the overlay
   * edits, and a reorder applied to a nested row would otherwise have been
   * accepted, persisted and then quietly done nothing — which is exactly the
   * outcome this phase exists to make impossible. Children obey the same total
   * order as their parents, at every depth, on both this path and
   * {@link defaultItemsFor}'s.
   */
  itemsFor(areaId: string): MenuItem[] {
    const edit = this.#areaEdit(areaId);
    // A hidden area is still declared and still resolves; it simply adds no
    // rows, and `compose.ts` then drops the divider that would have introduced
    // an empty band.
    if (edit?.hidden) return [];
    return this.#sorted(areaId, applyItemEdits(this.#items.get(areaId) ?? [], edit?.items));
  }

  /**
   * One area's items exactly as source declared them, in the same total order —
   * the SCANNED DEFAULTS, with no overlay applied.
   *
   * This is the reference the phase's gate is measured against: drop the overlay
   * and {@link itemsFor} must equal this, exactly. It is also what a manager
   * shows beside an edited row to answer "what was this before", which is the
   * question that makes an edit reversible.
   */
  defaultItemsFor(areaId: string): MenuItem[] {
    return this.#sorted(areaId, this.#items.get(areaId) ?? []);
  }

  /** The one sort, used by both the edited and the pristine read. */
  #sorted(areaId: string, items: readonly MenuItem[]): MenuItem[] {
    const fallback = this.#areas.get(areaId)?.group ?? GROUP_DEFAULT;
    const orderOf = (item: MenuItem): number =>
      this.#groups.get(item.group ?? fallback)?.order ?? 0;
    const sort = (list: readonly MenuItem[]): MenuItem[] =>
      list
        .map((item) => (item.items ? { ...item, items: sort(item.items) } : item))
        .sort(
          (a, b) =>
            orderOf(a) - orderOf(b) ||
            (a.order ?? 0) - (b.order ?? 0) ||
            a.id.localeCompare(b.id)
        );
    return sort(items);
  }

  /**
   * Re-check the whole map against the registries as they now stand, returning
   * every problem rather than throwing on the first.
   *
   * This is the packaging-time pass, and it asks a different question from
   * {@link contribute}: not "is this item well-formed as it is written" but "is
   * every name it depends on still there". A command unregistered AFTER the map
   * was built passes registration and fails here, which is the case the plan
   * calls out — *caught at package time, reported at run time as a disabled row
   * naming the missing command, never a row that does nothing when clicked.*
   */
  validate(): MenuMapViolation[] {
    const out: MenuMapViolation[] = [];
    const walk = (areaId: string, item: MenuItem, trail: string): void => {
      const name = `${trail}${item.id}`;
      const note = (problem: string) => out.push({ area: areaId, item: name, problem });
      if (item.command !== undefined && !commands.has(item.command)) {
        note(`names command "${item.command}", which is not registered`);
      }
      for (const field of ["when", "enabledWhen", "checkedWhen"] as const) {
        const id = item[field];
        if (id !== undefined && !predicates.has(id)) {
          note(`names ${field} predicate "${id}", which is not registered`);
        }
      }
      if (item.group !== undefined && !this.#groups.has(item.group)) {
        note(`names group "${item.group}", which is not declared`);
      }
      for (const child of item.items ?? []) walk(areaId, child, `${name}/`);
    };
    for (const [areaId, items] of this.#items) {
      if (!this.#areas.has(areaId)) {
        out.push({ area: areaId, item: "*", problem: "the area is no longer declared" });
      }
      for (const item of items) walk(areaId, item, "");
    }
    return out;
  }

  /**
   * The whole SCANNED map as plain data — which is the claim this design makes
   * about itself, so it is worth being able to demonstrate rather than assert.
   * What comes out of here round-trips through `JSON.stringify` unchanged, and
   * that is what makes the map diffable.
   *
   * Deliberately the DEFAULTS, not the edited menu, and this is the one place
   * where saying so matters: what this returns is the shape a manifest carries
   * and a diff reads, and folding the overlay into it would produce exactly the
   * artefact this design refuses — a serialised copy of a scanned tree, which
   * goes stale the moment source changes and cannot be told from a deliberate
   * edit afterwards. The overlay serialises on its own, separately, and is small
   * precisely because this stays whole. Use {@link toEffectiveJSON} when the
   * question really is "what does the menu look like right now".
   */
  toJSON(): MenuMapSnapshot {
    const items: Record<string, readonly MenuItem[]> = {};
    for (const areaId of [...this.#items.keys()].sort()) {
      items[areaId] = this.defaultItemsFor(areaId);
    }
    return { groups: this.groups(), areas: this.declaredAreas(), items };
  }

  /**
   * The map as it currently RENDERS — defaults with the overlay laid over.
   *
   * For a manager's preview and for a test that wants one value to compare
   * before and after an edit. Never persist it: it is a derived view, and
   * persisting a derived view is the stale-copy failure under a different name.
   */
  toEffectiveJSON(): MenuMapSnapshot {
    const items: Record<string, readonly MenuItem[]> = {};
    for (const areaId of [...this.#items.keys()].sort()) {
      items[areaId] = this.itemsFor(areaId);
    }
    return { groups: this.groups(), areas: this.areas(), items };
  }
}

/** The process-wide context-menu map. */
export const menu = new MenuMap();
