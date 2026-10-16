/**
 * @file Named predicates — the other half of what keeps the map serialisable.
 *
 * The command registry answers "what does this row DO". This answers "should
 * this row be here, and can it run right now". Both are resolved by NAME for
 * the same reason: an item carrying `when: (ctx) => ctx.selection !== ""` is an
 * item that can only be edited by editing the file it lives in, and escaping
 * that is the entire point of the design.
 *
 * A PREDICATE RETURNS A REASON, NOT `false`.
 *
 * That is the one shape decision here worth defending. `PredicateVerdict` is
 * `true | string`: it either holds, or it hands back the sentence explaining why
 * it does not. Bare `false` is not in the type.
 *
 * The plan's rule is that `enabledWhen` greys a row WITH the reason shown, and
 * never produces a row that does nothing when clicked. A boolean predicate
 * cannot satisfy that rule — the reason has to come from somewhere, and the
 * only two places available are the predicate (which knows) or the item
 * (which would have to restate the predicate's logic in prose, and go stale the
 * first time the predicate changes). So the predicate carries it, and an author
 * cannot forget to supply one because there is no way to say "no" without it.
 *
 * `when` uses the same predicates and simply discards the reason — presence
 * needs no explanation. Nothing is lost: the reason is still available to an
 * inspector answering "why is this row not in my menu", which is a question the
 * manager will absolutely be asked.
 */
import { commands } from "../commands";
import type { CtxClipboard, CtxTarget } from "./types";

/**
 * Everything a predicate is allowed to know about the click.
 *
 * Deliberately a flat record of values rather than the live DOM. A predicate
 * that could query the document could depend on anything, and a map full of
 * those is a map nobody can reason about or test. Everything here was resolved
 * once, at the moment of the click, by the resolver.
 */
export interface MenuContext {
  /**
   * Area ids from the innermost outwards — `["cell", "row", "table",
   * "pane:library", "module:claude", "shell"]`. The full path, uncapped: D3's
   * 4-area limit governs which areas CONTRIBUTE items, not what a predicate can
   * see. A row that wants to know it is inside a particular module still can.
   */
  readonly path: readonly string[];
  /** The innermost area, i.e. `path[0]`. Null when the click hit no area. */
  readonly area: string | null;
  readonly target: CtxTarget;
  readonly clipboard: CtxClipboard;
  readonly signedIn: boolean;
  readonly user: string | null;
  /**
   * `data-axf-*` attributes harvested from the area chain, innermost winning.
   *
   * This is how a predicate gets at the thing that was clicked — a row's id, a
   * task's status — without being handed the element. Strings only, because
   * that is what the DOM holds and because a serialisable map deserves a
   * serialisable context.
   */
  readonly data: Readonly<Record<string, string>>;
}

/** `true` = it holds. A string = it does not, and this is why. */
export type PredicateVerdict = true | string;

/** A named test over a {@link MenuContext}. Pure — see the file docblock. */
export interface Predicate {
  /** Stable id, conventionally `<namespace>.<claim>` — `selection.present`. */
  readonly id: string;
  /** What a person calls it. The manager lists predicates by this. */
  readonly title: string;
  readonly test: (ctx: MenuContext) => PredicateVerdict;
}

export class PredicateDefinitionError extends Error {}

export class PredicateRegistry {
  readonly #predicates = new Map<string, Predicate>();

  constructor() {
    // Built-ins are registered HERE rather than behind a `registerBuiltins()`
    // call, unlike the ctx commands. The commands touch the DOM and the
    // clipboard, so they wait for a host; a predicate is a pure function over a
    // context that is handed to it, so there is nothing to wait for.
    //
    // It also closes an ordering trap that would otherwise be real: `map.ts`
    // refuses an item naming an unregistered predicate AT REGISTRATION TIME, so
    // a built-in that arrived after the first contribution would reject a
    // perfectly correct map depending on module evaluation order.
    for (const p of BUILTIN_PREDICATES) this.register(p);
  }

  /**
   * Register a predicate. Returns an unregister function. Throws on a duplicate
   * id — two owners of one name is a bug, and the loser would silently never be
   * consulted.
   */
  register(predicate: Predicate): () => void {
    const { id, title, test } = predicate;
    if (!id.trim() || /\s/.test(id)) {
      throw new PredicateDefinitionError(
        `a predicate id must be non-empty and contain no whitespace (got "${id}")`
      );
    }
    if (!title.trim()) {
      throw new PredicateDefinitionError(`predicate "${id}" needs a title — the manager lists it`);
    }
    if (typeof test !== "function") {
      throw new PredicateDefinitionError(`predicate "${id}" has no test function`);
    }
    if (this.#predicates.has(id)) {
      throw new PredicateDefinitionError(`predicate "${id}" is already registered`);
    }
    this.#predicates.set(id, predicate);
    return () => {
      if (this.#predicates.get(id) === predicate) this.#predicates.delete(id);
    };
  }

  has(id: string): boolean {
    return this.#predicates.has(id);
  }

  get(id: string): Predicate | undefined {
    return this.#predicates.get(id);
  }

  ids(): string[] {
    return [...this.#predicates.keys()].sort();
  }

  all(): Predicate[] {
    return this.ids().map((id) => this.#predicates.get(id) as Predicate);
  }

  /**
   * Run a predicate and normalise whatever came back.
   *
   * Three things are normalised, all of them cases where the type system has
   * already been sailed past by a JS caller, an `as` cast or a throw:
   *
   * - an UNKNOWN id degrades to a reason rather than throwing. `map.ts` refuses
   *   these at registration, so reaching here means the predicate was
   *   unregistered after the map was built — at which point greying the row with
   *   an honest sentence beats taking down the menu.
   * - a bare `false` or an empty string becomes a reason naming the predicate,
   *   with a warning. The row still says something rather than nothing.
   * - a THROW is caught for the same reason a menu must open: one bad predicate
   *   must not cost the user every other row on the menu.
   */
  evaluate(id: string, ctx: MenuContext): PredicateVerdict {
    const predicate = this.#predicates.get(id);
    if (!predicate) {
      if (typeof console !== "undefined") {
        console.warn(`[axf] no predicate registered as "${id}" — treated as not satisfied`);
      }
      return `unavailable (predicate "${id}" is not registered)`;
    }
    let verdict: PredicateVerdict | boolean;
    try {
      verdict = predicate.test(ctx);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (typeof console !== "undefined") {
        console.warn(`[axf] predicate "${id}" threw — treated as not satisfied: ${msg}`);
      }
      return `unavailable (predicate "${id}" failed)`;
    }
    if (verdict === true) return true;
    if (typeof verdict === "string" && verdict.trim()) return verdict;
    if (typeof console !== "undefined") {
      console.warn(`[axf] predicate "${id}" returned no reason — a greyed row must say why`);
    }
    return `unavailable (${predicate.title})`;
  }

  /** Presence form: does it hold? The reason, if any, is discarded. */
  holds(id: string, ctx: MenuContext): boolean {
    return this.evaluate(id, ctx) === true;
  }
}

/* ------------------------------------------------------------- built-ins */

/**
 * The predicates the engine's own rows need, and the vocabulary a module should
 * reach for before writing its own.
 *
 * Kept small on purpose. Every one of these is a fact about the CLICK that no
 * module could compute for itself from the context alone (`session.signedIn` is
 * a fact about the app; `clipboard.hasText` required an async read the resolver
 * already did). A predicate that just reads `ctx.data` belongs to the module
 * that owns that data, not here.
 */
const BUILTIN_PREDICATES: readonly Predicate[] = [
  {
    id: "always",
    title: "Always",
    test: () => true
  },
  {
    id: "selection.present",
    title: "Something is selected",
    test: (ctx) => (ctx.target.selection.length > 0 ? true : "nothing is selected")
  },
  {
    id: "target.editable",
    title: "The target accepts typed text",
    test: (ctx) => (ctx.target.editable ? true : "this text is not editable")
  },
  {
    id: "target.hasValue",
    title: "The click has a value to copy",
    // Distinct from `selection.present`: a field holds its value whether or not
    // any of it happens to be highlighted, and D2's Copy value row is about the
    // former. Reads the value the resolver derived (`resolve.ts`'s `valueFor`)
    // rather than the element, so this stays a pure function of the context.
    test: (ctx) => (ctx.target.value ? true : "there is nothing here to copy")
  },
  {
    id: "clipboard.hasText",
    title: "The system clipboard holds text",
    test: (ctx) =>
      ctx.clipboard.text
        ? true
        : // "We could not look" and "it is empty" are different facts and must
          // not render as the same sentence — the first is fixable by the
          // reader, the second is not.
          (ctx.clipboard.unreadable ?? "the clipboard is empty"),
  },
  {
    id: "session.signedIn",
    title: "Somebody is signed in",
    test: (ctx) => (ctx.signedIn ? true : "nobody is signed in")
  },
  {
    id: "session.signedOut",
    title: "Nobody is signed in",
    test: (ctx) => (ctx.signedIn ? `already signed in${ctx.user ? ` as ${ctx.user}` : ""}` : true)
  },
  {
    id: "command.available",
    title: "The row's own command is registered",
    test: (ctx) => {
      // Reads `ctx.data["command"]`, which the resolver fills with the row's own
      // command id. This is the run-time half of the plan's rule that a command
      // which no longer exists must be *caught at package time and reported at
      // run time as a disabled row naming it* — never a row that does nothing.
      const id = ctx.data.command;
      if (!id) return true;
      return commands.has(id) ? true : `the command "${id}" is no longer registered`;
    }
  }
];

/** The process-wide predicate registry. */
export const predicates = new PredicateRegistry();
