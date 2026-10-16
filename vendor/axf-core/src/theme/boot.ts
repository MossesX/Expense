/**
 * @file The pre-paint theme publisher — a blocking `<head>` script.
 *
 * (Imports `PACKS_KEY` from the brand layer rather than repeating the string:
 * the pack selection is part of this script's signature as of 2026-08-10, and a
 * second copy of that key would fail SILENTLY and permanently — the script
 * would read nothing, every signature would mismatch, and the flash this file
 * exists to remove would come back with no error anywhere. `brand/packs` does
 * not import the theme layer, so there is no cycle.)
 *
 * ## What it is for
 *
 * The stored theme lives in `localStorage`, which the server cannot read, so
 * the document arrives painted in the DEFAULT theme and the client corrects it
 * after hydration. The owner's report of it: *"when I click a nav menu item a
 * theme loads quick for 1 second before rendering the theme that sticks."*
 *
 * Making the markup theme-independent (`derived.ts`, `Toolbar`, `NavMenu`) is
 * what stops React discarding the tree. It does NOT stop the flash on its own,
 * because the variables those markups resolve against are still the default
 * ones until `AxfStyleRoot` publishes in a layout effect — after the first
 * paint. The only place a value can be written EARLIER than that is a
 * synchronous script in `<head>`, which the browser runs before it paints
 * anything. Hence this.
 *
 * ## Why it applies a cache instead of recomputing
 *
 * The stored theme is a six-character SEED, and turning a seed into variables
 * means the generator, the spec, the derivations, the colour maths and the
 * active brand pack — the whole engine, inlined into the head of every
 * document. So `AxfStyleRoot` writes the variables it resolved into a second
 * key, and this script replays them. Publishing stays in one place; this only
 * ever repeats an answer that publisher already computed.
 *
 * ## Why the cache is signed
 *
 * A cache that can be stale is a cache that paints the wrong theme confidently.
 * The signature is the persisted `{seed, options, overrides}` this variable set
 * was resolved FROM; if it does not match what is in the theme record right
 * now, the script applies nothing and the server-rendered default block stands.
 * A default first paint corrected on hydration is exactly what the code did
 * before, so the failure mode of this optimisation is the behaviour it
 * replaces — never a wrong theme that persists.
 *
 * It is deliberately not a `<style>` tag: `AxfStyleRoot` writes the same
 * properties onto `documentElement.style`, and one writer beating the other in
 * the cascade is the two-publishers bug `resolve.ts` exists to have ended.
 * Writing to the same place means the publisher simply diffs against what is
 * already there and touches nothing.
 */

/** The key `ThemeStore` persists under. */
import { PACKS_KEY } from "../brand/packs";

export const THEME_KEY = "axf:theme@1";

/** The key the resolved variables are cached under, for this script. */
export const THEME_VARS_KEY = "axf:theme-vars@1";

/**
 * The cookie mirror of the applied theme — what the SERVER renders from.
 *
 * ## Why a cookie exists at all, when a boot script already runs
 *
 * The boot script fixes custom properties, and that is everything a `token()`
 * surface needs. It is NOT everything MUI needs. `mui.ts` deliberately refused
 * `cssVariables` mode (MUI runs `alpha()`/`darken()`/`getContrastRatio()` over
 * palette entries and needs real values), so an MUI palette is resolved in JS
 * and **serialised into the SSR'd emotion CSS as literal hex**. Literals in
 * already-painted markup cannot be corrected by anything that runs later —
 * which is precisely the argument `PACKS_COOKIE` makes for pack drawings:
 *
 *   > A pack's drawings are markup, so unlike the theme variables they cannot
 *   > be corrected by the pre-paint boot script — the server has to emit the
 *   > right ones or every glyph swaps after hydration.
 *
 * An MUI palette is markup by that definition. So it gets the same remedy: the
 * one thing the server can read.
 *
 * ## Why this is not the same job as `THEME_VARS_KEY`
 *
 * The vars cache is an OPTIMISATION whose failure mode is the old behaviour.
 * This is a CORRECTNESS input: without it the server has no way to emit the
 * applied palette, and `MuiBridge`'s layout effect can only repair the flash
 * after hydration — which is the ~1s the owner reported on 2026-08-12. They
 * are also written at different moments, and that is the point: the cookie
 * tracks what is APPLIED, never what a designer is previewing.
 *
 * Deliberately small — seed, options and overrides only, never history — because
 * a cookie rides on every request to the origin and history is up to 64 seeds
 * of dead weight the server has no use for.
 */
export const THEME_COOKIE = "axf_theme";

/** The applied theme, in the shape both sides reconstruct values from. */
export interface ThemeRecord {
  readonly seed: string | null;
  readonly options: Readonly<Record<string, unknown>>;
  readonly overrides: Readonly<Record<string, string | number>>;
}

/**
 * Parse a `THEME_COOKIE` value into a record, or null if it is unusable.
 *
 * Null on anything doubtful, deliberately: the caller's fallback is
 * `defaultValues()`, which is the behaviour that shipped before this cookie
 * existed. A half-parsed record would paint a theme nobody chose and persist
 * that mistake for as long as the cookie lives.
 */
export function parseThemeCookie(raw: string | null | undefined): ThemeRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as Partial<ThemeRecord> | null;
    if (!parsed || typeof parsed !== "object") return null;
    const seed = typeof parsed.seed === "string" ? parsed.seed : null;
    // A record with no seed and no overrides IS the default theme. Returning it
    // rather than null costs nothing and keeps "cookie present" meaning "the
    // server knows", so a deliberate reset is not mistaken for a missing mirror.
    return {
      seed,
      options: (parsed.options ?? {}) as Readonly<Record<string, unknown>>,
      overrides: (parsed.overrides ?? {}) as Readonly<Record<string, string | number>>
    };
  } catch {
    return null;
  }
}

/**
 * Serialise a record for `document.cookie`.
 *
 * `SameSite=Lax` and a year, matching `PACKS_COOKIE` exactly — two mirrors of
 * the same app state expiring on different schedules is a pack and a palette
 * that disagree after a gap, which is the half-light/half-dark bug again.
 */
export function themeCookieValue(record: ThemeRecord): string {
  const payload = encodeURIComponent(
    JSON.stringify({ seed: record.seed, options: record.options, overrides: record.overrides })
  );
  return `${THEME_COOKIE}=${payload}; path=/; max-age=31536000; SameSite=Lax`;
}

/** What `AxfStyleRoot` caches: the variables, and what they were resolved from. */
export interface CachedVariables {
  /** `JSON.stringify` of the persisted `{seed, options, overrides}`. */
  readonly sig: string;
  readonly vars: Readonly<Record<string, string>>;
}

/**
 * The signature of a persisted theme record **and the pack selection**.
 *
 * Reads the raw persisted JSON rather than the store's state, because that is
 * what the boot script can see — computing it from anything richer would mean
 * the two sides could agree in memory and disagree on disk.
 *
 * ## Why the pack selection is in here (2026-08-10)
 *
 * The cached variables are resolved from the theme dials AND the active style
 * pack — `AxfStyleRoot` composes both through `resolveVariables`. A signature
 * covering only the dials therefore could not tell "same dials, different pack"
 * from "same everything", so a cache written under one pack was replayed under
 * another and the script confidently painted the wrong identity before the
 * first frame.
 *
 * It only ever worked by accident: the cache is rewritten on every publish, so
 * a pack swap normally overwrote it before the next load. Anything that broke
 * that ordering — a swap in a second tab, a crash between swap and publish,
 * storage that rejected the write — left a cache the signature swore was valid.
 *
 * `packsPersisted` is optional so a caller with no pack selection (there is no
 * `axf:packs@1` until something other than the default is chosen) produces the
 * same signature it always did for the default case.
 */
export function themeSignature(persisted: unknown, packsPersisted?: unknown): string {
  const p = (persisted ?? {}) as {
    seed?: unknown;
    options?: unknown;
    overrides?: unknown;
  };
  const k = (packsPersisted ?? {}) as { chosen?: unknown };
  return JSON.stringify([p.seed ?? null, p.options ?? {}, p.overrides ?? {}, k.chosen ?? {}]);
}

/**
 * The script source to inline in `<head>`, before anything paints.
 *
 * Kept as a string rather than a real function stringified, because a bundler
 * is free to rename and to transpile a real function, and what ends up in the
 * head must be exactly what was written. It is small enough to read.
 *
 * Everything is inside a `try`: a private-mode browser, disabled storage or a
 * half-written value must produce the default theme, not a document that never
 * finishes parsing its head.
 */
export function themeBootScript(): string {
  return [
    "(function(){try{",
    `var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});`,
    `var c=localStorage.getItem(${JSON.stringify(THEME_VARS_KEY)});`,
    "if(!t||!c)return;",
    // The pack selection is part of what the variables were resolved FROM, so
    // it is part of the signature. Absent until something other than the app
    // default is chosen, and an absent selection must sign the same as an empty
    // one or every default-pack visitor loses their cache.
    `var g=localStorage.getItem(${JSON.stringify(PACKS_KEY)});`,
    "var q=g?JSON.parse(g):{};",
    "var p=JSON.parse(t),k=JSON.parse(c);",
    // The same shape `themeSignature` produces. Written out rather than shared,
    // because this string cannot import anything.
    "var s=JSON.stringify([p.seed||null,p.options||{},p.overrides||{},q.chosen||{}]);",
    "if(!k||k.sig!==s||!k.vars)return;",
    "var e=document.documentElement;",
    "for(var n in k.vars)e.style.setProperty(n,k.vars[n]);",
    "}catch(_){}})();"
  ].join("");
}
