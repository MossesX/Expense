/**
 * @file `/api/axf/kv/<ns>` — the per-user kv document route every core
 * settings store and the accounts module's own documents ride.
 *
 *   GET    → { doc } or 404 when the user has no such document
 *   PUT    → { ok: true }; body { doc }
 *   DELETE → { ok: true }
 *
 * The studio serves this route; the peel did not (2026-10-16), so module
 * settings — the pay schedule included — were silently kept in memory and
 * lost on reload: `ModuleSettingsStore` swallows the transport's errors by
 * design. Same store as `/api/expenses` (`axfKv`, keyed by the session user
 * through `kvUser`), same bound on a document, which is a preferences store
 * and not a blob store. **Node-only.**
 */
import { isKvName } from "@axf/core";

import { axfKv, kvUser } from "../../../../../src/server/axfKv";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 512 * 1024;

type RouteCtx = { params: Promise<{ ns: string }> };

async function nsOf(ctx: RouteCtx): Promise<string | null> {
  const { ns } = await ctx.params;
  return isKvName(ns) ? ns : null;
}

export async function GET(request: Request, ctx: RouteCtx): Promise<Response> {
  const ns = await nsOf(ctx);
  if (!ns) return Response.json({ error: "not a kv namespace" }, { status: 400 });
  const doc = await axfKv.read(kvUser(request), ns);
  if (doc === null) return Response.json({ error: "no document" }, { status: 404 });
  return Response.json({ doc });
}

export async function PUT(request: Request, ctx: RouteCtx): Promise<Response> {
  const ns = await nsOf(ctx);
  if (!ns) return Response.json({ error: "not a kv namespace" }, { status: 400 });
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return Response.json({ error: "document too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "body is not JSON" }, { status: 400 });
  }
  const doc = (body as { doc?: unknown }).doc;
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return Response.json({ error: "body.doc must be an object" }, { status: 400 });
  }
  await axfKv.write(kvUser(request), ns, doc as Record<string, unknown>);
  return Response.json({ ok: true });
}

export async function DELETE(request: Request, ctx: RouteCtx): Promise<Response> {
  const ns = await nsOf(ctx);
  if (!ns) return Response.json({ error: "not a kv namespace" }, { status: 400 });
  await axfKv.remove(kvUser(request), ns);
  return Response.json({ ok: true });
}
