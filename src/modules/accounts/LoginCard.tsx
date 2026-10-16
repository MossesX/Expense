/**
 * @file The entry card — sign-in, and the forced change-password step when the
 * session comes back flagged.
 *
 * One component for both steps because the temp password typed at sign-in is
 * the "current password" the change step needs — holding it across the
 * transition saves the user retyping it (after a reload the field is simply
 * empty and asked for).
 *
 * It lives in its own file rather than inside `./AccountsModule` because it now
 * has TWO mounts, and the second one is the whole studio's front door: the
 * `/login` route the proxy gate redirects to (`proxy.ts`). The module screen
 * still renders it when its own state says signed out, so a person who reaches
 * `/accounts` with a dead cookie sees the same card in the same place rather
 * than a second, subtly different login.
 *
 * It marks `data-axf-area="accounts.surface"` for the same reason the module's
 * signed-in root does: an arealess right-click is the coverage hole P6's area
 * walk exists to have ended, and the login pane is a surface like any other.
 */
"use client";

import * as React from "react";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { Glyph, token } from "@axf/core";

import { accountsStore } from "./store";
import type { AccountMe } from "./lib/types";

/** Run `fn` on Enter — the login fields all submit without reaching for the
 *  button, same as the reference login. */
const onEnter =
  (fn: () => void, busy: boolean) =>
  (e: React.KeyboardEvent): void => {
    if (e.key === "Enter" && !busy) fn();
  };

export default function LoginCard({ me }: { me: AccountMe | null }) {
  const step: "signin" | "change" = me?.mustChangePassword ? "change" : "signin";

  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");

  const run = async (action: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    setError(null);
    const res = await action();
    setBusy(false);
    if (!res.ok) setError(res.error ?? "something went wrong");
  };

  const signIn = () => void run(() => accountsStore.login(username.trim(), password));
  const change = () => {
    if (newPassword !== confirm) {
      setError("the two new passwords do not match");
      return;
    }
    void run(() => accountsStore.changePassword(password, newPassword));
  };

  return (
    <Box
      data-axf-area="accounts.surface"
      sx={{
        flex: 1,
        minHeight: 0,
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        p: 3,
      }}
    >
      <Stack
        key={step}
        sx={{
          width: "min(400px, 92vw)",
          background: token("panel"),
          border: `1px solid ${token("edge")}`,
          borderRadius: token("radius"),
          p: 3.5,
          gap: 2,
        }}
      >
        <Stack direction="row" sx={{ alignItems: "center", gap: 1.5 }}>
          <Glyph id="icon-account" size={26} />
          <Box>
            <Typography
              sx={{
                fontFamily: token("mono"),
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "0.16em",
              }}
            >
              ACCOUNTS
            </Typography>
            <Typography sx={{ fontSize: 11, color: token("dim") }}>
              {step === "signin" ? "Sign in to the studio" : (me?.screenname ?? me?.username)}
            </Typography>
          </Box>
        </Stack>

        {step === "signin" && (
          <>
            <TextField
              label="Username"
              size="small"
              autoFocus
              fullWidth
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={onEnter(signIn, busy)}
              slotProps={{ htmlInput: { autoCapitalize: "none", autoCorrect: "off" } }}
            />
            <TextField
              type="password"
              label="Password"
              size="small"
              fullWidth
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={onEnter(signIn, busy)}
            />
            <Button
              variant="contained"
              onClick={signIn}
              disabled={busy || !username.trim() || !password}
            >
              {busy ? <CircularProgress size={18} /> : "Sign in"}
            </Button>
            <Typography sx={{ fontSize: 11, color: token("dim") }}>
              No account? An administrator creates one and hands you a temp password — you choose
              your own on first sign-in.
            </Typography>
          </>
        )}

        {step === "change" && (
          <>
            <Alert severity="info" variant="outlined" sx={{ fontSize: 12 }}>
              A temp password is in force — choose your own before entering.
            </Alert>
            <TextField
              type="password"
              label="Temp password"
              size="small"
              fullWidth
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <TextField
              type="password"
              label="New password"
              size="small"
              autoFocus
              fullWidth
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              helperText="At least 6 characters."
            />
            <TextField
              type="password"
              label="New password again"
              size="small"
              fullWidth
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={onEnter(change, busy)}
            />
            <Button
              variant="contained"
              onClick={change}
              disabled={busy || !password || !newPassword || !confirm}
            >
              {busy ? <CircularProgress size={18} /> : "Change password"}
            </Button>
            <Button size="small" onClick={() => void accountsStore.logout()} sx={{ color: token("dim") }}>
              Sign out
            </Button>
          </>
        )}

        {error && (
          <Alert severity="error" variant="outlined" sx={{ fontSize: 12 }}>
            {error}
          </Alert>
        )}
      </Stack>
    </Box>
  );
}
