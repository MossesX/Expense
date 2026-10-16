/**
 * @file The Users tab's DETAIL pane — everything the administration platform
 * knows about one member, on one surface: identity and account flags, the
 * profile (summary and edit form), the storage gauge off P1's index with a
 * rescan, sessions and presence, the generic policy editor over P2's cascade,
 * and this member's row of the permission matrix inline.
 *
 * ## Why all of it is here rather than behind six tabs
 *
 * The administrator's question is almost never "what is this member's bio" — it
 * is "why can this person not do the thing they say they cannot do", and the
 * answer is spread across three stores that each hold part of it: the account
 * row (disabled), the policy cascade (suspended, capability off), and the
 * permission matrix (module revoked). A screen that made you visit three tabs to
 * assemble that answer would be the reason the answer keeps getting got wrong.
 * So the detail pane is a scroll, and the three refusal sources sit within a
 * screen of each other.
 *
 * ## Nothing destructive fires from a bare click
 *
 * The module's doctrine, unchanged: every action here opens a deliberate
 * surface. Role change and suspension state what they will do and take a
 * confirming click; a temp password says out loud that the member's next
 * sign-in is forced through change-password. Account REMOVAL is deliberately
 * absent — it lives on `/api/accounts/users` behind the directory's confirm
 * dialog, and its data cascade lives on the overview. One door per destructive
 * act, and this phase adds no second one.
 *
 * ## Writes go through the P3 admin routes, not the member relays
 *
 * `adminApi` calls `/api/accounts/admin/users`, which audits every mutation
 * through `lib/audit.ts`. The member-facing store relays in `./store` do not,
 * because they serve surfaces where an audit record would be noise. An
 * administrator acting on somebody else is exactly the case the trail exists
 * for, so the suite uses the audited door.
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
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Glyph, registry, token } from "@axf/core";

import PolicyEditor from "./PolicyEditor";
import { useAccountsState } from "./store";
import {
  fetchPermissions,
  fetchProfile,
  fetchStorage,
  fmtBytes,
  fmtWhen,
  issueTempPassword,
  pinPolicy,
  rescanStorage,
  saveProfile,
  setCapability,
  setModuleAccess,
  setUserRole,
  unpinPolicy,
  type AdminUserRow,
  type StorageAnswer,
} from "./adminApi";
import type { AccountRole, EffectivePermissions, Profile, ProfileField } from "./lib/types";

/* ================================== chrome ================================== */

/** A titled card — the module's existing idiom (border, radius, mono caption),
 *  factored so the six sections of this pane cannot drift apart. */
function Card({
  title,
  action,
  marker,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  /** A scroll target for `AdminUserDetailProps.focusCard`. Not an area marker —
   *  the whole pane is one member, and a card is not a second subject. */
  marker?: string;
  children: React.ReactNode;
}) {
  return (
    <Box
      data-axs-detail-card={marker}
      sx={{ border: `1px solid ${token("edge")}`, borderRadius: token("radius") }}
    >
      <Stack direction="row" sx={{ alignItems: "center", gap: 1, px: 1.5, py: 0.75 }}>
        <Typography
          sx={{
            flex: 1,
            fontSize: 10.5,
            fontFamily: token("mono"),
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: token("dim"),
          }}
        >
          {title}
        </Typography>
        {action}
      </Stack>
      <Box sx={{ px: 1.5, pb: 1.5, pt: 0.25 }}>{children}</Box>
    </Box>
  );
}

/** label → value, the pane's one spelling for a fact. */
function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Stack direction="row" sx={{ gap: 1, alignItems: "baseline" }}>
      <Typography sx={{ fontSize: 11, color: token("dim"), minWidth: 110 }}>{label}</Typography>
      <Typography sx={{ fontSize: 12, minWidth: 0, wordBreak: "break-word" }}>{value}</Typography>
    </Stack>
  );
}

/* ================================= dialogs ================================== */

/** Shared submit plumbing — busy, and the server's refusal verbatim. */
function useAction(onDone: () => void) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    if (res.ok) onDone();
    else setError(res.error ?? "refused");
  };
  return { busy, error, run };
}

function RoleDialog({
  row,
  onClose,
  onDone,
}: {
  row: AdminUserRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [role, setRole] = React.useState<AccountRole>(row.role);
  const { busy, error, run } = useAction(onDone);

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 15 }}>Role — “{row.username}”</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2, pt: 1 }}>
          <TextField
            select
            label="Role"
            size="small"
            value={role}
            onChange={(e) => setRole(e.target.value as AccountRole)}
          >
            <MenuItem value="member">member</MenuItem>
            <MenuItem value="administrator">administrator</MenuItem>
          </TextField>
          <Typography sx={{ fontSize: 11.5, color: token("dim") }}>
            {role === "administrator"
              ? "An administrator passes every permission check by role — the matrix cannot refuse them anything, and they can reach this suite."
              : "A member is subject to the permission matrix and the policy cascade."}{" "}
            You cannot grant a role above your own, and nobody may demote themselves.
          </Typography>
          {error && (
            <Alert severity="error" variant="outlined" sx={{ fontSize: 12 }}>
              {error}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ color: token("dim") }}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={busy || role === row.role}
          onClick={() => void run(() => setUserRole(row.username, role))}
        >
          {busy ? <CircularProgress size={16} /> : "Change role"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function TempPasswordDialog({
  row,
  onClose,
  onDone,
}: {
  row: AdminUserRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [password, setPassword] = React.useState("");
  const { busy, error, run } = useAction(onDone);

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 15 }}>Temp password — “{row.username}”</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2, pt: 1 }}>
          <TextField
            label="New temp password"
            size="small"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            helperText="At least 6 characters. Hand it to the member out of band — their next sign-in is forced through change-password, and nothing here can read the old one back."
            slotProps={{ htmlInput: { autoCapitalize: "none", autoCorrect: "off" } }}
          />
          {error && (
            <Alert severity="error" variant="outlined" sx={{ fontSize: 12 }}>
              {error}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ color: token("dim") }}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={busy || password.length < 6}
          onClick={() => void run(() => issueTempPassword(row.username, password))}
        >
          {busy ? <CircularProgress size={16} /> : "Issue"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Suspension is THREE policy rows behaving as one fact, so it gets a dialog
 * rather than three pins nobody would set together correctly. Lifting one is a
 * DELETE of the same three keys — un-pinning, not a write of `false`, so the
 * member goes back to following the site as it moves.
 */
function SuspendDialog({
  row,
  suspended,
  onClose,
  onDone,
}: {
  row: AdminUserRow;
  suspended: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = React.useState(row.policy?.suspendedReason ?? "");
  const [until, setUntil] = React.useState(row.policy?.suspendedUntil ?? "");
  const { busy, error, run } = useAction(onDone);

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 15 }}>
        {suspended ? `Lift the suspension — “${row.username}”` : `Suspend “${row.username}”`}
      </DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2, pt: 1 }}>
          {suspended ? (
            <Typography sx={{ fontSize: 12.5 }}>
              This un-pins the three suspension rows, so {row.username} follows the site defaults
              again and can sign in. Their data is untouched — a suspension never removed any.
            </Typography>
          ) : (
            <>
              <Typography sx={{ fontSize: 12.5 }}>
                A suspension refuses sign-in and TELLS the member why. Their data is untouched.
                Distinct from disabling the account, which says nothing.
              </Typography>
              <TextField
                label="Reason (shown to them verbatim)"
                size="small"
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                helperText="Write something a person can act on — a refusal with no reason becomes a support ticket the same day."
              />
              <TextField
                label="Until (ISO date, empty = indefinite)"
                size="small"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
                helperText="e.g. 2026-09-01. It lapses on its own — a timed suspension nobody has to remember to lift is the only kind that gets used."
                slotProps={{ htmlInput: { autoCapitalize: "none", autoCorrect: "off" } }}
              />
            </>
          )}
          {error && (
            <Alert severity="error" variant="outlined" sx={{ fontSize: 12 }}>
              {error}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ color: token("dim") }}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color={suspended ? "primary" : "warning"}
          disabled={busy}
          onClick={() =>
            void run(() =>
              suspended
                ? unpinPolicy(row.username, ["suspended", "suspendedReason", "suspendedUntil"])
                : pinPolicy(row.username, {
                    suspended: true,
                    suspendedReason: reason,
                    suspendedUntil: until.trim(),
                  }),
            )
          }
        >
          {busy ? <CircularProgress size={16} /> : suspended ? "Lift suspension" : "Suspend"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ================================= storage =================================== */

/**
 * The gauge. Two numbers that are easy to confuse and must not be: `totalBytes`
 * is what this member OWNS, `sharedBytes` is attributed to them and to others
 * as well — summing the second across a roster would count the same bytes
 * repeatedly, so the bar measures the first alone and the second is named
 * beside it.
 *
 * `scannedAt` versus `updatedAt` is shown for the same reason the index carries
 * both: the distance between them is exactly how much unreconciled advisory
 * drift the number could be carrying, and an administrator about to refuse
 * somebody for being over quota deserves to know the measurement is a week old.
 */
function StorageCard({ username, quotaMB }: { username: string; quotaMB: number }) {
  const [state, setState] = React.useState<StorageAnswer | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const res = await fetchStorage(username);
    if (res.ok) {
      setState(res.data);
      setError(null);
    } else setError(res.error);
  }, [username]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const rescan = async () => {
    setBusy(true);
    const res = await rescanStorage(username);
    setBusy(false);
    if (res.ok) {
      setState(res.data);
      setError(null);
    } else setError(res.error);
  };

  const usage = state?.usage ?? null;
  const quotaBytes = quotaMB > 0 ? quotaMB * 1024 * 1024 : 0;
  const pct = usage && quotaBytes > 0 ? Math.min(100, (usage.totalBytes / quotaBytes) * 100) : 0;
  const titleFor = (id: string): string => state?.roots.find((r) => r.id === id)?.title ?? id;
  const isShared = (id: string): boolean => state?.roots.find((r) => r.id === id)?.shared === true;

  return (
    <Card
      title="Storage"
      marker="storage"
      action={
        <Tooltip title="Rebuild this member's index from disk — authoritative, and slow enough that a page load must never trigger it">
          <span>
            <IconButton size="small" disabled={busy} onClick={() => void rescan()}>
              {busy ? <CircularProgress size={13} /> : <Glyph id="icon-sync" size={13} />}
            </IconButton>
          </span>
        </Tooltip>
      }
    >
      {error && (
        <Alert severity="error" variant="outlined" sx={{ fontSize: 12, mb: 1 }}>
          {error}
        </Alert>
      )}

      {usage === null ? (
        <Typography sx={{ fontSize: 12, color: token("dim") }}>
          Never scanned — nothing can honestly say what this member uses, and a quota refuses
          nobody on the strength of a measurement that does not exist. Rescan to measure.
        </Typography>
      ) : (
        <Stack sx={{ gap: 0.75 }}>
          <Stack direction="row" sx={{ alignItems: "baseline", gap: 1 }}>
            <Typography sx={{ fontSize: 17, fontWeight: 700, fontFamily: token("mono") }}>
              {fmtBytes(usage.totalBytes)}
            </Typography>
            <Typography sx={{ fontSize: 11.5, color: token("dim") }}>
              {quotaBytes > 0 ? `of ${fmtBytes(quotaBytes)} quota` : "no quota set"}
              {usage.sharedBytes > 0 ? ` · ${fmtBytes(usage.sharedBytes)} shared with others` : ""}
            </Typography>
          </Stack>

          {quotaBytes > 0 && (
            <LinearProgress
              variant="determinate"
              value={pct}
              sx={{
                height: 6,
                borderRadius: 3,
                "& .MuiLinearProgress-bar": {
                  background: pct >= 100 ? token("err") : pct >= 80 ? token("warn") : token("accent"),
                },
              }}
            />
          )}

          <Stack sx={{ gap: 0.25, mt: 0.5 }}>
            {usage.roots.map((r) => (
              <Stack key={r.rootId} direction="row" sx={{ gap: 1, alignItems: "baseline" }}>
                <Typography sx={{ fontSize: 11, color: token("dim"), flex: 1, minWidth: 0 }}>
                  {titleFor(r.rootId)}
                  {isShared(r.rootId) ? " (shared)" : ""}
                </Typography>
                <Typography sx={{ fontSize: 11, fontFamily: token("mono") }}>
                  {fmtBytes(r.bytes)}
                </Typography>
                <Typography sx={{ fontSize: 10.5, color: token("dim"), width: 70, textAlign: "right" }}>
                  {r.files} file{r.files === 1 ? "" : "s"}
                </Typography>
              </Stack>
            ))}
          </Stack>

          <Typography sx={{ fontSize: 10.5, color: token("dim"), mt: 0.5 }}>
            Last authoritative scan {fmtWhen(usage.scannedAt)} · last change {fmtWhen(usage.updatedAt)}
          </Typography>
        </Stack>
      )}
    </Card>
  );
}

/* ================================= profile =================================== */

function ProfileCard({ username, disabled }: { username: string; disabled: boolean }) {
  const [profile, setProfile] = React.useState<Profile | null>(null);
  const [missing, setMissing] = React.useState<string | null>(null);
  const [bio, setBio] = React.useState("");
  const [fields, setFields] = React.useState<ProfileField[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const load = React.useCallback(async () => {
    const res = await fetchProfile(username);
    if (res.ok) {
      setProfile(res.data);
      setBio(res.data.bio);
      setFields(res.data.customFields.map((f) => ({ ...f })));
      setMissing(null);
    } else {
      setProfile(null);
      setMissing(res.error);
    }
  }, [username]);

  React.useEffect(() => {
    setSaved(false);
    void load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    setError(null);
    const res = await saveProfile(username, {
      bio,
      customFields: fields.filter((f) => f.label.trim() !== "" || f.value.trim() !== ""),
    });
    setBusy(false);
    if (res.ok) {
      setProfile(res.data);
      setSaved(true);
    } else setError(res.error);
  };

  if (!profile) {
    return (
      <Card title="Profile">
        <Typography sx={{ fontSize: 12, color: token("dim") }}>
          {disabled
            ? "A disabled account has no profile to show — the store returns none for one, administrators included. Re-enable the account to reach it."
            : (missing ?? "Loading…")}
        </Typography>
      </Card>
    );
  }

  const dirty =
    bio !== profile.bio ||
    JSON.stringify(fields) !== JSON.stringify(profile.customFields);

  return (
    <Card title="Profile">
      <Stack sx={{ gap: 1 }}>
        <Stack direction="row" sx={{ gap: 1.25, alignItems: "center" }}>
          <Box
            sx={{
              width: 38,
              height: 38,
              borderRadius: "50%",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: profile.avatar.kind === "image" ? "transparent" : profile.avatar.color,
              border: `1px solid ${token("edge")}`,
              overflow: "hidden",
            }}
          >
            {profile.avatar.kind === "image" && profile.avatar.imageDataUrl ? (
              // A data-url the store has already size-capped; `img` because
              // there is no MUI component for an avatar image and `Avatar`
              // would re-impose its own sizing on a disc we already drew.
              <Box
                component="img"
                src={profile.avatar.imageDataUrl}
                alt=""
                sx={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              <Typography sx={{ fontSize: 14, fontWeight: 700 }}>
                {(profile.screenname || profile.username).slice(0, 2).toUpperCase()}
              </Typography>
            )}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
              {profile.screenname || profile.username}
            </Typography>
            <Typography sx={{ fontSize: 10.5, color: token("dim") }}>
              last seen {fmtWhen(profile.lastSeenAt)} · profile updated {fmtWhen(profile.updatedAt)}
            </Typography>
          </Box>
        </Stack>

        <TextField
          label="Bio"
          size="small"
          multiline
          minRows={2}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          sx={{ "& .MuiInputBase-input": { fontSize: 12.5 } }}
        />

        {fields.map((f, i) => (
          <Stack key={i} direction="row" sx={{ gap: 1 }}>
            <TextField
              label="Label"
              size="small"
              value={f.label}
              onChange={(e) =>
                setFields((prev) => prev.map((row, j) => (j === i ? { ...row, label: e.target.value } : row)))
              }
              sx={{ width: 160, "& .MuiInputBase-input": { fontSize: 12.5 } }}
            />
            <TextField
              label="Value"
              size="small"
              value={f.value}
              onChange={(e) =>
                setFields((prev) => prev.map((row, j) => (j === i ? { ...row, value: e.target.value } : row)))
              }
              sx={{ flex: 1, "& .MuiInputBase-input": { fontSize: 12.5 } }}
            />
            <Tooltip title="Remove this field">
              <IconButton size="small" onClick={() => setFields((prev) => prev.filter((_, j) => j !== i))}>
                <Glyph id="icon-trash" size={12} />
              </IconButton>
            </Tooltip>
          </Stack>
        ))}

        <Stack direction="row" sx={{ gap: 1, alignItems: "center" }}>
          <Button
            size="small"
            startIcon={<Glyph id="icon-plus" size={11} />}
            onClick={() => setFields((prev) => [...prev, { label: "", value: "" }])}
            sx={{ fontSize: 11.5, textTransform: "none" }}
          >
            Add field
          </Button>
          <Box sx={{ flex: 1 }} />
          {saved && !dirty && (
            <Typography sx={{ fontSize: 11, color: token("ok") }}>saved</Typography>
          )}
          <Button
            size="small"
            variant="contained"
            disabled={busy || !dirty}
            onClick={() => void save()}
            sx={{ fontSize: 11.5, textTransform: "none" }}
          >
            {busy ? <CircularProgress size={14} /> : "Save profile"}
          </Button>
        </Stack>

        <Typography sx={{ fontSize: 10.5, color: token("dim") }}>
          The screenname is the member’s own choice through their profile and has no admin setter —
          the avatar likewise. This form edits what an administrator legitimately owns: the bio and
          the custom fields.
        </Typography>

        {error && (
          <Alert severity="error" variant="outlined" sx={{ fontSize: 12 }}>
            {error}
          </Alert>
        )}
      </Stack>
    </Card>
  );
}

/* =============================== permissions ================================= */

/**
 * This member's ROW of the permission matrix, inline. The same route, the same
 * no-optimistic-flip rule the full grid uses: every write answers with the
 * fresh verdict and that verdict replaces the row, so what the switch shows is
 * always what the server decided.
 *
 * An administrator's row renders locked-on, because they pass every check by
 * role and a switch that pretended otherwise would be the matrix lying.
 */
function PermissionsCard({ username }: { username: string }) {
  const [modules, setModules] = React.useState<readonly { id: string; title: string }[]>([]);
  const [perms, setPerms] = React.useState<EffectivePermissions | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busyKey, setBusyKey] = React.useState<string | null>(null);

  React.useEffect(() => {
    // Read after mount: boot populates the registry before React runs, but
    // reading at render would bake an empty SSR answer into hydration.
    setModules(registry.modules().map((m) => ({ id: m.id, title: m.title })));
  }, []);

  React.useEffect(() => {
    let stale = false;
    void (async () => {
      const res = await fetchPermissions(username);
      if (stale) return;
      if (res.ok) {
        setPerms(res.data);
        setError(null);
      } else setError(res.error);
    })();
    return () => {
      stale = true;
    };
  }, [username]);

  const adopt = async (key: string, fn: () => Promise<{ ok: boolean; error?: string; data?: EffectivePermissions }>) => {
    setBusyKey(key);
    const res = await fn();
    setBusyKey(null);
    if (res.ok && res.data) {
      setPerms(res.data);
      setError(null);
    } else setError(res.error ?? "refused");
  };

  const admin = perms?.administrator === true;

  return (
    <Card title="Module access">
      {error && (
        <Alert severity="error" variant="outlined" sx={{ fontSize: 12, mb: 1 }}>
          {error}
        </Alert>
      )}
      {!perms ? (
        <CircularProgress size={16} />
      ) : admin ? (
        <Typography sx={{ fontSize: 12, color: token("dim") }}>
          An administrator passes every permission check by role — every module, both capabilities.
          Change the role to make this row mean something.
        </Typography>
      ) : (
        <Stack sx={{ gap: 0.25 }}>
          {modules.map((m) => {
            const allowed = !perms.deniedModules.includes(m.id);
            return (
              <Stack key={m.id} direction="row" sx={{ alignItems: "center", gap: 1 }}>
                <Tooltip title={m.id}>
                  <Typography sx={{ fontSize: 12, flex: 1, minWidth: 0 }}>{m.title}</Typography>
                </Tooltip>
                <Switch
                  size="small"
                  checked={allowed}
                  disabled={busyKey === m.id}
                  slotProps={{ input: { "aria-label": `${username} may open ${m.id}` } }}
                  onChange={(_, next) => void adopt(m.id, () => setModuleAccess(username, m.id, next))}
                />
              </Stack>
            );
          })}
          {(["canMessage", "canEditProfile"] as const).map((cap) => (
            <Stack key={cap} direction="row" sx={{ alignItems: "center", gap: 1 }}>
              <Typography sx={{ fontSize: 12, flex: 1, fontStyle: "italic", color: token("dim") }}>
                {cap === "canMessage" ? "Messaging" : "Edit profile"}
              </Typography>
              <Switch
                size="small"
                checked={perms[cap]}
                disabled={busyKey === cap}
                slotProps={{ input: { "aria-label": `${username} ${cap}` } }}
                onChange={(_, next) => void adopt(cap, () => setCapability(username, cap, next))}
              />
            </Stack>
          ))}
          <Typography sx={{ fontSize: 10.5, color: token("dim"), mt: 0.5 }}>
            The two capabilities are also policy rows; either store saying no is a no, and the
            policy editor below shows the composed answer.
          </Typography>
        </Stack>
      )}
    </Card>
  );
}

/* ================================ the pane =================================== */

export interface AdminUserDetailProps {
  row: AdminUserRow;
  /** Re-read the page after a write that changed the roster row itself. */
  onChanged: () => void;
  /**
   * Scroll one of this pane's cards into view on arrival, by the marker it
   * carries (`storage` today). Null for an ordinary selection.
   *
   * This is what makes *View storage* on the member context menu a different
   * destination from *Open in admin suite* rather than the same link with a
   * second label: the Storage tab is the roster-wide accounting view and lists
   * only the largest footprints, so the one place a given member's measurement
   * always exists is this pane.
   */
  focusCard?: string | null;
}

export default function AdminUserDetail({ row, onChanged, focusCard = null }: AdminUserDetailProps) {
  const { presence } = useAccountsState();
  const [dialog, setDialog] = React.useState<"role" | "password" | "suspend" | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [policyKey, setPolicyKey] = React.useState(0);
  const paneRef = React.useRef<HTMLDivElement | null>(null);

  // After paint, and only once per (member, card): the cards below the fold
  // mount with the pane, so the node exists by the time this runs.
  React.useEffect(() => {
    if (!focusCard) return;
    const card = paneRef.current?.querySelector(`[data-axs-detail-card="${focusCard}"]`);
    card?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusCard, row.username]);

  // A different member selected is a different subject entirely — drop the
  // notice rather than leaving one person's confirmation over another's detail.
  React.useEffect(() => {
    setNotice(null);
    setDialog(null);
  }, [row.username]);

  const here = presence.find((p) => p.username.toLowerCase() === row.username.toLowerCase());
  const suspended = row.policy?.suspended === true && row.policy.lapsed !== true;

  const done = (message: string) => {
    setDialog(null);
    setNotice(message);
    setPolicyKey((n) => n + 1);
    onChanged();
  };

  return (
    <Stack
      ref={paneRef}
      // The pane is ABOUT one member, so the whole of it carries the member
      // area — right-clicking the identity header, a fact row or the storage
      // gauge all offer the same member's rows.
      data-axf-area="accounts.user-row"
      data-axf-user={row.username}
      sx={{ gap: 1.25, p: 1.5, minWidth: 0 }}
    >
      {/* ------------------------------- identity ------------------------------- */}
      <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <Typography sx={{ fontSize: 15, fontWeight: 700 }}>
          {row.screenname ?? row.username}
        </Typography>
        <Typography sx={{ fontSize: 11.5, color: token("dim"), fontFamily: token("mono") }}>
          {row.username}
        </Typography>
        <Chip
          size="small"
          variant="outlined"
          label={row.role}
          sx={{
            height: 19,
            fontSize: 10.5,
            ...(row.role === "administrator"
              ? { color: token("accent"), borderColor: token("accent") }
              : { color: token("dim") }),
          }}
        />
        {row.online && (
          <Chip
            size="small"
            variant="outlined"
            label="online"
            sx={{ height: 19, fontSize: 10.5, color: token("ok"), borderColor: token("ok") }}
          />
        )}
        {row.disabled && (
          <Chip
            size="small"
            variant="outlined"
            label="disabled"
            sx={{ height: 19, fontSize: 10.5, color: token("err"), borderColor: token("err") }}
          />
        )}
        {suspended && (
          <Chip
            size="small"
            variant="outlined"
            label="suspended"
            sx={{ height: 19, fontSize: 10.5, color: token("warn"), borderColor: token("warn") }}
          />
        )}
        {row.mustChangePassword && (
          <Chip
            size="small"
            variant="outlined"
            label="temp password"
            sx={{ height: 19, fontSize: 10.5, color: token("warn"), borderColor: token("warn") }}
          />
        )}
        {row.awaitingFirstPassword && (
          <Chip
            size="small"
            variant="outlined"
            label="no password yet"
            sx={{ height: 19, fontSize: 10.5, color: token("warn"), borderColor: token("warn") }}
          />
        )}
      </Stack>

      {/* -------------------------------- actions ------------------------------- */}
      <Stack direction="row" sx={{ gap: 0.75, flexWrap: "wrap" }}>
        <Button
          size="small"
          variant="outlined"
          onClick={() => setDialog("role")}
          sx={{ fontSize: 11.5, textTransform: "none" }}
        >
          Change role
        </Button>
        <Button
          size="small"
          variant="outlined"
          onClick={() => setDialog("password")}
          sx={{ fontSize: 11.5, textTransform: "none" }}
        >
          Temp password
        </Button>
        <Button
          size="small"
          variant="outlined"
          color={suspended ? "primary" : "warning"}
          onClick={() => setDialog("suspend")}
          sx={{ fontSize: 11.5, textTransform: "none" }}
        >
          {suspended ? "Lift suspension" : "Suspend"}
        </Button>
      </Stack>

      {notice && (
        <Alert severity="success" variant="outlined" sx={{ fontSize: 12 }} onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      {/* --------------------------------- facts -------------------------------- */}
      <Card title="Account">
        <Stack sx={{ gap: 0.4 }}>
          <Fact label="Created" value={`${fmtWhen(row.createdAt)} by ${row.createdBy}`} />
          <Fact label="Updated" value={fmtWhen(row.updatedAt)} />
          <Fact label="Last login" value={fmtWhen(row.lastLoginAt)} />
          {row.policy && (
            <Fact
              label="Sign-in"
              value={
                row.policy.loginDisabled
                  ? "disabled by policy — no reason is offered to the member"
                  : suspended
                    ? `suspended${row.policy.suspendedUntil ? ` until ${row.policy.suspendedUntil}` : " indefinitely"}${
                        row.policy.suspendedReason ? ` — “${row.policy.suspendedReason}”` : ""
                      }`
                    : row.policy.lapsed
                      ? "a suspension is recorded but has lapsed — sign-in works"
                      : "allowed"
              }
            />
          )}
        </Stack>
      </Card>

      {/* ------------------------------- sessions ------------------------------- */}
      <Card title="Sessions & presence">
        <Stack sx={{ gap: 0.4 }}>
          <Fact
            label="Now"
            value={
              here
                ? here.online
                  ? here.away
                    ? "online, away"
                    : "online"
                  : "offline"
                : "no presence record"
            }
          />
          <Fact label="Last seen" value={fmtWhen(here?.lastSeenAt ?? null)} />
          <Fact label="Concurrent cap" value="set by “Concurrent sessions” in the Quotas group below" />
        </Stack>
        <Typography sx={{ fontSize: 10.5, color: token("dim"), mt: 0.75 }}>
          A session here is a live presence stream, which is what being signed in actually costs the
          server — the same thing the concurrent-sessions policy counts. There is no per-device
          session list, so this pane does not draw one.
        </Typography>
      </Card>

      <StorageCard username={row.username} quotaMB={row.policy?.storageQuotaMB ?? 0} />

      <ProfileCard username={row.username} disabled={row.disabled} />

      <PermissionsCard username={row.username} />

      {/* -------------------------------- policy -------------------------------- */}
      <Box sx={{ mt: 0.5 }}>
        <PolicyEditor
          subject={row.username}
          reloadKey={policyKey}
          onChanged={onChanged}
        />
      </Box>

      {dialog === "role" && (
        <RoleDialog row={row} onClose={() => setDialog(null)} onDone={() => done(`Role changed for ${row.username}.`)} />
      )}
      {dialog === "password" && (
        <TempPasswordDialog
          row={row}
          onClose={() => setDialog(null)}
          onDone={() => done(`Temp password issued for ${row.username} — their next sign-in is forced through change-password.`)}
        />
      )}
      {dialog === "suspend" && (
        <SuspendDialog
          row={row}
          suspended={suspended}
          onClose={() => setDialog(null)}
          onDone={() =>
            done(suspended ? `Suspension lifted for ${row.username}.` : `${row.username} is suspended.`)
          }
        />
      )}
    </Stack>
  );
}
