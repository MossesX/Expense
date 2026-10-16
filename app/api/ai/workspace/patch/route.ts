import { caller } from "../../../../../src/server/ai/http";
import { sourceVersion, workspaceDiff } from "../../../../../src/server/ai/workspace";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const c = await caller(request);
  const d = workspaceDiff(c.user);
  return new Response(d.diff, { headers: { "Content-Type": "text/x-patch", "Content-Disposition": `attachment; filename="expenses-assistant-${sourceVersion()}.patch"` } });
}
