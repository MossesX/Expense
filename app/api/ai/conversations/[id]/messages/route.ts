/**
 * @file One assistant turn, streamed as server-sent events: `status`, `text`
 * and `tool` events, then `done { messageId, backend, tools, text, changed }`
 * or `error { message }`. A client disconnect aborts the model run.
 */
import { assistantTurn } from "../../../../../../src/server/ai/assistant";
import { caller, json, str } from "../../../../../../src/server/ai/http";
import { getConversation } from "../../../../../../src/server/ai/store";
import type { PageContext } from "../../../../../../src/server/ai/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const c = await caller(request);
  const id = Number((await ctx.params).id);
  const conv = await getConversation(c.user, id);
  if (!conv) return Response.json({ error: "Conversation not found" }, { status: 404 });
  const b = await json(request);
  const prompt = str(b.content, 20000).trim();
  if (!prompt) return Response.json({ error: "Message is empty" }, { status: 400 });
  const cx = (b.context ?? {}) as Record<string, unknown>;
  const context: PageContext = { url: str(cx.url, 500), title: str(cx.title, 200), selection: str(cx.selection, 4000), element: str(cx.element, 300) };

  const encoder = new TextEncoder();
  const abort = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* closed */
        }
      };
      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          clearInterval(keepAlive);
        }
      }, 15_000);
      void (async () => {
        try {
          const { result, messageId, changedFiles } = await assistantTurn({
            user: c.user,
            screenname: c.screenname,
            conversationId: id,
            prompt,
            model: c.model,
            connection: c.connection,
            context,
            onEvent: (e) => send(e.type, e),
            signal: abort.signal
          });
          send("done", { messageId, backend: result.backend, tools: result.toolsUsed, text: result.text, changed: changedFiles });
        } catch (e) {
          send("error", { message: (e as Error).message });
        } finally {
          clearInterval(keepAlive);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      })();
    },
    cancel() {
      abort.abort();
    }
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}
