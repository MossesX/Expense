/**
 * @file Context-menu types — items are DATA, behaviour is resolved by name.
 *
 * The one constraint everything else here depends on: **no inline closures in
 * an item, ever.** `command` is a name in the core command registry
 * (`../commands`), resolved at the moment the row runs. That is what lets a
 * menu be serialised, diffed, validated at packaging time and edited by a UI
 * that never touches source — a map with functions in it can only be edited by
 * editing the file it lives in, which is the whole thing being escaped.
 *
 * TWO SHAPES, ON PURPOSE (widened by `axf-context-menus` P0, 2026-08-09).
 *
 * - {@link MenuItem} is the AUTHORED row: what lives in the map, in a manifest,
 *   in the overlay the manager edits. Every behavioural field on it is a NAME —
 *   `command`, `when`, `enabledWhen`, `checkedWhen` — never a function.
 * - {@link CtxItem} is the RESOLVED row: what the renderer draws after the
 *   engine has evaluated those names against a real click. `label` is final,
 *   `disabledReason` is filled in, predicates are gone.
 *
 * They are not the same type because they are not the same thing, and collapsing
 * them is how a "data" menu grows a closure: the moment the drawn row and the
 * stored row share a type, someone needs a computed label and puts a function
 * on the stored one. The compile step MenuItem[] → CtxItem[] is the resolver's
 * job (P1/P2) and is where every name is turned into a value.
 */

/**
 * What a row IS. `normal` and `danger` act; `toggle` acts and reports a state;
 * `submenu` opens children and acts on nothing itself; `separator` and `header`
 * are structural, carry no command and never take focus.
 *
 * `danger` is styled in the error colour — it is what Sign in / Sign out render
 * as, per the owner's directive.
 */
export type ItemRole = "normal" | "danger" | "toggle" | "submenu" | "separator" | "header";

/**
 * How a `toggle` draws its two states. See {@link MenuItem.marks}.
 *
 * A closed set rather than two glyph ids on the item, deliberately: a row that
 * could name any pair of drawings would let one menu disagree with the next
 * about what "on" looks like, and the point of a marker column is that it means
 * the same thing everywhere. Adding a third mode is a decision made here, once.
 */
export type ToggleMarks = "check" | "visibility";

/**
 * The subset of roles the CURRENT renderer draws — a flat menu, no submenu
 * flyouts and no toggle checkmarks yet (both are P2).
 *
 * Derived from {@link ItemRole} rather than written out a second time. Two
 * hand-kept role vocabularies drift, and the drift shows up as a row that
 * validates in the map and renders as nothing on screen.
 *
 * NOTE (P1, 2026-08-09): this is now the RENDERER's subset, not the resolved
 * row's. {@link CtxItem.role} widened to the full {@link ItemRole} when the
 * resolver landed, because the resolver compiles whatever the map holds and the
 * map has been able to hold toggles and submenus since P0 — narrowing here would
 * have meant the resolver dropping those rows, and a row that vanishes without a
 * word is exactly what this package keeps refusing to ship. What the flat
 * renderer cannot draw yet, it will draw in P2; until then the composed data is
 * complete and nothing is wired to a renderer that would mis-draw it.
 */
export type CtxRole = Exclude<ItemRole, "toggle" | "submenu">;

export interface CtxItem {
  /**
   * Unique within the COMPOSED menu, not within an area.
   *
   * The resolver namespaces it `"<area>:<item>"`, because two areas on one path
   * may each carry a `copy` row and the renderer keys on this. The authored
   * halves stay available, unmangled, in {@link origin} — recovering them by
   * slicing the string would be a parser nobody wrote down.
   */
  id: string;
  label: string;
  role?: ItemRole;
  /** A name in the command registry. Absent on `separator` / `header`. */
  command?: string;
  /**
   * Why this row cannot run right now. Present ⇒ the row renders greyed WITH
   * this text beside it.
   *
   * There is no bare `disabled` boolean on purpose. A row that is inert and
   * does not say why is the failure mode this field exists to make
   * unrepresentable: the reader clicks it, nothing happens, and they learn the
   * menu is unreliable rather than that the action is unavailable.
   */
  disabledReason?: string;
  /** A `toggle`'s state, from its `checkedWhen` predicate. */
  checked?: boolean;
  /** How to draw that state. Carried through from the authored item. */
  marks?: ToggleMarks;
  /** A `submenu`'s resolved children. */
  items?: readonly CtxItem[];
  /**
   * Where the row came from — the area that contributed it and the id it has in
   * that area's map.
   *
   * Absent on rows the engine synthesised (separators, the target header) and on
   * the default menu, which answers to no area. The manager's overlay (P4) keys
   * its edits on this pair, and it is also the honest answer to "why is this row
   * in my menu", which is the question an area-resolved menu invites.
   */
  origin?: { readonly area: string; readonly item: string };
}

/* ------------------------------------------------------- the authored map */

/**
 * A named surface a click can land in — the unit the whole system resolves by.
 *
 * A menu is not assembled by whichever component remembered to handle the
 * event. Every surface marks itself `data-axf-area="<id>"`; the resolver walks
 * up from the event target collecting ids into a PATH (`cell` → `row` → `table`
 * → `pane:library` → `module:claude` → `shell`), and each area on that path
 * contributes its group. A module gets a complete menu by declaring its areas
 * and nothing else, which is the fix for the failure this project exists for:
 * GizmoX's menus were not bad, their COVERAGE was inconsistent, because forty
 * modules each hand-wrote `useCtx` and a habit has holes.
 *
 * Ids are conventionally `<kind>:<name>` for the broad ones (`module:claude`,
 * `pane:library`) and bare for the fine ones (`row`, `cell`). Nothing enforces
 * that — an area id is opaque to the engine and only has to be unique.
 *
 * D1 (owner, 2026-08-07): areas are DECLARED here as well as marked in the DOM.
 * It costs one line per area and buys two things a marker alone cannot: the
 * manager gets a real list instead of a guess, and the resolver can warn about a
 * DOM area nobody declared — which is how a typo'd `data-axf-area` becomes an
 * invisible menu rather than a message.
 */
export interface Area {
  /** Unique across the app. Matched against `data-axf-area` in the DOM. */
  readonly id: string;
  /** Human title — what the manager lists and what a header can name. */
  readonly title: string;
  /** One line on what clicking here means. */
  readonly description?: string;
  /** Asset that declares it, for the manager and the peel closure. */
  readonly owner?: string;
  /** Group this area's items land in when an item names none. */
  readonly group?: string;
  /**
   * Keep D2's universal group off menus rooted here.
   *
   * The default is to inject it everywhere, always last, because a menu that
   * varies in whether it has the basics is a menu people stop trusting. This
   * exists for the surfaces where a basic genuinely cannot apply, and it is
   * per-area precisely so switching it off is a visible, reviewable decision.
   */
  readonly suppressUniversal?: boolean;
}

/**
 * A band within a composed menu. Items sort by their group's `order` first,
 * then their own — so an item can move between bands without renumbering the
 * band it left.
 *
 * Groups are declared, and an item naming an undeclared one is refused. A menu
 * band nobody declared cannot be ordered against the others, so the item lands
 * in a phantom position that looks deliberate and is not.
 */
export interface Group {
  readonly id: string;
  /** Rendered as a heading when set; an unnamed group is just a divider. */
  readonly title?: string;
  /** Ascending. Ties break on group id, so the order is total and stable. */
  readonly order: number;
}

/**
 * One authored row. **No inline closures, anywhere, ever.**
 *
 * The four orthogonal dials the manager overrides per area, because "controlling
 * the options" has to mean something precise:
 *
 * | dial | field(s) | what it decides |
 * |---|---|---|
 * | presence | `when` | whether the row is in the menu at all |
 * | availability | `enabledWhen` | greyed WITH the reason the predicate returned |
 * | placement | `group`, `order` | which band, and where in it |
 * | kind | `role` | normal, danger, toggle, submenu |
 *
 * Availability never produces a silently dead row: a predicate that does not
 * hold returns the REASON it does not, and that string is what renders beside
 * the greyed label. See {@link CtxItem.disabledReason}.
 */
export interface MenuItem {
  /** Unique within its area. The manager's overlay keys its edits on it. */
  readonly id: string;
  readonly label: string;
  /** A pack glyph id — the same vocabulary a toolbar item's `glyph` uses. */
  readonly icon?: string;
  /** Group id. Falls back to the area's `group`, then the default band. */
  readonly group?: string;
  /** Ascending within the group. Ties break on item id. */
  readonly order?: number;
  /** Defaults to `normal`. */
  readonly role?: ItemRole;
  /** A command id. Required on acting roles, refused on structural ones. */
  readonly command?: string;
  /** Predicate id: the row is present only when it holds. */
  readonly when?: string;
  /** Predicate id: the row is enabled only when it holds. */
  readonly enabledWhen?: string;
  /**
   * Predicate id giving a `toggle`'s checked state. Required on `toggle`, and
   * refused elsewhere.
   *
   * A toggle with no state source draws a checkmark that means nothing, which
   * is worse than a plain row — it asserts a fact about the system that nothing
   * computed. Making it unrepresentable costs one field.
   */
  readonly checkedWhen?: string;
  /**
   * How a `toggle`'s two states are DRAWN. Optional; `check` is the default and
   * is what every toggle written before this field existed keeps.
   *
   * `check` marks the on state with a tick and leaves the off state blank —
   * right for a toggle whose off state is simply the absence of a choice
   * ("…including the build project lists").
   *
   * `visibility` marks both: on with a tick in the OK colour, off with the
   * struck-through eye. It exists because a menu listing what is on screen has
   * two POSITIVE states — shown and hidden — and a blank column for "hidden"
   * reads as "no answer" rather than as an answer. Refused on non-toggles at
   * the `validateMenusDecl` chokepoint, because a mark with no state to draw is
   * the same empty assertion `checkedWhen` exists to prevent.
   */
  readonly marks?: ToggleMarks;
  /** A `submenu`'s children. Required on `submenu`, and refused elsewhere. */
  readonly items?: readonly MenuItem[];
}

/* ---------------------------------------------------------- the drawn row */

/** What the resolver learned about the click. Commands read it at run time. */
export interface CtxTarget {
  /** The element the event landed on. Null only if the event had no target. */
  element: HTMLElement | null;
  /** Header text — what this menu is FOR, named as specifically as possible. */
  label: string;
  /** Highlighted text at the moment of the click; empty when nothing is. */
  selection: string;
  /** The target accepts text input, so cut and paste can actually apply. */
  editable: boolean;
  /**
   * What the clicked thing HOLDS, as distinct from what happens to be
   * highlighted — a field's value, a leaf's text, or whatever a surface named
   * with `data-axf-value`. Empty when the click landed on something that holds
   * nothing (added by P3 for D2's Copy value row).
   *
   * Resolved once, at the click, for the same reason everything else on this
   * type is: `target.hasValue` is a predicate, and a predicate that reached into
   * the live DOM to answer could depend on anything (`predicates.ts`). Deriving
   * it here is what keeps that rule true for the universal band as well as for
   * everyone else's rows.
   */
  value: string;
}

/**
 * The clipboard as far as this document is allowed to know.
 *
 * `text` is what the system clipboard holds — from ANY application, not just
 * this one, which is the point of reading it rather than tracking our own
 * copies. `unreadable` is set when the browser refuses (no permission, the
 * document is not focused, an insecure origin); it is a REASON string because
 * it goes straight onto the disabled Paste row. "We could not look" and "the
 * clipboard is empty" are different facts and must not render the same.
 */
export interface CtxClipboard {
  text: string | null;
  unreadable: string | null;
}
