/**
 * @file `/api/accounts/profiles` — the profile engine's door: read a member's
 * profile, edit your own (or anyone's, as an administrator).
 *
 * GET
 *   - no query       → your own profile
 *   - `?user=<name>` → that member's profile
 *   - `?list=1`      → every enabled member's profile, screenname order
 *
 * Members may read member profiles — a profile IS the member-facing face of an
 * account, and the buddy list, the thread header and the messenger avatar all
 * render from it. What a member may NOT see is a disabled account: `getProfile`
 * returns null for one, so a non-admin gets a plain 404 and cannot use this
 * route to enumerate who has been switched off. An administrator asking by name
 * gets the same 404 — the store hides disabled rows from everyone here, and the
 * admin overview (`/api/accounts/admin`) is where disabled accounts are visible.
 *
 * BOTH READS PASS THE VIEWER (P4). `getProfile`/`listProfiles` take the signed-
 * in username and ask `canInteract`, so a blocked pair gets that same 404 and
 * that same absence from the list — one 404 for "never existed", "switched
 * off" and "blocked you", which is the only shape in which a block stays
 * silent. The route does not re-implement the rule and does not get to see the
 * verdict; it passes the one thing the store cannot know, exactly as POST
 * already passes the actor.
 *
 * POST `{ user?, bio?, avatar?, customFields? }` — owner-or-admin, gated by
 * `resolveActor` inside `updateProfile`, which ALSO re-checks `canEditProfile`
 * for a non-admin. The route does not re-implement either rule; it passes the
 * session's username as the actor, which is the one thing the store cannot know.
 *
 * THE AVATAR CAP is enforced twice on purpose. `readJsonBody(PROFILE_BODY_MAX)`
 * refuses an oversized BODY with 413 before it is parsed (an image data-url is
 * the only reason this route's body is bigger than everyone else's), and
 * `normalizeAvatar` inside the store refuses an oversized IMAGE with 400. The
 * first is a transport limit, the second is a content limit — a 500 KB body of
 * bio text is refused by neither, and a 300 KB image inside a 400 KB body is
 * refused by the second alone.
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  PROFILE_BODY_MAX,
  fail,
  readJsonBody,
  refuse,
  requireSession,
} from "@axs/modules/accounts/lib/http";
import {
  getProfile,
  listProfiles,
  resolveActor,
  updateProfile,
  type ProfilePatch,
} from "@axs/modules/accounts/lib/profiles";
import { isOnline } from "@axs/modules/accounts/lib/presence";
import {
  assertAvatarBytes,
  assertCapability,
  type PolicyVerdict,
} from "@axs/modules/accounts/lib/policy";
import { AVATAR_IMAGE_MAX } from "@axs/modules/accounts/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A policy refusal as a response — the row travels with the sentence. */
const denyPolicy = (v: Extract<PolicyVerdict, { ok: false }>): NextResponse =>
  NextResponse.json(
    { ok: false, error: v.error, policyRow: v.row, limit: v.value },
    { status: v.status },
  );

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = requireSession(req);
  if ("deny" in gate) return gate.deny;

  if (req.nextUrl.searchParams.get("list") === "1") {
    // `canSeeDirectory` gates the LIST and nothing else: a member without it
    // keeps `?user=` lookups, so the people they already know stay reachable
    // and only enumeration of the roster is closed. Refusing the whole route
    // would have taken the messenger's own avatars with it.
    const may = await assertCapability(gate.user, "canSeeDirectory");
    if (!may.ok) return denyPolicy(may);
    const profiles = await listProfiles(gate.user);
    return NextResponse.json({
      ok: true,
      profiles: profiles.map((p) => ({ ...p, online: isOnline(p.username) })),
    });
  }

  const who = (req.nextUrl.searchParams.get("user") ?? gate.user).trim();
  const profile = await getProfile(gate.user, who);
  if (!profile) return fail(404, "no such member");
  return NextResponse.json({
    ok: true,
    profile,
    online: isOnline(profile.username),
    // Whether the VIEWER is looking at their own — the UI's edit affordance
    // reads this rather than string-comparing usernames itself.
    own: profile.username.toLowerCase() === gate.user.trim().toLowerCase(),
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = requireSession(req);
  if ("deny" in gate) return gate.deny;

  const read = await readJsonBody(req, PROFILE_BODY_MAX);
  if (!read.ok) return read.deny;

  const owner = typeof read.body.user === "string" && read.body.user.trim()
    ? (read.body.user as string).trim()
    : gate.user;

  const patch: ProfilePatch = {};
  if (read.body.bio !== undefined) patch.bio = read.body.bio as string;
  if (read.body.avatar !== undefined) patch.avatar = read.body.avatar;
  if (read.body.customFields !== undefined) patch.customFields = read.body.customFields;
  if (Object.keys(patch).length === 0) return fail(400, "nothing to update");

  // THE AVATAR POLICY, and it is the OWNER's policy that governs, never the
  // actor's — a member's avatar cap is a fact about that member, so an
  // administrator editing on their behalf must not silently get their own.
  //
  // `resolveActor` is the same gate `updateProfile` holds; asking it here too
  // is what lets an administrator fix a profile whose owner has had the
  // capability revoked, exactly as the store already lets them past
  // `canEditProfile`. It refuses a non-owner non-admin as well, which is the
  // same 403 the store would have given a moment later.
  if (patch.avatar !== undefined) {
    const who = await resolveActor(gate.user, owner);
    if (!who.ok) return fail(who.status, who.error);
    if (!who.asAdmin) {
      const may = await assertCapability(owner, "canChangeAvatar");
      if (!may.ok) return denyPolicy(may);
    }
    // Measured off the data URL, which is what actually lands in the profile
    // document. A non-image avatar (initials) carries none and costs nothing.
    const raw = patch.avatar as { imageDataUrl?: unknown } | null;
    const url = typeof raw?.imageDataUrl === "string" ? raw.imageDataUrl : "";
    if (url) {
      const size = await assertAvatarBytes(owner, url.length, AVATAR_IMAGE_MAX);
      if (!size.ok) return denyPolicy(size);
    }
  }

  const result = await updateProfile(gate.user, owner, patch);
  if (!result.ok) return refuse(result);
  return NextResponse.json({ ok: true, profile: result.profile });
}
