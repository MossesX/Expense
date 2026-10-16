/**
 * @file Where an overlay is KEPT, and how a stale entry in one gets reported.
 *
 * The runtime half of P4. `overlay.ts` is the leaf — the shape of an edit and
 * the pure functions that lay one over a scanned map — and everything that needs
 * a live `MenuMap` is here instead, for the same reason `register-menus.ts` is
 * separate from `menus.ts`: `map.ts` imports the leaf at run time, so anything
 * here that the map imported back would be a cycle.
 *
 * ── DRIFT IS THE POINT OF THIS FILE ───────────────────────────────────────────
 *
 * The phase's own words: *an overlay entry referencing an area or command that
 * no longer exists is reported, not silently dropped, because silence here is
 * indistinguishable from the edit never having been made.*
 *
 * That sentence is worth unpacking, because the naive implementation gets it
 * backwards. The tempting thing for a store to do with an entry it cannot match
 * is prune it — the document stays small, nothing downstream has to handle a
 * dangling key, and everything keeps working. What that costs is the only
 * evidence anybody had: a person who hid a row six months ago, upgrades, and
 * finds the row back. Did the upgrade rename the area? Did the edit never save?
 * Was it hidden by something else? A pruned overlay cannot answer, and neither
 * can the person.
 *
 * So a stale entry is KEPT, exactly as written, and {@link overlayDrift} names
 * it. It applies to nothing — an edit for a row that no longer exists has
 * nothing to lay itself over, which is inherent rather than enforced — but it
 * survives, it is reported, and the manager can eventually offer to repoint or
 * discard it with the person watching. Repair is a decision; deletion is not the
 * store's to make.
 *
 * ── WHY THE SWEEP IS ON DEMAND, AND WHAT ORDERING IT REQUIRES ─────────────────
 *
 * {@link installCtxOverlay} runs the sweep once and warns. It must therefore be
 * called AFTER the modules have registered their menus — the same ordering
 * constraint `installCtxContributions` documents for itself, and for the same
 * reason: an area that has not been declared YET and an area that no longer
 * exists are the same absence, so a sweep run too early reports every edit in
 * the document as drift and teaches people to ignore the warning. In Studio and
 * in a peeled app the registrations happen in the subsystem's `start()`, well
 * before the shell mounts, which is why `ContextMenuRoot`'s mount effect is a
 * correct place to call it.
 */
import { commands } from "../commands";
import { MenuMap, menu } from "./map";
import {
  CTX_OVERLAY_KEY,
  EMPTY_OVERLAY,
  OVERLAY_VERSION,
  indexItemPaths,
  isEmptyAreaEdit,
  isEmptyItemEdit,
  normaliseItemEdit,
  parseOverlay
} from "./overlay";
import type { AreaEdit, ItemEdit, MenuOverlay } from "./overlay";

/* ----------------------------------------------------------------- drift */

/** One overlay entry that no longer matches the map it is laid over. */
export interface OverlayDrift {
  readonly area: string;
  /** The row path the edit is keyed to, or `null` for the area's own entry. */
  readonly item: string | null;
  readonly problem: string;
}

/**
 * Every entry in the overlay that the map can no longer account for.
 *
 * Four kinds, and the first two are the ones the phase names:
 *
 * 1. **The area is gone.** Reported once for the area, with a count of the row
 *    edits stranded under it — one line per orphaned row would bury the fact
 *    that the AREA is the thing that moved, which is the fact somebody needs.
 * 2. **The command is gone.** The row still exists and the edit still applies,
 *    but the row it edits can no longer run. `compose.ts` already renders that
 *    row greyed and names the missing command, so the menu is honest either way
 *    — this reports it a second time, at the overlay level, because a person
 *    curating a menu wants to know their edit is now maintaining a dead row.
 * 3. **The row is gone.** The area survived; the item did not.
 * 4. **The band is gone.** The edit moves a row into a group nothing declares,
 *    which would sort it into a phantom position that looks deliberate.
 *
 * Returned rather than thrown, and sorted, so a caller can print them, count
 * them or put them in a table without re-deriving an order.
 */
export function overlayDrift(
  map: MenuMap = menu,
  overlay: MenuOverlay | null = map.overlay()
): OverlayDrift[] {
  const out: OverlayDrift[] = [];
  if (!overlay) return out;

  for (const areaId of Object.keys(overlay.areas).sort()) {
    const edit: AreaEdit | undefined = overlay.areas[areaId];
    if (isEmptyAreaEdit(edit)) continue;
    const paths = Object.keys(edit?.items ?? {}).sort();

    if (!map.declaredArea(areaId)) {
      const stranded = paths.length;
      out.push({
        area: areaId,
        item: null,
        problem:
          `no area is declared under this id any more` +
          (stranded
            ? ` — ${stranded} row edit${stranded === 1 ? "" : "s"} under it (${paths
                .map((p) => `"${p}"`)
                .join(", ")}) apply to nothing`
            : "")
      });
      continue;
    }

    // Indexed off the SCANNED defaults, never off `itemsFor`: the effective
    // rows are the overlay's own output, so checking an edit against them would
    // ask whether the edit agrees with itself. A hidden row must still count as
    // present, or hiding one would immediately report itself as drift.
    const authored = indexItemPaths(map.defaultItemsFor(areaId));

    for (const path of paths) {
      const rowEdit: ItemEdit | undefined = edit?.items?.[path];
      if (isEmptyItemEdit(rowEdit)) continue;

      const item = authored.get(path);
      if (!item) {
        out.push({
          area: areaId,
          item: path,
          problem: "no row is authored at this path in the area any more"
        });
        continue;
      }
      if (item.command !== undefined && !commands.has(item.command)) {
        out.push({
          area: areaId,
          item: path,
          problem: `the row names command "${item.command}", which is not registered`
        });
      }
      if (rowEdit?.group !== undefined && !map.group(rowEdit.group)) {
        out.push({
          area: areaId,
          item: path,
          problem: `the edit moves the row to group "${rowEdit.group}", which is not declared`
        });
      }
    }
  }

  return out;
}

/**
 * The sweep, plus a console line per finding. Returns the findings either way.
 *
 * A warning is the floor rather than the mechanism: a manager UI will list these
 * properly. But a console line is what exists TODAY, and this phase's whole
 * claim is that a stale edit is never silent — so it says so somewhere from the
 * moment it lands, not from the moment an editor is built for it.
 */
export function reportOverlayDrift(
  map: MenuMap = menu,
  overlay: MenuOverlay | null = map.overlay(),
  options: { readonly warn?: boolean } = {}
): OverlayDrift[] {
  const drift = overlayDrift(map, overlay);
  if ((options.warn ?? true) && drift.length && typeof console !== "undefined") {
    for (const d of drift) {
      console.warn(
        `[axf] the context-menu overlay still holds an edit for ` +
          (d.item === null ? `area "${d.area}"` : `area "${d.area}" row "${d.item}"`) +
          `, but ${d.problem}. The edit was kept, not discarded — repoint or remove it.`
      );
    }
  }
  return drift;
}

/* ----------------------------------------------------------------- store */

export interface OverlayStorage {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
}

const memoryStorage = (): OverlayStorage => {
  const map = new Map<string, string>();
  return {
    read: (k) => map.get(k) ?? null,
    write: (k, v) => void map.set(k, v),
    remove: (k) => void map.delete(k)
  };
};

const browserStorage = (): OverlayStorage | null => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return {
      read: (k) => window.localStorage.getItem(k),
      write: (k, v) => window.localStorage.setItem(k, v),
      remove: (k) => window.localStorage.removeItem(k)
    };
  } catch {
    // Private mode, disabled storage, a sandboxed iframe. A menu that cannot
    // remember an edit should still open.
    return null;
  }
};

export interface OverlayStoreOptions {
  readonly storage?: OverlayStorage;
  readonly key?: string;
  /** Console-warn what a corrupt or foreign-version document cost. Default true. */
  readonly warn?: boolean;
}

/**
 * The persisted edits, and the only writer of them.
 *
 * Saves on every change with no confirm step, which is the house rule the theme
 * store already follows and which matters more here: a menu editor with a Save
 * button is a menu editor where half the edits are lost, and unlike a theme
 * these edits are not re-derivable by rolling again.
 *
 * The store never touches the map's contents. It holds a document and pushes it
 * at whatever maps are bound to it; `MenuMap` decides what an edit MEANS. One
 * place for the semantics, one place for the persistence.
 */
export class OverlayStore {
  readonly #listeners = new Set<() => void>();
  readonly #storage: OverlayStorage;
  readonly #key: string;
  readonly #bound = new Set<MenuMap>();
  #overlay: MenuOverlay = EMPTY_OVERLAY;
  /** What reading the persisted document cost, if anything. Reported, not hidden. */
  #parseProblems: readonly { area: string; problem: string }[] = [];

  constructor(options: OverlayStoreOptions = {}) {
    this.#storage = options.storage ?? browserStorage() ?? memoryStorage();
    this.#key = options.key ?? CTX_OVERLAY_KEY;
    this.#restore(options.warn ?? true);
  }

  #restore(warn: boolean): void {
    let raw: string | null = null;
    try {
      raw = this.#storage.read(this.#key);
    } catch {
      raw = null;
    }
    if (!raw) return;

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      this.#parseProblems = [
        { area: "*", problem: "the stored overlay is not valid JSON and could not be read" }
      ];
      this.#announce(warn);
      return;
    }

    const { overlay, problems } = parseOverlay(parsedJson);
    this.#overlay = overlay;
    this.#parseProblems = problems;
    this.#announce(warn);
  }

  /**
   * Say what a bad document cost. A store that started empty in silence would
   * hand a person their defaults back with no account of where their edits went
   * — the worst outcome available to a settings layer, and the exact silence the
   * drift rule is written against.
   */
  #announce(warn: boolean): void {
    if (!warn || !this.#parseProblems.length || typeof console === "undefined") return;
    for (const p of this.#parseProblems) {
      console.warn(`[axf] context-menu overlay (${p.area}): ${p.problem}`);
    }
  }

  /** What reading the persisted document cost. Empty when it read clean. */
  parseProblems(): readonly { area: string; problem: string }[] {
    return this.#parseProblems;
  }

  /* ------------------------------------------------------------ binding */

  /**
   * Push this store's document into a map, now and on every later change.
   *
   * Idempotent, and it has to be: a dev-server remount re-runs the effect that
   * calls it. Returns an unbind for a test that wants its map back.
   */
  bind(map: MenuMap = menu): () => void {
    this.#bound.add(map);
    map.setOverlay(this.#overlay);
    return () => {
      this.#bound.delete(map);
      map.setOverlay(null);
    };
  }

  /* ------------------------------------------------------------ reading */

  /** The document as it stands. Sparse: only what somebody actually edited. */
  get(): MenuOverlay {
    return this.#overlay;
  }

  /** True when nothing has been edited — the map is at its scanned defaults. */
  isEmpty(): boolean {
    return !Object.keys(this.#overlay.areas).length;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /* ------------------------------------------------------------ writing */

  /**
   * Edit one row; revert one dial by passing it as `undefined`; revert the whole
   * row with `null`.
   *
   * Fields merge over whatever the row's entry already held, so setting `order`
   * does not forget a rename — and a field passed as `undefined` clears just
   * that dial, which is `{ ...held, ...edit }` behaving exactly as JavaScript
   * says it does. An entry that ends up empty is DELETED rather than stored: the
   * document holds human edits and nothing else, and an empty entry is a record
   * of a UI having been opened, not of a decision.
   *
   * @param path the row's id, or `parent/child` for a nested one
   */
  editItem(areaId: string, path: string, edit: ItemEdit | null): void {
    const area = this.#overlay.areas[areaId];
    const items = { ...(area?.items ?? {}) };
    if (edit === null) {
      delete items[path];
    } else {
      // Normalised, not merged raw: the merge above leaves an explicitly-cleared
      // dial present-and-undefined, and a document handed back with keys that
      // mean nothing is a document every reader has to defend against.
      const merged = normaliseItemEdit({ ...items[path], ...edit });
      if (isEmptyItemEdit(merged)) delete items[path];
      else items[path] = merged;
    }
    this.#setArea(areaId, {
      ...area,
      ...(Object.keys(items).length ? { items } : { items: undefined })
    });
  }

  /** Edit the area itself (hide it, rename it, suppress the universal band). */
  editArea(areaId: string, edit: Omit<AreaEdit, "items"> | null): void {
    const area = this.#overlay.areas[areaId];
    if (edit === null) {
      // Only the area's OWN fields are reverted; the row edits under it survive.
      // Un-hiding an area and discarding every edit inside it are two different
      // intentions, and one control that did both would destroy work silently.
      this.#setArea(areaId, area?.items ? { items: area.items } : undefined);
      return;
    }
    this.#setArea(areaId, { ...area, ...edit });
  }

  /** Drop every edit for one area, rows included. */
  clearArea(areaId: string): void {
    this.#setArea(areaId, undefined);
  }

  /**
   * Delete the overlay entirely — from memory, from every bound map, and from
   * storage.
   *
   * This is the phase's gate made callable: after it, every map is back at the
   * scanned defaults, exactly. The key is REMOVED rather than overwritten with
   * an empty document, so "nobody has edited anything" and "somebody edited
   * things and then reset" leave the same trace, and no empty husk is left for
   * the next version's parser to interpret.
   */
  clear(): void {
    this.#overlay = EMPTY_OVERLAY;
    try {
      this.#storage.remove(this.#key);
    } catch {
      /* storage unavailable — the map is still reset in memory */
    }
    this.#changed(false);
  }

  #setArea(areaId: string, edit: AreaEdit | undefined): void {
    const areas = { ...this.#overlay.areas };
    const next = edit && !isEmptyAreaEdit(edit) ? stripUndefined(edit) : undefined;
    if (next) areas[areaId] = next;
    else delete areas[areaId];
    this.#overlay = { version: OVERLAY_VERSION, areas };
    this.#changed(true);
  }

  #changed(persist: boolean): void {
    for (const map of this.#bound) map.setOverlay(this.#overlay);
    if (persist) this.#persist();
    for (const listener of this.#listeners) listener();
  }

  #persist(): void {
    try {
      if (this.isEmpty()) this.#storage.remove(this.#key);
      else this.#storage.write(this.#key, JSON.stringify(this.#overlay));
    } catch {
      /* storage full or unavailable — the edit still applies for this session */
    }
  }
}

/** Drop `undefined` fields so the persisted JSON carries only real values. */
function stripUndefined(edit: AreaEdit): AreaEdit {
  return {
    ...(edit.hidden !== undefined ? { hidden: edit.hidden } : {}),
    ...(edit.title !== undefined ? { title: edit.title } : {}),
    ...(edit.suppressUniversal !== undefined
      ? { suppressUniversal: edit.suppressUniversal }
      : {}),
    ...(edit.items && Object.keys(edit.items).length ? { items: edit.items } : {})
  };
}

/** The process-wide overlay store. Reads storage; mutates no registry. */
export const ctxOverlay = new OverlayStore();

/**
 * Bind the overlay to a map and sweep it for stale entries. Idempotent.
 *
 * Not done at import time, for the reason `declareCtxItemPoint` gives: core
 * declares `"sideEffects": false`, and a module that mutates a process-wide map
 * when it is merely imported makes that a lie. Call it after the modules have
 * registered their menus — `ContextMenuRoot` does, on mount.
 */
export function installCtxOverlay(
  options: {
    readonly store?: OverlayStore;
    readonly map?: MenuMap;
    readonly warn?: boolean;
  } = {}
): OverlayDrift[] {
  const store = options.store ?? ctxOverlay;
  const map = options.map ?? menu;
  store.bind(map);
  return reportOverlayDrift(map, store.get(), { warn: options.warn ?? true });
}
