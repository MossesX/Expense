import { caller, json, str } from "../../../../src/server/ai/http";
import { createConversation, listConversations, summary } from "../../../../src/server/ai/store";
import { MODES, type AssistantMode } from "../../../../src/server/ai/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const c = await caller(request);
  const mode = new URL(request.url).searchParams.get("mode") ?? "";
  return Response.json({ conversations: await listConversations(c.user, MODES.includes(mode as AssistantMode) ? (mode as AssistantMode) : undefined) });
}

export async function POST(request: Request): Promise<Response> {
  const c = await caller(request);
  const b = await json(request);
  const mode = MODES.includes(b.mode as AssistantMode) ? (b.mode as AssistantMode) : "chat";
  const conv = await createConversation(c.user, mode, str(b.title, 80));
  return Response.json({ conversation: summary(conv) }, { status: 201 });
}
