/**
 * @file The edits-only overlay — the shape of a human edit, and how one is
 * laid over a scanned map.
 *
 * THE RULE THIS FILE EXISTS TO KEEP, stated before anything else, because every
 * decision below is downstream of it: **the area tree and the default items are
 * DERIVED from declarations in source and are never persisted.** What is
 * persisted is only what a person changed — a row hidden, renamed, moved to
 * another band, given a different order. `map.ts` already says why in its own
 * docblock, and it is worth repeating where the persisted document actually
 * lives: *a stored copy of a scanned structure goes stale silently, and you find
 * out when a menu fires a command that no longer exists.*
 *
 * So an overlay is a sparse document. It holds an entry for an area only if
 * somebody edited that area, and an entry for a row only if somebody edited that
 * row. A map with two hundred rows and one hidden one persists ONE key.
 *
 * ── WHY THIS IS A LEAF ────────────────────────────────────────────────────────
 *
 * Types and pure functions only, importing nothing but `./types`. Two reasons,
 * and they are the same two that split `menus.ts` from `register-menus.ts`:
 *
 * 1. `map.ts` applies the overlay on read, so `map.ts` must be able to import
 *    this at run time. Anything here that reached back into the map would be a
 *    cycle. The store, the drift sweep and the install seam — everything that
 *    genuinely needs a `MenuMap` — live in `overlay-store.ts` instead.
 * 2. A leaf loads under plain Node with native type stripping, which is what the
 *    test harness and the closure resolver get.
 *
 * ── WHAT AN EDIT CAN CHANGE, AND WHAT IT DELIBERATELY CANNOT ──────────────────
 *
 * The four the phase names — hidden, renamed, re-grouped, reordered — and
 * nothing else. In particular an edit CANNOT name a predicate, cannot change a
 * row's `role`, cannot change its `command`, and cannot add a row that no source
 * declared.
 *
 * That is a scope decision rather than an oversight, and the reason is drift.
 * Every name an overlay is allowed to hold is a name that can stop existing
 * while the overlay still refers to it, and each one is therefore a class of
 * stale entry somebody has to detect, report and eventually repair in a UI. The
 * four dials above reference exactly two things that can vanish — the AREA and
 * the ITEM — plus a group id, and that is precisely the drift surface this phase
 * is asked to make loud. Adding a `when` override would add a fourth, and it
 * would arrive with no UI able to pick a predicate honestly; that belongs with
 * the manager project, where the picker and the drift report can be designed
 * together. Adding rows is already solved and is not the overlay's job: a plugin
 * contributes through the `ctx.item` extension point, which routes through the
 * registry core already has and is therefore visible to the peel closure — an
 * overlay-authored row would be visible to neither.
 *
 * ── HOW A NESTED ROW IS ADDRESSED ─────────────────────────────────────────────
 *
 * By its path from the top of the area, `parent/child`, joined with `/` — the
 * SAME trail `MenuMap.#check` builds when it reports a duplicate id inside a
 * submenu. A submenu's children are unique within their parent rather than
 * within the area, so a bare id is not an address, and inventing a second
 * addressing scheme here would guarantee the two disagree about which row an
 * error is talking about.
 */
import type { Area, MenuItem } from "./types";

/**
 * The `localStorage` key. Versioned in the key itself, exactly as `axf:theme@1`
 * is: a format change gets a new key rather than a migration, so an old client
 * and a new one cannot half-read each other's document.
 */
export const CTX_OVERLAY_KEY = "axf:ctx-overlay@1";

/** The version stamped inside the document, checked on read. */
export const OVERLAY_VERSION = 1;

/** The path separator for a nested row. See the docblock. */
export const ITEM_PATH_SEP = "/";

/**
 * One person's edit to one authored row.
 *
 * Every field is optional and an absent field means "leave the authored value
 * alone" — which is what makes the document sparse.
 *
 * Passing a field as `undefined` to {@link OverlayStore.editItem} REVERTS that
 * one dial, which is how a manager offers "undo the rename, keep the reorder"
 * without a second API. It is also just what `{ ...held, ...edit }` does, and a
 * convention that agrees with the language it is written in is one fewer thing
 * to remember. An entry left holding nothing is DELETED rather than stored, so
 * the document never accumulates a key per row a UI merely opened.
 */
export interface ItemEdit {
  /**
   * Take the row out of the menu entirely.
   *
   * Unconditional, unlike the authored `when` predicate — this is a person
   * saying "not here", not a rule about when the row applies. A hidden submenu
   * takes its children with it.
   */
  readonly hidden?: boolean;
  /** Rename. Replaces the authored label; the row's id and origin are untouched. */
  readonly label?: string;
  /** Move to another band. Must be a declared group or it is drift. */
  readonly group?: string;
  /** Reorder within the band. Ascending, exactly like the authored `order`. */
  readonly order?: number;
}

/** Edits to an area itself, plus the edits to the rows inside it. */
export interface AreaEdit {
  /**
   * The area contributes no rows at all.
   *
   * Not the same as deleting it: the area stays DECLARED, so a click inside it
   * still resolves normally and does not trip the undeclared-area warning that
   * exists to catch typo'd markers. It simply adds nothing, and `compose.ts`
   * drops the divider that would have introduced it along with the rows.
   */
  readonly hidden?: boolean;
  /** Rename the area as the manager lists it, and as a header can name it. */
  readonly title?: string;
  /** Override D2's per-area universal suppression. */
  readonly suppressUniversal?: boolean;
  /** Row edits, keyed by item path (`id`, or `parent/child` when nested). */
  readonly items?: Readonly<Record<string, ItemEdit>>;
}

/** The whole persisted document. */
export interface MenuOverlay {
  readonly version: number;
  readonly areas: Readonly<Record<string, AreaEdit>>;
}

/** No edits. The value a map holds when nobody has changed anything. */
export const EMPTY_OVERLAY: MenuOverlay = { version: OVERLAY_VERSION, areas: {} };

/** True when an edit changes nothing — every field absent. */
export function isEmptyItemEdit(edit: ItemEdit | undefined): boolean {
  if (!edit) return true;
  return (
    edit.hidden === undefined &&
    edit.label === undefined &&
    edit.group === undefined &&
    edit.order === undefined
  );
}

/** True when an area's entry changes nothing — itself or any row under it. */
export function isEmptyAreaEdit(edit: AreaEdit | undefined): boolean {
  if (!edit) return true;
  if (
    edit.hidden !== undefined ||
    edit.title !== undefined ||
    edit.suppressUniversal !== undefined
  ) {
    return false;
  }
  for (const key of Object.keys(edit.items ?? {})) {
    if (!isEmptyItemEdit(edit.items?.[key])) return false;
  }
  return true;
}

/**
 * True when the document as a whole changes nothing.
 *
 * `MenuMap.setOverlay` normalises an empty overlay to `null`, which is what
 * makes "an overlay with no edits" and "no overlay" the same state rather than
 * two states that have to be proved equivalent. The phase's gate — *deleting the
 * overlay restores the scanned defaults exactly* — is a property of the code
 * only if those two are genuinely indistinguishable.
 */
export function isEmptyOverlay(overlay: MenuOverlay | null | undefined): boolean {
  if (!overlay) return true;
  for (const areaId of Object.keys(overlay.areas ?? {})) {
    if (!isEmptyAreaEdit(overlay.areas[areaId])) return false;
  }
  return true;
}

/* -------------------------------------------------------------- applying */

/**
 * Lay an area's edits over its declared record.
 *
 * Returns the SAME object when nothing applies, so an unedited area costs no
 * allocation on a path that runs on every right-click.
 */
export function applyAreaEdit(area: Area, edit: AreaEdit | undefined): Area {
  if (!edit || (edit.title === undefined && edit.suppressUniversal === undefined)) return area;
  return {
    ...area,
    ...(edit.title !== undefined ? { title: edit.title } : {}),
    ...(edit.suppressUniversal !== undefined
      ? { suppressUniversal: edit.suppressUniversal }
      : {})
  };
}

/**
 * Lay a set of row edits over one area's authored items, recursively.
 *
 * Hidden rows are dropped here rather than marked, because everything
 * downstream — the composer, the renderer, the keyboard model — already treats
 * "not in the list" correctly and would have to learn a second way to say the
 * same thing.
 *
 * Ordering is NOT done here. This function only rewrites fields; sorting stays
 * with {@link MenuMap.itemsFor}, which sorts the scanned defaults and the edited
 * rows through the identical code path. If it sorted here, an overlay with no
 * edits could produce a different order from no overlay at all, and the gate
 * this phase is judged on would be false by construction.
 */
export function applyItemEdits(
  items: readonly MenuItem[],
  edits: Readonly<Record<string, ItemEdit>> | undefined,
  trail = ""
): MenuItem[] {
  const out: MenuItem[] = [];
  for (const item of items) {
    const path = `${trail}${item.id}`;
    const edit = edits?.[path];
    if (edit?.hidden) continue;

    let next: MenuItem = edit
      ? {
          ...item,
          ...(edit.label !== undefined ? { label: edit.label } : {}),
          ...(edit.group !== undefined ? { group: edit.group } : {}),
          ...(edit.order !== undefined ? { order: edit.order } : {})
        }
      : item;

    if (next.items) {
      const children = applyItemEdits(next.items, edits, `${path}${ITEM_PATH_SEP}`);
      // Every child hidden means a flyout that opens on nothing — a disclosure
      // arrow that promised otherwise, which is the dead row this package keeps
      // refusing to ship. `compose.ts` drops such a submenu too; dropping it
      // here as well keeps `MenuMap.itemsFor` from ever handing out a shape the
      // map's own registration gate calls invalid.
      if (!children.length) continue;
      next = { ...next, items: children };
    }

    out.push(next);
  }
  return out;
}

/* --------------------------------------------------------------- reading */

/**
 * Every authored row in one area, indexed by the path an edit addresses it with.
 *
 * The drift sweep and any manager UI both need this, and both need it to agree
 * exactly with what {@link applyItemEdits} matches on — so it is built by the
 * same rule, in the same file, rather than re-derived by whoever needs it next.
 */
export function indexItemPaths(
  items: readonly MenuItem[],
  trail = "",
  into: Map<string, MenuItem> = new Map()
): Map<string, MenuItem> {
  for (const item of items) {
    const path = `${trail}${item.id}`;
    into.set(path, item);
    if (item.items) indexItemPaths(item.items, `${path}${ITEM_PATH_SEP}`, into);
  }
  return into;
}

/* --------------------------------------------------------------- parsing */

/** A problem found while reading a persisted overlay. */
export interface OverlayParseProblem {
  /** The area the bad entry was under, or `"*"` for a whole-document problem. */
  readonly area: string;
  readonly problem: string;
}

/**
 * Read an untrusted value into a {@link MenuOverlay}, reporting what it had to
 * discard rather than discarding it quietly.
 *
 * This is the read half of the same principle the drift sweep implements:
 * *silence here is indistinguishable from the edit never having been made.* A
 * store that swallowed a malformed document would present a person with their
 * menu back at its defaults and no account of where their edits went, which is
 * the single worst outcome available to a settings layer.
 *
 * What it will NOT do is throw. An unreadable overlay must still leave a working
 * menu — the whole document is one person's customisation, and losing it is bad
 * where failing to open a menu at all is worse.
 */
export function parseOverlay(raw: unknown): {
  overlay: MenuOverlay;
  problems: OverlayParseProblem[];
} {
  const problems: OverlayParseProblem[] = [];
  const note = (area: string, problem: string) => problems.push({ area, problem });

  if (!raw || typeof raw !== "object") {
    note("*", "the stored overlay is not an object — starting from the scanned defaults");
    return { overlay: EMPTY_OVERLAY, problems };
  }

  const doc = raw as Partial<MenuOverlay>;
  if (doc.version !== OVERLAY_VERSION) {
    note(
      "*",
      `the stored overlay is version ${JSON.stringify(doc.version)}, not ${OVERLAY_VERSION} — ` +
        `it was left in place, unread, rather than migrated by guesswork`
    );
    return { overlay: EMPTY_OVERLAY, problems };
  }

  const areas: Record<string, AreaEdit> = {};
  const rawAreas = doc.areas;
  if (rawAreas && !isPlainObject(rawAreas)) {
    note("*", "the stored overlay's `areas` is not an object — no edits were read");
  } else if (rawAreas) {
    for (const areaId of Object.keys(rawAreas)) {
      const entry = (rawAreas as Record<string, unknown>)[areaId];
      if (!isPlainObject(entry)) {
        note(areaId, "the entry is not an object and was dropped");
        continue;
      }
      const src = entry as AreaEdit;

      const items: Record<string, ItemEdit> = {};
      const rawItems = src.items;
      if (rawItems !== undefined && !isPlainObject(rawItems)) {
        note(areaId, "the entry's `items` is not an object and was dropped");
      } else if (rawItems) {
        for (const path of Object.keys(rawItems)) {
          const e = (rawItems as Record<string, unknown>)[path];
          if (!isPlainObject(e)) {
            note(areaId, `the edit for row "${path}" is not an object and was dropped`);
            continue;
          }
          const edit = normaliseItemEdit(e as ItemEdit, (problem) =>
            note(areaId, `the edit for row "${path}": ${problem}`)
          );
          if (!isEmptyItemEdit(edit)) items[path] = edit;
        }
      }

      const area: AreaEdit = {
        ...keep("hidden", src.hidden, "boolean", (p) => note(areaId, p)),
        ...keep("title", src.title, "string", (p) => note(areaId, p)),
        ...keep("suppressUniversal", src.suppressUniversal, "boolean", (p) => note(areaId, p)),
        ...(Object.keys(items).length ? { items } : {})
      };
      if (!isEmptyAreaEdit(area)) areas[areaId] = area;
    }
  }

  return { overlay: { version: OVERLAY_VERSION, areas }, problems };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Keep one field if it is the right type, and SAY SO if it is not.
 *
 * The saying-so is the whole reason this is a helper rather than a ternary. A
 * field silently discarded for being the wrong type is a person's edit vanishing
 * with no account of why — the same silence the drift rule is written against,
 * one level down.
 */
function keep<T>(
  field: string,
  value: unknown,
  type: "string" | "boolean" | "number",
  note: (problem: string) => void
): Record<string, T> {
  if (value === undefined) return {};
  if (typeof value !== type || (type === "number" && !Number.isFinite(value))) {
    note(`\`${field}\` is ${JSON.stringify(value)}, not a ${type}, and was dropped`);
    return {};
  }
  return { [field]: value } as Record<string, T>;
}

/**
 * Keep the four dials, at the right types, and nothing else — reporting every
 * field it drops through `note` when one is given.
 *
 * Used on the way IN from storage (where the value is untrusted) and on the way
 * in from {@link OverlayStore.editItem} (where it strips the `undefined`s the
 * merge leaves behind, so `get()` never hands back a field that is present and
 * meaningless).
 */
export function normaliseItemEdit(
  edit: ItemEdit,
  note: (problem: string) => void = () => {}
): ItemEdit {
  return {
    ...keep<boolean>("hidden", edit.hidden, "boolean", note),
    ...keep<string>("label", edit.label, "string", note),
    ...keep<string>("group", edit.group, "string", note),
    ...keep<number>("order", edit.order, "number", note)
  };
}
