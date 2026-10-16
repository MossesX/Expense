/**
 * @file `/api/accounts/permissions` — the permission matrix's door: what a
 * signed-in user may open, and (for an administrator) the setters that decide it.
 *
 * GET
 *   - no query       → YOUR effective permissions. Never gated: every signed-in
 *                      user may read their own verdict, because the shell needs
 *                      it to draw a nav that does not offer doors that refuse.
 *   - `?user=<name>` → someone else's — ADMINISTRATOR ONLY. Reading another
 *                      user's grants is administration, not self-service.
 *   - `?raw=1`       → the sparse stored grants beside the flat verdict, so the
 *                      admin matrix can tell "explicitly allowed" from
 *                      "allowed because nobody decided" — absent-means-allowed
 *                      is invisible in `EffectivePermissions` by design.
 *
 * POST `{ action, … }`. The two administrator actions check administrator-ness
 * inside `setModuleGrant` / `setCapability` (`gateMutation` → `requireAdmin`),
 * not here; the route's own job is the shape of the request:
 *   - `set-module`     { username, moduleId, allowed }        (administrator)
 *   - `set-capability` { username, capability: 'canMessage'|'canEditProfile', allowed }
 *                                                             (administrator)
 *   - `request-module` { moduleId }                           SELF-SERVE
 *
 * `request-module` is the one non-admin mutation in the module: a signed-in
 * user joining a module that is open to it. It writes only the caller's own
 * row and it REFUSES (403) when an administrator has explicitly revoked that
 * module — see `requestModuleGrant`, where that refusal lives, for why it is a
 * separate function rather than `setModuleGrant` with the caller as actor.
 * Whether a given module is open is the module's own policy, decided by the
 * caller before it posts here.
 *
 * `allowed` is read with `bool()` and a missing value is a 400 rather than a
 * silent `false`. That matters more here than anywhere else in the module: a
 * typo'd field name would otherwise REVOKE the thing the caller meant to grant.
 *
 * Nothing is cached, on either side of this route. `effectivePermissions()`
 * re-reads the account and the grants file per call, which is what makes a
 * revocation bind on the target's very next request instead of at their next
 * login — the property BootedHost's gate depends on.
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@axs/modules/accounts/lib/accounts";
import { bool, fail, readJsonBody, refuse, requireSession, str } from "@axs/modules/accounts/lib/http";
import {
  effectivePermissions,
  grantsFor,
  requestModuleGrant,
  setCapability,
  setModuleGrant,
} from "@axs/modules/accounts/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = requireSession(req);
  if ("deny" in gate) return gate.deny;

  const asked = (req.nextUrl.searchParams.get("user") ?? "").trim();
  const self = asked === "" || asked.toLowerCase() === gate.user.trim().toLowerCase();

  if (!self) {
    const admin = await requireAdmin(gate.user);
    if (!admin.ok) return fail(admin.status, admin.error);
  }

  const who = self ? gate.user : asked;
  const permissions = await effectivePermissions(who);
  const body: Record<string, unknown> = { ok: true, permissions };
  if (req.nextUrl.searchParams.get("raw") === "1") body.grants = grantsFor(who);
  return NextResponse.json(body);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = requireSession(req);
  if ("deny" in gate) return gate.deny;

  const read = await readJsonBody(req);
  if (!read.ok) return read.deny;
  const action = str(read.body, "action");

  // Self-serve join. It takes no `username` (it is always the caller's own row)
  // and no `allowed` (a join is not a two-way switch), so it is dispatched
  // BEFORE the admin actions' shared field checks rather than being made to
  // satisfy them with values it would ignore.
  if (action === "request-module") {
    const result = await requestModuleGrant(gate.user, str(read.body, "moduleId"));
    if (!result.ok) return refuse(result);
    return NextResponse.json({
      ok: true,
      username: result.username,
      grants: result.grants,
      permissions: await effectivePermissions(result.username),
    });
  }

  const username = str(read.body, "username").trim();
  if (!username) return fail(400, "which account?");

  const allowed = bool(read.body, "allowed");
  if (allowed === null) return fail(400, "`allowed` must be true or false");

  if (action === "set-module") {
    const result = await setModuleGrant(gate.user, username, str(read.body, "moduleId"), allowed);
    if (!result.ok) return refuse(result);
    return NextResponse.json({
      ok: true,
      username: result.username,
      grants: result.grants,
      permissions: await effectivePermissions(result.username),
    });
  }

  if (action === "set-capability") {
    const cap = str(read.body, "capability");
    if (cap !== "canMessage" && cap !== "canEditProfile") return fail(400, "unknown capability");
    const result = await setCapability(gate.user, username, cap, allowed);
    if (!result.ok) return refuse(result);
    return NextResponse.json({
      ok: true,
      username: result.username,
      grants: result.grants,
      permissions: await effectivePermissions(result.username),
    });
  }

  return fail(400, `unknown action "${action}"`);
}
