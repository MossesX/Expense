/**
 * @file MY PROFILE — the member's own face in the studio, and the read-only
 * viewer every other member is seen through.
 *
 * Two exports, because they are two halves of one document: `ProfilePane`
 * (default) is the editor for your own profile, and `ProfileViewerDialog` is
 * what the members list opens on somebody else's. They share the avatar
 * renderer and the fetches in `./profileClient`, so a member looks the same in
 * both.
 *
 * ── the screenname is not a profile field ────────────────────────────────────
 *
 * It is an ACCOUNT field, and it is written through the accounts store
 * (`accountsStore.setScreenname` → `/api/accounts/session`), not through the
 * profile route. The profile engine re-syncs `screenname` from the account on
 * every read (`lib/profiles.ts`), so a write anywhere else is a value the next
 * read discards. Saving does the rename FIRST and stops on a refusal: a taken
 * name must not leave a saved bio implying the whole save went through.
 *
 * ── what the caps are, and where they come from ──────────────────────────────
 *
 * Every limit on screen is imported from `./lib/types` — the same constants the
 * server validates against, so the counter cannot promise something the store
 * then refuses. The avatar image is checked client-side at `AVATAR_IMAGE_MAX`
 * before it is ever posted, and the route's separate BODY cap (a 413) is
 * surfaced verbatim by `profileClient` rather than swallowed.
 *
 * ── rights ───────────────────────────────────────────────────────────────────
 *
 * `canEditProfile` is an administrator-controlled capability. When it is off,
 * every control here is disabled and says why — the fields still SHOW their
 * values, because a profile you may not edit is still yours to read. The
 * server re-checks it inside `updateProfile` regardless; this is the
 * affordance, never the guard.
 *
 * Settings honoured: `denseTables` tightens the custom-field rows.
 * `showOfflineMembers` has nothing to filter here — this pane renders one
 * member — so it is deliberately unread.
 */
"use client";

import * as React from "react";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";

import { Glyph, token } from "@axf/core";

import { AvatarView, initialsOf, loadProfile, saveProfile } from "./profileClient";
import { useAccountsSettings } from "./settings";
import { accountsStore, useAccountsState } from "./store";
import {
  AVATAR_IMAGE_MAX,
  BIO_MAX,
  CUSTOM_FIELDS_MAX,
  FIELD_LABEL_MAX,
  FIELD_VALUE_MAX,
  type Profile,
  type ProfileAvatar,
  type ProfileField,
} from "./lib/types";

/** A section heading — the mono/uppercase label the module's cards use. */
function SectionLabel({ text, hint }: { text: string; hint?: string }) {
  return (
    <Stack direction="row" sx={{ alignItems: "baseline", gap: 1 }}>
      <Typography
        sx={{
          fontFamily: token("mono"),
          fontSize: 10,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: token("dim"),
        }}
      >
        {text}
      </Typography>
      {hint && <Typography sx={{ fontSize: 11, color: token("dim") }}>{hint}</Typography>}
    </Stack>
  );
}

/**
 * The avatar's colour row, built from the LIVE MUI palette — which the theme
 * engine drives (`MUI_DIAL_MAP`: accent → primary, accent2 → secondary, and
 * the four status dials). So the choices on offer are always the current
 * theme's own colours, and a rolled theme offers a different six without this
 * file knowing a thing about it. A colour already on the profile that is not
 * one of the six is kept and shown last, so an older choice is never silently
 * replaced by the closest swatch.
 */
function useSwatches(current: string): string[] {
  const theme = useTheme();
  return React.useMemo(() => {
    const palette = [
      theme.palette.primary.main,
      theme.palette.secondary.main,
      theme.palette.success.main,
      theme.palette.info.main,
      theme.palette.warning.main,
      theme.palette.error.main,
    ];
    return palette.includes(current) ? palette : [...palette, current];
  }, [theme, current]);
}

function ColorSwatchRow({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (color: string) => void;
  disabled: boolean;
}) {
  const swatches = useSwatches(value);
  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={value}
      disabled={disabled}
      onChange={(_, next: string | null) => {
        // Exclusive groups report null when the selected button is clicked
        // again; an avatar always has a colour, so that is a no-op, not a clear.
        if (next) onChange(next);
      }}
      sx={{ flexWrap: "wrap", gap: 0.5, "& .MuiToggleButtonGroup-grouped": { border: 0, borderRadius: "50%" } }}
    >
      {swatches.map((c) => (
        <ToggleButton key={c} value={c} aria-label={c} sx={{ p: 0.5 }}>
          <Box
            sx={{
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: c,
              border: `2px solid ${c === value ? token("ink") : "transparent"}`,
            }}
          />
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

/* --------------------------------- the editor --------------------------------- */

type Load = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; profile: Profile };

export default function ProfilePane() {
  const { session, permissions } = useAccountsState();
  const settings = useAccountsSettings();

  const [load, setLoad] = React.useState<Load>({ kind: "loading" });
  const [screenname, setScreenname] = React.useState("");
  const [bio, setBio] = React.useState("");
  const [avatar, setAvatar] = React.useState<ProfileAvatar>({ kind: "initials", color: "#3a7bd5" });
  const [fields, setFields] = React.useState<ProfileField[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const fileRef = React.useRef<HTMLInputElement | null>(null);

  // Administrators always keep the right (the store's `resolveActor` says so);
  // for everyone else it is the administrator-controlled capability.
  const mayEdit = permissions?.administrator === true || permissions?.canEditProfile === true;

  const adopt = React.useCallback((p: Profile) => {
    setLoad({ kind: "ready", profile: p });
    setBio(p.bio);
    setAvatar(p.avatar);
    setFields(p.customFields);
  }, []);

  React.useEffect(() => {
    if (!session) return;
    setScreenname(session.screenname ?? "");
    let live = true;
    void loadProfile().then((res) => {
      if (!live) return;
      if (res.ok) adopt(res.profile);
      else setLoad({ kind: "error", message: res.error });
    });
    return () => {
      live = false;
    };
  }, [session, adopt]);

  if (!session) return null;

  if (load.kind === "loading") {
    return (
      <Box sx={{ display: "grid", placeItems: "center", p: 6 }}>
        <CircularProgress size={22} />
      </Box>
    );
  }
  if (load.kind === "error") {
    return (
      <Stack sx={{ p: 3, gap: 1.5 }}>
        <Alert severity="error" variant="outlined" sx={{ fontSize: 12.5 }}>
          {load.message}
        </Alert>
        <Button
          size="small"
          sx={{ alignSelf: "flex-start", textTransform: "none" }}
          onClick={() => {
            setLoad({ kind: "loading" });
            void loadProfile().then((res) =>
              res.ok ? adopt(res.profile) : setLoad({ kind: "error", message: res.error }),
            );
          }}
        >
          Try again
        </Button>
      </Stack>
    );
  }

  const profile = load.profile;
  const nameForInitials = screenname.trim() || session.username;
  const dirty =
    screenname.trim() !== (session.screenname ?? "") ||
    bio !== profile.bio ||
    JSON.stringify(avatar) !== JSON.stringify(profile.avatar) ||
    JSON.stringify(fields) !== JSON.stringify(profile.customFields);

  /* ------------------------------- field editing ------------------------------ */

  const patchField = (i: number, patch: Partial<ProfileField>) =>
    setFields((f) => f.map((row, n) => (n === i ? { ...row, ...patch } : row)));

  const moveField = (i: number, delta: number) =>
    setFields((f) => {
      const to = i + delta;
      if (to < 0 || to >= f.length) return f;
      const next = [...f];
      [next[i], next[to]] = [next[to], next[i]];
      return next;
    });

  /* --------------------------------- the image -------------------------------- */

  const pickImage = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    const reader = new FileReader();
    reader.onerror = () => setError("that file could not be read");
    reader.onload = () => {
      const url = typeof reader.result === "string" ? reader.result : "";
      if (!url.startsWith("data:image/")) {
        setError("that file is not an image");
        return;
      }
      // The client cap, checked before anything is posted — the same number the
      // store validates against, so the refusal here says what the server's
      // would have said, without the round trip.
      if (url.length > AVATAR_IMAGE_MAX) {
        setError(
          `avatar images are capped at ${Math.floor(AVATAR_IMAGE_MAX / 1024)} KB — that one encodes to ${Math.round(url.length / 1024)} KB. Crop or shrink it and try again.`,
        );
        return;
      }
      setAvatar((a) => ({ kind: "image", color: a.color, imageDataUrl: url }));
    };
    reader.readAsDataURL(file);
  };

  /* ----------------------------------- save ----------------------------------- */

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);

    // The rename goes first and a refusal stops the save: a taken screenname
    // that still wrote the bio would report a half-success as a success.
    const wanted = screenname.trim();
    if (wanted !== (session.screenname ?? "")) {
      const res = await accountsStore.setScreenname(wanted);
      if (!res.ok) {
        setSaving(false);
        setError(res.error);
        return;
      }
    }

    const res = await saveProfile({ bio, avatar, customFields: fields });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    adopt(res.profile);
    setSaved(true);
  };

  const dense = settings.denseTables;
  const size = dense ? "small" : "medium";

  return (
    <Stack sx={{ p: 2, gap: 2, minWidth: 0, maxWidth: 760 }}>
      {/* ------------------------------- identity ------------------------------- */}
      <Stack direction="row" sx={{ gap: 2, alignItems: "flex-start" }}>
        <AvatarView
          avatar={avatar.kind === "initials" ? { ...avatar } : avatar}
          name={nameForInitials}
          size={84}
        />
        <Stack sx={{ flex: 1, minWidth: 0, gap: 1 }}>
          <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
            <Typography sx={{ fontSize: 15, fontWeight: 700 }}>My profile</Typography>
            <Chip
              label={session.role}
              size="small"
              variant="outlined"
              sx={{
                fontSize: 11,
                height: 20,
                ...(session.role === "administrator"
                  ? { color: token("accent"), borderColor: token("accent") }
                  : { color: token("dim") }),
              }}
            />
            <Typography sx={{ fontSize: 11.5, color: token("dim"), fontFamily: token("mono") }}>
              {session.username}
            </Typography>
          </Stack>
          <TextField
            label="Screenname"
            size="small"
            value={screenname}
            disabled={!mayEdit}
            onChange={(e) => setScreenname(e.target.value.slice(0, 24))}
            helperText="3–24 characters: letters, digits, spaces, . _ ' - — this is the name the roster, your messages and every mention of you show."
            sx={{ maxWidth: 420 }}
          />
        </Stack>
      </Stack>

      {!mayEdit && (
        <Alert severity="info" variant="outlined" sx={{ fontSize: 12 }}>
          An administrator has switched profile editing off for your account. Your profile is
          shown as it stands and the controls are disabled — nothing has been lost.
        </Alert>
      )}

      <Divider />

      {/* -------------------------------- avatar -------------------------------- */}
      <Stack sx={{ gap: 1 }}>
        <SectionLabel
          text="Avatar"
          hint={`initials are drawn from your screenname — “${initialsOf(nameForInitials)}”`}
        />
        <Stack direction="row" sx={{ gap: 2, alignItems: "center", flexWrap: "wrap" }}>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={avatar.kind}
            disabled={!mayEdit}
            onChange={(_, next: ProfileAvatar["kind"] | null) => {
              if (!next) return;
              // Switching to initials KEEPS the uploaded image in state so a
              // change of mind is free — only a save discards it, and the
              // store's normalizer drops the field for an initials avatar.
              setAvatar((a) => (next === "image" ? { ...a, kind: "image" } : { kind: "initials", color: a.color }));
            }}
          >
            <ToggleButton value="initials" sx={{ textTransform: "none", fontSize: 12.5, px: 1.5 }}>
              Initials
            </ToggleButton>
            <ToggleButton
              value="image"
              disabled={!avatar.imageDataUrl}
              sx={{ textTransform: "none", fontSize: 12.5, px: 1.5 }}
            >
              Image
            </ToggleButton>
          </ToggleButtonGroup>

          <Button
            size="small"
            variant="outlined"
            disabled={!mayEdit}
            startIcon={<Glyph id="icon-plus" size={12} />}
            onClick={() => fileRef.current?.click()}
            sx={{ textTransform: "none", fontSize: 12.5 }}
          >
            {avatar.imageDataUrl ? "Replace image" : "Upload an image"}
          </Button>
          {/* The picker itself is never seen — the Button above it is the
              control. `Box component="input"` rather than a raw <input>, the
              same shape the amberxvid gallery and the expenses vault use for
              theirs: check:ui's rule is that where an MUI component exists it
              is used, and a hidden field is not an exception to it. */}
          <Box
            component="input"
            ref={fileRef}
            type="file"
            accept="image/*"
            sx={{ display: "none" }}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              pickImage(e.target.files?.[0]);
              // Clearing the input lets the same file be picked twice — a
              // browser fires no change event for an unchanged value.
              e.target.value = "";
            }}
          />
          {avatar.imageDataUrl && (
            <Typography sx={{ fontSize: 11, color: token("dim") }}>
              {Math.round(avatar.imageDataUrl.length / 1024)} KB of{" "}
              {Math.floor(AVATAR_IMAGE_MAX / 1024)} KB
            </Typography>
          )}
        </Stack>

        <Stack direction="row" sx={{ gap: 1.5, alignItems: "center", flexWrap: "wrap" }}>
          <Typography sx={{ fontSize: 12, color: token("dim") }}>
            {avatar.kind === "initials" ? "Disc colour" : "Ring colour"}
          </Typography>
          <ColorSwatchRow
            value={avatar.color}
            disabled={!mayEdit}
            onChange={(color) => setAvatar((a) => ({ ...a, color }))}
          />
        </Stack>
      </Stack>

      <Divider />

      {/* ---------------------------------- bio --------------------------------- */}
      <Stack sx={{ gap: 1 }}>
        <SectionLabel text="Bio" hint={`${bio.length} / ${BIO_MAX}`} />
        <TextField
          multiline
          minRows={3}
          maxRows={12}
          size="small"
          fullWidth
          disabled={!mayEdit}
          placeholder="Tell the other members who you are and what you work on…"
          value={bio}
          onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))}
        />
      </Stack>

      <Divider />

      {/* ------------------------------ custom fields --------------------------- */}
      <Stack sx={{ gap: 1 }}>
        <SectionLabel
          text="Custom fields"
          hint={`${fields.length} of ${CUSTOM_FIELDS_MAX} — anything you want on your card`}
        />
        <Stack sx={{ gap: dense ? 0.5 : 1 }}>
          {fields.map((f, i) => (
            <Stack key={i} direction="row" sx={{ gap: 1, alignItems: "center" }}>
              <TextField
                label={i === 0 ? "Label" : undefined}
                placeholder="Location"
                size={size}
                disabled={!mayEdit}
                value={f.label}
                onChange={(e) => patchField(i, { label: e.target.value.slice(0, FIELD_LABEL_MAX) })}
                sx={{ width: 190 }}
              />
              <TextField
                label={i === 0 ? "Value" : undefined}
                placeholder="the garage"
                size={size}
                disabled={!mayEdit}
                value={f.value}
                onChange={(e) => patchField(i, { value: e.target.value.slice(0, FIELD_VALUE_MAX) })}
                sx={{ flex: 1, minWidth: 0 }}
              />
              <Tooltip title="Move up">
                <span>
                  <IconButton size="small" disabled={!mayEdit || i === 0} onClick={() => moveField(i, -1)}>
                    <Glyph id="icon-chevron-up" size={13} />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Move down">
                <span>
                  <IconButton
                    size="small"
                    disabled={!mayEdit || i === fields.length - 1}
                    onClick={() => moveField(i, 1)}
                  >
                    <Glyph id="icon-chevron-down" size={13} />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Remove this field">
                <span>
                  <IconButton
                    size="small"
                    disabled={!mayEdit}
                    onClick={() => setFields((rows) => rows.filter((_, n) => n !== i))}
                  >
                    <Glyph id="icon-trash" size={13} />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
          ))}
          {fields.length === 0 && (
            <Typography sx={{ fontSize: 12.5, color: token("dim") }}>
              No custom fields yet — they are the rows on your profile card, like “Location: the
              garage” or “Timezone: UTC+1”.
            </Typography>
          )}
        </Stack>
        <Button
          size="small"
          startIcon={<Glyph id="icon-plus" size={12} />}
          disabled={!mayEdit || fields.length >= CUSTOM_FIELDS_MAX}
          onClick={() => setFields((f) => [...f, { label: "", value: "" }])}
          sx={{ alignSelf: "flex-start", textTransform: "none", fontSize: 12.5 }}
        >
          {fields.length >= CUSTOM_FIELDS_MAX ? `${CUSTOM_FIELDS_MAX} is the limit` : "Add field"}
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" variant="outlined" sx={{ fontSize: 12 }}>
          {error}
        </Alert>
      )}
      {saved && !dirty && (
        <Alert severity="success" variant="outlined" sx={{ fontSize: 12 }}>
          Profile saved — it is what every other member sees.
        </Alert>
      )}

      <Stack direction="row" sx={{ gap: 1, alignItems: "center" }}>
        <Button
          variant="contained"
          disabled={!mayEdit || !dirty || saving}
          onClick={() => void save()}
          sx={{ textTransform: "none" }}
        >
          {saving ? <CircularProgress size={16} /> : "Save profile"}
        </Button>
        <Button
          disabled={!dirty || saving}
          onClick={() => {
            setScreenname(session.screenname ?? "");
            adopt(profile);
            setError(null);
          }}
          sx={{ color: token("dim"), textTransform: "none" }}
        >
          Discard changes
        </Button>
        <Typography sx={{ fontSize: 11, color: token("dim") }}>
          Last updated {new Date(profile.updatedAt).toLocaleString()}
        </Typography>
      </Stack>
    </Stack>
  );
}

/* --------------------------------- the viewer --------------------------------- */

/**
 * Another member's profile, read-only — opened from the members list.
 *
 * It is read-only for EVERYONE, administrators included: `updateProfile` lets
 * an admin edit anyone's profile, but doing it from a viewer dialog is how
 * somebody edits a colleague's bio while meaning to read it. The admin path
 * for that is the Admin pane, deliberately.
 *
 * A disabled member has no profile to show: `getProfile` returns null for one,
 * so the route 404s — for administrators too, which is the store hiding
 * disabled rows from this door rather than the UI pretending to. The dialog
 * relays that refusal instead of rendering an empty card.
 */
export function ProfileViewerDialog({ username, onClose }: { username: string; onClose: () => void }) {
  const [load, setLoad] = React.useState<
    { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; profile: Profile; online: boolean; own: boolean }
  >({ kind: "loading" });

  React.useEffect(() => {
    let live = true;
    void loadProfile(username).then((res) => {
      if (!live) return;
      setLoad(
        res.ok
          ? { kind: "ready", profile: res.profile, online: res.online, own: res.own }
          : { kind: "error", message: res.error },
      );
    });
    return () => {
      live = false;
    };
  }, [username]);

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: 15 }}>Profile</DialogTitle>
      <DialogContent dividers>
        {load.kind === "loading" && (
          <Box sx={{ display: "grid", placeItems: "center", py: 4 }}>
            <CircularProgress size={22} />
          </Box>
        )}
        {load.kind === "error" && (
          <Alert severity="warning" variant="outlined" sx={{ fontSize: 12.5 }}>
            {load.message}
          </Alert>
        )}
        {load.kind === "ready" && (
          <Stack sx={{ gap: 2 }}>
            <Stack direction="row" sx={{ gap: 2, alignItems: "center" }}>
              <AvatarView avatar={load.profile.avatar} name={load.profile.screenname} size={72} />
              <Stack sx={{ minWidth: 0, gap: 0.25 }}>
                <Typography sx={{ fontSize: 17, fontWeight: 700 }}>
                  {load.profile.screenname}
                </Typography>
                <Typography sx={{ fontSize: 11.5, color: token("dim"), fontFamily: token("mono") }}>
                  {load.profile.username}
                  {load.own && " · this is you"}
                </Typography>
                <Typography sx={{ fontSize: 11.5, color: load.online ? token("ok") : token("dim") }}>
                  {load.online
                    ? "Online now"
                    : load.profile.lastSeenAt
                      ? `Last seen ${new Date(load.profile.lastSeenAt).toLocaleString()}`
                      : "Has not connected yet"}
                </Typography>
              </Stack>
            </Stack>

            <Stack sx={{ gap: 0.5 }}>
              <SectionLabel text="Bio" />
              <Typography
                sx={{
                  fontSize: 12.5,
                  whiteSpace: "pre-wrap",
                  color: load.profile.bio ? token("ink") : token("dim"),
                  fontStyle: load.profile.bio ? "normal" : "italic",
                }}
              >
                {load.profile.bio || `${load.profile.screenname} has not written a bio yet.`}
              </Typography>
            </Stack>

            {load.profile.customFields.length > 0 && (
              <Stack sx={{ gap: 0.5 }}>
                <SectionLabel text="Details" />
                {load.profile.customFields.map((f, i) => (
                  <Stack key={i} direction="row" sx={{ gap: 1 }}>
                    <Typography sx={{ fontSize: 12.5, color: token("dim"), width: 150, flexShrink: 0 }}>
                      {f.label}
                    </Typography>
                    <Typography sx={{ fontSize: 12.5, whiteSpace: "pre-wrap", minWidth: 0 }}>
                      {f.value}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            )}

            {load.own && (
              <Typography sx={{ fontSize: 11.5, color: token("dim") }}>
                Edit this on the My profile tab.
              </Typography>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ textTransform: "none" }}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
