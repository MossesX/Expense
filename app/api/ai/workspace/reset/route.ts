import { caller } from "../../../../../src/server/ai/http";
import { resetWorkspace } from "../../../../../src/server/ai/workspace";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const c = await caller(request);
  resetWorkspace(c.user);
  return Response.json({ ok: true });
}
