/**
 * @file `/api/accounts/admin/audit` — the administrative audit trail, queried.
 *
 * ```
 * GET ?actor=&subject=&verb=a,b&since=&until=&q=&offset=&limit=&facets=1
 * ```
 *
 * Every filter is an AND and every one is optional; `verb` takes a comma-
 * separated list. `since`/`until` accept an ISO stamp or epoch milliseconds,
 * because one of those is what a date picker produces and the other is what a
 * link somebody pasted carries.
 *
 * ## Read-only, and there is no write verb on purpose
 *
 * The trail is written by the acts it records — the file browser before it
 * hands over bytes, `auditFieldChange` when a policy field moves, the admin
 * users route when an account is created or a credential is issued. A POST that
 * let a caller append an entry would let an administrator write a record of
 * something that did not happen, which is the one thing an audit trail must not
 * be able to say. There is likewise no delete: an entry an administrator can
 * remove is an entry nobody can rely on.
 *
 * ## The 403 an administrator gets is the same 403 anyone else gets
 *
 * Admin-only, live-checked per request like every route in the suite. Reading
 * the trail is not itself audited: it records nobody's data, only the fact that
 * administrators acted, and a log that logged its own reads would grow without
 * bound the first time somebody left the tab open on a poll.
 */

import { NextResponse, type NextRequest } from "next/server";

import {
  AUDIT_PAGE_DEFAULT,
  AUDIT_PAGE_MAX,
  AUDIT_VERBS,
  auditFacets,
  isAuditVerb,
  queryAudit,
  type AuditVerb,
} from "@axs/modules/accounts/lib/audit";
import { fail, requireLiveAdmin } from "@axs/modules/accounts/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * An ISO stamp or epoch milliseconds → epoch milliseconds, or null when the
 * parameter was absent. `undefined` for a value that was PRESENT and unusable,
 * so the route can refuse it by name rather than silently widening the window
 * to everything — a time filter that quietly stops filtering is how somebody
 * concludes an administrator did nothing that week.
 */
function whenParam(raw: string | null): number | null | undefined {
  if (raw === null || raw.trim() === "") return null;
  const text = raw.trim();
  if (/^\d+$/.test(text)) return Number(text);
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await requireLiveAdmin(req);
  if ("deny" in gate) return gate.deny;

  const params = req.nextUrl.searchParams;

  const since = whenParam(params.get("since"));
  if (since === undefined) return fail(400, "since must be an ISO date or epoch milliseconds");
  const until = whenParam(params.get("until"));
  if (until === undefined) return fail(400, "until must be an ISO date or epoch milliseconds");

  const verbs: AuditVerb[] = [];
  const rawVerbs = (params.get("verb") ?? params.get("verbs") ?? "").trim();
  if (rawVerbs) {
    for (const piece of rawVerbs.split(",").map((v) => v.trim()).filter(Boolean)) {
      if (!isAuditVerb(piece)) {
        return fail(400, `unknown verb "${piece}" — one of ${AUDIT_VERBS.join(", ")}`);
      }
      verbs.push(piece);
    }
  }

  const page = await queryAudit({
    actor: params.get("actor") ?? undefined,
    subject: params.get("subject") ?? undefined,
    verbs,
    since: since ?? undefined,
    until: until ?? undefined,
    q: params.get("q") ?? undefined,
    offset: Number(params.get("offset") ?? 0) || 0,
    limit: Number(params.get("limit") ?? AUDIT_PAGE_DEFAULT) || AUDIT_PAGE_DEFAULT,
  });

  return NextResponse.json({
    ok: true,
    ...page,
    /** The declared verb set, so a filter never hard-codes it. */
    verbs: AUDIT_VERBS,
    maxLimit: AUDIT_PAGE_MAX,
    /** The names that actually appear in the window — opt-in, because it reads
     *  the whole trail and a table paging through it does not need them again. */
    ...(params.get("facets") === "1" ? { facets: await auditFacets() } : {}),
  });
}
