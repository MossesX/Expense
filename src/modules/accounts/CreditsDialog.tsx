"use client";

/**
 * @file **The credit console for one member** — the administrator's grant and
 * revoke surface, beside the user detail it is about (P18).
 *
 * It opens from the member's own row in the directory, next to Edit and Reset
 * password, because that is where an administrator is already standing when the
 * question comes up. A separate "Credits" screen listing every member would be
 * a second place to look up a person, and the directory is the first.
 *
 * Three properties this file exists to keep:
 *
 * - **The ledger is shown, not just the number.** A balance with no history is
 *   an assertion; the entries are what let an administrator answer "where did
 *   those go". Newest first, with the actor on every row — including their own
 *   grants, which is the point.
 * - **A revoke is the same control as a grant.** One signed field, not two
 *   buttons. An administrator who means "take fifty back" types `-50`, and the
 *   surface says what that will do before they commit. Two buttons is how a
 *   grant gets clicked when a revoke was meant.
 * - **The server's refusal is relayed verbatim.** The clamp rule (a revoke
 *   larger than the balance moves the balance to zero) lives in
 *   `lib/credits.ts`, and this dialog does not restate it — a second copy of a
 *   money rule is a second copy that drifts.
 *
 * The reason field is not optional in spirit: it becomes the entry's `ref`, and
 * `ref` is the only thing on a ledger row that says WHY. The store supplies a
 * dull default rather than refusing an empty one, because an administrator
 * blocked at 2am by a required text field will type "x".
 */

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
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { token } from "@axf/core";

import type { CreditKind, CreditStatement } from "./lib/types";

/** The colour each kind reads in. Purchases and grants add, spends subtract,
 *  refunds are a correction — the eye should tell them apart before the sign. */
const KIND_COLOR: Record<CreditKind, string> = {
  purchase: "ok",
  grant: "accent",
  spend: "dim",
  refund: "warn",
};

const fmtDelta = (n: number): string => (n > 0 ? `+${n}` : String(n));

export interface CreditsDialogProps {
  /** Whose ledger. Lowercased server-side; passed as the account holds it. */
  username: string;
  onClose: () => void;
}

export default function CreditsDialog({ username, onClose }: CreditsDialogProps) {
  const [statement, setStatement] = React.useState<CreditStatement | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [delta, setDelta] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`/api/accounts/credits?user=${encodeURIComponent(username)}`);
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; statement?: CreditStatement }
        | null;
      if (!res.ok || !json?.ok || !json.statement) {
        setLoadError(json?.error ?? `the ledger could not be read (${res.status})`);
        return;
      }
      setStatement(json.statement);
    } catch {
      setLoadError("the ledger could not be reached");
    }
  }, [username]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const amount = Number(delta);
  const valid = Number.isFinite(amount) && Math.round(amount) !== 0;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/accounts/credits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "grant", username, delta: Math.round(amount), reason }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; balance?: number; statement?: CreditStatement }
        | null;
      if (!res.ok || !json?.ok) {
        // Verbatim — the clamp and insufficient-balance wordings are the
        // store's, and it names the number that caused them.
        setError(json?.error ?? `the grant failed (${res.status})`);
        return;
      }
      if (json.statement) setStatement(json.statement);
      else await load();
      setNote(
        `${Math.round(amount) > 0 ? "Granted" : "Revoked"} ${Math.abs(Math.round(amount))} — ` +
          `balance is now ${json.balance ?? "?"}.`,
      );
      setDelta("");
      setReason("");
    } catch {
      setError("the grant could not be sent");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: 15 }}>
        AI credits — “{username}”
        {statement && (
          <Chip
            label={`${statement.balance} credit${statement.balance === 1 ? "" : "s"}`}
            size="small"
            sx={{
              ml: 1.25,
              fontSize: 11.5,
              height: 22,
              fontFamily: token("mono"),
              color: token("accent"),
              borderColor: token("accent"),
            }}
            variant="outlined"
          />
        )}
      </DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2, pt: 1 }}>
          {loadError && (
            <Alert severity="error" variant="outlined" sx={{ fontSize: 12 }}>
              {loadError}
            </Alert>
          )}

          {/* ── the one signed control ─────────────────────────────────────── */}
          <Stack direction="row" sx={{ gap: 1.5, alignItems: "flex-start" }}>
            <TextField
              label="Credits"
              size="small"
              autoFocus
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              helperText="Positive grants, negative revokes"
              sx={{ width: 150 }}
              slotProps={{ htmlInput: { inputMode: "numeric" } }}
            />
            <TextField
              label="Reason"
              size="small"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              helperText="Recorded on the entry — it is the only field that says why"
              sx={{ flex: 1 }}
            />
          </Stack>

          {valid && statement && (
            <Typography sx={{ fontSize: 12, color: token("dim") }}>
              {statement.balance} → {Math.max(0, statement.balance + Math.round(amount))}
              {Math.round(amount) < 0 && statement.balance + Math.round(amount) < 0
                ? " — the revoke is larger than the balance, so it will stop at zero"
                : ""}
            </Typography>
          )}

          {error && (
            <Alert severity="error" variant="outlined" sx={{ fontSize: 12 }}>
              {error}
            </Alert>
          )}
          {note && (
            <Alert severity="success" variant="outlined" sx={{ fontSize: 12 }}>
              {note}
            </Alert>
          )}

          {/* ── the ledger ─────────────────────────────────────────────────── */}
          <Box>
            <Typography sx={{ fontSize: 11.5, color: token("dim"), mb: 0.5 }}>
              {statement
                ? statement.total === 0
                  ? "No credit has ever moved for this member."
                  : `${statement.entries.length} of ${statement.total} entries, newest first`
                : "Reading the ledger…"}
            </Typography>
            {statement && statement.entries.length > 0 && (
              <Box sx={{ maxHeight: 260, overflowY: "auto", border: `1px solid ${token("edge")}` }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontSize: 11, color: token("dim") }}>When</TableCell>
                      <TableCell sx={{ fontSize: 11, color: token("dim") }}>Kind</TableCell>
                      <TableCell sx={{ fontSize: 11, color: token("dim") }} align="right">
                        Δ
                      </TableCell>
                      <TableCell sx={{ fontSize: 11, color: token("dim") }}>Reference</TableCell>
                      <TableCell sx={{ fontSize: 11, color: token("dim") }}>By</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {statement.entries.map((e) => (
                      <TableRow key={e.id} hover>
                        <TableCell sx={{ fontSize: 11.5, color: token("dim"), whiteSpace: "nowrap" }}>
                          {new Date(e.at).toLocaleString()}
                        </TableCell>
                        <TableCell sx={{ fontSize: 11.5, color: token(KIND_COLOR[e.kind]) }}>
                          {e.kind}
                        </TableCell>
                        <TableCell
                          align="right"
                          sx={{
                            fontFamily: token("mono"),
                            fontSize: 12,
                            fontVariantNumeric: "tabular-nums",
                            color: e.delta > 0 ? token("ok") : token("ink"),
                          }}
                        >
                          {fmtDelta(e.delta)}
                        </TableCell>
                        <TableCell sx={{ fontSize: 11.5 }}>{e.ref}</TableCell>
                        <TableCell sx={{ fontSize: 11.5, color: token("dim") }}>{e.actor}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ color: token("dim") }}>
          Close
        </Button>
        <Button variant="contained" disabled={busy || !valid} onClick={() => void submit()}>
          {busy ? (
            <CircularProgress size={16} />
          ) : Math.round(amount) < 0 ? (
            "Revoke"
          ) : (
            "Grant"
          )}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
