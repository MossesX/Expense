/**
 * @file **Remove a member's stored data** — the one destructive control the
 * member directory deliberately does not carry, behind a typed confirmation.
 *
 * ## Why it is a file of its own now
 *
 * It lived inside `AdminPane.tsx`'s Dashboard tab, which was the administrator
 * overview. P9 replaced that tab with the card canvas, and this is the one part
 * of the old tab that was a CAPABILITY rather than a readout — the only surface
 * in the studio that can fire `remove-user-data`. A control with exactly one
 * call site in the whole app is a control that gets deleted with the screen it
 * happened to be sitting on, so it moved out before the screen changed under it
 * and is now mounted from the canvas's Storage card, beside the numbers that
 * make somebody want it.
 *
 * The dialog itself is unchanged: the button stays dead until the username is
 * typed back exactly. A checkbox is a reflex; retyping the name is a decision.
 */
"use client";

import * as React from "react";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { token } from "@axf/core";

export interface RemoveDataDialogProps {
  username: string;
  onClose: () => void;
  /** The roots the cascade actually emptied, as the route reports them — an
   *  empty array is a real answer ("nothing stored"), not a failure. */
  onDone: (removed: string[]) => void;
}

export default function RemoveDataDialog({ username, onClose, onDone }: RemoveDataDialogProps) {
  const [typed, setTyped] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/accounts/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "remove-user-data", username }),
      });
      const body = (await res.json()) as { ok?: boolean; removed?: string[]; error?: string };
      if (!res.ok || !body.ok) {
        setError(body.error ?? `remove failed (HTTP ${res.status})`);
      } else {
        onDone(body.removed ?? []);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 15 }}>Remove stored data — “{username}”</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2 }}>
          <Typography sx={{ fontSize: 12.5 }}>
            Deletes {username}’s profile, permission grants and live presence. Message threads are
            managed separately and are not touched. There is no undo.
          </Typography>
          <TextField
            label={`Type “${username}” to confirm`}
            size="small"
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
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
          color="error"
          disabled={busy || typed.trim().toLowerCase() !== username.toLowerCase()}
          onClick={() => void go()}
        >
          {busy ? <CircularProgress size={16} /> : "Remove data"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
