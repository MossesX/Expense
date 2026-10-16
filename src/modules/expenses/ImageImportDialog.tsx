"use client";

/**
 * @file Scan a statement image — pick the account (or add one), choose a
 * photo or screenshot, let Claude read the transactions, then review what is
 * new and what the ledger already holds before anything is written (owner,
 * 2026-10-16).
 *
 * The reading is `/api/expenses/parse-image` (Claude vision, structured
 * output). From there the rows take the SAME path a pasted statement takes
 * (`import.ts`): the duplicate checks, the fingerprinted ids, the entries. The
 * one difference from the paste review is how a duplicate is shown — as a
 * PAIR, the image's line beside the ledger's entry, with a switch to keep
 * both, because the person asked to see "both of each duo" before deciding.
 */

import * as React from "react";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { token } from "@axf/core";

import { MONO } from "./bits";
import { judge, rowsFromParsed, toExpenses } from "./import";
import type { ImportRow, ParsedTransaction, Verdict } from "./import";
import { effectiveTotal, money } from "./math";
import { expensesSettings, useExpensesSettings } from "./settings";
import { expenseStore } from "./store";
import { PAYMENT_METHODS, categoryOf, isIncome, type Expense } from "./types";
import { expenseUi } from "./ui";

const NEW_ACCOUNT = "__new__";

/** The built-in accounts plus the ones added in settings, in order, no repeats. */
export function allAccounts(extra: string): string[] {
  const out: string[] = [...PAYMENT_METHODS];
  for (const name of extra.split(",").map((s) => s.trim()).filter(Boolean)) if (!out.includes(name)) out.push(name);
  return out;
}

const CHECK_LABEL: Record<NonNullable<Verdict["check"]>, string> = {
  exact: "same date, amount and merchant",
  "posting-drift": "same amount and merchant, dates a few days apart",
  "merchant-rewrite": "same day and amount, named differently",
  "tip-or-rounding": "same merchant and date, amount slightly off",
  fingerprint: "this exact line was imported before",
  "repeated-in-paste": "appears twice in the image"
};

function Side({ title, date, merchant, amount, income, category, account, tone }: {
  title: string; date: string; merchant: string; amount: number; income: boolean; category: string; account?: string; tone?: "accent" | "dim";
}) {
  return (
    <Box sx={{ flex: 1, minWidth: 0, p: 1, border: `1px solid ${token("edge")}`, borderRadius: 1, background: token("panel") }}>
      <Typography sx={{ fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: token(tone ?? "dim"), mb: 0.4 }}>{title}</Typography>
      <Typography sx={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{merchant}</Typography>
      <Typography sx={{ ...MONO, fontSize: 12 }}>
        {date} · <Box component="span" sx={{ color: income ? token("ok") : undefined }}>{income ? "+" : ""}{money(amount)}</Box>
      </Typography>
      <Typography sx={{ fontSize: 11, color: token("dim") }}>{category}{account ? ` · ${account}` : ""}</Typography>
    </Box>
  );
}

export default function ImageImportDialog({ open, expenses, onClose }: { open: boolean; expenses: readonly Expense[]; onClose: () => void }) {
  const prefs = useExpensesSettings();
  const [step, setStep] = React.useState<"pick" | "parsing" | "review">("pick");
  const [account, setAccount] = React.useState("");
  const [newAccount, setNewAccount] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notes, setNotes] = React.useState("");
  const [source, setSource] = React.useState("");
  const [problems, setProblems] = React.useState<{ line: number; text: string; reason: string }[]>([]);
  const [verdicts, setVerdicts] = React.useState<Verdict[]>([]);
  const [ticked, setTicked] = React.useState<Set<number>>(new Set());
  const [keepBoth, setKeepBoth] = React.useState<Set<number>>(new Set());
  const fileRef = React.useRef<HTMLInputElement>(null);

  const accounts = React.useMemo(() => allAccounts(prefs.extraAccounts), [prefs.extraAccounts]);

  React.useEffect(() => {
    if (!open) return;
    setStep("pick");
    setAccount(prefs.importAccount && accounts.includes(prefs.importAccount) ? prefs.importAccount : accounts[0] ?? "");
    setNewAccount("");
    setFile(null);
    setPreview(null);
    setError(null);
    setNotes("");
    setSource("");
    setProblems([]);
    setVerdicts([]);
    setTicked(new Set());
    setKeepBoth(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onFile = (f: File | null) => {
    setFile(f);
    setError(null);
    if (!f) return void setPreview(null);
    const reader = new FileReader();
    reader.onload = () => setPreview(String(reader.result ?? ""));
    reader.readAsDataURL(f);
  };

  const chosenAccount = account === NEW_ACCOUNT ? newAccount.trim() : account;
  const canParse = Boolean(file && chosenAccount);

  const parse = async () => {
    if (!file || !preview) return;
    setStep("parsing");
    setError(null);
    if (account === NEW_ACCOUNT && chosenAccount && !accounts.includes(chosenAccount)) {
      expensesSettings.set("extraAccounts", [prefs.extraAccounts, chosenAccount].filter(Boolean).join(", "));
    }
    try {
      const res = await fetch("/api/expenses/parse-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: preview, mediaType: file.type, account: chosenAccount, model: prefs.aiModel, mode: prefs.aiMode })
      });
      const body = (await res.json()) as { error?: string; transactions?: ParsedTransaction[]; notes?: string; source?: string };
      if (!res.ok || !body.transactions) throw new Error(body.error ?? `HTTP ${res.status}`);
      const parsed = rowsFromParsed(body.transactions);
      const judged = judge(parsed.rows, expenses, { dateSlackDays: prefs.importDateSlack, amountSlackCents: Math.round(prefs.importAmountSlack * 100) });
      setNotes(body.notes ?? "");
      setSource(body.source ?? "");
      setProblems(parsed.problems);
      setVerdicts(judged);
      setTicked(new Set(judged.filter((v) => !v.check && !(prefs.importSkipPayments && v.row.payment)).map((v) => v.row.line)));
      setKeepBoth(new Set());
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("pick");
    }
  };

  const fresh = verdicts.filter((v) => !v.check);
  const dupes = verdicts.filter((v) => v.check);
  const selectedRows: ImportRow[] = [
    ...fresh.filter((v) => ticked.has(v.row.line)).map((v) => v.row),
    ...dupes.filter((v) => keepBoth.has(v.row.line)).map((v) => v.row)
  ];

  const commit = () => {
    const entries = toExpenses(selectedRows, { paymentMethod: chosenAccount, sourceLabel: `${chosenAccount} statement image` });
    const added = expenseStore.addMany(entries);
    const skipped = dupes.length - keepBoth.size;
    expenseUi.say(`Imported ${added} transaction${added === 1 ? "" : "s"} from the image` + (skipped ? ` · skipped ${skipped} duplicate${skipped === 1 ? "" : "s"}` : ""));
    onClose();
  };

  const toggleTick = (line: number) => setTicked((p) => { const n = new Set(p); if (n.has(line)) n.delete(line); else n.add(line); return n; });
  const toggleKeep = (line: number) => setKeepBoth((p) => { const n = new Set(p); if (n.has(line)) n.delete(line); else n.add(line); return n; });

  const existingOf = (v: Verdict) => {
    const d = v.duplicateOf;
    if (!d) return null;
    if ("items" in d) {
      const e = d as Expense;
      return { date: e.date, merchant: e.merchant, amount: effectiveTotal(e), income: isIncome(e), category: categoryOf(e.category).label, account: e.paymentMethod };
    }
    const r = d as ImportRow;
    return { date: r.date, merchant: r.merchant, amount: r.cents, income: r.kind === "income", category: categoryOf(r.category).label, account: undefined };
  };

  return (
    <Dialog open={open} onClose={step === "parsing" ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontSize: 15, fontWeight: 700, pb: 1 }}>Scan a statement image</DialogTitle>
      <DialogContent dividers sx={{ display: "grid", gap: 1.4 }}>
        {step !== "review" && (
          <>
            <Typography sx={{ fontSize: 12, color: token("dim") }}>
              A screenshot of the bank app, a photo of a printed statement, or a receipt. Claude reads every transaction
              line; you then see what is new and what the ledger already has, side by side, before anything is written.
            </Typography>
            <Stack direction="row" spacing={1.2} useFlexGap sx={{ flexWrap: "wrap", alignItems: "flex-start" }}>
              <TextField select size="small" label="Account" value={account} onChange={(e) => setAccount(e.target.value)} sx={{ minWidth: 200 }} disabled={step === "parsing"}>
                {accounts.map((a) => (
                  <MenuItem key={a} value={a} sx={{ fontSize: 12.5 }}>{a}</MenuItem>
                ))}
                <MenuItem value={NEW_ACCOUNT} sx={{ fontSize: 12.5, color: token("accent") }}>Add new account…</MenuItem>
              </TextField>
              {account === NEW_ACCOUNT && (
                <TextField size="small" label="New account name" value={newAccount} onChange={(e) => setNewAccount(e.target.value)} autoFocus sx={{ minWidth: 200 }} helperText="Saved to Settings › Import › Extra accounts" />
              )}
              <Box sx={{ flex: 1 }} />
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
              <Button size="small" variant="outlined" onClick={() => fileRef.current?.click()} disabled={step === "parsing"}>
                {file ? "Change image…" : "Choose image…"}
              </Button>
            </Stack>
            {preview && (
              <Box sx={{ display: "flex", gap: 1.5, alignItems: "flex-start" }}>
                <Box component="img" src={preview} alt="statement" sx={{ maxHeight: 260, maxWidth: "60%", borderRadius: 1, border: `1px solid ${token("edge")}` }} />
                <Typography sx={{ fontSize: 12, color: token("dim") }}>
                  {file?.name} · {file ? `${Math.round(file.size / 1024)} KB` : ""}
                  <br />
                  Reads with {prefs.aiModel}. Change the model or the Claude connection in Settings › AI.
                </Typography>
              </Box>
            )}
            {step === "parsing" && (
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <CircularProgress size={18} />
                <Typography sx={{ fontSize: 12.5 }}>Reading the image…</Typography>
              </Stack>
            )}
            {error && <Alert severity="error">{error}</Alert>}
          </>
        )}

        {step === "review" && (
          <>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
              <Chip size="small" label={`${verdicts.length} read`} />
              <Chip size="small" color="success" variant="outlined" label={`${fresh.length} new`} />
              <Chip size="small" color="warning" variant="outlined" label={`${dupes.length} possible duplicate${dupes.length === 1 ? "" : "s"}`} />
              {problems.length > 0 && <Chip size="small" color="error" variant="outlined" label={`${problems.length} unreadable`} />}
              <Chip size="small" variant="outlined" label={chosenAccount} />
              {source && <Chip size="small" variant="outlined" label={source === "user-key" ? "your API key" : "server credential"} sx={{ color: token("dim") }} />}
              <Box sx={{ flex: 1 }} />
              <Button size="small" onClick={() => setStep("pick")}>Back</Button>
            </Stack>
            {notes && <Alert severity="info" sx={{ py: 0, fontSize: 12 }}>{notes}</Alert>}

            {dupes.length > 0 && (
              <Box>
                <Typography sx={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: token("warn"), mb: 0.6 }}>
                  Possible duplicates — skipped unless you keep both
                </Typography>
                <Stack spacing={1}>
                  {dupes.map((v) => {
                    const ex = existingOf(v)!;
                    return (
                      <Box key={v.row.line} sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
                        <Side title="In the image" date={v.row.date} merchant={v.row.merchant} amount={v.row.cents} income={v.row.kind === "income"} category={categoryOf(v.row.category).label} tone="accent" />
                        <Typography sx={{ fontSize: 18, color: token("dim") }}>≈</Typography>
                        <Side title={v.check === "repeated-in-paste" ? "Earlier in the image" : "Already in the ledger"} date={ex.date} merchant={ex.merchant} amount={ex.amount} income={ex.income} category={ex.category} account={ex.account} />
                        <Box sx={{ minWidth: 150 }}>
                          <Typography sx={{ fontSize: 11, color: token("dim") }}>{CHECK_LABEL[v.check!]}</Typography>
                          <FormControlLabel
                            control={<Switch size="small" checked={keepBoth.has(v.row.line)} onChange={() => toggleKeep(v.row.line)} />}
                            label={<Typography sx={{ fontSize: 12.5 }}>Keep both</Typography>}
                            sx={{ mr: 0 }}
                          />
                        </Box>
                      </Box>
                    );
                  })}
                </Stack>
              </Box>
            )}

            {fresh.length > 0 && (
              <Box>
                <Typography sx={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: token("dim"), mb: 0.6 }}>New transactions</Typography>
                <Box sx={{ overflow: "auto", maxHeight: 300, border: `1px solid ${token("edge")}`, borderRadius: 1 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell padding="checkbox">
                          <Checkbox size="small" checked={fresh.every((v) => ticked.has(v.row.line))} indeterminate={fresh.some((v) => ticked.has(v.row.line)) && !fresh.every((v) => ticked.has(v.row.line))} onChange={() => setTicked(fresh.every((v) => ticked.has(v.row.line)) ? new Set() : new Set(fresh.map((v) => v.row.line)))} />
                        </TableCell>
                        <TableCell>Date</TableCell>
                        <TableCell>Merchant</TableCell>
                        <TableCell align="right">Amount</TableCell>
                        <TableCell>Category</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {fresh.map((v) => (
                        <TableRow key={v.row.line} hover onClick={() => toggleTick(v.row.line)} sx={{ cursor: "pointer", opacity: ticked.has(v.row.line) ? 1 : 0.6 }}>
                          <TableCell padding="checkbox"><Checkbox size="small" checked={ticked.has(v.row.line)} onChange={() => toggleTick(v.row.line)} onClick={(e) => e.stopPropagation()} /></TableCell>
                          <TableCell sx={{ ...MONO, whiteSpace: "nowrap" }}>{v.row.date}</TableCell>
                          <TableCell>{v.row.merchant}{v.row.payment && <Chip size="small" variant="outlined" label="card payment" sx={{ ml: 0.8, height: 18 }} />}</TableCell>
                          <TableCell align="right" sx={{ ...MONO, whiteSpace: "nowrap", color: v.row.kind === "income" ? token("ok") : undefined }}>{v.row.kind === "income" ? "+" : ""}{money(v.row.cents)}</TableCell>
                          <TableCell sx={{ whiteSpace: "nowrap" }}>{categoryOf(v.row.category).label}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              </Box>
            )}
            {verdicts.length === 0 && <Alert severity="warning">No transactions were read from the image.</Alert>}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onClose} disabled={step === "parsing"}>Cancel</Button>
        {step === "review" ? (
          <Button size="small" variant="contained" disabled={!selectedRows.length} onClick={commit}>Import {selectedRows.length} selected</Button>
        ) : (
          <Button size="small" variant="contained" disabled={!canParse || step === "parsing"} onClick={() => void parse()}>Read transactions</Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
