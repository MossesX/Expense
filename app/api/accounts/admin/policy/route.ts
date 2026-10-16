/**
 * @file `/api/accounts/admin/policy` — the per-user policy cascade over the
 * wire: the editor's read, and the only two writes there are.
 *
 * ```
 * GET    ?user=<u>            → the catalog, the resolved values, WHICH TIER
 *                               supplied each one, this subject's own pins, the
 *                               site tier, and the permission matrix's verdict
 * PUT    { subject, key, value }      → pin one field
 * PUT    { subject, values: {…} }     → pin several, reported per key
 * DELETE { subject, key | keys: […] } → un-pin, back to FOLLOWING the tier above
 * ```
 *
 * `subject` is a username, or `_site` for the site defaults — the same PUT
 * writes both, because they are the same operation at two tiers and a second
 * endpoint would be a second place to get the cascade wrong. `?user=` is
 * accepted as a synonym everywhere for the callers that already spell it that
 * way.
 *
 * ## Effective AND override, in one answer, deliberately
 *
 * The editor has to show "pinned to 500" differently from "following the site,
 * which currently says 500" — those two produce identical values today and
 * diverge the day an administrator moves the site tier. `policyDetail` already
 * carries the resolved values plus `tiers` (which tier supplied each), and this
 * route adds the subject's raw override document alongside. One request, both
 * halves, so the screen cannot render a pin it inferred from a value.
 *
 * ## Un-pinning is a DELETE, not a set-to-the-default
 *
 * Same reason. `clearPolicyValue` removes the field so the subject follows the
 * tier above as it changes; writing the default's current value would pin them
 * to a number that stops moving. The two are indistinguishable on the day they
 * are done and different forever after, so they are different verbs.
 *
 * ## Gating and audit
 *
 * `requireLiveAdmin` on every handler — and the store re-checks: every
 * `setPolicyValue` / `clearPolicyValue` holds its own `requireAdmin`, refuses a
 * self-lockout, and audits through the one chokepoint in `lib/admin.ts`. The
 * route's job is to map refusals onto status codes, which `refuse()` does
 * verbatim, and never to decide one itself.
 */

import { NextResponse, type NextRequest } from "next/server";

import { findAccount } from "@axs/modules/accounts/lib/accounts";
import { fail, readJsonBody, requireLiveAdmin, str } from "@axs/modules/accounts/lib/http";
import { SITE_POLICY_SUBJECT } from "@axs/modules/accounts/lib/paths";
import {
  POLICY_GROUPS,
  clearPolicyValue,
  policyDefaults,
  policyWithAccess,
  readOverrides,
  setPolicyValue,
  suspensionOf,
  type PolicyWriteResult,
} from "@axs/modules/accounts/lib/policy";
import type { SettingValue } from "@axf/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `subject` or `user`, lowercased. The site tier is a legal subject and is NOT
 *  looked up as an account — `_site` is an impossible username by construction
 *  (see `lib/paths.ts`), so the two can never collide. */
function subjectOf(body: Record<string, unknown>): string {
  return (str(body, "subject") || str(body, "user")).trim().toLowerCase();
}

/** A refusal from the policy store, mapped verbatim. Its own helper because
 *  `PolicyWriteResult` is not the module's `StoreRefusal` shape — it carries
 *  `subject`/`key` on success — so `refuse()` cannot take it directly. */
const denyWrite = (r: Extract<PolicyWriteResult, { ok: false }>): NextResponse =>
  NextResponse.json({ ok: false, error: r.error }, { status: r.status });

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await requireLiveAdmin(req);
  if ("deny" in gate) return gate.deny;

  const asked = (req.nextUrl.searchParams.get("user") ?? req.nextUrl.searchParams.get("subject") ?? "")
    .trim()
    .toLowerCase();
  if (!asked) return fail(400, "whose policy? pass ?user= (or ?subject=_site)");

  const site = asked === SITE_POLICY_SUBJECT;
  if (!site && !(await findAccount(asked))) return fail(404, "no such account");

  const { policy, access } = await policyWithAccess(asked);
  return NextResponse.json({
    ok: true,
    subject: policy.subject,
    isSite: site,
    /** The catalog, so the editor renders labels/hints/kinds without a second call. */
    rows: policy.rows,
    groups: POLICY_GROUPS,
    /** The resolved answer — every key present. */
    values: policy.values,
    /** key → "default" | "site" | "user": pinned versus following, and where. */
    tiers: policy.tiers,
    /** What THIS subject has pinned. Sparse: only the fields somebody set. */
    overrides: readOverrides(asked).values,
    /** What the site tier holds, for a "the default is X" hint beside a pin. */
    site: policy.site,
    /** Every row's shipped default — the tier under the site. */
    defaults: policyDefaults(),
    /** The three suspension rows as the one fact they describe. */
    suspension: suspensionOf(policy.values),
    /** The permission matrix's own verdict, read THROUGH — never merged. Module
     *  access stays one store with one answer; this is here so the suite can
     *  render both halves on one screen. */
    access,
  });
}

/** Pin one field, or several. Several are applied in turn and reported per key
 *  rather than as one all-or-nothing write: the store validates each value
 *  against its own row, so a card carrying one bad number must not silently
 *  discard the four good ones beside it. */
export async function PUT(req: NextRequest): Promise<NextResponse> {
  const gate = await requireLiveAdmin(req);
  if ("deny" in gate) return gate.deny;

  const read = await readJsonBody(req);
  if (!read.ok) return read.deny;
  const body = read.body;

  const subject = subjectOf(body);
  if (!subject) return fail(400, "which subject? pass a username, or _site for the site defaults");

  const raw = body["values"];
  const many =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, SettingValue>)
      : null;

  if (!many) {
    const key = str(body, "key").trim();
    if (!key) return fail(400, "a policy write needs a key, or a values object");
    if (!("value" in body)) return fail(400, `no value for "${key}" — to un-pin it, use DELETE`);
    const result = await setPolicyValue(gate.actor, subject, key, body["value"] as SettingValue);
    return result.ok
      ? NextResponse.json({ ok: true, subject: result.subject, key, from: result.from, to: result.to })
      : denyWrite(result);
  }

  const keys = Object.keys(many);
  if (keys.length === 0) return fail(400, "that values object is empty");

  const results: Array<{ key: string; ok: boolean; error?: string; from?: SettingValue; to?: SettingValue }> = [];
  for (const key of keys) {
    const result = await setPolicyValue(gate.actor, subject, key, many[key]);
    results.push(
      result.ok
        ? { key, ok: true, from: result.from, to: result.to }
        : { key, ok: false, error: result.error },
    );
  }
  const failed = results.filter((r) => !r.ok);
  return NextResponse.json(
    { ok: failed.length === 0, subject, applied: results.length - failed.length, results },
    // A partial write is a 207-shaped outcome; this store speaks in the plain
    // codes the rest of the module uses, so it reports 200 with `ok: false` and
    // a per-key reason. The editor needs the reasons either way, and a bare 400
    // would not carry the four keys that DID land.
    { status: 200 },
  );
}

/** Un-pin — the subject goes back to FOLLOWING the tier above, including as
 *  that tier changes. Accepts the key in the body or in the query, because a
 *  DELETE with a body is awkward from some clients and this must not be the
 *  reason an administrator reaches for "set it to the default" instead. */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const gate = await requireLiveAdmin(req);
  if ("deny" in gate) return gate.deny;

  const params = req.nextUrl.searchParams;
  let subject = (params.get("subject") ?? params.get("user") ?? "").trim().toLowerCase();
  let keys: string[] = [];
  const fromQuery = (params.get("key") ?? "").trim();
  if (fromQuery) keys = [fromQuery];

  // A body is optional here; an absent one is not an error.
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > 0) {
    const read = await readJsonBody(req);
    if (!read.ok) return read.deny;
    subject = subject || subjectOf(read.body);
    const list = read.body["keys"];
    if (Array.isArray(list)) keys = list.filter((k): k is string => typeof k === "string");
    else if (str(read.body, "key")) keys = [str(read.body, "key").trim()];
  }

  if (!subject) return fail(400, "which subject? pass a username, or _site for the site defaults");
  keys = keys.map((k) => k.trim()).filter(Boolean);
  if (keys.length === 0) return fail(400, "which field? pass key= or a keys array");

  const results: Array<{ key: string; ok: boolean; error?: string; from?: SettingValue }> = [];
  for (const key of keys) {
    const result = await clearPolicyValue(gate.actor, subject, key);
    results.push(result.ok ? { key, ok: true, from: result.from } : { key, ok: false, error: result.error });
  }
  const failed = results.filter((r) => !r.ok);
  return NextResponse.json({ ok: failed.length === 0, subject, cleared: results.length - failed.length, results });
}
