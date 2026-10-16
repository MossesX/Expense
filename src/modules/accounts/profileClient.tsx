/**
 * @file The profile engine's CLIENT half — the three fetches over
 * `/api/accounts/profiles` and the ONE avatar renderer every accounts surface
 * draws through, shared by `ProfilePane` (my profile + the viewer dialog) and
 * `MessengerPane` (thread rows and the conversation header).
 *
 * It is a separate file for the reason the reference module's `Avatar.tsx` is
 * (GizmoX `src/modules/amberxvid/Avatar.tsx`, read never imported): two panes
 * drawing the same member must draw the same pixels, and the only way that
 * stays true is one component. The initials fallback, the ring and the crop
 * live here once rather than twice.
 *
 * Profiles are deliberately NOT in the P3 store. The store holds what the
 * session and the live channels own — identity, permissions, the roster, the
 * threads — and a profile is none of those: it is a read of another member's
 * document, refreshed when a pane opens rather than pushed on the stream. A
 * copy in the store would be a fourth thing to keep in step with the SSE feed
 * for no reader that needs it.
 *
 * THE 413 IS SURFACED HONESTLY. The client caps an avatar image at
 * `AVATAR_IMAGE_MAX` before it ever posts, but the route caps the whole BODY
 * separately and answers 413 — a status with no JSON body worth trusting. A
 * caller gets the server's sentence when there is one and a true one when
 * there is not, never a silent failure that looks like a save.
 */
"use client";

import * as React from "react";

import Avatar from "@mui/material/Avatar";

import { token } from "@axf/core";

import type { Profile, ProfileAvatar } from "./lib/types";

/** A member's profile as the list endpoint serves it — profile + liveness. */
export type ProfileRow = Profile & { online?: boolean };

export type ProfileLoad =
  | { ok: true; profile: Profile; online: boolean; own: boolean }
  | { ok: false; error: string };

export type ProfileListLoad = { ok: true; profiles: ProfileRow[] } | { ok: false; error: string };

export type ProfileSave = { ok: true; profile: Profile } | { ok: false; error: string };

/** What the route answers with on either side of the ok/error union. */
interface ProfilePayload {
  ok?: boolean;
  error?: string;
  profile?: Profile;
  profiles?: ProfileRow[];
  online?: boolean;
  own?: boolean;
}

/** Read the body's own error line, or say honestly what the status was — a
 *  413 from the transport cap carries no error the store wrote. */
async function errorFrom(res: Response, fallback: string): Promise<string> {
  if (res.status === 413) {
    return "that profile was too large to send — pick a smaller avatar image";
  }
  try {
    const body = (await res.json()) as ProfilePayload;
    if (typeof body.error === "string" && body.error) return body.error;
  } catch {
    /* a body that will not parse tells us nothing — fall through */
  }
  return `${fallback} (HTTP ${res.status})`;
}

/** One member's profile — omit `user` for your own. */
export async function loadProfile(user?: string): Promise<ProfileLoad> {
  try {
    const res = await fetch(
      user ? `/api/accounts/profiles?user=${encodeURIComponent(user)}` : "/api/accounts/profiles",
    );
    if (!res.ok) return { ok: false, error: await errorFrom(res, "could not read that profile") };
    const body = (await res.json()) as ProfilePayload;
    if (!body.profile) return { ok: false, error: "the profile route answered with no profile" };
    return { ok: true, profile: body.profile, online: body.online === true, own: body.own === true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Every enabled member's profile, screenname order — the messenger's avatars
 *  and the members list's viewer both read this one call. */
export async function loadProfiles(): Promise<ProfileListLoad> {
  try {
    const res = await fetch("/api/accounts/profiles?list=1");
    if (!res.ok) return { ok: false, error: await errorFrom(res, "could not read the profiles") };
    const body = (await res.json()) as ProfilePayload;
    return { ok: true, profiles: Array.isArray(body.profiles) ? body.profiles : [] };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Save a patch of your own profile (or, as an administrator, `user`'s). */
export async function saveProfile(
  patch: { bio?: string; avatar?: ProfileAvatar; customFields?: { label: string; value: string }[] },
  user?: string,
): Promise<ProfileSave> {
  try {
    const res = await fetch("/api/accounts/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(user ? { ...patch, user } : patch),
    });
    if (!res.ok) return { ok: false, error: await errorFrom(res, "the profile did not save") };
    const body = (await res.json()) as ProfilePayload;
    if (!body.profile) return { ok: false, error: "the profile route answered with no profile" };
    return { ok: true, profile: body.profile };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/* --------------------------------- the avatar --------------------------------- */

/**
 * Up to two initials from a display name — "Ada Lovelace" → "AL", "casey" →
 * "C". Derived, never stored: a screenname change must move the initials with
 * it, and a stored copy is a second truth that goes stale the moment it does.
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length === 1 ? words[0].slice(0, 1) : words[0][0] + words[words.length - 1][0];
  return letters.toUpperCase();
}

export interface AvatarViewProps {
  /** The member's designed avatar, or null before their profile has loaded. */
  avatar: ProfileAvatar | null;
  /** Initials source — the screenname, else the username. */
  name: string;
  /** Square size in px. Default 32. */
  size?: number;
}

/**
 * THE avatar. An initials disc filled with the member's chosen colour, or
 * their uploaded image ringed in it — one component, so a member looks the
 * same in the roster, the thread list and the conversation header.
 *
 * An absent avatar (a profile still loading) draws the initials over the
 * theme's panel colour rather than an empty circle: a hole where a face goes
 * reads as breakage, and the initials are already correct.
 */
export function AvatarView({ avatar, name, size = 32 }: AvatarViewProps) {
  const initials = initialsOf(name);
  const color = avatar?.color ?? token("panel2");
  const image = avatar?.kind === "image" ? avatar.imageDataUrl : undefined;

  return (
    <Avatar
      src={image}
      alt={name}
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        fontSize: Math.max(9, Math.round(size * 0.4)),
        fontWeight: 700,
        // The colour is the fill for initials and the RING for an image —
        // either way the member's chosen colour is what identifies them.
        bgcolor: image ? "transparent" : color,
        color: token("page"),
        border: image ? `2px solid ${color}` : "none",
      }}
    >
      {initials}
    </Avatar>
  );
}
