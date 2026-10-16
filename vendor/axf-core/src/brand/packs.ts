/**
 * @file The pack registry and the hot swap.
 *
 * Two selections exist — a branding pack and a logo pack — and both are
 * **app settings, not theme state** (owner, 2026-08-12: *"branding is just
 * that, its not negotiable, its global and does not change"*). A pack supplies
 * DRAWINGS. It never decides a colour the theme's dials own: `--axf-accent`
 * and the status colours are the theme's alone, so a roll always visibly
 * restyles the app, whatever pack is selected. The pack's own palette is
 * published only as the `--gxb-*` / `--axf-brand-*` role variables its
 * drawings paint in.
 *
 * "Hot swap" means exactly one thing here: **activating a pack recomputes the
 * published CSS variables and notifies subscribers, and nothing re-mounts.**
 * Every glyph in every pack draws through `var(--axf-brand-*)` / `var(--gxb-*)`,
 * so changing the values repaints the entire identity — hundreds of SVGs — in
 * one style write. No component re-renders to change colour; React re-renders
 * only where the *set of drawings* changed.
 *
 * The store is a `useSyncExternalStore` source rather than React state on
 * purpose: packs are registered at boot by a subsystem, outside any component,
 * and a module that wants to read the active style should not have to be
 * beneath a provider to do it.
 *
 * ## Two tiers of selection, and why there have to be two
 *
 * A slot's value comes from one of two places, and keeping them apart is what
 * makes a selection survive a reload:
 *
 * - **The app's default** — {@link PackRegistry.activateDefault}. Studio's
 *   `start()` and the console wrapper's look binding both apply their packs
 *   this way. It is code, so it is re-applied on every boot and never
 *   persisted.
 * - **The user's selection** — {@link PackRegistry.activate}. Persisted the
 *   moment it is made, restored before the first render, and it OUTRANKS the
 *   default for that slot.
 *
 * One tier and the two collide: the gallery's click and the console look's boot
 * activation are the same call, so the last one to run wins — and the boot one
 * always runs last, which is precisely why a pack chosen in the gallery used to
 * vanish on reload. `look-binding.ts` already drew this line for the session
 * ("a pack swap made while the wrapper is active is the user's move"); this
 * extends it across the reload, where the whole point of a saved preference is.
 *
 * Persistence follows the theme store's two rules verbatim: applied on
 * selection, saved on selection, no confirm step.
 */
import { paletteVariables, paletteLegibility, validatePalette } from "./roles";
import type { BrandPalette } from "./roles";
import type { AnyPackage, BrandingPackage, GlyphEntry, LogoPackage } from "./types";

export interface PackProblem {
  readonly pack: string;
  readonly problem: string;
}

/**
 * Where a selection is kept between visits.
 *
 * Injectable and defaulting to `localStorage`, exactly as the theme store's
 * `ThemeStorage` is, so this module imports nothing browser-specific and stays
 * usable server-side. It is declared here rather than imported from the theme
 * layer because the dependency runs theme → brand (`theme/resolve.ts` imports
 * `brand/roles`), and borrowing a two-method interface back the other way would
 * make that a cycle.
 */
export interface PackStorage {
  read(key: string): string | null;
  write(key: string, value: string): void;
}

/** The key a selection is persisted under. */
export const PACKS_KEY = "axf:packs@1";

/**
 * The cookie the same selection is MIRRORED into, so the SERVER can see it.
 *
 * `localStorage` is invisible to the server, which is why `serverResolved`
 * resolved from `#default` alone: it was the only thing both runtimes could
 * agree on. The cost was visible. A chosen pack's DRAWINGS are markup, so the
 * server emitted the default identity, the hydrating render had to match it,
 * and the real pack arrived a commit later — every glyph on the page swapping
 * at once (486 of them on `/brand`). The owner reported it as "a different
 * theme loads for 1 second", and unlike the variables it could NOT be fixed by
 * the pre-paint boot script: a script can patch a custom property, it cannot
 * patch markup React is about to hydrate against.
 *
 * A cookie is the one channel a client preference can reach the server through.
 * Deliberately NOT httpOnly: `serverResolved()` reads this same cookie on BOTH
 * runtimes, which is what makes the two renders agree by construction. Reading
 * `localStorage` on the client while the server read a cookie would put the
 * mismatch straight back the moment the two disagreed.
 *
 * `localStorage` stays the source of truth for the selection; this is a mirror,
 * and a failed write costs the first paint, never the preference.
 */
export const PACKS_COOKIE = "axf_packs";

/** One slot per pack kind. */
type Slot = AnyPackage["type"];

/**
 * The slots, as a record so TypeScript refuses a new pack kind that has not
 * been given one. A hand-written list can silently miss a kind, and a slot
 * missing from this list is a selection that silently stops persisting.
 */
const SLOT_ORDER: Record<Slot, number> = {
  "branding-package": 0,
  "logo-package": 1
};

const SLOTS = (Object.keys(SLOT_ORDER) as Slot[]).sort((a, b) => SLOT_ORDER[a] - SLOT_ORDER[b]);

/**
 * Read a `{ chosen }` record out of anything — the persisted JSON, the cookie,
 * or a value the server handed in. ONE parser for all three, because the cookie
 * and `localStorage` must agree on what a selection means; two parsers that
 * drift is the mismatch this whole mechanism exists to remove.
 *
 * Unknown slots and non-string ids are dropped rather than rejected: a record
 * written by a newer build must not stop an older one rendering.
 */
function readChosen(source: unknown): Partial<Record<Slot, string | null>> {
  const chosen = (source as { chosen?: unknown } | null)?.chosen;
  if (!chosen || typeof chosen !== "object") return {};
  const out: Partial<Record<Slot, string | null>> = {};
  for (const slot of SLOTS) {
    if (!Object.prototype.hasOwnProperty.call(chosen, slot)) continue;
    const id = (chosen as Record<string, unknown>)[slot];
    if (id === null || typeof id === "string") out[slot] = id;
  }
  return out;
}

/**
 * What lands in storage. Only the USER's selections — a default is code and is
 * re-applied by whatever declared it. A key that is PRESENT with `null` means
 * the slot was deliberately cleared, which is a different statement from a key
 * that is absent (never chosen, so the default applies).
 */
interface PersistedPacks {
  readonly chosen: Partial<Record<Slot, string | null>>;
}

const memoryStorage = (): PackStorage => {
  const map = new Map<string, string>();
  return {
    read: (k) => map.get(k) ?? null,
    write: (k, v) => void map.set(k, v)
  };
};

const browserStorage = (): PackStorage | null => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return {
      read: (k) => window.localStorage.getItem(k),
      write: (k, v) => window.localStorage.setItem(k, v)
    };
  } catch {
    // Private mode, disabled storage, a sandboxed iframe — all fine. An
    // identity that cannot persist should still apply.
    return null;
  }
};

/** What the app should actually paint, after resolution. */
export interface ResolvedStyle {
  readonly brandingId: string | null;
  readonly logoId: string | null;
  readonly palette: BrandPalette;
  /** Every drawing available right now, by entry id. */
  readonly glyphs: ReadonlyMap<string, GlyphEntry>;
  /**
   * CSS custom properties to publish — the `--gxb-*` / `--axf-brand-*` role
   * variables the drawings paint in, and NOTHING in the `--axf-*` theme
   * vocabulary. A pack that could publish `--axf-accent` outranked the dials,
   * which is the "my roll changed nothing" defect this shape ended.
   */
  readonly variables: Readonly<Record<string, string>>;
  /**
   * Selected ids that name a pack nothing has registered.
   *
   * A stored selection outlives the code, so a pack that is renamed or removed
   * leaves a choice pointing at nothing. The slot falls back — an app must
   * still boot — but the id is reported here rather than disappearing, because
   * "my identity silently reverted" is the complaint that follows otherwise.
   *
   * Computed rather than recorded: during boot there is a window where a
   * restored id is legitimately not registered YET, and a problem pushed then
   * would be a permanent false report of a selection that resolves a
   * millisecond later.
   */
  readonly unresolved: readonly string[];
  /**
   * Slots holding a stored USER selection rather than the app's default.
   *
   * On the snapshot rather than a `registry.isChosen()` getter, because a UI
   * reads this while rendering: a getter answers with the client's restored
   * truth during the hydrating render, when the server rendered the default —
   * the same mismatch `serverResolved` exists to prevent, reintroduced by a
   * convenience method. Coming through the snapshot, it is empty exactly when
   * the rest of the snapshot is the server's.
   */
  readonly chosen: readonly AnyPackage["type"][];
}

const FALLBACK_PALETTE: BrandPalette = {
  accent: "#ff7a1a",
  accent2: "#4f8ef7",
  accent3: "#b06df7",
  ink: "#f7f2ea",
  dim: "#9c9083",
  edge: "#2a2621",
  page: "#0f0d0b",
  ok: "#3fb27f",
  warn: "#f5a623",
  err: "#e5484d"
};

function entriesOf(pack: BrandingPackage | LogoPackage | undefined): readonly GlyphEntry[] {
  if (!pack) return [];
  return pack.type === "branding-package" ? pack.payload.entries : (pack.payload.entries ?? []);
}

export class PackRegistry {
  readonly #packs = new Map<string, AnyPackage>();
  readonly #problems: PackProblem[] = [];
  readonly #listeners = new Set<() => void>();
  readonly #storage: PackStorage;

  /** What the APP asks for per slot — code, re-applied every boot. */
  readonly #default: Record<Slot, string | null> = {
    "branding-package": null,
    "logo-package": null
  };
  /** What the USER selected. Present key wins over the default for that slot. */
  readonly #chosen = new Map<Slot, string | null>();

  #snapshot: ResolvedStyle | null = null;
  #serverSnapshot: ResolvedStyle | null = null;

  /**
   * The selection the server was told to render, from the request's cookie.
   * `null` on the client, where `#mirroredSelection()` reads `document.cookie`
   * directly instead. See `applyServerSelection`.
   */
  #serverSelection: Partial<Record<Slot, string | null>> | null = null;

  constructor(storage?: PackStorage) {
    this.#storage = storage ?? browserStorage() ?? memoryStorage();
    this.#restore();
  }

  /**
   * Register a pack. A pack whose palette is malformed or illegible is recorded
   * as a problem and REFUSED, rather than registered and left to paint an
   * unreadable app — the same posture the contribution registry takes.
   */
  register(pack: AnyPackage): this {
    if (this.#packs.has(pack.id)) {
      this.#problems.push({ pack: pack.id, problem: "a pack with this id is already registered" });
      return this;
    }
    const palette =
      pack.type === "logo-package" ? null : (pack.payload as { palette: BrandPalette }).palette;

    if (palette) {
      const malformed = validatePalette(palette);
      if (malformed.length) {
        for (const problem of malformed) this.#problems.push({ pack: pack.id, problem });
        return this;
      }
      for (const problem of paletteLegibility(palette)) {
        this.#problems.push({ pack: pack.id, problem });
      }
    }
    this.#packs.set(pack.id, pack);
    // Invalidate AND notify. Registration at boot happens before anything
    // subscribes, so this is free there — but a pack registered at runtime
    // (the peeled-app install path) must repaint subscribers, and a snapshot
    // dropped without notification is a repaint that never happens.
    this.#invalidate();
    return this;
  }

  packs(kind?: AnyPackage["type"]): AnyPackage[] {
    const all = [...this.#packs.values()];
    return (kind ? all.filter((p) => p.type === kind) : all).sort((a, b) =>
      a.id.localeCompare(b.id)
    );
  }

  pack(id: string): AnyPackage | undefined {
    return this.#packs.get(id);
  }

  problems(): readonly PackProblem[] {
    return this.#problems;
  }

  /* ------------------------------ activation ----------------------------- */

  /**
   * SELECT a pack by id, or clear its slot with `null`. The slot is inferred
   * from the pack's own type, so a caller cannot put a logo pack in the style
   * slot — the kind is data on the pack, not an argument that can be wrong.
   *
   * This is the user's move: it outranks the app's default for that slot and is
   * saved immediately. Code that is stating what the app ships with wants
   * {@link activateDefault} instead — see the two tiers in the file docblock.
   */
  activate(id: string | null, kind?: Slot): this {
    if (id === null) {
      if (!kind) throw new Error("activate(null) needs a kind to know which slot to clear");
      return this.#choose(kind, null);
    }
    const pack = this.#packs.get(id);
    if (!pack) {
      this.#problems.push({ pack: id, problem: "activated but not registered" });
      return this;
    }
    return this.#choose(pack.type, id);
  }

  /**
   * Offer a pack as the APP's default for its slot — what is in force when the
   * user has not selected anything for it.
   *
   * Nothing is written: a default is code, re-applied on every boot by whatever
   * declared it. And it does not displace a stored selection, which is the
   * whole reason this is a separate call — Studio's `start()` and the console
   * wrapper's look both run AFTER the registry has restored, so as plain
   * activations they overwrote the user's choice on every single load.
   */
  activateDefault(id: string): this {
    const pack = this.#packs.get(id);
    if (!pack) {
      this.#problems.push({ pack: id, problem: "offered as a default but not registered" });
      return this;
    }
    this.#default[pack.type] = id;
    this.#invalidate("all");
    return this;
  }

  /**
   * Forget the stored selection for a slot, so the app's default governs it
   * again. The way back — without it, one click in a gallery permanently opts
   * a slot out of whatever the app decides its identity should be.
   */
  clearChoice(kind: Slot): this {
    if (!this.#chosen.delete(kind)) return this;
    this.#persist();
    this.#invalidate("effective");
    return this;
  }

  #choose(slot: Slot, id: string | null): this {
    this.#chosen.set(slot, id);
    this.#persist();
    this.#invalidate("effective");
    return this;
  }

  /* ----------------------------- persistence ----------------------------- */

  #persist(): void {
    const chosen: Partial<Record<Slot, string | null>> = {};
    for (const slot of SLOTS) {
      if (this.#chosen.has(slot)) chosen[slot] = this.#chosen.get(slot) ?? null;
    }
    const record = JSON.stringify({ chosen } satisfies PersistedPacks);
    try {
      this.#storage.write(PACKS_KEY, record);
    } catch {
      /* storage full or unavailable — the identity still applies */
    }
    this.#mirrorToCookie(record);
  }

  /**
   * Mirror the selection into a cookie so the SERVER renders this identity
   * instead of the default — see `PACKS_COOKIE` for why the drawings need it
   * and the variables did not.
   *
   * Written separately from `#storage` on purpose: storage is injectable and
   * the tests substitute it, while this is a real browser side effect that must
   * be a no-op everywhere else. A failure here costs the first paint of the
   * next load, never the preference — `localStorage` above already holds it.
   *
   * `SameSite=Lax` because this is only ever read by the app's own document
   * request, and one year because a brand choice is not a session.
   */
  #mirrorToCookie(record: string): void {
    if (typeof document === "undefined") return;
    try {
      document.cookie =
        `${PACKS_COOKIE}=${encodeURIComponent(record)}; path=/; max-age=31536000; SameSite=Lax`;
    } catch {
      /* cookies disabled — the next first paint uses the defaults, as before */
    }
  }

  /**
   * Read the stored selection back, in the constructor, so it is in force
   * BEFORE the first render rather than arriving as a correction.
   *
   * Ids are not checked against the registry here because nothing is
   * registered yet — that check is `ResolvedStyle.unresolved`, computed when a
   * snapshot is taken. A corrupt or half-written record starts from the
   * defaults, the theme store's recovery posture: refusing to boot over an
   * unreadable preference file is worse than the preference being lost.
   */
  #restore(): void {
    try {
      const raw = this.#storage.read(PACKS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<PersistedPacks>;
      const chosen = parsed?.chosen;
      if (!chosen || typeof chosen !== "object") return;
      for (const slot of SLOTS) {
        if (!Object.prototype.hasOwnProperty.call(chosen, slot)) continue;
        const id = chosen[slot];
        if (id !== null && typeof id !== "string") continue;
        this.#chosen.set(slot, id);
      }
      // BACKFILL the cookie mirror for a selection made before the mirror
      // existed — without this, an operator who chose a pack last week keeps
      // the flash forever, because the cookie is only written by `#persist()`
      // and they have no reason to pick the same pack again. Their FIRST load
      // after this ships still flashes (the cookie is written during it, too
      // late for its own server render) and every load after is correct.
      //
      // Unconditional rather than "only if the cookie is missing": rewriting
      // an identical value costs nothing, and a cookie that disagrees with
      // storage is the mismatch `serverResolved` exists to prevent — storage is
      // the source of truth, so it wins here by construction.
      if (this.#chosen.size) this.#mirrorToCookie(raw);
    } catch {
      this.#chosen.clear();
    }
  }

  /**
   * Drop the cached snapshot and notify.
   *
   * `"effective"` leaves the SERVER snapshot alone, and that is deliberate:
   * it must keep returning the identity the server actually rendered for the
   * whole hydration pass, and a user selection cannot have reached the server.
   * Registration and defaults change what the server resolved too, so those
   * invalidate both.
   */
  #invalidate(scope: "effective" | "all" = "all"): void {
    this.#snapshot = null;
    if (scope === "all") this.#serverSnapshot = null;
    for (const listener of this.#listeners) listener();
  }

  /** `useSyncExternalStore` subscribe. */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /**
   * `useSyncExternalStore` snapshot. Cached until something changes, because
   * the hook requires a stable reference between renders — recomputing on every
   * call is an infinite render loop, not a performance note.
   */
  resolved = (): ResolvedStyle => {
    // explicit selection → the app's default. Two tiers, no more.
    //
    // A third tier — the theme's own `brandingPack`/`logoPack` dials — lived
    // between them until 2026-08-12 and was REMOVED with the dials themselves:
    // branding is an app setting now, never part of a theme, so a theme has no
    // say in which pack draws. `#chosen` holding an explicit `null` still means
    // *the person cleared this slot on purpose*, distinct from an absent key
    // (never chosen, the default applies).
    this.#snapshot ??= this.#resolve(
      (slot) =>
        this.#chosen.has(slot) ? (this.#chosen.get(slot) ?? null) : this.#default[slot],
      SLOTS.filter((slot) => this.#chosen.has(slot))
    );
    return this.#snapshot;
  };

  /**
   * The snapshot the SERVER renders, and the one the client HYDRATES with —
   * the app's defaults, with stored selections deliberately ignored.
   *
   * The same fix, for the same reason, as `ThemeStore.serverState`. `#restore()`
   * runs in the constructor at module scope, so by the first client render the
   * registry already holds the user's packs, while the server — which cannot
   * read `localStorage` — rendered the defaults. Every `<Glyph>` puts its pack's
   * SVG markup straight into the DOM, so a different pack is different markup,
   * and React answers a mismatch by throwing the server tree away and
   * re-rendering the whole app.
   *
   * `useSyncExternalStore`'s third argument is used for the server render AND
   * for the hydrating client render, then React re-reads `resolved()` and
   * schedules an update if it differs. So hydration matches by construction and
   * the stored identity lands one commit later as an ordinary update.
   *
   * Both runtimes compute this from `#default` PLUS the cookie mirror of the
   * selection (`PACKS_COOKIE`) — the only two things they can both read. The
   * cookie is why a chosen pack no longer swaps its drawings after hydration:
   * the server emits the chosen identity, the hydrating render computes the
   * same one from the same cookie, and there is nothing left to correct.
   *
   * `localStorage` is deliberately NOT consulted here even on the client. It is
   * the richer source, and using it would make the hydrating render disagree
   * with the server whenever the cookie were blocked, stale or trimmed — which
   * is the exact mismatch this method exists to prevent. A cookie the server
   * could not read simply means both sides fall back to `#default` together,
   * i.e. the old behaviour, which was correct-but-flashy rather than broken.
   */
  serverResolved = (): ResolvedStyle => {
    if (!this.#serverSnapshot) {
      const mirrored = this.#mirroredSelection();
      const slots = SLOTS.filter((slot) => mirrored[slot] != null);
      // Same two tiers as `resolved()`, and it has to be the same two or the
      // server would render a different identity from the client and every
      // glyph would swap after hydration — the exact failure PACKS_COOKIE
      // exists to have ended.
      this.#serverSnapshot = this.#resolve(
        (slot) => (slot in mirrored ? (mirrored[slot] ?? null) : this.#default[slot]),
        slots
      );
    }
    return this.#serverSnapshot;
  };

  /**
   * The selection as the COOKIE reports it, on either runtime.
   *
   * On the client it is parsed from `document.cookie`. On the server there is
   * no such object, so the request handler injects it with
   * `applyServerSelection()` before rendering.
   */
  #mirroredSelection(): Partial<Record<Slot, string | null>> {
    if (this.#serverSelection) return this.#serverSelection;
    if (typeof document === "undefined") return {};
    try {
      const hit = document.cookie
        .split("; ")
        .find((c) => c.startsWith(`${PACKS_COOKIE}=`));
      if (!hit) return {};
      const parsed = JSON.parse(decodeURIComponent(hit.slice(PACKS_COOKIE.length + 1))) as unknown;
      return readChosen(parsed);
    } catch {
      // A corrupt cookie falls back to the defaults, matching `#restore`'s
      // posture: a lost preference beats a page that refuses to render.
      return {};
    }
  }

  /**
   * Seed the selection the SERVER should render, from the request's cookie.
   *
   * Call once per request, before rendering, from the server layout — see
   * `app/layout.tsx`. Resets the memoised server snapshot so the next
   * `serverResolved()` reflects this request rather than the last one.
   *
   * **Process-global, and that is a real limitation.** The registry is a module
   * singleton, so two concurrent requests with DIFFERENT cookies can race: the
   * second seed wins and the first request renders the second's identity. That
   * is acceptable for a local single-operator studio on :3200 and is NOT
   * acceptable for a multi-user deployment. The fix when that day comes is to
   * make the snapshot request-scoped (React `cache()` or AsyncLocalStorage)
   * rather than to add a lock — recorded here so the next person does not have
   * to rediscover why it was safe when it was written.
   */
  applyServerSelection(chosen: unknown): this {
    this.#serverSelection = readChosen(chosen);
    this.#serverSnapshot = null;
    return this;
  }

  #resolve(pick: (slot: Slot) => string | null, chosen: readonly Slot[]): ResolvedStyle {
    const unresolved: string[] = [];
    const lookup = <T extends AnyPackage>(slot: Slot): T | undefined => {
      const id = pick(slot);
      if (!id) return undefined;
      const pack = this.#packs.get(id) as T | undefined;
      if (pack) return pack;
      unresolved.push(id);
      // A stored selection outlives the code, so it can name a pack that has
      // been renamed or removed. Leaving the slot empty would blank the brand
      // over a stale preference; the app's own default is the right floor, and
      // `unresolved` above is what stops the substitution being silent.
      const fallback = this.#default[slot];
      return fallback && fallback !== id ? (this.#packs.get(fallback) as T | undefined) : undefined;
    };

    const branding = lookup<BrandingPackage>("branding-package");
    const logos = lookup<LogoPackage>("logo-package");

    const palette = branding?.payload.palette ?? FALLBACK_PALETTE;

    const glyphs = new Map<string, GlyphEntry>();
    // Branding first, logos second: a logo pack's mark should win over the
    // generic one of the same id, because it is the more specific statement.
    for (const entry of entriesOf(branding)) glyphs.set(entry.id, entry);
    for (const entry of entriesOf(logos)) glyphs.set(entry.id, entry);

    return {
      brandingId: branding?.id ?? null,
      logoId: logos?.id ?? null,
      palette,
      glyphs,
      variables: this.#variables(palette),
      unresolved,
      chosen
    };
  }

  /**
   * The pack's published variables: the `--gxb-*` / `--axf-brand-*` roles its
   * drawings paint in, and NOTHING else.
   *
   * This used to also publish `--axf-accent`, the status colours and the four
   * surface roles, which handed a selected pack precedence over the theme's own
   * dials — the exact mechanism behind "I rolled a theme and nothing changed".
   * The theme owns every `--axf-*` value now, without exception; a pack is
   * drawings plus the fixed brand colours those drawings are painted in.
   */
  #variables(palette: BrandPalette): Record<string, string> {
    return { ...paletteVariables(palette) };
  }
}

/** The process-wide pack registry. */
export const packs = new PackRegistry();
