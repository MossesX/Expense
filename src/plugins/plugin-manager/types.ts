/**
 * @file The plugin engine's vocabulary — isomorphic, imported by the page, the
 * commands, the server engine and the routes alike.
 *
 * Everything here is JSON-serialisable DATA, and none of it is NEW format. The
 * package is the zip `npm run pack` already builds (the asset's source
 * directory with its `manifest.json` at the archive root); the ledger is
 * `assets/registry.json` (`axf-asset-registry/1`), the document
 * `scripts/lib/registry-store.mjs` and `build/tools/asset_registry.py` both
 * write under one lock. The engine ADDS the runtime half the INITIATION spec
 * calls "one plugin artifact, two hosts" (§3): the same zip installs through
 * an HTTP route as through the pack script, into this SDK today and into a
 * compiled app when its host grows the same routes — which is exactly why
 * inventing a second manifest here would have been the wrong move.
 */

/** The asset-id fence `pack.mjs` holds (`/^[a-z][a-z0-9-]*$/`), restated for
 *  both sides of the HTTP boundary. An id becomes a path component on every
 *  host that unpacks a package. */
export const PLUGIN_ID_RE = /^[a-z][a-z0-9-]*$/;

/** The manifest's member name inside a package — at the archive ROOT, exactly
 *  where `pack.mjs` finds it in the source directory it zips. */
export const PLUGIN_MANIFEST_NAME = "manifest.json";

/** The u-asset kinds a PACKAGE may carry (INITIATION §4). `module` and
 *  `subsystem` are u-assets too but do not install through this engine — a
 *  module joins the suite manifest by hand, deliberately (§4.6). */
export const INSTALLABLE_KINDS = ["plugin", "extension", "add-on"] as const;
export type InstallableKind = (typeof INSTALLABLE_KINDS)[number];

/**
 * `src/plugins/<id>/manifest.json` — the shape `pack.mjs` validates and eight
 * plugins already carry. Field-for-field the same document; the type exists so
 * the engine and the page cannot drift from the script.
 */
export interface PluginManifest {
  readonly id: string;
  readonly kind: InstallableKind;
  readonly name: string;
  /** x.y.z */
  readonly version: string;
  readonly layer: "core" | "sdk";
  /** `core` | `universal` | `module:<id>` — required for installable kinds. */
  readonly target: string;
  /** Entry module relative to the plugin root, `plugin.ts` by convention —
   *  the ONE spelling the closure scanner reads (`scripts/lib/closure.mjs`). */
  readonly entry?: string;
  readonly summary?: string;
}

/** One entry in `assets/registry.json` — what `registerAsset` writes. */
export interface AssetRegistryEntry {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly version: string;
  readonly created: string;
  /** Relative to the assets root, forward-slashed; null when never archived. */
  readonly archive: string | null;
  readonly installed: string | null;
  readonly enabled: boolean;
  readonly layer?: string;
  readonly target?: string;
  readonly meta: Readonly<Record<string, unknown>>;
}

/**
 * How a file in a plugin's inventory came to be — the three groups the files
 * tab shows.
 *
 * - `source`: tracked in git and clean — the plugin as authored.
 * - `modified`: tracked in git and currently dirty — being worked on now.
 * - `generated`: untracked — produced at runtime (a kv document, a log, an
 *   emitted artifact). Never exported: a package carries what a plugin IS,
 *   not what it has accumulated.
 */
export type PluginFileKind = "source" | "modified" | "generated";

export interface PluginFileInfo {
  /** Repo-relative, forward-slashed — the same spelling the expenses scan
   *  returns and the diff browser links. */
  readonly path: string;
  readonly kind: PluginFileKind;
  readonly size: number;
  /** Epoch millis of the last modification. */
  readonly mtime: number;
}

export interface PluginInventory {
  readonly id: string;
  /** Repo-relative root of the plugin's source directory. */
  readonly root: string;
  readonly files: readonly PluginFileInfo[];
  /** True when the walk hit a structural cap and the list is incomplete. */
  readonly truncated: boolean;
  /** False when git was unavailable and source/modified could not be told
   *  apart — every tracked-looking file reports `source` then, and the UI
   *  says so rather than showing a complete-looking answer. */
  readonly gitAware: boolean;
  /** README.md content from the plugin root, for the docs tab. */
  readonly readme?: string;
}

/** What `GET /api/plugins` reports per on-disk plugin directory, joined
 *  client-side with the live registry's roster. */
export interface PluginDirReport {
  readonly id: string;
  /** True when `src/plugins/<id>/plugin.ts` exists — the file the closure
   *  scanner and the peel read. */
  readonly hasPluginEntry: boolean;
  /** Parsed `manifest.json`, when the directory carries one. */
  readonly manifest?: PluginManifest;
  /** A note instead of a manifest when the file exists but does not parse or
   *  validate — shown, never silently dropped. */
  readonly manifestProblem?: string;
  /** The `assets/registry.json` entry, when this asset is registered there. */
  readonly registered?: AssetRegistryEntry;
  /** True when the engine imported this plugin (its registration reaches the
   *  app through `installed.generated.ts` rather than static composition) —
   *  the only plugins the engine may uninstall or flip wholesale. */
  readonly imported: boolean;
}

export interface PluginListResponse {
  readonly plugins: readonly PluginDirReport[];
}

/** What the import route answers. */
export interface ImportResult {
  readonly id: string;
  readonly version: string;
  readonly files: number;
  /** Non-fatal observations — a missing `plugin.ts`, a `from` id that does not
   *  match the directory, a synthesized manifest. Shown to the operator. */
  readonly warnings: readonly string[];
  /** True when the app must recompile before the plugin registers (always,
   *  today: registration is a generated import the dev server picks up on the
   *  next compile, and a compiled app picks up on its next build). */
  readonly needsReload: boolean;
}
