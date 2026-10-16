/**
 * @file The member directory — every signed-in user's view of who is in the
 * studio (presence dot, screenname, role), and the administrator's account
 * CRUD on top of the same table: add member, edit (role / disable), reset
 * password, remove.
 *
 * Every mutation goes through the P3 store's admin relays to
 * `POST /api/accounts/users`, and the SERVER is the guard — `requireAdmin`
 * and the self-lockout refusals live in the accounts store behind that route,
 * so the dialogs here relay refusal text verbatim rather than re-implementing
 * policy. Destructive actions (remove) sit behind an explicit confirm Dialog.
 *
 * A member's name in the table opens the read-only profile viewer
 * (`ProfileViewerDialog`, P5) — the directory is where you look somebody up,
 * so it is where their card opens from.
 *
 * Screennames are deliberately absent from the add/edit dialogs: the server
 * has no admin setter for them (`setScreenname` takes the session user only),
 * because a screenname is the member's own choice, made through the profile
 * engine on first entry (P5). The add dialog says so instead of pretending.
 *
 * Settings honoured: `showOfflineMembers` filters the roster to live
 * connections (self always shown); `denseTables` drives the table density.
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
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Glyph, token } from "@axf/core";

import CreditsDialog from "./CreditsDialog";
import { ProfileViewerDialog } from "./ProfilePane";
import { useAccountsSettings } from "./settings";
import { accountsStore, useAccountsState, type ActionResult } from "./store";
import type { AccountPublic, AccountRole } from "./lib/types";

/** Online/offline as a dot, the roster's one-glance liveness read. */
function PresenceDot({ online }: { online: boolean }) {
  return (
    <Box
      component="span"
      aria-label={online ? "online" : "offline"}
      title={online ? "Online" : "Offline"}
      sx={{
        width: 9,
        height: 9,
        borderRadius: "50%",
        flexShrink: 0,
        background: online ? token("ok") : "transparent",
        border: `1.5px solid ${online ? token("ok") : token("dim")}`,
        opacity: online ? 1 : 0.6,
      }}
    />
  );
}

/** Shared submit plumbing for the four dialogs: busy state + the server's
 *  refusal surfaced verbatim. */
function useSubmit(onDone: () => void) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const submit = async (action: () => Promise<ActionResult>) => {
    setBusy(true);
    setError(null);
    const res = await action();
    setBusy(false);
    if (res.ok) onDone();
    else setError(res.error);
  };
  return { busy, error, submit };
}

function AddUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [username, setUsername] = React.useState("");
  const [tempPassword, setTempPassword] = React.useState("");
  const [role, setRole] = React.useState<AccountRole>("member");
  const { busy, error, submit } = useSubmit(onClose);

  // Field state resets per opening, so a cancelled add does not haunt the next.
  React.useEffect(() => {
    if (open) {
      setUsername("");
      setTempPassword("");
      setRole("member");
    }
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 15 }}>Add member</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2, pt: 1 }}>
          <TextField
            label="Username"
            size="small"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            helperText="2–32 characters: letters, digits, . _ -"
            slotProps={{ htmlInput: { autoCapitalize: "none", autoCorrect: "off" } }}
          />
          <TextField
            label="Temp password"
            size="small"
            value={tempPassword}
            onChange={(e) => setTempPassword(e.target.value)}
            helperText="At least 6 characters. The member signs in with it once and is forced to choose their own; they pick their screenname themselves on first entry."
          />
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
          disabled={busy || !username.trim() || tempPassword.length < 6}
          onClick={() => void submit(() => accountsStore.addUser(username, tempPassword, role))}
        >
          {busy ? <CircularProgress size={16} /> : "Add member"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function EditUserDialog({ user, onClose }: { user: AccountPublic; onClose: () => void }) {
  const [role, setRole] = React.useState<AccountRole>(user.role);
  const [disabled, setDisabled] = React.useState(user.disabled);
  const { busy, error, submit } = useSubmit(onClose);

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 15 }}>Edit “{user.username}”</DialogTitle>
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
          <FormControlLabel
            control={<Switch checked={disabled} onChange={(e) => setDisabled(e.target.checked)} />}
            label={<Typography sx={{ fontSize: 13 }}>Disabled — sign-in refused</Typography>}
          />
          <Typography sx={{ fontSize: 11, color: token("dim") }}>
            The screenname is {user.screenname ? `“${user.screenname}”` : "not chosen yet"} — it is
            the member’s own choice, made through their profile, and has no admin setter.
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
          disabled={busy}
          onClick={() => void submit(() => accountsStore.updateUser(user.username, { role, disabled }))}
        >
          {busy ? <CircularProgress size={16} /> : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: AccountPublic; onClose: () => void }) {
  const [tempPassword, setTempPassword] = React.useState("");
  const { busy, error, submit } = useSubmit(onClose);

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 15 }}>Reset password — “{user.username}”</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2, pt: 1 }}>
          <TextField
            label="New temp password"
            size="small"
            autoFocus
            value={tempPassword}
            onChange={(e) => setTempPassword(e.target.value)}
            helperText="Hand this to the member. Their next sign-in is forced through change-password."
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
          disabled={busy || tempPassword.length < 6}
          onClick={() =>
            void submit(() => accountsStore.resetPassword(user.username, tempPassword))
          }
        >
          {busy ? <CircularProgress size={16} /> : "Reset"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function RemoveUserDialog({ user, onClose }: { user: AccountPublic; onClose: () => void }) {
  const { busy, error, submit } = useSubmit(onClose);

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 15 }}>Remove “{user.username}”?</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 1.5 }}>
          <Typography sx={{ fontSize: 12.5 }}>
            This removes the account row — {user.username} can no longer sign in. Their stored
            data (profile, messages, permission grants) is kept until an administrator removes it
            from the Admin pane.
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
          color="error"
          disabled={busy}
          onClick={() => void submit(() => accountsStore.removeUser(user.username))}
        >
          {busy ? <CircularProgress size={16} /> : "Remove account"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

type DialogState =
  | { kind: "add" }
  | { kind: "edit"; user: AccountPublic }
  | { kind: "reset"; user: AccountPublic }
  | { kind: "remove"; user: AccountPublic }
  /** P18 — the AI credit console: this member's balance, their ledger, and the
   *  grant/revoke control. Administrator-only, and it opens from the row for
   *  the same reason Edit does: it is a fact about this person, so it belongs
   *  beside the rest of their detail rather than on a screen of its own. */
  | { kind: "credits"; user: AccountPublic }
  /** The read-only profile viewer — every signed-in member may open it on any
   *  member they can see, which is what makes the directory a directory rather
   *  than a list of strings. */
  | { kind: "view"; user: AccountPublic }
  | null;

export default function UsersPane() {
  const { users, presence, session, permissions } = useAccountsState();
  const settings = useAccountsSettings();
  const [filter, setFilter] = React.useState("");
  const [dialog, setDialog] = React.useState<DialogState>(null);

  const administrator = permissions?.administrator === true;
  const meName = session?.username.toLowerCase() ?? "";

  const onlineBy = React.useMemo(
    () => new Map(presence.map((p) => [p.username.toLowerCase(), p.online])),
    [presence],
  );

  const needle = filter.trim().toLowerCase();
  const visible = users.filter((u) => {
    const self = u.username.toLowerCase() === meName;
    if (!settings.showOfflineMembers && !self && !(onlineBy.get(u.username.toLowerCase()) ?? false)) {
      return false;
    }
    if (!needle) return true;
    return (
      u.username.toLowerCase().includes(needle) ||
      (u.screenname ?? "").toLowerCase().includes(needle)
    );
  });

  return (
    <Stack sx={{ p: 2, gap: 1.5, minWidth: 0 }}>
      <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 700, flex: 1 }}>
          Members
          <Typography component="span" sx={{ fontSize: 11.5, color: token("dim"), ml: 1 }}>
            {visible.length} of {users.length}
            {settings.showOfflineMembers ? "" : " (online only)"}
          </Typography>
        </Typography>
        <TextField
          placeholder="Search members…"
          size="small"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Glyph id="icon-search" size={13} />
                </InputAdornment>
              ),
            },
          }}
          sx={{ width: 220, "& .MuiInputBase-input": { fontSize: 12.5 } }}
        />
        <Tooltip title="Refresh the directory">
          <IconButton size="small" onClick={() => void accountsStore.refreshUsers()}>
            <Glyph id="icon-sync" size={14} />
          </IconButton>
        </Tooltip>
        {administrator && (
          <Button
            variant="contained"
            size="small"
            startIcon={<Glyph id="icon-plus" size={12} />}
            onClick={() => setDialog({ kind: "add" })}
            sx={{ textTransform: "none", fontSize: 12.5 }}
          >
            Add member
          </Button>
        )}
      </Stack>

      <Table size={settings.denseTables ? "small" : "medium"}>
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontSize: 11.5, color: token("dim") }}>Member</TableCell>
            <TableCell sx={{ fontSize: 11.5, color: token("dim") }}>Username</TableCell>
            <TableCell sx={{ fontSize: 11.5, color: token("dim") }}>Role</TableCell>
            <TableCell sx={{ fontSize: 11.5, color: token("dim") }}>Joined</TableCell>
            {administrator && (
              <>
                <TableCell sx={{ fontSize: 11.5, color: token("dim") }}>Status</TableCell>
                <TableCell sx={{ fontSize: 11.5, color: token("dim") }} align="right">
                  Actions
                </TableCell>
              </>
            )}
          </TableRow>
        </TableHead>
        <TableBody>
          {visible.map((u) => {
            const online = onlineBy.get(u.username.toLowerCase()) ?? false;
            const self = u.username.toLowerCase() === meName;
            return (
              <TableRow key={u.username} hover>
                <TableCell>
                  <Stack direction="row" sx={{ alignItems: "center", gap: 1.25 }}>
                    <PresenceDot online={online} />
                    {u.disabled ? (
                      // A disabled account has no profile to show — `getProfile`
                      // returns null for one, so the route 404s for everybody,
                      // administrators included. Offering the viewer here would
                      // be an affordance that only ever produces a refusal.
                      <Tooltip title="A disabled account has no profile to view">
                        <Typography sx={{ fontSize: 13, fontWeight: 600, color: token("dim") }}>
                          {u.screenname ?? "—"}
                        </Typography>
                      </Tooltip>
                    ) : (
                      <Button
                        size="small"
                        onClick={() => setDialog({ kind: "view", user: u })}
                        sx={{
                          fontSize: 13,
                          fontWeight: 600,
                          textTransform: "none",
                          p: 0,
                          minWidth: 0,
                          color: token("ink"),
                          justifyContent: "flex-start",
                        }}
                      >
                        {u.screenname ?? "—"}
                      </Button>
                    )}
                    {self && (
                      <Typography component="span" sx={{ fontSize: 11, color: token("dim") }}>
                        (you)
                      </Typography>
                    )}
                  </Stack>
                </TableCell>
                <TableCell sx={{ fontFamily: token("mono"), fontSize: 12.5 }}>{u.username}</TableCell>
                <TableCell>
                  <Chip
                    label={u.role}
                    size="small"
                    variant="outlined"
                    sx={{
                      fontSize: 11,
                      height: 20,
                      ...(u.role === "administrator"
                        ? { color: token("accent"), borderColor: token("accent") }
                        : { color: token("dim") }),
                    }}
                  />
                </TableCell>
                <TableCell sx={{ fontSize: 12, color: token("dim") }}>
                  {new Date(u.createdAt).toLocaleDateString()}
                </TableCell>
                {administrator && (
                  <>
                    <TableCell>
                      {u.disabled ? (
                        <Chip
                          label="disabled"
                          size="small"
                          sx={{ fontSize: 11, height: 20, color: token("err") }}
                          variant="outlined"
                        />
                      ) : (
                        <Typography sx={{ fontSize: 12, color: token("dim") }}>enabled</Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" sx={{ gap: 0.5, justifyContent: "flex-end" }}>
                        <Button
                          size="small"
                          onClick={() => setDialog({ kind: "edit", user: u })}
                          sx={{ fontSize: 11.5, textTransform: "none" }}
                        >
                          Edit
                        </Button>
                        <Button
                          size="small"
                          onClick={() => setDialog({ kind: "reset", user: u })}
                          sx={{ fontSize: 11.5, textTransform: "none" }}
                        >
                          Reset password
                        </Button>
                        <Tooltip title={`AI credits — grant, revoke and the ledger for ${u.username}`}>
                          <Button
                            size="small"
                            onClick={() => setDialog({ kind: "credits", user: u })}
                            sx={{ fontSize: 11.5, textTransform: "none" }}
                          >
                            Credits
                          </Button>
                        </Tooltip>
                        <Tooltip title={`Remove ${u.username}`}>
                          <IconButton size="small" onClick={() => setDialog({ kind: "remove", user: u })}>
                            <Glyph id="icon-trash" size={13} />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </TableCell>
                  </>
                )}
              </TableRow>
            );
          })}
          {visible.length === 0 && (
            <TableRow>
              <TableCell colSpan={administrator ? 6 : 4}>
                <Typography sx={{ fontSize: 12.5, color: token("dim"), py: 1 }}>
                  {users.length === 0
                    ? "No members loaded yet."
                    : needle
                      ? `No member matches “${filter.trim()}”.`
                      : "Nobody is online right now — switch “show offline members” back on in the module settings to see the full roster."}
                </Typography>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <AddUserDialog open={dialog?.kind === "add"} onClose={() => setDialog(null)} />
      {dialog?.kind === "edit" && <EditUserDialog user={dialog.user} onClose={() => setDialog(null)} />}
      {dialog?.kind === "reset" && (
        <ResetPasswordDialog user={dialog.user} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "remove" && (
        <RemoveUserDialog user={dialog.user} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "credits" && (
        <CreditsDialog username={dialog.user.username} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "view" && (
        <ProfileViewerDialog username={dialog.user.username} onClose={() => setDialog(null)} />
      )}
    </Stack>
  );
}
