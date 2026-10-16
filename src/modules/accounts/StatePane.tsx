/**
 * @file The STATE surface — factory reset, and named appearance states
 * (P3 of `default-state`). Three cards over `/api/accounts/states`:
 *
 *   1. **Defaults** — "Reset everything to default" behind the route's own
 *      typed-confirmation gate (`factory-reset <username>`, typed by the user,
 *      relayed verbatim). The server wipes the per-user kv tree and module
 *      data subtrees and returns the P0 default snapshot; THIS pane then
 *      clears browser-resident storage (taskman's localStorage, the
 *      assistant's sessionStorage — module data lives there too, and the
 *      appearance helper is forbidden from knowing about it), applies the
 *      default snapshot through the one apply path, and reloads.
 *   2. **Save** — an MUI dialog prompting for a name; the snapshot is captured
 *      CLIENT-side by `captureStateSnapshot()` and POSTed. Same name = the
 *      server refreshes that state rather than forking it.
 *   3. **States** — every saved state (name, savedAt) with Apply and Delete.
 *      Apply fetches the stored snapshot and runs `applyStateSnapshot()`;
 *      theme and packs are hot, and when the report says a kv/boot-read
 *      surface was written the pane reloads — visibly, with the reasons shown
 *      first, never silently.
 *
 * Appearance states never touch user data: saving captures no module store,
 * applying writes none, and saved states deliberately SURVIVE a factory reset
 * (they are the user's own captures — re-applying one afterwards is the point).
 */
"use client";

import * as React from "react";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { Glyph, token } from "@axf/core";

import { applyStateSnapshot, captureStateSnapshot } from "./state-snapshot";
import { useAccountsState } from "./store";
import type { AppearanceStateSnapshot } from "@axs/defaults/default-state";
import type { SavedStateMeta } from "./lib/states";

/** One panel card — the login pane's surface, reused for consistency. */
function StateCard({ children }: { children: React.ReactNode }) {
  return (
    <Stack
      sx={{
        background: token("panel"),
        border: `1px solid ${token("edge")}`,
        borderRadius: token("radius"),
        p: 2.5,
        gap: 1.5,
      }}
    >
      {children}
    </Stack>
  );
}

function CardTitle({ glyph, text }: { glyph: string; text: string }) {
  return (
    <Stack direction="row" sx={{ alignItems: "center", gap: 1.25 }}>
      <Glyph id={glyph} size={18} />
      <Typography
        sx={{ fontFamily: token("mono"), fontSize: 12, fontWeight: 700, letterSpacing: "0.14em" }}
      >
        {text}
      </Typography>
    </Stack>
  );
}

type StatesAnswer = {
  ok?: boolean;
  error?: string;
  states?: SavedStateMeta[];
  state?: SavedStateMeta & { snapshot: AppearanceStateSnapshot };
  snapshot?: AppearanceStateSnapshot;
};

async function statesRequest(body?: Record<string, unknown>): Promise<StatesAnswer> {
  const res = await fetch(
    "/api/accounts/states",
    body
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  const answer = (await res.json().catch(() => null)) as StatesAnswer | null;
  if (!res.ok || !answer?.ok) {
    throw new Error(answer?.error ?? `request failed (HTTP ${res.status})`);
  }
  return answer;
}

export default function StatePane() {
  const { session } = useAccountsState();
  const username = session?.username ?? "";

  const [states, setStates] = React.useState<readonly SavedStateMeta[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  /** One line per completed action ("applied ...", "deleted ...") — the pane's
   *  honest receipt when no reload happens. */
  const [status, setStatus] = React.useState<string | null>(null);
  /** Slug (or "__reset"/"__save") of the action in flight — one at a time. */
  const [busy, setBusy] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const answer = await statesRequest();
      setStates(answer.states ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  /* ── factory reset dialog ────────────────────────────────────────────────── */

  const confirmPhrase = `factory-reset ${username}`;
  const [resetOpen, setResetOpen] = React.useState(false);
  const [resetTyped, setResetTyped] = React.useState("");
  const [resetError, setResetError] = React.useState<string | null>(null);

  const runFactoryReset = async () => {
    setBusy("__reset");
    setResetError(null);
    try {
      const answer = await statesRequest({ action: "factory-reset", confirm: resetTyped });
      if (!answer.snapshot) throw new Error("reset answered without a default snapshot");
      // Browser-resident module data (taskman's localStorage doc, the
      // assistant's sessionStorage) is part of "all data" and lives outside
      // every server store — cleared HERE, not in the appearance helper,
      // which is forbidden from knowing module stores exist.
      try {
        window.localStorage.clear();
        window.sessionStorage.clear();
      } catch {
        /* private mode — the server-side wipe already happened */
      }
      // The default snapshot re-persists theme + packs through their stores...
      await applyStateSnapshot(answer.snapshot);
      // ...and the reload is unconditional: the server just deleted this
      // user's kv tree, so every kv-backed store on screen is a cache of
      // documents that no longer exist.
      window.location.reload();
    } catch (err) {
      setResetError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };

  /* ── save dialog ─────────────────────────────────────────────────────────── */

  const [saveOpen, setSaveOpen] = React.useState(false);
  const [saveName, setSaveName] = React.useState("");
  const [saveError, setSaveError] = React.useState<string | null>(null);

  const runSave = async () => {
    setBusy("__save");
    setSaveError(null);
    try {
      const snapshot = await captureStateSnapshot();
      const answer = await statesRequest({ action: "save", name: saveName, snapshot });
      setSaveOpen(false);
      setSaveName("");
      setStatus(`Saved "${answer.state?.name ?? saveName}".`);
      await refresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  /* ── apply / delete ──────────────────────────────────────────────────────── */

  const runApply = async (meta: SavedStateMeta) => {
    setBusy(meta.slug);
    setStatus(null);
    try {
      const answer = await statesRequest({ action: "apply", slug: meta.slug });
      if (!answer.state?.snapshot) throw new Error("apply answered without a snapshot");
      const report = await applyStateSnapshot(answer.state.snapshot);
      if (report.problems.length) {
        setError(report.problems.join("; "));
      }
      if (report.reloadRequired) {
        // A kv/boot-read surface was written (the reasons say which); it only
        // re-reads its store at boot, so the apply is not on screen until the
        // page comes back. Reload knowingly rather than half-apply silently.
        setStatus(`Applied "${meta.name}" — reloading: ${report.reasons.join("; ")}`);
        window.location.reload();
        return;
      }
      setStatus(`Applied "${meta.name}" — theme and packs are live.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const runDelete = async (meta: SavedStateMeta) => {
    setBusy(meta.slug);
    setStatus(null);
    try {
      await statesRequest({ action: "delete", slug: meta.slug });
      setStatus(`Deleted "${meta.name}".`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  /* ── render ──────────────────────────────────────────────────────────────── */

  return (
    <Stack sx={{ p: 2, gap: 2, maxWidth: 720 }}>
      {status && (
        <Alert severity="success" variant="outlined" sx={{ fontSize: 12 }} onClose={() => setStatus(null)}>
          {status}
        </Alert>
      )}
      {error && (
        <Alert severity="error" variant="outlined" sx={{ fontSize: 12 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* ------------------------------ defaults ------------------------------ */}
      <StateCard>
        <CardTitle glyph="icon-gear" text="DEFAULTS" />
        <Typography sx={{ fontSize: 12, color: token("dim") }}>
          Put this account back to the state every new user gets. Destructive: all module data
          (expenses, Claude conversations and projects, tasks), all per-user settings and all
          appearance (theme, chrome, dashboard layout, pack selection) are deleted. Saved
          appearance states below survive.
        </Typography>
        <Box>
          <Button
            color="error"
            variant="outlined"
            onClick={() => {
              setResetTyped("");
              setResetError(null);
              setResetOpen(true);
            }}
          >
            Reset everything to default…
          </Button>
        </Box>
      </StateCard>

      {/* -------------------------------- save -------------------------------- */}
      <StateCard>
        <CardTitle glyph="icon-eye" text="SAVE" />
        <Typography sx={{ fontSize: 12, color: token("dim") }}>
          Capture the appearance on screen — theme, chrome, packs, dashboard layout — under a
          name. Appearance only; none of your data is in a saved state. Saving under an existing
          name refreshes that state.
        </Typography>
        <Box>
          <Button
            variant="contained"
            onClick={() => {
              setSaveError(null);
              setSaveOpen(true);
            }}
          >
            Save current state…
          </Button>
        </Box>
      </StateCard>

      {/* ------------------------------- states -------------------------------- */}
      <StateCard>
        <CardTitle glyph="icon-eye" text="STATES" />
        {loading ? (
          <CircularProgress size={20} />
        ) : states.length === 0 ? (
          <Typography sx={{ fontSize: 12, color: token("dim") }}>
            No saved states yet — capture one with “Save current state…”.
          </Typography>
        ) : (
          <Stack sx={{ gap: 0.5 }}>
            {states.map((meta) => (
              <Stack
                key={meta.slug}
                direction="row"
                sx={{
                  alignItems: "center",
                  gap: 1.5,
                  p: "6px 8px",
                  borderRadius: 1,
                  "&:hover": { background: token("page") },
                }}
              >
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography
                    sx={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {meta.name}
                  </Typography>
                  <Typography sx={{ fontSize: 10.5, color: token("dim"), fontFamily: token("mono") }}>
                    {new Date(meta.savedAt).toLocaleString()}
                  </Typography>
                </Box>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={busy !== null}
                  onClick={() => void runApply(meta)}
                >
                  {busy === meta.slug ? <CircularProgress size={14} /> : "Apply"}
                </Button>
                <Button
                  size="small"
                  color="error"
                  disabled={busy !== null}
                  onClick={() => void runDelete(meta)}
                >
                  Delete
                </Button>
              </Stack>
            ))}
          </Stack>
        )}
      </StateCard>

      {/* -------------------------- factory-reset dialog ------------------------ */}
      <Dialog open={resetOpen} onClose={() => busy !== "__reset" && setResetOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Factory reset</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ fontSize: 13 }}>
            This deletes everything this account has: <b>all module data</b> (expense reports and
            saves, Claude conversations and projects, tasks and browser-held module state),{" "}
            <b>all per-user settings</b>, and <b>all appearance</b> (theme, chrome, dashboard
            layout, pack selection). Saved appearance states are kept. There is no undo.
          </DialogContentText>
          <TextField
            autoFocus
            fullWidth
            size="small"
            sx={{ mt: 2 }}
            label={`Type "${confirmPhrase}" to confirm`}
            value={resetTyped}
            onChange={(e) => setResetTyped(e.target.value)}
            slotProps={{ htmlInput: { autoCapitalize: "none", autoCorrect: "off" } }}
          />
          {resetError && (
            <Alert severity="error" variant="outlined" sx={{ mt: 2, fontSize: 12 }}>
              {resetError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResetOpen(false)} disabled={busy === "__reset"}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={resetTyped !== confirmPhrase || busy === "__reset"}
            onClick={() => void runFactoryReset()}
          >
            {busy === "__reset" ? <CircularProgress size={16} /> : "Reset everything"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ------------------------------ save dialog ----------------------------- */}
      <Dialog open={saveOpen} onClose={() => busy !== "__save" && setSaveOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Save current state</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ fontSize: 13 }}>
            Name this appearance. The snapshot is captured from the live stores on this screen —
            theme, chrome, packs and dashboard layout — and holds no module data.
          </DialogContentText>
          <TextField
            autoFocus
            fullWidth
            size="small"
            sx={{ mt: 2 }}
            label="State name"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && saveName.trim() && busy !== "__save") void runSave();
            }}
          />
          {saveError && (
            <Alert severity="error" variant="outlined" sx={{ mt: 2, fontSize: 12 }}>
              {saveError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveOpen(false)} disabled={busy === "__save"}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={!saveName.trim() || busy === "__save"}
            onClick={() => void runSave()}
          >
            {busy === "__save" ? <CircularProgress size={16} /> : "Save"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
