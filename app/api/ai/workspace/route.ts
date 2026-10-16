import { caller } from "../../../../src/server/ai/http";
import { ensureWorkspace, sourceVersion, workspaceDiff } from "../../../../src/server/ai/workspace";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const c = await caller(request);
  ensureWorkspace(c.user);
  return Response.json({ ...workspaceDiff(c.user), sourceVersion: sourceVersion() });
}
