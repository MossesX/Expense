/**
 * @file The command registry — the one place a NAME becomes behaviour.
 *
 * A surface fires a name; the registry resolves it to a handler at the moment
 * it runs. That indirection is the whole feature: it is what lets a toolbar, a
 * menu or a hotkey stay serialisable DATA (`command: "search.open"`) while the
 * behaviour lives with whoever owns it — handlers are registered by name at
 * subsystem start, never stored as inline closures inside an asset.
 *
 * Consumers, present and planned: the `app.banner` bar (`AppShell` wires
 * `<Toolbar onCommand>` through {@link CommandRegistry.run}), the context-menu
 * map (`ctx/map.ts`, which refuses an item naming a command that is not here),
 * then the hotkey system and the search palette — all of which need the same
 * name → behaviour resolution, which is why this lives in core rather than in
 * the first host that wanted it.
 *
 * WIDENED 2026-08-09 by `axf-context-menus` P0, per its own coordination note:
 * *"Whichever project lands first owns the registry; the other consumes and
 * extends it. One registry, never one each."* `studio-shell-init` P3 landed the
 * minimal version (name → handler) and this extends THAT, in place. A command
 * is now a record — id, title, run, plus an optional icon and default hotkey —
 * because the consumers queued behind it need to LIST commands, not only fire
 * them: a palette needs a title to show, a menu needs an icon to draw, and the
 * hotkey system needs the default binding to live with the command rather than
 * in a second file that drifts from it.
 *
 * There is deliberately no `(id, handler)` shorthand. A title-less command is
 * one that cannot appear in a palette, and an optional title is a title that
 * gets skipped — the same reasoning that puts the sui contract on
 * `registerSettingsSource` rather than in a checklist.
 *
 * **Unknown names log and degrade, never throw.** A shared bar asset may name a
 * command a given host has not registered; the correct outcome is a console
 * line naming the miss, not a crashed chrome. Registration conflicts, by
 * contrast, DO throw — two owners for one name is a real bug and must surface
 * where it is made, the same posture as every other registry here.
 *
 * INTENDED CONVERGENCE — noted, deliberately NOT done in this build (RUN
 * prompt §P4 amendment): the `nav-menu` kind still navigates directly
 * (`window.location.assign` in `nav/NavMenu.tsx`). Routing nav items through
 * named commands would give the bar and the nav a single entry point; that
 * rewiring is its own step, so the two converge once, on purpose, rather than
 * as a side effect of the bar landing.
 */

export type CommandHandler = () => void;

/**
 * A registered command. Everything except `run` is DATA — which is what lets a
 * palette, a menu editor or an inspector render the full command surface
 * without invoking anything.
 */
export interface Command {
  /** Stable id, conventionally `<namespace>.<verb>` — `ctx.copy`. */
  readonly id: string;
  /** What a person calls it. Shown by the palette, tooltips, the manager. */
  readonly title: string;
  /** The behaviour. Takes no arguments on purpose — see the note below. */
  readonly run: CommandHandler;
  /** A pack glyph id, same vocabulary as a toolbar item's `glyph`. */
  readonly icon?: string;
  /**
   * The binding this command ships with, e.g. `"Ctrl+Shift+K"`.
   *
   * A DEFAULT, not the truth: a user's own binding overrides it, and that
   * mapping belongs to the hotkey system. What lives here is the one fact only
   * the command's author knows — what it *wants* to be bound to — kept beside
   * the command so the two cannot drift.
   */
  readonly hotkey?: string;
}

/**
 * Handlers take no arguments, deliberately. A handler that took the click event
 * would be a handler only a menu could call, and the point of the registry is
 * that a hotkey, a toolbar button and a menu row all fire the SAME behaviour.
 * Invocation context is parked where the handler can read it — see
 * `ctx/resolve.ts`'s `activeTarget()`.
 */

export class CommandDefinitionError extends Error {}

const MODIFIERS = ["Ctrl", "Alt", "Shift", "Meta"] as const;
const MODIFIER_ALIASES: Record<string, (typeof MODIFIERS)[number]> = {
  ctrl: "Ctrl",
  control: "Ctrl",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
  meta: "Meta",
  cmd: "Meta",
  command: "Meta",
  super: "Meta",
  win: "Meta"
};

/**
 * Put a chord into one canonical spelling so `"shift+ctrl+k"` and `"Ctrl+Shift+K"`
 * are recognisably the same binding.
 *
 * Without this, the duplicate check below is decorative: two commands could
 * claim the same physical chord in two spellings and both register, and the
 * conflict would surface as one of them silently never firing.
 */
export function normaliseHotkey(chord: string): string {
  const parts = chord.split("+").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) throw new CommandDefinitionError(`"${chord}" is not a hotkey`);

  const seen = new Set<string>();
  const key = parts.pop() as string;
  for (const part of parts) {
    const mod = MODIFIER_ALIASES[part.toLowerCase()];
    if (!mod) {
      throw new CommandDefinitionError(
        `"${chord}" names "${part}" where a modifier was expected (${MODIFIERS.join(", ")})`
      );
    }
    seen.add(mod);
  }
  if (MODIFIER_ALIASES[key.toLowerCase()]) {
    throw new CommandDefinitionError(`"${chord}" ends on the modifier "${key}" and binds no key`);
  }
  // Single characters upper-case so `k` and `K` are one binding; longer names
  // (`Enter`, `F5`, `ArrowLeft`) are left as written, matching KeyboardEvent.key.
  const canonicalKey = key.length === 1 ? key.toUpperCase() : key;
  return [...MODIFIERS.filter((m) => seen.has(m)), canonicalKey].join("+");
}

export class CommandRegistry {
  readonly #commands = new Map<string, Command>();
  /** Canonical chord → command id, so a clash is caught at registration. */
  readonly #hotkeys = new Map<string, string>();

  /**
   * Register a command. Returns an unregister function, so a host whose
   * behaviour has a lifetime (an overlay, a mounted surface) can take its name
   * back down. Unregistering only removes the command it registered — a later
   * owner of the same id is not disturbed.
   *
   * Throws on a duplicate id and on two commands claiming the same default
   * hotkey. Both are bugs at the point they are written, and both are invisible
   * afterwards: the second registration would either lose its behaviour or lose
   * its binding, with nothing on screen to say so.
   */
  register(command: Command): () => void {
    const { id, title, run, hotkey } = command;
    if (!id.trim() || /\s/.test(id)) {
      throw new CommandDefinitionError(`a command id must be non-empty and contain no whitespace (got "${id}")`);
    }
    if (!title.trim()) {
      throw new CommandDefinitionError(`command "${id}" needs a title — it is what a palette shows`);
    }
    if (typeof run !== "function") {
      throw new CommandDefinitionError(`command "${id}" has no run handler`);
    }
    if (this.#commands.has(id)) {
      throw new CommandDefinitionError(`command "${id}" is already registered`);
    }

    let chord: string | null = null;
    if (hotkey !== undefined) {
      try {
        chord = normaliseHotkey(hotkey);
      } catch (e) {
        throw new CommandDefinitionError(
          `command "${id}" has an unusable hotkey: ${e instanceof Error ? e.message : String(e)}`
        );
      }
      const holder = this.#hotkeys.get(chord);
      if (holder) {
        throw new CommandDefinitionError(
          `command "${id}" claims default hotkey "${chord}", already claimed by "${holder}"`
        );
      }
    }

    const stored: Command = chord ? { ...command, hotkey: chord } : command;
    this.#commands.set(id, stored);
    if (chord) this.#hotkeys.set(chord, id);

    return () => {
      if (this.#commands.get(id) !== stored) return;
      this.#commands.delete(id);
      if (chord && this.#hotkeys.get(chord) === id) this.#hotkeys.delete(chord);
    };
  }

  has(id: string): boolean {
    return this.#commands.has(id);
  }

  /** The full record — for a palette row, a menu icon, a hotkey binding. */
  get(id: string): Command | undefined {
    return this.#commands.get(id);
  }

  /** Every registered id, sorted — for an inspector or a validation pass. */
  ids(): string[] {
    return [...this.#commands.keys()].sort();
  }

  /** Every command, sorted by id — what a palette enumerates. */
  all(): Command[] {
    return this.ids().map((id) => this.#commands.get(id) as Command);
  }

  /** Which command a canonical chord belongs to, if any. */
  byHotkey(chord: string): Command | undefined {
    const id = this.#hotkeys.get(normaliseHotkey(chord));
    return id ? this.#commands.get(id) : undefined;
  }

  /**
   * Resolve an id and invoke its handler. Unknown ids log and degrade:
   * `false` means "nothing ran", and the console line names the miss so a
   * misspelt command in an asset is a message rather than a silent dead click.
   */
  run(id: string): boolean {
    const command = this.#commands.get(id);
    if (!command) {
      if (typeof console !== "undefined") {
        console.warn(`[axf] no handler registered for command "${id}" — ignored`);
      }
      return false;
    }
    command.run();
    return true;
  }
}

/** The process-wide command registry. */
export const commands = new CommandRegistry();
