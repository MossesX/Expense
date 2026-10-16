/**
 * @file `GET /api/plugins/<id>/export` — download a plugin as a package.
 *
 * Answers with `content-disposition: attachment` so the export command can be
 * a plain navigation (the document stays put, the browser takes the file) —
 * the amberxvid `?download=1` pattern. The bytes are the same package the
 * import route accepts and `npm run pack` archives; export warnings (a
 * synthesized manifest, say) travel in an `x-axs-warnings` header because a
 * download has no JSON body to carry them in.
 */
import { EngineError, exportPlugin } from "../../../../../src/plugins/plugin-manager/engine.server";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: RouteCtx): Promise<Response> {
  const { id } = await ctx.params;
  try {
    const { filename, data, warnings } = exportPlugin(id);
    return new Response(new Uint8Array(data), {
      headers: {
        "content-type": "application/zip",
        "content-length": String(data.length),
        "content-disposition": `attachment; filename="${filename}"`,
        ...(warnings.length ? { "x-axs-warnings": warnings.join(" | ") } : {})
      }
    });
  } catch (e) {
    if (e instanceof EngineError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json(
      { error: e instanceof Error ? e.message : "export failed" },
      { status: 500 }
    );
  }
}
