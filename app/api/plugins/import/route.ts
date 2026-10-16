/**
 * @file `POST /api/plugins/import` — install a plugin package.
 *
 * Body: the zip itself, raw (`content-type: application/zip`), the same
 * raw-buffer posture as the amberxvid recording upload. `?overwrite=1` lets a
 * re-import replace an existing directory — which the engine archives first,
 * never deletes.
 *
 * The package is the one artifact `npm run pack` builds and this engine's
 * export route serves: source dir contents, `manifest.json` at the root. One
 * artifact, two hosts (INITIATION §3) — this route is the second host's door.
 */
import { EngineError, importPlugin } from "../../../../src/plugins/plugin-manager/engine.server";

export const dynamic = "force-dynamic";

/** A plugin package is source text; 16 MB of it is not a plugin, it is a
 *  mistake — refused with a status rather than half-written. */
const MAX_BODY_BYTES = 16 * 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const overwrite = url.searchParams.get("overwrite") === "1";

  let body: Buffer;
  try {
    body = Buffer.from(await request.arrayBuffer());
  } catch {
    return Response.json({ error: "unreadable request body" }, { status: 400 });
  }
  if (!body.length) return Response.json({ error: "empty request body" }, { status: 400 });
  if (body.length > MAX_BODY_BYTES) {
    return Response.json(
      { error: `package exceeds ${MAX_BODY_BYTES} bytes` },
      { status: 413 }
    );
  }

  try {
    return Response.json(importPlugin(body, { overwrite }));
  } catch (e) {
    if (e instanceof EngineError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json(
      { error: e instanceof Error ? e.message : "import failed" },
      { status: 500 }
    );
  }
}
