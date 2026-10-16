/**
 * @file `GET /api/plugins` — the on-disk half of the plugin roster.
 *
 * Directories under `src/plugins/`, each with its manifest (validated, with
 * the problem REPORTED when it fails — a manifest that does not parse is a
 * fact about the plugin, not a reason to hide it), its `assets/registry.json`
 * entry when one exists, and whether the engine imported it. The page joins
 * this with the live registry client-side; neither side alone is the roster.
 *
 * A thin translation over `engine.server.ts`, the way every route here stays
 * thin over its `.server.ts` — the route speaks HTTP, the engine speaks
 * filesystem, and `EngineError` carries the status across.
 */
import { EngineError, listPluginDirs } from "../../../src/plugins/plugin-manager/engine.server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return Response.json({ plugins: listPluginDirs() });
  } catch (e) {
    if (e instanceof EngineError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json(
      { error: e instanceof Error ? e.message : "plugin listing failed" },
      { status: 500 }
    );
  }
}
