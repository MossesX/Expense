/**
 * @file `/api/expenses/dupes` — Claude's opinion on candidate duplicate
 * pairs the browser already found.
 *
 *   POST { pairs: [{ index, a: {…}, b: {…}, daysApart }], model?, mode? }
 *     → { verdicts: [{ index, duplicate, confidence, reason }], source, model }
 *
 * Subscription (Claude Code) first, API fallback (`server/ai/dupes.ts`).
 * The ledger never leaves the browser — only the pairs, and of those only
 * the fields that identify a purchase. **Node-only.**
 */
import { judgeDuplicates } from "../../../../src/server/ai/dupes";
import { kvUser } from "../../../../src/server/axfKv";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_PAIRS = 200;
const MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"]);

export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return Response.json({ error: "too many pairs (2 MB limit)" }, { status: 413 });
  let body: { pairs?: unknown; model?: unknown; mode?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "body is not JSON" }, { status: 400 });
  }
  const pairs = Array.isArray(body.pairs) ? body.pairs.slice(0, MAX_PAIRS) : [];
  if (!pairs.length) return Response.json({ error: "pairs[] is required" }, { status: 400 });
  const model = typeof body.model === "string" && MODELS.has(body.model) ? body.model : "claude-opus-5-5";
  const connection = body.mode === "user-key" || body.mode === "server" ? body.mode : "auto";
  try {
    const { verdicts, backend } = await judgeDuplicates({ user: kvUser(request), pairs, model, connection });
    return Response.json({ verdicts, source: backend, model });
  } catch (err) {
    const status = typeof (err as { status?: unknown }).status === "number" ? (err as { status: number }).status : 0;
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: status === 401 ? 401 : /not connected|No Claude connection/i.test(message) ? 401 : 502 });
  }
}
