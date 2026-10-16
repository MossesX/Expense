"use client";

/**
 * @file The **Paydays** dialog — set the pay schedule, see what it implies,
 * add what the ledger is missing.
 *
 * The schedule itself is four module settings (`expenses.decl.ts`), so the
 * shell's gear opens the same values; this dialog exists because the rows on
 * their own answer "what is my schedule" and not "which paydays am I missing"
 * — the second question needs the ledger, and that is what the summary strip
 * and the one action button here are for.
 *
 * Edits are local until Save: a half-typed amount must not write itself to
 * the kv store on every keystroke, and Cancel has to mean cancel.
 */

import * as React from "react";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { token } from "@axf/core";

import { MONO, StatTile, autoDashIso } from "./bits";
import { fillPaydays } from "./expenses.commands";
import { evalAmount, money } from "./math";
import {
  PAY_FREQUENCIES,
  isIsoDate,
  missingPaydays,
  nextPayday,
  paydayId,
  scheduleReady,
  todayIso,
  type PayFrequency,
  type PaySchedule
} from "./payday";
import { expensesSettings, paySchedule, useExpensesSettings } from "./settings";
import type { Expense } from "./types";

export default function PaydayDialog({
  open,
  expenses,
  onClose
}: {
  open: boolean;
  expenses: Expense[];
  onClose: () => void;
}) {
  const saved = useExpensesSettings();
  // Keyed on the four SCALARS, not on `saved`: the settings hook returns a
  // fresh object every render, and a `current` that changed every render
  // re-ran the re-seed effect below on every keystroke — wiping the form as
  // it was typed, which is exactly how the first deploy shipped (the
  // "Add missing paydays" button could never enable).
  const current = React.useMemo(
    () => paySchedule(saved),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [saved.paydayAmount, saved.paydayEvery, saved.paydayAnchor, saved.paydayPayer]
  );

  const [amount, setAmount] = React.useState("");
  const [every, setEvery] = React.useState<PayFrequency>("biweekly");
  const [anchor, setAnchor] = React.useState("");
  const [payer, setPayer] = React.useState("");
  const [note, setNote] = React.useState<string | null>(null);

  // Re-seed the form from the saved schedule every time the dialog OPENS, so
  // a Cancel-then-reopen shows the truth rather than the abandoned draft. On
  // open only — not when `current` changes — because our own Save changes it,
  // and re-seeding then would wipe the "Schedule saved" note the moment it
  // appeared (the form already holds the values that were just saved).
  React.useEffect(() => {
    if (!open) return;
    setAmount(current.amount ? (current.amount / 100).toFixed(2) : "");
    setEvery(current.every);
    setAnchor(current.anchor);
    setPayer(current.payer);
    setNote(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const draftCents = evalAmount(amount);
  const draft: PaySchedule = {
    amount: draftCents ?? 0,
    every,
    anchor: anchor.trim(),
    payer: payer.trim() || "Payday"
  };
  const anchorOk = !draft.anchor || isIsoDate(draft.anchor);
  const ready = scheduleReady(draft);
  const dirty =
    draft.amount !== current.amount ||
    draft.every !== current.every ||
    draft.anchor !== current.anchor ||
    draft.payer !== current.payer;

  const today = todayIso();
  const missing = React.useMemo(
    () => (ready ? missingPaydays(expenses, draft, today) : []),
    // `draft` is rebuilt every render; its four scalars are what the calendar depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expenses, ready, today, draft.amount, draft.every, draft.anchor, draft.payer]
  );
  const present = React.useMemo(() => expenses.filter((e) => e.id.startsWith("inc_payday_")).length, [expenses]);
  const next = ready ? nextPayday(draft, today) : null;

  const save = () => {
    expensesSettings.set("paydayAmount", draft.amount / 100);
    expensesSettings.set("paydayEvery", draft.every);
    expensesSettings.set("paydayAnchor", draft.anchor);
    expensesSettings.set("paydayPayer", draft.payer);
    setNote("Schedule saved");
  };

  const fill = () => {
    if (dirty) save();
    const added = fillPaydays(today);
    setNote(added ? `Added ${added} payday${added === 1 ? "" : "s"}` : "Nothing to add — every payday through today is already in the ledger");
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: 15, fontWeight: 700, pb: 1 }}>Paydays</DialogTitle>
      <DialogContent dividers sx={{ display: "grid", gap: 1.4 }}>
        <Typography sx={{ fontSize: 12, color: token("dim") }}>
          A payday is an income entry the ledger writes for you. Set the schedule once; &ldquo;Add missing
          paydays&rdquo; then fills in every payday from the first one through today that the ledger does not
          already have. Each generated payday has a fixed id per date, so running it again never duplicates
          one — but a payday you deleted will come back.
        </Typography>

        <Stack direction="row" spacing={1.2} useFlexGap sx={{ flexWrap: "wrap" }}>
          <TextField
            size="small"
            label="Take-home per payday"
            value={amount}
            placeholder="1850.00"
            onChange={(e) => setAmount(e.target.value)}
            error={amount.trim() !== "" && draftCents === null}
            helperText={amount.trim() !== "" && draftCents === null ? "Not an amount" : " "}
            sx={{ width: 180, "& input": { ...MONO, fontSize: 12.5 } }}
          />
          <TextField
            select
            size="small"
            label="Paid every"
            value={every}
            onChange={(e) => setEvery(e.target.value as PayFrequency)}
            helperText=" "
            sx={{ width: 220 }}
          >
            {PAY_FREQUENCIES.map((f) => (
              <MenuItem key={f.value} value={f.value} sx={{ fontSize: 12.5 }}>
                {f.label}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
        <Stack direction="row" spacing={1.2} useFlexGap sx={{ flexWrap: "wrap" }}>
          <TextField
            size="small"
            label="First payday"
            value={anchor}
            placeholder="2026-01-09"
            onChange={(e) => setAnchor(autoDashIso(e.target.value) || e.target.value)}
            error={!anchorOk}
            helperText={!anchorOk ? "Use YYYY-MM-DD" : "Any past payday — the calendar counts from it"}
            sx={{ width: 180, "& input": { ...MONO, fontSize: 12.5 } }}
          />
          <TextField
            size="small"
            label="Payer"
            value={payer}
            placeholder="Payday"
            onChange={(e) => setPayer(e.target.value)}
            helperText="Shown in the Merchant column"
            sx={{ width: 220 }}
          />
        </Stack>

        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          <StatTile value={ready ? money(draft.amount) : "—"} label="per payday" />
          <StatTile value={next ?? "—"} label="next payday" />
          <StatTile value={String(present)} label="in the ledger" sub={present ? `ids ${paydayId("…")}` : undefined} />
          <StatTile
            value={ready ? String(missing.length) : "—"}
            label="missing through today"
            sub={ready ? (missing.length ? `${missing[0]} → ${missing[missing.length - 1]}` : "all present") : "set an amount and a first payday"}
            subTone={ready ? (missing.length ? "warn" : "ok") : undefined}
          />
        </Box>

        {note ? (
          <Alert severity="success" sx={{ py: 0 }}>
            {note}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onClose}>
          Close
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="outlined" disabled={!dirty || !anchorOk} onClick={save}>
          Save schedule
        </Button>
        <Button size="small" variant="contained" color="success" disabled={!ready || !missing.length} onClick={fill}>
          Add {ready && missing.length ? `${missing.length} ` : ""}missing payday{missing.length === 1 ? "" : "s"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
