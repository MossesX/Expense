/**
 * @file `GET /api/plugins/<id>/inventory` — the files tab's answer.
 *
 * `?ns=` and `?route=` widen the scan beyond `src/plugins/<id>/`: the CLIENT
 * knows a plugin's kv namespace and page route (they are registry data — the
 * settings decl's `ns`, the decl's `route`), the server does not, so the page
 * passes the addresses and the engine fences them exactly as any other
 * incoming name. Empty inventory is 200 with an empty list — "empty" is not
 * an error (the history route's rule).
 */
import { EngineError, inventory } from "../../../../../src/plugins/plugin-manager/engine.server";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: RouteCtx): Promise<Response> {
  const { id } = await ctx.params;
  const url = new URL(request.url);
  const ns = url.searchParams.get("ns") ?? undefined;
  const route = url.searchParams.get("route") ?? undefined;
  try {
    return Response.json(inventory(id, { ns, route }));
  } catch (e) {
    if (e instanceof EngineError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json(
      { error: e instanceof Error ? e.message : "inventory failed" },
      { status: 500 }
    );
  }
}
