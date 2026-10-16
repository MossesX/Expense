/**
 * @file **The one persisted directory.** Every server-side root resolves here.
 *
 * INITIATION-PROMPT §2.2, which is a production fact rather than a preference:
 *
 * > The container filesystem is ephemeral. Exactly one persisted directory
 * > survives a redeploy. Every module declares its persisted paths under it;
 * > writing anywhere else is a bug a test should catch.
 *
 * Before this, six modules each wrote `path.join(process.cwd(), "data", …)`.
 * That happens to produce one directory, and "happens to" is the problem: the
 * seventh writer is one `path.join` away from landing outside the volume, and
 * the symptom is not an error — it is data that is present all session and gone
 * after the next deploy. `scripts/check-runtime-files.mjs` fails on a `cwd`-plus-
 * `data` join anywhere but this file, so the property is checked rather than
 * remembered.
 *
 * ## Read per call, never latched at import
 *
 * `src/modules/accounts/lib/paths.ts` set this rule first and its reasoning
 * carries: *"The env var is read per call, never latched at import, so tests and
 * a deploy env both take effect without ordering games."* A test that points
 * `AXS_DATA_ROOT` at a temp dir after the module graph is warm still gets the
 * temp dir. The consts below are the exception that proves it — they are the
 * existing exported shape, and a container sets its environment before node
 * starts, so they resolve correctly there; the FUNCTION is what new code and
 * tests should call.
 *
 * ## The per-module overrides still win
 *
 * `ACCOUNTS_DATA_DIR` and `AMBERXVID_DATA_DIR` predate this and are how the test
 * suites and the proof servers pin a store to a scratch directory. They stay,
 * and they outrank this: one env var for "where the volume is mounted", the
 * specific ones for "put this one store somewhere else". A deployment sets only
 * `AXS_DATA_ROOT`.
 */
import path from "node:path";

/**
 * The persisted root — `AXS_DATA_ROOT` if set, else `<cwd>/data`.
 *
 * The default is the string the six modules already used, so nothing about a
 * dev tree changes: same directory, same files, one place that names it.
 */
export function dataRoot(): string {
  const env = process.env.AXS_DATA_ROOT?.trim();
  return env ? path.resolve(env) : path.join(process.cwd(), "data");
}

/** A subtree of the persisted root. `dataPath("axf", "kv")` → `<root>/axf/kv`. */
export function dataPath(...segments: string[]): string {
  return path.join(dataRoot(), ...segments);
}
