/**
 * @file `/api/expenses/parse-image` — a statement or receipt IMAGE, read into
 * transactions the import review can judge.
 *
 *   POST { image: <base64>, mediaType, account?, model?, mode? }
 *     → { account, transactions: [...], notes, source, model }
 *
 * The reading runs on the subscription (Claude Code) when the person has one,
 * else on the API (`server/ai/vision.ts`); the rows then feed `import.ts`
 * unchanged — the duplicate checks do not care whether a row came from a
 * paste, a CSV or a photograph. **Node-only.**
 */
import { readStatementImage, type ImageMediaType } from "../../../../src/server/ai/vision";
import { kvUser } from "../../../../src/server/axfKv";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 12 * 1024 * 1024;
const MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"]);

export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return Response.json({ error: "image too large (12 MB limit)" }, { status: 413 });
  let body: { image?: unknown; mediaType?: unknown; account?: unknown; model?: unknown; mode?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "body is not JSON" }, { status: 400 });
  }
  const image = typeof body.image === "string" ? body.image.replace(/^data:[^;]+;base64,/, "") : "";
  const mediaType = typeof body.mediaType === "string" ? body.mediaType : "";
  if (!image || !MEDIA_TYPES.has(mediaType)) {
    return Response.json({ error: "image (base64) and a mediaType of image/jpeg, image/png, image/gif or image/webp are required" }, { status: 400 });
  }
  const model = typeof body.model === "string" && MODELS.has(body.model) ? body.model : "claude-opus-5-5";
  const connection = body.mode === "user-key" || body.mode === "server" ? body.mode : "auto";
  const account = typeof body.account === "string" ? body.account : "";
  try {
    const { parsed, backend } = await readStatementImage({ user: kvUser(request), image, mediaType: mediaType as ImageMediaType, account, model, connection });
    return Response.json({ ...parsed, source: backend, model });
  } catch (err) {
    const status = typeof (err as { status?: unknown }).status === "number" ? (err as { status: number }).status : 0;
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: status === 401 ? 401 : /not connected|No Claude connection/i.test(message) ? 401 : 502 });
  }
}
