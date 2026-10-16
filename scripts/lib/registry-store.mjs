/**
 * The persisted asset registry, Node side (INITIATION-PROMPT.md §4).
 *
 * `<assets root>/registry.json` is the document of record for every packaged
 * asset: id, kind, where its archive zip is, where its installed files are,
 * and the `enabled` flag — which is the ONLY thing a state flip touches; files
 * never move on enable/disable.
 *
 * This document has two writers in two languages: `scripts/pack.mjs` registers
 * here, and `build/tools/asset_registry.py` is the Python writer builds use.
 * Both do a read-modify-write of one JSON file, so both take ONE lock — the
 * same lock file, by the same rules (10s patience, 60s staleness), so a Python
 * registration and a Node registration exclude each other, not just their own
 * language. GizmoX proved the failure this prevents: twelve simultaneous
 * writers against unlocked code left ONE survivor.
 *
 * The core runtime `Registry` (packages/core/src/registry.ts) stays in-memory
 * and is not this: that one is what a booted app knows, this one is what is
 * installed on disk. Framework tooling per INITIATION §0.1 — zero
 * dependencies, `node:fs` only.
 */
import fs from "node:fs";
import path from "node:path";

/** Format tag on the registry document — versioned like `axf-peel/1`. */
export const REGISTRY_FORMAT = "axf-asset-registry/1";

/** How long a writer waits for the lock, and how old a lock file must be
 *  before it is assumed abandoned. MUST match the Python writer exactly —
 *  two writers with different staleness rules break each other's live locks. */
export const LOCK_TIMEOUT_MS = 10_000;
export const LOCK_STALE_MS = 60_000;

// `import.meta.dirname` under plain Node; under a BUNDLER (the plugin
// engine's routes import this file into the Next server) it is undefined, so
// fall back the way `src/server/paths.ts` does: the `AXF_ROOT` env, then
// cwd/../.. — `next dev`, `next start` and `node --test` all run with
// `packages/studio` as cwd.
const AXF_ROOT = import.meta.dirname
  ? path.resolve(import.meta.dirname, "..", "..", "..", "..")
  : process.env.AXF_ROOT ?? path.resolve(process.cwd(), "..", "..");

/**
 * The assets root. `AXF_ASSETS_ROOT` (core-namespaced env, per §5.1 tier 2)
 * overrides for tests and alternate roots; the default is `<root>/assets`,
 * resolved from this file's location so the tooling works from any cwd.
 */
export function assetsRoot() {
  const env = process.env.AXF_ASSETS_ROOT;
  if (env && path.isAbsolute(env)) return env;
  return path.join(AXF_ROOT, "assets");
}

export function registryPath(root = assetsRoot()) {
  return path.join(root, "registry.json");
}

function lockPath(root) {
  return `${registryPath(root)}.lock`;
}

/** Block the thread briefly; the critical section is measured in milliseconds. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Run `fn` holding exclusive access to the registry file.
 *
 * Wrap the WHOLE read-modify-write, never just the save: locking the write
 * alone still lets two writers load the same base document, and the second
 * save drops the first one's entry — an atomic save of a stale document is
 * atomically wrong.
 *
 * The lock is an O_CREAT|O_EXCL file beside the registry — dependency-free,
 * atomic on every filesystem this runs on, and language-neutral, which is the
 * property that matters: the Python writer takes the identical file by the
 * identical rules.
 */
export function withRegistryLock(fn, root = assetsRoot()) {
  const lock = lockPath(root);
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  for (;;) {
    try {
      fs.writeFileSync(lock, `${process.pid} ${new Date().toISOString()}\n`, { flag: "wx" });
      break;
    } catch (err) {
      const code = err?.code;
      // EPERM/EACCES: Windows answers access-denied rather than EEXIST while
      // the lock sits in a delete-pending state — a writer released it
      // microseconds ago and the last handle has not closed. Contention; retry.
      if (code !== "EEXIST" && code !== "EPERM" && code !== "EACCES") throw err;

      let heldMs = 0;
      try {
        heldMs = Date.now() - fs.statSync(lock).mtimeMs;
      } catch {
        heldMs = 0; // vanished underneath us — retry immediately
      }
      if (heldMs > LOCK_STALE_MS) {
        try {
          fs.unlinkSync(lock); // a process died holding it; do not wedge forever
        } catch {
          /* someone else broke it first */
        }
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `asset registry is locked by another process (${lock}, held ` +
            `${(heldMs / 1000).toFixed(1)}s) — gave up after ${LOCK_TIMEOUT_MS / 1000}s`
        );
      }
      sleepSync(50);
    }
  }

  try {
    return fn();
  } finally {
    try {
      fs.unlinkSync(lock);
    } catch {
      /* already gone */
    }
  }
}

/** Load the registry document, empty if it does not exist yet. */
export function loadRegistry(root = assetsRoot()) {
  const file = registryPath(root);
  if (!fs.existsSync(file)) return { format: REGISTRY_FORMAT, assets: [] };
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  doc.format ??= REGISTRY_FORMAT;
  doc.assets ??= [];
  return doc;
}

/**
 * Write the registry atomically: a per-process temp file, then a rename.
 * The temp name carries the pid because a single shared `.tmp` is fatal on
 * Windows — one writer holds it open while another renames it, and the loser
 * dies with EPERM instead of writing.
 */
export function saveRegistry(doc, root = assetsRoot()) {
  const file = registryPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

/**
 * Register (or upsert) an asset entry and persist — the whole load-splice-save
 * as one critical section under the lock. An existing entry with the same id
 * is replaced, keeping its original `created` stamp: re-packing an asset is a
 * refresh, not a new asset.
 *
 * Paths (`archive`, `installed`) are stored RELATIVE TO THE ASSETS ROOT with
 * forward slashes, so the document survives the root moving — which it will:
 * the port happened (2026-08-11), and tests point the root at temp dirs.
 */
export function registerAsset(fields, root = assetsRoot()) {
  const { id, kind, name } = fields;
  for (const [key, value] of Object.entries({ id, kind, name })) {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`registerAsset: "${key}" is required and must be a non-empty string (got ${JSON.stringify(value)})`);
    }
  }

  return withRegistryLock(() => {
    const doc = loadRegistry(root);
    const existing = doc.assets.find((a) => a.id === id);
    const entry = {
      id,
      kind,
      name,
      version: fields.version || "0.1.0",
      created: fields.created ?? existing?.created ?? new Date().toISOString(),
      archive: fields.archive ?? null,
      installed: fields.installed ?? null,
      enabled: fields.enabled ?? true,
      ...(fields.layer ? { layer: fields.layer } : {}),
      ...(fields.target ? { target: fields.target } : {}),
      meta: fields.meta ?? {}
    };
    doc.assets = doc.assets.filter((a) => a.id !== id);
    doc.assets.push(entry);
    saveRegistry(doc, root);
    return entry;
  }, root);
}

export function getAsset(id, root = assetsRoot()) {
  return loadRegistry(root).assets.find((a) => a.id === id) ?? null;
}

/**
 * Flip the enabled switch — the ONLY thing a state flip does. Files never
 * move, and nothing but this one field changes. Returns false if unregistered.
 */
export function setEnabled(id, enabled, root = assetsRoot()) {
  return withRegistryLock(() => {
    const doc = loadRegistry(root);
    const entry = doc.assets.find((a) => a.id === id);
    if (!entry) return false;
    entry.enabled = Boolean(enabled);
    saveRegistry(doc, root);
    return true;
  }, root);
}
