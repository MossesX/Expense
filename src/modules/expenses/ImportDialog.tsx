"use client";

/**
 * @file Import transactions — paste a bank app's list or drop in a CSV export,
 * review what is new against what the ledger already holds, add only that.
 *
 * The thinking lives in `./import.ts` (parsing, categories, the duplicate
 * checks); this file is the two-step skin over it: **paste → review**. The
 * review table shows every parsed row with its verdict and the check that
 * produced it, each row with a checkbox the person can flip — a duplicate
 * check is a strong default, never a lock, because two identical charges on
 * one day are a real thing and so is a wrongly matched one.
 *
 * Card payments (`CAPITAL ONE MOBILE PYMT`) are parsed but unticked by
 * default: they are neither spending nor income to this ledger, and ticking
 * them files them under Transfers.
 */

import * as React from "react";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { token } from "@axf/core";

import { MONO } from "./bits";
import { judge, parseImport, toExpenses } from "./import";
import type { Verdict } from "./import";
import { money } from "./math";
import { expenseStore } from "./store";
import { PAYMENT_METHODS, categoryOf, type Expense } from "./types";
import { expenseUi } from "./ui";

const PLACEHOLDER = `Paste from the bank app or a CSV export. Examples:

October 2
BIG Y 61 GROTON\t$26.51\tGrocery
Cumberland Farms - Fuel\t$5.11\tGas/Automotive
September 30
CAPITAL ONE MOBILE PYMT\t-$4,262.07\tPayment

2026-09-28  Stop & Shop  92.65  Grocery

Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit
2026-09-24,2026-09-25,1843,Target,Grocery,372.21,`;

const CHECK_LABEL: Record<NonNullable<Verdict["check"]>, string> = {
  exact: "duplicate",
  "posting-drift": "duplicate · date drift",
  "merchant-rewrite": "duplicate · same day & amount",
  "tip-or-rounding": "duplicate · amount close",
  fingerprint: "imported before",
  "repeated-in-paste": "repeated in paste"
};

export default function ImportDialog({
  open,
  expenses,
  onClose
}: {
  open: boolean;
  expenses: readonly Expense[];
  onClose: () => void;
}) {
  const [text, setText] = React.useState("");
  const [method, setMethod] = React.useState("Capital One");
  const [year, setYear] = React.useState(String(new Date().getFullYear()));
  const [verdicts, setVerdicts] = React.useState<Verdict[] | null>(null);
  const [problems, setProblems] = React.useState<{ line: number; text: string; reason: string }[]>([]);
  const [ticked, setTicked] = React.useState<Set<number>>(new Set());
  const fileRef = React.useRef<HTMLInputElement>(null);

  // Fresh each time it opens: a paste is a one-off, not a draft to keep.
  React.useEffect(() => {
    if (!open) return;
    setText("");
    setVerdicts(null);
    setProblems([]);
    setTicked(new Set());
  }, [open]);

  const review = () => {
    const y = /^\d{4}$/.test(year.trim()) ? Number(year.trim()) : undefined;
    const parsed = parseImport(text, { year: y });
    const judged = judge(parsed.rows, expenses);
    setProblems(parsed.problems);
    setVerdicts(judged);
    // Default ticks: new rows yes, duplicates no, card payments no.
    setTicked(new Set(judged.filter((v) => !v.check && !v.row.payment).map((v) => v.row.line)));
  };

  const onFile = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result ?? ""));
    reader.readAsText(file);
  };

  const toggle = (line: number) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });

  const commit = () => {
    if (!verdicts) return;
    const rows = verdicts.filter((v) => ticked.has(v.row.line)).map((v) => v.row);
    const entries = toExpenses(rows, { paymentMethod: method, sourceLabel: `${method} import` });
    const added = expenseStore.addMany(entries);
    const left = verdicts.filter((v) => !ticked.has(v.row.line));
    const dupes = left.filter((v) => v.check).length;
    const payments = left.filter((v) => !v.check && v.row.payment).length;
    const other = left.length - dupes - payments;
    const skipped = [
      dupes ? `${dupes} duplicate${dupes === 1 ? "" : "s"}` : "",
      payments ? `${payments} card payment${payments === 1 ? "" : "s"}` : "",
      other ? `${other} unticked` : ""
    ].filter(Boolean);
    expenseUi.say(
      `Imported ${added} transaction${added === 1 ? "" : "s"}` +
        (skipped.length ? ` · skipped ${skipped.join(", ")}` : "") +
        (added < rows.length ? ` · ${rows.length - added} already in the ledger` : "")
    );
    onClose();
  };

  const dupes = verdicts?.filter((v) => v.check).length ?? 0;
  const fresh = verdicts ? verdicts.length - dupes : 0;
  const selected = ticked.size;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontSize: 15, fontWeight: 700, pb: 1 }}>Import transactions</DialogTitle>
      <DialogContent dividers sx={{ display: "grid", gap: 1.4 }}>
        {!verdicts && (
          <>
            <Stack direction="row" spacing={1.2} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
              <TextField
                select
                size="small"
                label="Account"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                sx={{ minWidth: 160 }}
              >
                {PAYMENT_METHODS.map((m) => (
                  <MenuItem key={m} value={m}>
                    {m}
                  </MenuItem>
                ))}
              </TextField>
              <Tooltip title="Used for dates that carry no year, like “October 2”.">
                <TextField
                  size="small"
                  label="Year"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  sx={{ width: 100 }}
                  slotProps={{ htmlInput: { inputMode: "numeric", ...MONO } }}
                />
              </Tooltip>
              <Box sx={{ flex: 1 }} />
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                hidden
                onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              />
              <Button size="small" variant="outlined" onClick={() => fileRef.current?.click()}>
                Choose CSV…
              </Button>
            </Stack>
            <TextField
              multiline
              minRows={10}
              maxRows={18}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={PLACEHOLDER}
              slotProps={{ htmlInput: { style: { fontFamily: "var(--axf-mono)", fontSize: 12 }, spellCheck: false } }}
            />
            <Typography sx={{ fontSize: 12, color: token("dim") }}>
              Rows are checked against the ledger five ways — same date, amount and merchant; same amount and
              merchant a few days apart; same day and amount under another name; a tip or rounding
              difference; and anything this importer already added — and against each other. Nothing is
              written until you confirm the review.
            </Typography>
          </>
        )}

        {verdicts && (
          <>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
              <Chip size="small" label={`${verdicts.length} parsed`} />
              <Chip size="small" color="success" variant="outlined" label={`${fresh} new`} />
              <Chip size="small" color="warning" variant="outlined" label={`${dupes} duplicate${dupes === 1 ? "" : "s"}`} />
              {problems.length > 0 && (
                <Chip size="small" color="error" variant="outlined" label={`${problems.length} unreadable`} />
              )}
              <Box sx={{ flex: 1 }} />
              <Button size="small" onClick={() => setVerdicts(null)}>
                Back to paste
              </Button>
            </Stack>

            {verdicts.length === 0 && (
              <Alert severity="warning">Nothing parsed. Each line needs a merchant and an amount, with a date on the line or on a date line above it.</Alert>
            )}

            {verdicts.length > 0 && (
              <Box sx={{ overflow: "auto", maxHeight: 420, border: `1px solid ${token("edge")}`, borderRadius: 1 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell padding="checkbox">
                        <Checkbox
                          size="small"
                          checked={selected === verdicts.length}
                          indeterminate={selected > 0 && selected < verdicts.length}
                          onChange={() =>
                            setTicked(selected === verdicts.length ? new Set() : new Set(verdicts.map((v) => v.row.line)))
                          }
                        />
                      </TableCell>
                      <TableCell>Date</TableCell>
                      <TableCell>Merchant</TableCell>
                      <TableCell align="right">Amount</TableCell>
                      <TableCell>Category</TableCell>
                      <TableCell>Verdict</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {verdicts.map((v) => {
                      const on = ticked.has(v.row.line);
                      const dup = v.check !== null;
                      return (
                        <TableRow
                          key={v.row.line}
                          hover
                          onClick={() => toggle(v.row.line)}
                          sx={{ cursor: "pointer", opacity: on ? 1 : 0.6 }}
                        >
                          <TableCell padding="checkbox">
                            <Checkbox size="small" checked={on} onChange={() => toggle(v.row.line)} onClick={(e) => e.stopPropagation()} />
                          </TableCell>
                          <TableCell sx={{ ...MONO, whiteSpace: "nowrap" }}>{v.row.date}</TableCell>
                          <TableCell>
                            {v.row.merchant}
                            {v.row.payment && (
                              <Chip size="small" variant="outlined" label="card payment" sx={{ ml: 0.8, height: 18 }} />
                            )}
                          </TableCell>
                          <TableCell align="right" sx={{ ...MONO, whiteSpace: "nowrap", color: v.row.kind === "income" ? token("ok") : undefined }}>
                            {v.row.kind === "income" ? "+" : ""}
                            {money(v.row.cents)}
                          </TableCell>
                          <TableCell sx={{ whiteSpace: "nowrap" }}>{categoryOf(v.row.category).label}</TableCell>
                          <TableCell>
                            {dup ? (
                              <Tooltip title={v.reason}>
                                <Chip size="small" color="warning" variant="outlined" label={CHECK_LABEL[v.check!]} sx={{ height: 20 }} />
                              </Tooltip>
                            ) : (
                              <Chip size="small" color="success" variant="outlined" label="new" sx={{ height: 20 }} />
                            )}
                            {dup && (
                              <Typography component="span" sx={{ fontSize: 11, color: token("dim"), ml: 0.8 }}>
                                {v.reason}
                              </Typography>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Box>
            )}

            {problems.length > 0 && (
              <Alert severity="info" sx={{ fontSize: 12 }}>
                Skipped {problems.length} line{problems.length === 1 ? "" : "s"} that could not be read:
                <Box component="ul" sx={{ m: "4px 0 0", pl: 2.2 }}>
                  {problems.slice(0, 6).map((p) => (
                    <li key={p.line}>
                      <Typography component="span" sx={{ ...MONO, fontSize: 11.5 }}>
                        line {p.line}: {p.text}
                      </Typography>{" "}
                      <Typography component="span" sx={{ fontSize: 11.5, color: token("dim") }}>
                        — {p.reason}
                      </Typography>
                    </li>
                  ))}
                  {problems.length > 6 && <li>…and {problems.length - 6} more</li>}
                </Box>
              </Alert>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onClose}>
          Cancel
        </Button>
        {!verdicts ? (
          <Button size="small" variant="contained" disabled={!text.trim()} onClick={review}>
            Review
          </Button>
        ) : (
          <Button size="small" variant="contained" disabled={selected === 0} onClick={commit}>
            Import {selected} selected
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
