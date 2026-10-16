"use client";

/**
 * @file The **saved directory**, as a dialog — one surface, three jobs.
 *
 * The owner asked for five things that all bottom out in the same directory:
 * *"save a load features … import html … open report that opens from saved
 * directory … find saved reports and import them"*. They are one dialog in
 * three modes rather than four dialogs, because every one of them is "here is
 * what is on disk, do something with one of them" and four copies of that list
 * is four places for it to drift.
 *
 *   - `save`    — write the ledger to a named snapshot.
 *   - `load`    — replace the ledger from a snapshot. Destructive, and says so.
 *   - `reports` — open a saved report, import an HTML/markdown file from
 *                 anywhere, or scan the project for reports and import them.
 *
 * ## Two guards worth stating
 *
 * **Load is total and irreversible**, so it asks — `store.replaceAll`'s
 * docblock explains why a merge would be worse. **No import overwrites
 * silently**: an uploaded file whose name is already in the vault becomes
 * `-2`, `-3`…, and a scanned file that is already there says so on its own
 * button ("Import again") instead of quietly replacing what is on disk. A
 * report you saved last month disappearing without a word is the kind of data
 * loss nobody thinks to look for.
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
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { token } from "@axf/core";

import { MONO } from "./bits";
import { buildSnapshot, readSnapshot, saveFileName } from "./report";
import type { Expense } from "./types";
import {
  deleteVault,
  humanBytes,
  humanWhen,
  importFound,
  listVault,
  readVault,
  scanForReports,
  writeVault,
  type FoundFile,
  type VaultFile,
  type VaultKind
} from "./vault";

export type VaultMode = "save" | "load" | "reports";

const TITLES: Record<VaultMode, string> = {
  save: "Save the ledger",
  load: "Load a saved ledger",
  reports: "Reports — saved directory"
};

const KIND_OF: Record<VaultMode, VaultKind> = { save: "save", load: "save", reports: "report" };

/** `report.html` → `report-2.html`, never a silent overwrite. */
function uniqueName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const base = dot === -1 ? name : name.slice(0, dot);
  const ext = dot === -1 ? "" : name.slice(dot);
  for (let n = 2; n < 500; n += 1) {
    const candidate = `${base}-${n}${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}${ext}`;
}

/** Make an arbitrary upload name legal for the API's guard. */
function legalName(raw: string): string {
  const ext = /\.md$/i.test(raw) ? ".md" : ".html";
  const base = raw
    .replace(/\.[^.]+$/, "")
    .replace(/[^A-Za-z0-9 ._-]/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "")
    .slice(0, 100)
    .trim();
  return `${base || "imported-report"}${ext}`;
}

export default function VaultDialog({
  open,
  mode,
  expenses,
  onClose,
  onOpenReport,
  onLoadLedger
}: {
  open: boolean;
  mode: VaultMode;
  /** The live ledger — what `save` writes. */
  expenses: readonly Expense[];
  onClose: () => void;
  onOpenReport: (file: VaultFile, content: string) => void;
  onLoadLedger: (list: Expense[], from: VaultFile) => void;
}) {
  const kind = KIND_OF[mode];

  const [files, setFiles] = React.useState<VaultFile[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [found, setFound] = React.useState<FoundFile[] | null>(null);
  const [truncated, setTruncated] = React.useState(false);
  const [confirmLoad, setConfirmLoad] = React.useState<VaultFile | null>(null);
  const upload = React.useRef<HTMLInputElement | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    const result = await listVault(kind);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setFiles(result.files);
  }, [kind]);

  React.useEffect(() => {
    if (!open) return;
    setNote(null);
    setError(null);
    setFound(null);
    setConfirmLoad(null);
    if (mode === "save") setName(saveFileName());
    void refresh();
  }, [open, mode, refresh]);

  const taken = React.useMemo(() => new Set(files.map((f) => f.name)), [files]);

  /* ------------------------------------------------------------ actions */

  const saveLedger = async () => {
    const clean = name.trim().replace(/[^A-Za-z0-9 ._-]/g, "-") || saveFileName();
    const filename = clean.endsWith(".json") ? clean : `${clean}.json`;
    setBusy(filename);
    const snapshot = buildSnapshot(expenses, `Ledger — ${expenses.length} expenses`);
    const result = await writeVault("save", filename, JSON.stringify(snapshot, null, 2));
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNote(`Saved ${result.file.name} · ${expenses.length} expenses`);
    void refresh();
  };

  const loadLedger = async (file: VaultFile) => {
    setBusy(file.name);
    const result = await readVault("save", file.name);
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const parsed = readSnapshot(result.content);
    if ("error" in parsed) {
      setError(`${file.name}: ${parsed.error}`);
      return;
    }
    onLoadLedger(parsed.expenses, result.file);
    onClose();
  };

  const openReport = async (file: VaultFile) => {
    setBusy(file.name);
    const result = await readVault("report", file.name);
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onOpenReport(result.file, result.content);
    onClose();
  };

  const removeFile = async (file: VaultFile) => {
    setBusy(file.name);
    const result = await deleteVault(kind, file.name);
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNote(`Deleted ${file.name}`);
    void refresh();
  };

  /** Import an HTML/markdown file the user picks from their own filesystem. */
  const importUpload = async (file: File) => {
    const text = await file.text();
    const filename = uniqueName(legalName(file.name), taken);
    setBusy(filename);
    const result = await writeVault("report", filename, text);
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNote(`Imported ${result.file.name}`);
    await refresh();
    onOpenReport(result.file, text);
    onClose();
  };

  const runScan = async () => {
    setLoading(true);
    const result = await scanForReports();
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setFound(result.found);
    setTruncated(result.truncated);
    if (!result.found.length) setNote("Nothing report-shaped found outside the saved directory.");
  };

  const importOne = async (candidate: FoundFile) => {
    setBusy(candidate.relPath);
    const result = await importFound("report", candidate.relPath);
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNote(`Imported ${result.file.name}`);
    setFound((list) => list?.map((f) => (f.relPath === candidate.relPath ? { ...f, present: true } : f)) ?? null);
    void refresh();
  };

  /* -------------------------------------------------------------- render */

  const row = (file: VaultFile) => (
    <Paper
      key={file.name}
      variant="outlined"
      sx={{ p: 1, display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}
    >
      <Box sx={{ flex: 1, minWidth: 200 }}>
        <Typography sx={{ fontSize: 12.6, fontWeight: 600 }} noWrap>
          {file.title}
        </Typography>
        <Typography sx={{ ...MONO, fontSize: 10.5, color: token("dim") }} noWrap>
          {file.name} · {humanBytes(file.bytes)} · {humanWhen(file.modified)}
        </Typography>
      </Box>
      {mode === "reports" ? (
        <Button size="small" variant="contained" disabled={busy !== null} onClick={() => void openReport(file)}>
          Open
        </Button>
      ) : mode === "load" ? (
        <Button size="small" variant="contained" disabled={busy !== null} onClick={() => setConfirmLoad(file)}>
          Load
        </Button>
      ) : (
        <Tooltip title="Reuse this filename — saving will overwrite it.">
          <Button size="small" variant="outlined" onClick={() => setName(file.name)}>
            Use name
          </Button>
        </Tooltip>
      )}
      <Button size="small" color="error" disabled={busy !== null} onClick={() => void removeFile(file)}>
        Delete
      </Button>
    </Paper>
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontSize: 15, fontWeight: 700, pb: 1 }}>
        {TITLES[mode]}
        <Typography component="span" sx={{ ...MONO, fontSize: 10.5, color: token("dim"), ml: 1 }}>
          data/axf/expenses/{kind === "save" ? "saves" : "reports"}
        </Typography>
      </DialogTitle>

      <DialogContent dividers sx={{ display: "grid", gap: 1.2 }}>
        {error ? <Alert severity="error" sx={{ py: 0 }}>{error}</Alert> : null}
        {note ? <Alert severity="success" sx={{ py: 0 }}>{note}</Alert> : null}

        {mode === "save" ? (
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <TextField
              size="small"
              fullWidth
              label="Snapshot filename"
              value={name}
              onChange={(e) => setName(e.target.value)}
              sx={{ "& input": { ...MONO, fontSize: 12 } }}
            />
            <Button
              variant="contained"
              disabled={busy !== null || !expenses.length}
              onClick={() => void saveLedger()}
            >
              Save
            </Button>
          </Stack>
        ) : null}
        {mode === "save" && !expenses.length ? (
          <Typography sx={{ fontSize: 11.5, color: token("dim") }}>
            The ledger is empty — there is nothing to snapshot yet.
          </Typography>
        ) : null}

        {mode === "reports" ? (
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
            <Button size="small" variant="outlined" onClick={() => upload.current?.click()}>
              Import HTML file…
            </Button>
            <Button size="small" variant="outlined" disabled={loading} onClick={() => void runScan()}>
              Find saved reports
            </Button>
            <Box
              component="input"
              ref={upload}
              type="file"
              accept=".html,.htm,.md,text/html,text/markdown"
              sx={{ display: "none" }}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void importUpload(file);
              }}
            />
            <Typography sx={{ fontSize: 11.5, color: token("dim") }}>
              Import copies the file into the saved directory; the scan looks through the project for
              anything report-shaped.
            </Typography>
          </Stack>
        ) : null}

        {confirmLoad ? (
          <Alert
            severity="warning"
            action={
              <Stack direction="row" spacing={1}>
                <Button size="small" onClick={() => setConfirmLoad(null)}>
                  Cancel
                </Button>
                <Button size="small" color="warning" variant="contained" onClick={() => void loadLedger(confirmLoad)}>
                  Replace ledger
                </Button>
              </Stack>
            }
          >
            Loading <strong>{confirmLoad.name}</strong> replaces all {expenses.length} current
            expenses. There is no undo — save the current ledger first if you need it.
          </Alert>
        ) : null}

        <Divider />

        {loading ? (
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <CircularProgress size={14} />
            <Typography sx={{ fontSize: 12, color: token("dim") }}>Reading the saved directory…</Typography>
          </Stack>
        ) : null}

        {!loading && !files.length ? (
          <Typography sx={{ fontSize: 12, color: token("dim") }}>
            {kind === "save"
              ? "No saved ledgers yet — snapshots you save appear here."
              : "No saved reports yet — generate one with New report, or import a file."}
          </Typography>
        ) : null}

        <Stack spacing={0.7}>{files.map(row)}</Stack>

        {found ? (
          <>
            <Divider />
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Typography sx={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: token("dim") }}>
                Found in the project
              </Typography>
              <Chip size="small" variant="outlined" label={found.length} sx={{ ...MONO, height: 18 }} />
            </Stack>
            {truncated ? (
              <Alert severity="info" sx={{ py: 0 }}>
                The scan hit its file limit and stopped early — this list may be incomplete.
              </Alert>
            ) : null}
            {!found.length ? (
              <Typography sx={{ fontSize: 12, color: token("dim") }}>
                Nothing outside the saved directory looked like an expense report.
              </Typography>
            ) : null}
            <Stack spacing={0.7}>
              {found.map((candidate) => (
                <Paper
                  key={candidate.relPath}
                  variant="outlined"
                  sx={{ p: 1, display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}
                >
                  <Box sx={{ flex: 1, minWidth: 220 }}>
                    <Typography sx={{ fontSize: 12.4, fontWeight: 600 }} noWrap>
                      {candidate.title}
                    </Typography>
                    <Typography sx={{ ...MONO, fontSize: 10.3, color: token("dim") }} noWrap>
                      {candidate.relPath}
                    </Typography>
                    <Typography sx={{ fontSize: 10.5, color: token("dim") }} noWrap>
                      {candidate.reason} · {humanBytes(candidate.bytes)} · {humanWhen(candidate.modified)}
                    </Typography>
                  </Box>
                  <Button
                    size="small"
                    variant={candidate.present ? "outlined" : "contained"}
                    disabled={busy !== null}
                    onClick={() => void importOne(candidate)}
                  >
                    {candidate.present ? "Import again" : "Import"}
                  </Button>
                </Paper>
              ))}
            </Stack>
          </>
        ) : null}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
