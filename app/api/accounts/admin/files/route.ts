/**
 * @file `/api/accounts/admin/files` — **read-only browsing of any member's
 * registered data roots.** The most sensitive route in the module, and the two
 * things that make it safe are not optional.
 *
 * ## 1. Looking is a RECORDED ACT, and the record goes first
 *
 * Every LIST, VIEW and DOWNLOAD writes an audit entry — actor, subject, root,
 * path, verb — **before a single byte goes out**, and the handler REFUSES with
 * a 500 if that write fails. Not "logs afterwards", not "best effort": an
 * administrator reading a member's data leaves a trace, or does not read it.
 *
 * That is a deliberate departure from the module's house posture, where
 * journaling never fails a save. The difference is what the record is FOR: a
 * journal line describes something that already happened, so losing it costs a
 * line; here the record is the price of the act, so an unrecorded act must not
 * happen. `lib/audit.ts` returns its outcome for exactly this call site, and
 * `/api/accounts/admin/audit` is where the member — and the next administrator
 * — can read it back.
 *
 * ## 2. Every path is fenced, by construction
 *
 * `lib/browse.ts` resolves against the root's own base directory and then
 * verifies the result is under it, then does both again through `realpath` so a
 * symlink cannot be the way out. Shared roots (`profile`, `credits`,
 * `messages`) are flat and filtered by the registry's own `owns` predicate,
 * re-asked on the way to the bytes — otherwise "browse dana's files" would hand
 * over the whole studio's conversations under dana's name.
 *
 * ## What is NOT here
 *
 * No write, no delete, no rename, no move. This phase widens an administrator's
 * REACH; the destructive surfaces stay exactly where `lib/admin.ts` and
 * `/api/accounts/users` already put them, behind their confirm screens.
 *
 * ```
 * GET ?user=<u>                                  → the root rail
 * GET ?user=<u>&root=<id>&path=<rel>             → a directory listing
 * GET ?user=<u>&root=<id>&path=<rel>&view=preview  → the head of a file, as text
 * GET ?user=<u>&root=<id>&path=<rel>&view=download → the file, as an attachment
 * ```
 *
 * Admin-only on every handler (`requireLiveAdmin`), including a browse of the
 * administrator's OWN files: the point of the trail is that it is complete, and
 * an exemption for the person most able to use the route is the one hole worth
 * least and costing most.
 */

import { NextResponse, type NextRequest } from "next/server";

import { findAccount } from "@axs/modules/accounts/lib/accounts";
import { recordAudit, type AuditDraft } from "@axs/modules/accounts/lib/audit";
import {
  listDir,
  listRoots,
  normalizeRel,
  previewFile,
  readFileBytes,
} from "@axs/modules/accounts/lib/browse";
import { fail, requireLiveAdmin } from "@axs/modules/accounts/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Record the act, or refuse it. Returns the response to send INSTEAD of the
 * data when the trail could not be written.
 *
 * One function so that no handler below can be the one that forgets, and so
 * that the refusal reads the same whichever verb was being attempted.
 */
async function auditOrRefuse(draft: AuditDraft): Promise<NextResponse | null> {
  const written = await recordAudit(draft);
  if (written.ok) return null;
  return fail(
    500,
    "that read was refused because it could not be recorded in the audit trail — " +
      "looking at a member's data is a recorded act, always. " +
      `(${written.error})`,
  );
}

export async function GET(req: NextRequest): Promise<Response> {
  const gate = await requireLiveAdmin(req);
  if ("deny" in gate) return gate.deny;

  const params = req.nextUrl.searchParams;
  const subject = (params.get("user") ?? "").trim().toLowerCase();
  if (!subject) return fail(400, "which member's files? pass ?user=");

  // The roster is consulted so a browse of a name that has no account is a 404
  // rather than an empty rail that looks like a member with no data.
  const account = await findAccount(subject);
  if (!account) return fail(404, "no such account");

  const rootId = (params.get("root") ?? "").trim();
  const rel = normalizeRel(params.get("path") ?? "");
  const view = (params.get("view") ?? "list").trim();

  /* ------------------------------- the rail -------------------------------- */
  if (!rootId) {
    const refused = await auditOrRefuse({
      actor: gate.actor,
      subject,
      verb: "file-list",
      detail: "root index",
    });
    if (refused) return refused;
    return NextResponse.json({ ok: true, user: subject, roots: await listRoots(subject) });
  }

  /* ------------------------------- a preview -------------------------------- */
  if (view === "preview") {
    const refused = await auditOrRefuse({
      actor: gate.actor,
      subject,
      verb: "file-view",
      root: rootId,
      path: rel,
    });
    if (refused) return refused;

    const result = await previewFile(rootId, subject, rel);
    if (!result.ok) return fail(result.status, result.error);
    return NextResponse.json({ ok: true, user: subject, preview: result.value });
  }

  /* ------------------------------ a download -------------------------------- */
  if (view === "download") {
    const refused = await auditOrRefuse({
      actor: gate.actor,
      subject,
      verb: "file-download",
      root: rootId,
      path: rel,
    });
    if (refused) return refused;

    const result = await readFileBytes(rootId, subject, rel);
    if (!result.ok) return fail(result.status, result.error);
    const file = result.value;
    // Always an attachment. A member's stored HTML or SVG rendered inline would
    // be executing their content in the administrator's own origin, with the
    // administrator's cookie — the one way a read-only browser could stop being
    // read-only.
    return new NextResponse(file.bytes, {
      status: 200,
      headers: {
        "content-type": file.contentType,
        "content-length": String(file.bytes.byteLength),
        "content-disposition": `attachment; filename="${file.name.replace(/["\\]/g, "_")}"`,
        "cache-control": "no-store",
      },
    });
  }

  /* ------------------------------ a listing --------------------------------- */
  if (view !== "list") return fail(400, `unknown view "${view}" — list, preview or download`);

  const refused = await auditOrRefuse({
    actor: gate.actor,
    subject,
    verb: "file-list",
    root: rootId,
    path: rel,
  });
  if (refused) return refused;

  const result = await listDir(rootId, subject, rel);
  if (!result.ok) return fail(result.status, result.error);
  return NextResponse.json({ ok: true, user: subject, listing: result.value });
}
