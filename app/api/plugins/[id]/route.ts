/**
 * @file `/api/plugins/<id>` — uninstall (DELETE) and flip (PATCH).
 *
 * Both act only on plugins the engine IMPORTED — the engine refuses built-ins
 * with the reason (their registration is a static import in
 * `studio.subsystem.ts`; no route may un-compile source). A built-in with an
 * `enabledKey` flips client-side through its own settings store instead,
 * which is the one-switch doctrine the roster payload states.
 */
import {
  EngineError,
  setImportedEnabled,
  uninstallPlugin
} from "../../../../src/plugins/plugin-manager/engine.server";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

function refused(e: unknown): Response {
  if (e instanceof EngineError) return Response.json({ error: e.message }, { status: e.status });
  return Response.json(
    { error: e instanceof Error ? e.message : "plugin engine failure" },
    { status: 500 }
  );
}

export async function DELETE(_request: Request, ctx: RouteCtx): Promise<Response> {
  const { id } = await ctx.params;
  try {
    return Response.json({ ok: true, ...uninstallPlugin(id) });
  } catch (e) {
    return refused(e);
  }
}

export async function PATCH(request: Request, ctx: RouteCtx): Promise<Response> {
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "body is not JSON" }, { status: 400 });
  }
  const enabled = (body as { enabled?: unknown })?.enabled;
  if (typeof enabled !== "boolean") {
    return Response.json({ error: `body needs { enabled: boolean }` }, { status: 400 });
  }
  try {
    return Response.json({ ok: true, ...setImportedEnabled(id, enabled) });
  } catch (e) {
    return refused(e);
  }
}
