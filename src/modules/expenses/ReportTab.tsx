"use client";

/**
 * @file A report, inside a tab.
 *
 * ## Why an iframe, and why sandboxed
 *
 * A report is a whole HTML document with its own `<style>` — that is what makes
 * it portable (see `report.ts`). Injecting that into the page would leak its
 * rules over the studio and let an IMPORTED report — a file the user picked up
 * from anywhere — restyle the application. An iframe is the isolation boundary
 * the format already implies.
 *
 * `sandbox` carries `allow-same-origin` and `allow-modals` and **not**
 * `allow-scripts`. That combination is the safe one: with scripts disabled
 * there is nothing to run, and same-origin is what lets this component call
 * `contentWindow.print()` so Print prints the REPORT rather than the app around
 * it. `allow-same-origin` + `allow-scripts` together would defeat the sandbox,
 * which is precisely why scripts stay off.
 *
 * ## Save is explicit
 *
 * A generated report opens as a **draft** — it exists in the tab and nowhere
 * else. Save writes it to the vault and the tab adopts the filename. Nothing
 * auto-saves: a report is a record, and a directory that fills up with one file
 * per glance is a directory nobody can find anything in.
 */

import * as React from "react";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { token } from "@axf/core";

import { MONO } from "./bits";
import { expenseTabs, type TabState } from "./tabs";
import { deleteVault, humanBytes, writeVault, type VaultFormat } from "./vault";

/** Keep a suggested name legal for the API's guard, whatever was typed. */
function sanitizeName(raw: string, format: VaultFormat): string {
  const ext = format === "markdown" ? ".md" : ".html";
  const base = raw
    .replace(/\.(html|md)$/i, "")
    .replace(/[^A-Za-z0-9 ._-]/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "")
    .slice(0, 100)
    .trim();
  return `${base || "report"}${ext}`;
}

export default function ReportTab({ tab }: { tab: TabState }) {
  const report = tab.report;
  const [name, setName] = React.useState(() => report?.name ?? "");
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const frame = React.useRef<HTMLIFrameElement | null>(null);

  React.useEffect(() => {
    setName(report?.name ?? "");
    setProblem(null);
    setNote(null);
  }, [report?.name, tab.id]);

  if (!report) {
    return (
      <Typography sx={{ fontSize: 12, color: token("err") }}>
        This report tab carries no document — close it and generate a new one.
      </Typography>
    );
  }

  const saved = Boolean(report.name);
  const bytes = new Blob([report.content]).size;

  const save = async () => {
    const filename = sanitizeName(name || tab.title, report.format);
    setBusy(true);
    setProblem(null);
    const result = await writeVault("report", filename, report.content);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.error);
      return;
    }
    // The tab adopts the file's identity, so re-opening the same report from
    // the vault focuses THIS tab instead of growing a duplicate.
    expenseTabs.renameReport(tab.id, result.file.name, result.file.title);
    setNote(`Saved as ${result.file.name}`);
    window.setTimeout(() => setNote(null), 2400);
  };

  const forget = async () => {
    if (!report.name) return;
    setBusy(true);
    const result = await deleteVault("report", report.name);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.error);
      return;
    }
    // The document stays open — deleting the FILE and closing the view are two
    // different intentions, and doing both would lose an unsaved rename.
    setNote(`Deleted ${report.name} from the saved directory`);
  };

  /** Open the report on its own, outside the app — a real browser tab. */
  const popOut = () => {
    const blob = new Blob([report.content], {
      type: report.format === "markdown" ? "text/plain;charset=utf-8" : "text/html;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
    // Revoked late: revoking immediately races the new tab's own load.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const print = () => {
    const win = frame.current?.contentWindow;
    if (!win) return;
    win.focus();
    win.print();
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1, flex: 1, minHeight: 0 }}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <Chip
          size="small"
          variant="outlined"
          label={saved ? "saved" : "draft"}
          sx={{ ...MONO, height: 20, color: saved ? token("ok") : token("warn") }}
        />
        <Chip size="small" variant="outlined" label={report.format} sx={{ ...MONO, height: 20 }} />
        <Chip size="small" variant="outlined" label={humanBytes(bytes)} sx={{ ...MONO, height: 20 }} />
        <TextField
          size="small"
          label="Filename"
          value={name}
          placeholder={sanitizeName(tab.title, report.format)}
          onChange={(e) => setName(e.target.value)}
          sx={{ width: 280, "& input": { ...MONO, fontSize: 12 } }}
        />
        <Button size="small" variant="contained" disabled={busy} onClick={() => void save()}>
          {saved ? "Save a copy" : "Save to reports"}
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="outlined" onClick={popOut}>
          Open in browser
        </Button>
        <Button size="small" variant="outlined" onClick={print}>
          Print
        </Button>
        <Button size="small" variant="outlined" onClick={() => expenseTabs.float(tab.id)}>
          Float
        </Button>
        {saved ? (
          <Button size="small" color="error" disabled={busy} onClick={() => void forget()}>
            Delete file
          </Button>
        ) : null}
      </Stack>

      {problem ? (
        <Alert severity="error" sx={{ py: 0 }}>
          {problem}
        </Alert>
      ) : null}
      {note ? (
        <Alert severity="success" sx={{ py: 0 }}>
          {note}
        </Alert>
      ) : null}

      {report.format === "markdown" ? (
        <Box
          component="pre"
          sx={{
            flex: 1,
            minHeight: 420,
            m: 0,
            p: 2,
            overflow: "auto",
            border: `1px solid ${token("edge")}`,
            borderRadius: "var(--axf-radius-tight)",
            background: token("panel"),
            ...MONO,
            fontSize: 12,
            whiteSpace: "pre-wrap"
          }}
        >
          {report.content}
        </Box>
      ) : (
        <Box
          component="iframe"
          ref={frame}
          title={tab.title}
          srcDoc={report.content}
          sandbox="allow-same-origin allow-modals"
          sx={{
            flex: 1,
            width: "100%",
            minHeight: 480,
            border: `1px solid ${token("edge")}`,
            borderRadius: "var(--axf-radius-tight)",
            background: token("page")
          }}
        />
      )}
    </Box>
  );
}
