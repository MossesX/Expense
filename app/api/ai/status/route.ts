import { aiStatus } from "../../../../src/server/ai/assistant";
import { caller } from "../../../../src/server/ai/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const c = await caller(request);
  return Response.json(await aiStatus(c.user, c.model));
}
