/**
 * @file The plugin engine — the server half of the Plugin Manager.
 *
 * Node-only (`node:fs`, `node:child_process`); imported by the `/api/plugins`
 * routes and by nothing client-side — the page talks to it over HTTP and
 * shares only `./types`. The `.server.ts` suffix states that, the way
 * `forge.server.ts` and `agents.server.ts` do.
 *
 * WHAT IT REUSES, deliberately: the ledger is `assets/registry.json` through
 * `scripts/lib/registry-store.mjs` — the same document, the same lock, the
 * same rules as `npm run pack` and the Python writer, because a second ledger
 * would be a second truth. The package is the zip `pack.mjs` builds (source
 * dir contents, `manifest.json` at the root), so one artifact serves the
 * script, this engine, and a compiled app's engine — INITIATION §3's "one
 * plugin artifact, two hosts".
 *
 * TWO HOSTS, ONE FILE: this exact file is vendored into every peeled app by
 * `scripts/peel.mjs`, alongside `zip.ts`, `types.ts`, `install.ts`, the
 * routes and `registry-store.mjs` — copied, not forked. That is why every
 * path here comes from {@link engineRoots}, resolved PER CALL rather than at
 * module load: the SDK's tree keeps its sources under `packages/studio/` and
 * its assets at the repo root, a peeled app keeps both under its own root,
 * and the two-host gate (`test/plugin-hosts.test.ts`) points one process at
 * both layouts in turn and asserts the same package installs identically.
 *
 * WHAT IT ADDS: the HTTP lifecycle (import, export, uninstall, flip), the
 * file inventory behind the files tab, and the generated loader
 * (`src/plugins/installed.generated.ts`) that makes an imported plugin REAL —
 * a static import per enabled plugin, compiled by the next dev-server compile
 * or app build. The engine never claims a hot install: `needsReload` is on
 * every import result because it is true.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { AXF_ROOT } from "../../server/paths";
import { badMemberName, packZip, readZip, type ZipEntry } from "../../server/zip";
import {
  getAsset,
  loadRegistry,
  registerAsset,
  saveRegistry,
  setEnabled,
  withRegistryLock
} from "../../../scripts/lib/registry-store.mjs";
import { loaderSource } from "../../../scripts/lib/loader-template.mjs";
import {
  INSTALLABLE_KINDS,
  PLUGIN_ID_RE,
  PLUGIN_MANIFEST_NAME,
  type AssetRegistryEntry,
  type ImportResult,
  type PluginDirReport,
  type PluginFileInfo,
  type PluginFileKind,
  type PluginInventory,
  type PluginManifest
} from "./types";

/** Mirrors `isKvName` in core `persist/kv.ts` — a ns becomes a filename. */
const KV_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
/** A decl route: `/`, `/plugins`, `/sandbox/panes`. */
const ROUTE_RE = /^\/[a-z0-9/-]*$/;
/** An entry module: relative, extensioned, same alphabet the zip fence holds. */
const ENTRY_RE = /^[a-zA-Z0-9._/-]+\.tsx?$/;

/** Same caps discipline as the expenses scan: a capped walk REPORTS the cap. */
const WALK_MAX_ENTRIES = 4000;
const WALK_MAX_DEPTH = 8;
const WALK_SKIP = new Set(["node_modules", ".next", ".git", ".venv", "dist", ".turbo"]);
const README_CAP = 64 * 1024;

/* ── the two-host root resolution ─────────────────────────────────────────── */

export interface EngineRoots {
  /** The host's own root — the repo in the SDK, the app dir in a peel. */
  readonly root: string;
  /** Where `src/`, `app/` and `data/` live under that root. */
  readonly studio: string;
  readonly pluginsRoot: string;
  readonly loaderFile: string;
  readonly kvLocal: string;
  /** The assets root the ledger, archives and installed copies live under. */
  readonly assets: string;
}

/**
 * Resolve the host's layout, per call. `AXF_ROOT`/`AXF_ASSETS_ROOT` env win
 * (the same overrides `paths.ts` and `registry-store.mjs` honour), then the
 * layout is probed: a root with `packages/studio/` under it is the SDK tree;
 * anything else (a peeled app) keeps `src/` and `data/` directly under its
 * root. Per call rather than per module-load so one process can serve — and
 * one test can PROVE — both hosts.
 */
export function engineRoots(): EngineRoots {
  const envRoot = process.env.AXF_ROOT;
  const root = envRoot && path.isAbsolute(envRoot) ? envRoot : AXF_ROOT;
  const sdkStudio = path.join(root, "packages", "studio");
  const studio = fs.existsSync(sdkStudio) ? sdkStudio : root;
  const envAssets = process.env.AXF_ASSETS_ROOT;
  const assets = envAssets && path.isAbsolute(envAssets) ? envAssets : path.join(root, "assets");
  const pluginsRoot = path.join(studio, "src", "plugins");
  return {
    root,
    studio,
    pluginsRoot,
    loaderFile: path.join(pluginsRoot, "installed.generated.ts"),
    kvLocal: path.join(studio, "data", "axf", "kv", "local"),
    assets
  };
}

/** An engine refusal with the HTTP status it deserves — routes translate,
 *  never re-diagnose. */
export class EngineError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function checkedPluginId(id: string): string {
  if (!PLUGIN_ID_RE.test(id)) {
    throw new EngineError(400, `"${id}" is not a valid plugin id`);
  }
  return id;
}

/** Resolve-then-contain — the house idiom, stated once here. */
function contained(root: string, rel: string): string {
  const resolved = path.resolve(root, rel);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new EngineError(400, `path escapes its root: ${rel}`);
  }
  return resolved;
}

function relToRoot(R: EngineRoots, abs: string): string {
  return path.relative(R.root, abs).split(path.sep).join("/");
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/* ── manifest validation — pack.mjs's rules, importable ───────────────────── */

const TARGET_RE = /^(core|universal|module:[a-z][a-z0-9-]*)$/;
const LAYERS = new Set(["core", "sdk"]);

/**
 * The same checks `pack.mjs` runs, returning problems rather than exiting —
 * the engine reports all of them at once, the way `validateContribution`
 * does. A package this refuses would fail `npm run pack` identically, which
 * is the compatibility being maintained.
 */
export function validatePluginManifest(m: unknown): string[] {
  const problems: string[] = [];
  if (typeof m !== "object" || m === null) return ["manifest is not an object"];
  const man = m as Record<string, unknown>;
  if (typeof man.id !== "string" || !PLUGIN_ID_RE.test(man.id)) {
    problems.push(`manifest id ${JSON.stringify(man.id)} is not a valid asset id`);
  }
  if (!INSTALLABLE_KINDS.includes(man.kind as never)) {
    problems.push(
      `manifest kind ${JSON.stringify(man.kind)} does not install through this engine ` +
        `(${INSTALLABLE_KINDS.join(", ")} do; a module joins the suite manifest by hand, §4.6)`
    );
  }
  if (typeof man.name !== "string" || !man.name.trim()) problems.push("manifest has no name");
  if (typeof man.version !== "string" || !/^\d+\.\d+\.\d+/.test(man.version)) {
    problems.push(`manifest version ${JSON.stringify(man.version)} is not x.y.z`);
  }
  if (!LAYERS.has(man.layer as string)) {
    problems.push(`manifest layer ${JSON.stringify(man.layer)} must be "core" or "sdk"`);
  }
  if (typeof man.target !== "string" || !TARGET_RE.test(man.target)) {
    problems.push(
      `manifest target must be "core" | "universal" | "module:<id>" (got ${JSON.stringify(man.target)})`
    );
  }
  if (
    man.entry !== undefined &&
    (typeof man.entry !== "string" ||
      !ENTRY_RE.test(man.entry) ||
      // ENTRY_RE's alphabet admits dots and slashes, so `../x.ts` needs the
      // segment fence too — the zip member rule, applied to the one name that
      // becomes a generated import specifier.
      badMemberName(man.entry) !== null)
  ) {
    problems.push(`manifest entry ${JSON.stringify(man.entry)} is not a relative .ts/.tsx module`);
  }
  return problems;
}

/* ── listing ──────────────────────────────────────────────────────────────── */

export function listPluginDirs(): PluginDirReport[] {
  const R = engineRoots();
  let names: string[] = [];
  try {
    names = fs
      .readdirSync(R.pluginsRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
  const registryDoc = loadRegistry(R.assets) as { assets: AssetRegistryEntry[] };

  return names.map((id) => {
    const dir = path.join(R.pluginsRoot, id);
    const hasPluginEntry = fs.existsSync(path.join(dir, "plugin.ts"));
    let manifest: PluginManifest | undefined;
    let manifestProblem: string | undefined;
    const manifestPath = path.join(dir, PLUGIN_MANIFEST_NAME);
    if (fs.existsSync(manifestPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        const problems = validatePluginManifest(parsed);
        if (problems.length) manifestProblem = problems.join("; ");
        else manifest = parsed as PluginManifest;
      } catch (e) {
        manifestProblem = `manifest.json is not valid JSON: ${e instanceof Error ? e.message : e}`;
      }
    }
    const registered = registryDoc.assets.find((a) => a.id === id);
    return {
      id,
      hasPluginEntry,
      ...(manifest ? { manifest } : {}),
      ...(manifestProblem ? { manifestProblem } : {}),
      ...(registered ? { registered } : {}),
      imported: registered?.meta?.imported === true
    };
  });
}

/* ── the file inventory ───────────────────────────────────────────────────── */

interface WalkResult {
  files: { abs: string; size: number; mtime: number }[];
  truncated: boolean;
}

function walk(root: string): WalkResult {
  const out: WalkResult = { files: [], truncated: false };
  const visit = (dir: string, depth: number) => {
    if (out.truncated || depth > WALK_MAX_DEPTH) {
      out.truncated = out.truncated || depth > WALK_MAX_DEPTH;
      return;
    }
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable dir: skipped, not fatal — the forge scan's posture
    }
    for (const e of entries) {
      if (out.files.length >= WALK_MAX_ENTRIES) {
        out.truncated = true;
        return;
      }
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!WALK_SKIP.has(e.name)) visit(full, depth + 1);
      } else if (e.isFile()) {
        try {
          const st = fs.statSync(full);
          out.files.push({ abs: full, size: st.size, mtime: Math.round(st.mtimeMs) });
        } catch {
          /* raced away — skip */
        }
      }
    }
  };
  if (fs.existsSync(root)) visit(root, 0);
  return out;
}

/**
 * Ask git which of the root-relative paths are tracked, and which are dirty.
 * One spawn each for the whole inventory, never per file. A missing or
 * failing git — including the normal case of a deployed peeled app that is
 * no repository at all — degrades to `gitAware: false`: reported, not
 * guessed around.
 */
function gitClassify(
  gitRoot: string,
  repoRels: string[]
): {
  gitAware: boolean;
  tracked: Set<string>;
  dirty: Set<string>;
} {
  try {
    const run = (args: string[]) =>
      execFileSync("git", ["-C", gitRoot, ...args], {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true
      });
    const tracked = new Set(
      run(["ls-files", "-z", "--", ...(repoRels.length ? repoRels : ["."])])
        .split("\0")
        .filter(Boolean)
    );
    const dirty = new Set(
      run(["status", "--porcelain", "-z", "--", ...(repoRels.length ? repoRels : ["."])])
        .split("\0")
        .filter(Boolean)
        // porcelain -z rows are "XY <path>"; rename rows are followed by the
        // origin path as its own NUL field, which lacks the status prefix and
        // is filtered by the slice check below producing a harmless miss.
        .map((row) => row.slice(3))
    );
    return { gitAware: true, tracked, dirty };
  } catch {
    return { gitAware: false, tracked: new Set(), dirty: new Set() };
  }
}

/**
 * The three-group inventory behind the files tab. `ns` and `route` come from
 * the CLIENT — the registry knows a plugin's kv namespace and page route, the
 * server does not — and are fenced here exactly as any other incoming name:
 * refused, never sanitised.
 */
export function inventory(id: string, opts: { ns?: string; route?: string } = {}): PluginInventory {
  checkedPluginId(id);
  const R = engineRoots();
  const pluginDir = path.join(R.pluginsRoot, id);
  if (!fs.existsSync(pluginDir)) throw new EngineError(404, `no plugin directory "${id}"`);

  const roots: string[] = [pluginDir];

  if (opts.route !== undefined && opts.route !== "" && opts.route !== "/") {
    if (!ROUTE_RE.test(opts.route)) throw new EngineError(400, `"${opts.route}" is not a route`);
    const appDir = contained(path.join(R.studio, "app"), "." + opts.route);
    if (fs.existsSync(appDir)) roots.push(appDir);
  }

  const singles: string[] = [];
  if (opts.ns !== undefined && opts.ns !== "") {
    if (!KV_NAME_RE.test(opts.ns)) throw new EngineError(400, `"${opts.ns}" is not a kv namespace`);
    const kvFile = path.join(R.kvLocal, `${opts.ns}.json`);
    if (fs.existsSync(kvFile)) singles.push(kvFile);
  }

  let truncated = false;
  const found: { abs: string; size: number; mtime: number }[] = [];
  for (const root of roots) {
    const r = walk(root);
    truncated = truncated || r.truncated;
    found.push(...r.files);
  }
  for (const abs of singles) {
    try {
      const st = fs.statSync(abs);
      found.push({ abs, size: st.size, mtime: Math.round(st.mtimeMs) });
    } catch {
      /* raced away */
    }
  }

  const rels = found.map((f) => relToRoot(R, f.abs));
  const { gitAware, tracked, dirty } = gitClassify(R.root, [
    ...roots.map((r) => relToRoot(R, r)),
    ...singles.map((s) => relToRoot(R, s))
  ]);

  const files: PluginFileInfo[] = found
    .map((f, i) => {
      const rel = rels[i];
      let kind: PluginFileKind;
      if (!gitAware) kind = "source";
      else if (!tracked.has(rel)) kind = "generated";
      else if (dirty.has(rel)) kind = "modified";
      else kind = "source";
      return { path: rel, kind, size: f.size, mtime: f.mtime };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  let readme: string | undefined;
  const readmePath = path.join(pluginDir, "README.md");
  try {
    if (fs.existsSync(readmePath)) {
      readme = fs.readFileSync(readmePath, "utf8").slice(0, README_CAP);
    }
  } catch {
    /* unreadable readme is absence, not failure */
  }

  return {
    id,
    root: relToRoot(R, pluginDir),
    files,
    truncated,
    gitAware,
    ...(readme !== undefined ? { readme } : {})
  };
}

/* ── export ───────────────────────────────────────────────────────────────── */

/**
 * Build the package for a plugin directory — the same members `pack.mjs`
 * would zip. A plugin without a manifest gets one SYNTHESIZED into the
 * archive (marked as such in its summary) rather than a refusal: seven of the
 * fifteen live plugins predate the manifest convention, and "cannot export
 * half the roster" would make the manager a worse tool than the script it
 * extends. The synthesized file is in the zip only — the source tree is not
 * touched by an export.
 */
export function exportPlugin(id: string): { filename: string; data: Buffer; warnings: string[] } {
  checkedPluginId(id);
  const R = engineRoots();
  const dir = path.join(R.pluginsRoot, id);
  if (!fs.existsSync(dir)) throw new EngineError(404, `no plugin directory "${id}"`);

  const warnings: string[] = [];
  const { files, truncated } = walk(dir);
  if (truncated) throw new EngineError(500, `plugin "${id}" exceeds the walk caps — not exportable`);

  const entries: ZipEntry[] = files.map((f) => ({
    name: path.relative(dir, f.abs).split(path.sep).join("/"),
    data: fs.readFileSync(f.abs)
  }));

  let manifest: PluginManifest | undefined;
  const existing = entries.find((e) => e.name === PLUGIN_MANIFEST_NAME);
  if (existing) {
    try {
      const parsed = JSON.parse(existing.data.toString("utf8"));
      const problems = validatePluginManifest(parsed);
      if (problems.length) {
        throw new EngineError(422, `manifest.json does not validate: ${problems.join("; ")}`);
      }
      manifest = parsed as PluginManifest;
    } catch (e) {
      if (e instanceof EngineError) throw e;
      throw new EngineError(422, `manifest.json is not valid JSON`);
    }
  } else {
    manifest = {
      id,
      kind: "plugin",
      name: id,
      version: "0.0.0",
      layer: "sdk",
      target: "core",
      ...(fs.existsSync(path.join(dir, "plugin.ts")) ? { entry: "plugin.ts" } : {}),
      summary: `Synthesized by the plugin engine on export — ${id} carries no manifest.json of its own.`
    };
    warnings.push(
      `"${id}" has no manifest.json — a minimal one (version 0.0.0, target "core") was synthesized into the package`
    );
    entries.push({
      name: PLUGIN_MANIFEST_NAME,
      data: Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8")
    });
  }

  return {
    filename: `${id}-${manifest.version}.zip`,
    data: packZip(entries),
    warnings
  };
}

/* ── import ───────────────────────────────────────────────────────────────── */

/**
 * The pack lifecycle, over HTTP, from a zip built by this engine or by
 * `npm run pack` on any tree: validate the manifest, land the source in
 * `src/plugins/<id>/`, archive the zip and the installed copy under the assets
 * root, register in the shared ledger, regenerate the loader. Order is
 * deliberate — everything that can refuse, refuses before the first byte
 * lands in the source tree.
 */
export function importPlugin(buf: Buffer, opts: { overwrite?: boolean } = {}): ImportResult {
  const R = engineRoots();
  let entries: ZipEntry[];
  try {
    entries = readZip(buf);
  } catch (e) {
    throw new EngineError(400, e instanceof Error ? e.message : "unreadable archive");
  }
  if (!entries.length) throw new EngineError(400, "the archive is empty");

  const manifestEntry = entries.find((e) => e.name === PLUGIN_MANIFEST_NAME);
  if (!manifestEntry) {
    throw new EngineError(422, `the archive has no ${PLUGIN_MANIFEST_NAME} at its root`);
  }
  let manifest: PluginManifest;
  try {
    manifest = JSON.parse(manifestEntry.data.toString("utf8"));
  } catch {
    throw new EngineError(422, "manifest.json is not valid JSON");
  }
  const problems = validatePluginManifest(manifest);
  if (problems.length) {
    throw new EngineError(422, `manifest.json does not validate: ${problems.join("; ")}`);
  }

  const id = manifest.id;
  const warnings: string[] = [];

  const entryName = manifest.entry ?? "plugin.ts";
  const hasEntry = entries.some((e) => e.name === entryName);
  if (manifest.entry !== undefined && !hasEntry) {
    // A declared entry the archive does not contain would become a generated
    // import of a missing module — a broken compile for the WHOLE app, which
    // an installer may never cause.
    throw new EngineError(422, `manifest entry "${manifest.entry}" is not in the archive`);
  }
  if (!hasEntry) {
    warnings.push(
      `no entry module ("${entryName}") — files will install but nothing registers at boot`
    );
  }
  if (hasEntry && entryName !== "plugin.ts") {
    warnings.push(
      `entry is "${entryName}" — the peel's closure scanner reads only plugin.ts, so a module ` +
        `peel will not carry this plugin`
    );
  }

  const destDir = contained(R.pluginsRoot, id);
  const existed = fs.existsSync(destDir);
  if (existed && !opts.overwrite) {
    throw new EngineError(409, `plugin "${id}" already exists — re-send with overwrite to replace it`);
  }

  // Everything that can refuse has refused; now the writes, most reversible
  // first. The replaced source dir is archived, never deleted.
  if (existed) {
    const backup = path.join(R.assets, "archive", "plugin", `${id}.replaced-${stamp()}`);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.cpSync(destDir, backup, { recursive: true });
    fs.rmSync(destDir, { recursive: true, force: true });
    warnings.push(`the previous "${id}" was archived to ${relToRoot(R, backup)}`);
  }

  const writeTree = (base: string) => {
    for (const e of entries) {
      const dest = contained(base, e.name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, e.data);
    }
  };
  fs.mkdirSync(destDir, { recursive: true });
  writeTree(destDir);

  // The assets-root record: archive zip + installed copy + ledger entry —
  // the same three artifacts `pack.mjs` leaves, in the same places.
  const zipRel = `archive/${manifest.kind}/${id}-${manifest.version}.zip`;
  const zipAbs = path.join(R.assets, ...zipRel.split("/"));
  fs.mkdirSync(path.dirname(zipAbs), { recursive: true });
  const zipTmp = `${zipAbs}.${process.pid}.tmp`;
  fs.writeFileSync(zipTmp, buf);
  fs.renameSync(zipTmp, zipAbs);

  const installedRel = `installed/${manifest.kind}/${id}`;
  const installedAbs = path.join(R.assets, ...installedRel.split("/"));
  fs.rmSync(installedAbs, { recursive: true, force: true });
  fs.mkdirSync(installedAbs, { recursive: true });
  writeTree(installedAbs);

  registerAsset(
    {
      id,
      kind: manifest.kind,
      name: manifest.name,
      version: manifest.version,
      archive: zipRel,
      installed: installedRel,
      enabled: true,
      layer: manifest.layer,
      target: manifest.target,
      meta: {
        ...(manifest.summary ? { summary: manifest.summary } : {}),
        ...(hasEntry ? { entry: entryName } : {}),
        imported: true,
        importedTo: `src/plugins/${id}`
      }
    },
    R.assets
  );

  regenerateLoader();

  return { id, version: manifest.version, files: entries.length, warnings, needsReload: true };
}

/* ── uninstall / flip ─────────────────────────────────────────────────────── */

function importedEntryOf(R: EngineRoots, id: string): AssetRegistryEntry {
  checkedPluginId(id);
  const entry = getAsset(id, R.assets) as AssetRegistryEntry | null;
  if (!entry) throw new EngineError(404, `"${id}" is not in the asset registry`);
  if (entry.meta?.imported !== true) {
    throw new EngineError(
      400,
      `"${id}" is statically composed (studio.subsystem.ts imports it) — the engine only ` +
        `uninstalls plugins it imported. Remove built-ins in source, where their registration is.`
    );
  }
  return entry;
}

/**
 * Uninstall an IMPORTED plugin: archive its source dir, drop the installed
 * copy, remove its ledger entry, regenerate the loader. The archive zip stays
 * — it is the record that this plugin existed, and the file a re-import
 * takes.
 */
export function uninstallPlugin(id: string): { id: string; archivedTo: string | null } {
  const R = engineRoots();
  importedEntryOf(R, id);
  const srcDir = path.join(R.pluginsRoot, id);
  let archivedTo: string | null = null;
  if (fs.existsSync(srcDir)) {
    const backup = path.join(R.assets, "archive", "plugin", `${id}.uninstalled-${stamp()}`);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.cpSync(srcDir, backup, { recursive: true });
    fs.rmSync(srcDir, { recursive: true, force: true });
    archivedTo = relToRoot(R, backup);
  }
  fs.rmSync(path.join(R.assets, "installed", "plugin", id), { recursive: true, force: true });

  withRegistryLock(() => {
    const doc = loadRegistry(R.assets) as { assets: AssetRegistryEntry[] };
    doc.assets = doc.assets.filter((a) => a.id !== id);
    saveRegistry(doc, R.assets);
  }, R.assets);

  regenerateLoader();
  return { id, archivedTo };
}

/**
 * Flip an imported plugin. The ledger flag flips exactly as
 * `asset_registry.py enable|disable` flips it — no file moves — and the
 * loader regenerates so the flip is real at the next compile. Built-in
 * plugins with an `enabledKey` flip client-side through their own settings
 * store instead; this function refuses them so there is never a second
 * switch.
 */
export function setImportedEnabled(id: string, enabled: boolean): { id: string; enabled: boolean } {
  const R = engineRoots();
  importedEntryOf(R, id);
  setEnabled(id, enabled, R.assets);
  regenerateLoader();
  return { id, enabled };
}

/* ── the generated loader ─────────────────────────────────────────────────── */

/**
 * Rewrite `src/plugins/installed.generated.ts` from the ledger: one static
 * import per enabled imported plugin whose directory and entry module are
 * actually on disk. Deterministic (sorted by id), atomic (tmp + rename), and
 * honest about absences — a ledger entry whose files are gone is SKIPPED and
 * named in a comment, not imported into a broken compile.
 */
export function regenerateLoader(): void {
  const R = engineRoots();
  const doc = loadRegistry(R.assets) as { assets: AssetRegistryEntry[] };
  const rows: { id: string; specifier: string }[] = [];
  const skipped: string[] = [];
  for (const a of [...doc.assets].sort((x, y) => x.id.localeCompare(y.id))) {
    if (a.meta?.imported !== true || !a.enabled) continue;
    const entry = typeof a.meta?.entry === "string" ? (a.meta.entry as string) : null;
    if (!entry || !ENTRY_RE.test(entry) || badMemberName(entry)) {
      skipped.push(`${a.id} (no usable entry)`);
      continue;
    }
    const entryAbs = path.join(R.pluginsRoot, a.id, ...entry.split("/"));
    if (!fs.existsSync(entryAbs)) {
      skipped.push(`${a.id} (entry ${entry} missing on disk)`);
      continue;
    }
    rows.push({ id: a.id, specifier: `./${a.id}/${entry.replace(/\.tsx?$/, "")}` });
  }

  const tmp = `${R.loaderFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, loaderSource(rows, skipped), "utf8");
  fs.renameSync(tmp, R.loaderFile);
}
