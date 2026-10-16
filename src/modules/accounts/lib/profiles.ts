/**
 * @file Accounts profile engine — one JSON per member under
 * `<root>/profiles/`, holding the studio face of an account: bio, the designed
 * avatar (initials disc or uploaded image), the ordered custom fields, and the
 * member's presence timestamp.
 *
 * The accounts store stays the single source of truth for identity:
 * `screenname` is re-synced from the account on EVERY read, so a profile file
 * can never disagree with the roster. A missing file synthesizes an honest
 * default (initials avatar, empty bio) rather than 404ing a member who has
 * simply never opened the editor.
 *
 * Mutation rights: the owner (whose `canEditProfile` capability must be live),
 * or an administrator who has completed their own entry flow — the whole
 * "all data admin-manageable" rule in one gate, `resolveActor`.
 *
 * READ RIGHTS ARE BLOCK-AWARE (P4). Both reads take the VIEWER as their first
 * argument — required, not optional, because an optional viewer is one a call
 * site forgets and the block is then bypassed with no error anywhere. Each
 * asks `canInteract` from `./relations`, the one guard, and renders a
 * `blocked` verdict as EXACTLY what a nonexistent member renders as: `null`
 * from {@link getProfile} (the route's plain 404) and absent from
 * {@link listProfiles}. Indistinguishable on purpose — a viewer who can tell
 * "blocked" from "never existed" has been told about the block, which is the
 * one thing a block must never do. Only `blocked` hides; `not-buddy-required`
 * does not, because a profile is the public face of an account and a
 * buddies-only member still HAS one.
 *
 * House store posture (`./fsCore`): degrade never crash, atomic writes, every
 * profile mutation journaled. The one exception is `touchLastSeen`: a presence
 * stamp is connection churn, not a user edit — journaling each disconnect
 * would drown the real file activity the journal exists to record (the same
 * reasoning that keeps message appends out of it). Server-only.
 */

import fs from "node:fs";
import path from "node:path";
import { appendJournal, readJsonFile, writeJsonAtomic } from "./fsCore";
import { findAccount, listAccounts, requireAdmin } from "./accounts";
import { effectivePermissions } from "./permissions";
import { canInteract } from "./relations";
import { profilesDir } from "./paths";
import {
  AVATAR_IMAGE_MAX,
  BIO_MAX,
  CUSTOM_FIELDS_MAX,
  FIELD_LABEL_MAX,
  FIELD_VALUE_MAX,
  type Account,
  type Profile,
  type ProfileAvatar,
  type ProfileField,
} from "./types";

export type ProfileResult =
  | { ok: true; profile: Profile }
  | { ok: false; error: string; status: number };

const fail = (status: number, error: string): ProfileResult => ({ ok: false, error, status });

/* --------------------------------- plumbing ----------------------------------- */

const fwd = (p: string): string => p.replace(/\\/g, "/");

function ledgerPath(abs: string): string {
  const rel = path.relative(process.cwd(), abs);
  return fwd(rel.startsWith("..") ? abs : rel);
}

const profileFile = (username: string): string =>
  path.join(profilesDir(), `${username.trim().toLowerCase()}.json`);

const norm = (u: string): string => u.trim().toLowerCase();

/* ---------------------------------- access ------------------------------------- */

/**
 * May `actor` act on `owner`'s data? Owner always (capability checks are the
 * caller's, per-operation); otherwise an administrator whose own entry flow is
 * complete. Shared with the admin cascade — one gate, one rule.
 */
export async function resolveActor(
  actor: string,
  owner: string,
): Promise<{ ok: true; asAdmin: boolean } | { ok: false; error: string; status: number }> {
  if (norm(actor) === norm(owner)) return { ok: true, asAdmin: false };
  const gate = await requireAdmin(actor);
  if (!gate.ok) return { ok: false, error: "only the owner or an administrator may do that", status: 403 };
  return { ok: true, asAdmin: true };
}

/* --------------------------------- defaults ------------------------------------ */

/** Initials-disc palette — deterministic per username, so a member's default
 *  avatar is stable across machines without storing anything. */
const AVATAR_COLORS = ["#e05d38", "#3a7bd5", "#2f9e6e", "#8e5bd0", "#c9a227", "#c04b76"];

export function defaultAvatarFor(username: string): ProfileAvatar {
  let h = 0;
  for (const ch of norm(username)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { kind: "initials", color: AVATAR_COLORS[h % AVATAR_COLORS.length] };
}

function synthesize(account: Account): Profile {
  return {
    version: 1,
    username: account.username,
    screenname: account.screenname ?? account.username,
    bio: "",
    avatar: defaultAvatarFor(account.username),
    customFields: [],
    lastSeenAt: null,
    createdAt: account.updatedAt,
    updatedAt: account.updatedAt,
  };
}

/* -------------------------------- validation ----------------------------------- */

// Keeps the colour a plain CSS value (hex / named / rgb(...)) — a profile file
// is rendered into style attributes, so no quotes, braces or semicolons.
const COLOR_RE = /^[#a-zA-Z0-9(),.%\s-]{1,48}$/;

/** Validate + normalize an avatar patch. Returns the avatar or an error line. */
function normalizeAvatar(raw: unknown): ProfileAvatar | string {
  if (typeof raw !== "object" || raw === null) return "avatar must be an object";
  const r = raw as Record<string, unknown>;
  if (r.kind !== "initials" && r.kind !== "image") return "avatar.kind must be initials or image";
  if (typeof r.color !== "string" || !COLOR_RE.test(r.color)) return "avatar.color must be a CSS colour";
  if (r.kind === "image") {
    if (typeof r.imageDataUrl !== "string" || !r.imageDataUrl.startsWith("data:image/")) {
      return "an image avatar needs a data:image/* URL";
    }
    if (r.imageDataUrl.length > AVATAR_IMAGE_MAX) {
      return `avatar images are capped at ${Math.floor(AVATAR_IMAGE_MAX / 1024)} KB`;
    }
    return { kind: "image", color: r.color, imageDataUrl: r.imageDataUrl };
  }
  return { kind: "initials", color: r.color };
}

/** Validate + normalize a custom-fields patch (ordered, capped, trimmed). */
function normalizeFields(raw: unknown): ProfileField[] | string {
  if (!Array.isArray(raw)) return "customFields must be an array";
  if (raw.length > CUSTOM_FIELDS_MAX) return `profiles are capped at ${CUSTOM_FIELDS_MAX} custom fields`;
  const out: ProfileField[] = [];
  for (const f of raw) {
    if (typeof f !== "object" || f === null) return "each custom field is { label, value }";
    const { label, value } = f as Record<string, unknown>;
    if (typeof label !== "string" || label.trim().length === 0) return "custom-field labels cannot be empty";
    if (label.trim().length > FIELD_LABEL_MAX) return `field labels are capped at ${FIELD_LABEL_MAX} characters`;
    if (typeof value !== "string" || value.length > FIELD_VALUE_MAX) {
      return `field values are capped at ${FIELD_VALUE_MAX} characters`;
    }
    out.push({ label: label.trim(), value });
  }
  return out;
}

/* ----------------------------------- reads ------------------------------------- */

function readFileFor(account: Account): Profile {
  const raw = readJsonFile<Profile>(profileFile(account.username));
  if (raw?.version !== 1 || typeof raw.username !== "string") return synthesize(account);
  const base = synthesize(account);
  const avatar = normalizeAvatar(raw.avatar);
  const customFields = normalizeFields(raw.customFields);
  return {
    ...base,
    ...raw,
    // Identity always re-syncs from the account — the roster is the truth.
    username: account.username,
    screenname: account.screenname ?? account.username,
    bio: typeof raw.bio === "string" ? raw.bio.slice(0, BIO_MAX) : "",
    avatar: typeof avatar === "string" ? base.avatar : avatar,
    customFields: typeof customFields === "string" ? [] : customFields,
    lastSeenAt: typeof raw.lastSeenAt === "string" ? raw.lastSeenAt : null,
  };
}

/**
 * One member's profile as `viewer` sees it — null when the account is
 * gone/disabled, and null in the identical way when the pair is blocked.
 * The viewer is required: see the header.
 */
export async function getProfile(viewer: string, username: string): Promise<Profile | null> {
  const account = await findAccount(username);
  if (!account || account.disabled === true) return null;
  const social = canInteract(viewer, account.username);
  if (!social.ok && social.reason === "blocked") return null;
  return readFileFor(account);
}

/** Every enabled member's profile `viewer` may see, screenname order —
 *  blocked pairs simply are not in the list, exactly as a disabled account
 *  is not. */
export async function listProfiles(viewer: string): Promise<Profile[]> {
  const accounts = await listAccounts();
  return accounts
    .filter((a) => a.disabled !== true)
    .filter((a) => {
      const social = canInteract(viewer, a.username);
      return social.ok || social.reason !== "blocked";
    })
    .map(readFileFor)
    .sort((a, b) => a.screenname.localeCompare(b.screenname, undefined, { sensitivity: "base" }));
}

/** The stored presence stamp alone — the presence roster reads this without
 *  paying for a full profile resolve per member. */
export function readLastSeen(username: string): string | null {
  const raw = readJsonFile<Profile>(profileFile(username));
  return typeof raw?.lastSeenAt === "string" ? raw.lastSeenAt : null;
}

/* ---------------------------------- mutation ------------------------------------ */

export interface ProfilePatch {
  bio?: string;
  avatar?: unknown;
  customFields?: unknown;
}

/** Update `owner`'s profile as `actor` (owner-with-capability, or admin). */
export async function updateProfile(
  actor: string,
  owner: string,
  patch: ProfilePatch,
): Promise<ProfileResult> {
  const gate = await resolveActor(actor, owner);
  if (!gate.ok) return fail(gate.status, gate.error);
  const account = await findAccount(owner);
  if (!account || account.disabled === true) return fail(404, "no such account");
  if (!gate.asAdmin) {
    const perms = await effectivePermissions(owner);
    if (!perms.canEditProfile) {
      return fail(403, "profile editing has been disabled by an administrator");
    }
  }

  if (patch.bio !== undefined && (typeof patch.bio !== "string" || patch.bio.length > BIO_MAX)) {
    return fail(400, `the bio is capped at ${BIO_MAX} characters`);
  }
  const avatar = patch.avatar === undefined ? undefined : normalizeAvatar(patch.avatar);
  if (typeof avatar === "string") return fail(400, avatar);
  const customFields = patch.customFields === undefined ? undefined : normalizeFields(patch.customFields);
  if (typeof customFields === "string") return fail(400, customFields);

  const current = readFileFor(account);
  const isNew = !fs.existsSync(profileFile(owner));
  const next: Profile = {
    ...current,
    bio: patch.bio !== undefined ? patch.bio : current.bio,
    avatar: avatar ?? current.avatar,
    customFields: customFields ?? current.customFields,
    updatedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(profileFile(owner), next);
  await appendJournal(isNew ? "create" : "edit", ledgerPath(profileFile(owner)), {
    summary: gate.asAdmin
      ? `accounts: admin ${actor} edited ${account.username}'s profile`
      : `accounts: ${account.username} edited their profile`,
  });
  return { ok: true, profile: next };
}

/**
 * Stamp the member's presence timestamp — called by the presence registry when
 * their last connection closes. Best-effort and unjournaled (see the header);
 * presence must never fail on disk trouble.
 */
export async function touchLastSeen(username: string): Promise<void> {
  try {
    const account = await findAccount(username);
    if (!account) return;
    const next: Profile = { ...readFileFor(account), lastSeenAt: new Date().toISOString() };
    await writeJsonAtomic(profileFile(username), next);
  } catch {
    /* best-effort */
  }
}
