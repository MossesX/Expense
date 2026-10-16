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
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";

import { token } from "@axf/core";

import { MONO, StatTile, autoDashIso } from "./bits";
import { fillPaydays } from "./expenses.commands";
import { evalAmount, money } from "./math";
import {
  WEEKDAYS,
  calendarStart,
  isIsoDate,
  isPaydayEntry,
  missingPaydays,
  nextPayday,
  paydayId,
  recentWeekdays,
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
  // Keyed on the SCALARS, not on `saved`: the settings hook returns a fresh
  // object every render, and a `current` that changed every render re-ran the
  // re-seed effect below on every keystroke — wiping the form as it was typed.
  const current = React.useMemo(
    () => paySchedule(saved),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      saved.paydayAmount,
      saved.paydayEvery,
      saved.paydayWeekday,
      saved.paydayAnchor,
      saved.paydayDayOfMonth,
      saved.paydaySince,
      saved.paydayPayer
    ]
  );

  const [amount, setAmount] = React.useState("");
  const [every, setEvery] = React.useState<PayFrequency>("biweekly");
  const [weekday, setWeekday] = React.useState(5);
  const [anchor, setAnchor] = React.useState("");
  const [dayOfMonth, setDayOfMonth] = React.useState("1");
  const [since, setSince] = React.useState("");
  const [payer, setPayer] = React.useState("");
  const [note, setNote] = React.useState<string | null>(null);

  const today = todayIso();

  // Re-seed the form from the saved schedule every time the dialog OPENS, so
  // a Cancel-then-reopen shows the truth rather than the abandoned draft.
  React.useEffect(() => {
    if (!open) return;
    setAmount(current.amount ? (current.amount / 100).toFixed(2) : "");
    setEvery(current.every);
    setWeekday(current.weekday);
    setAnchor(current.anchor);
    setDayOfMonth(String(current.dayOfMonth));
    setSince(current.since);
    setPayer(current.payer);
    setNote(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The two most recent occurrences of the chosen weekday — the only two
  // answers to "which week?" a two-weekly schedule needs.
  const recent = React.useMemo(() => recentWeekdays(today, weekday, 2), [today, weekday]);
  // An anchor on another weekday (the weekday was just changed) is stale: the
  // reference must be ON the weekday or the lattice drifts off it.
  const anchorOnWeekday = isIsoDate(anchor) && recent.some((d) => d === anchor);
  const effectiveAnchor = every === "biweekly" ? (anchorOnWeekday ? anchor : recent[0]) : "";

  const draftCents = evalAmount(amount);
  const dom = Number(dayOfMonth);
  const draft: PaySchedule = {
    amount: draftCents ?? 0,
    every,
    weekday,
    anchor: effectiveAnchor,
    dayOfMonth: Number.isInteger(dom) ? Math.min(31, Math.max(1, dom)) : 1,
    since: since.trim(),
    payer: payer.trim() || "Payday"
  };
  const sinceOk = !draft.since || isIsoDate(draft.since);
  const domOk = every !== "monthly" || (Number.isInteger(dom) && dom >= 1 && dom <= 31);
  const ready = scheduleReady(draft) && sinceOk && domOk;
  const dirty =
    draft.amount !== current.amount ||
    draft.every !== current.every ||
    draft.weekday !== current.weekday ||
    draft.anchor !== current.anchor ||
    draft.dayOfMonth !== current.dayOfMonth ||
    draft.since !== current.since ||
    draft.payer !== current.payer;

  const start = calendarStart(expenses, draft, today);
  const missing = React.useMemo(
    () => (ready ? missingPaydays(expenses, draft, today) : []),
    // `draft` is rebuilt every render; its scalars are what the calendar depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expenses, ready, today, draft.amount, draft.every, draft.weekday, draft.anchor, draft.dayOfMonth, draft.since]
  );
  const present = React.useMemo(() => expenses.filter(isPaydayEntry).length, [expenses]);
  const next = ready ? nextPayday(draft, today) : null;

  const save = () => {
    expensesSettings.set("paydayAmount", draft.amount / 100);
    expensesSettings.set("paydayEvery", draft.every);
    expensesSettings.set("paydayWeekday", String(draft.weekday));
    expensesSettings.set("paydayAnchor", draft.anchor);
    expensesSettings.set("paydayDayOfMonth", draft.dayOfMonth);
    expensesSettings.set("paydaySince", draft.since);
    expensesSettings.set("paydayPayer", draft.payer);
    setNote("Schedule saved");
  };

  const fill = () => {
    if (dirty) save();
    const added = fillPaydays(today);
    setNote(added ? `Added ${added} payday${added === 1 ? "" : "s"}` : "Nothing to add — every payday through today is already in the ledger");
  };

  const weekdayLabel = WEEKDAYS[weekday]?.label ?? "Friday";
  const prettyDate = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    return `${WEEKDAYS[d.getUTCDay()].short} ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: 15, fontWeight: 700, pb: 1 }}>Paydays</DialogTitle>
      <DialogContent dividers sx={{ display: "grid", gap: 1.4 }}>
        <Typography sx={{ fontSize: 12, color: token("dim") }}>
          A payday is an income entry the ledger writes for you. Say what day it lands on; &ldquo;Add missing
          paydays&rdquo; then fills in every payday from the ledger&apos;s first entry through today that it
          does not already have. Each generated payday has a fixed id per date, so running it again never
          duplicates one — but a payday you deleted will come back.
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
          {/* The frequency as a SWITCH, not a dropdown (owner, 2026-10-16):
              four choices that are always on view and one tap apart, and the
              fields underneath change with the one that is pressed. */}
          <Box>
            <Typography sx={{ fontSize: 11, color: token("dim"), mb: 0.5 }}>Paid every</Typography>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={every}
              onChange={(_, v: PayFrequency | null) => {
                if (v) setEvery(v);
              }}
              aria-label="Pay frequency"
              data-axf-payday-frequency={every}
              sx={{ "& .MuiToggleButton-root": { textTransform: "none", fontSize: 12.5, px: 1.4, py: 0.55, whiteSpace: "nowrap" } }}
            >
              <ToggleButton value="weekly">Week</ToggleButton>
              <ToggleButton value="biweekly">Two weeks</ToggleButton>
              <ToggleButton value="semimonthly">1st &amp; 15th</ToggleButton>
              <ToggleButton value="monthly">Month</ToggleButton>
            </ToggleButtonGroup>
          </Box>
        </Stack>

        <Stack direction="row" spacing={1.2} useFlexGap sx={{ flexWrap: "wrap" }}>
          {(every === "weekly" || every === "biweekly") && (
            <TextField
              select
              size="small"
              label="Payday is a"
              value={String(weekday)}
              onChange={(e) => setWeekday(Number(e.target.value))}
              helperText={every === "weekly" ? `Every ${weekdayLabel}` : `Every other ${weekdayLabel}`}
              sx={{ width: 180 }}
            >
              {WEEKDAYS.map((d) => (
                <MenuItem key={d.value} value={String(d.value)} sx={{ fontSize: 12.5 }}>
                  {d.label}
                </MenuItem>
              ))}
            </TextField>
          )}
          {every === "biweekly" && (
            <TextField
              select
              size="small"
              label="Most recent payday was"
              value={effectiveAnchor}
              onChange={(e) => setAnchor(e.target.value)}
              helperText="Settles which week — the calendar counts in fourteens from it"
              sx={{ width: 220 }}
            >
              {recent.map((d) => (
                <MenuItem key={d} value={d} sx={{ fontSize: 12.5 }}>
                  {prettyDate(d)}
                  {d === recent[0] ? " (this week)" : " (last week)"}
                </MenuItem>
              ))}
            </TextField>
          )}
          {every === "monthly" && (
            <TextField
              size="small"
              label="Day of the month"
              value={dayOfMonth}
              onChange={(e) => setDayOfMonth(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
              error={!domOk}
              helperText={domOk ? "Short months use their last day" : "1 to 31"}
              sx={{ width: 180, "& input": { ...MONO, fontSize: 12.5 } }}
            />
          )}
          {every === "semimonthly" && (
            <Typography sx={{ fontSize: 12, color: token("dim"), alignSelf: "center" }}>
              Lands on the 1st and the 15th.
            </Typography>
          )}
        </Stack>

        <Stack direction="row" spacing={1.2} useFlexGap sx={{ flexWrap: "wrap" }}>
          <TextField
            size="small"
            label="Payer"
            value={payer}
            placeholder="Payday"
            onChange={(e) => setPayer(e.target.value)}
            helperText="Shown in the Merchant column"
            sx={{ width: 180 }}
          />
          <TextField
            size="small"
            label="Generate since"
            value={since}
            placeholder={start}
            onChange={(e) => setSince(autoDashIso(e.target.value) || e.target.value)}
            error={!sinceOk}
            helperText={!sinceOk ? "Use YYYY-MM-DD" : `Blank = the ledger's first entry (${start})`}
            sx={{ width: 220, "& input": { ...MONO, fontSize: 12.5 } }}
          />
        </Stack>

        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          <StatTile value={ready ? money(draft.amount) : "—"} label="per payday" />
          <StatTile value={next ?? "—"} label="next payday" />
          <StatTile value={String(present)} label="in the ledger" sub={present ? `ids ${paydayId("…")}` : undefined} />
          <StatTile
            value={ready ? String(missing.length) : "—"}
            label="missing through today"
            sub={ready ? (missing.length ? `${missing[0]} → ${missing[missing.length - 1]}` : "all present") : "set an amount"}
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
        <Button size="small" variant="outlined" disabled={!dirty || !sinceOk || !domOk} onClick={save}>
          Save schedule
        </Button>
        <Button size="small" variant="contained" color="success" disabled={!ready || !missing.length} onClick={fill}>
          Add {ready && missing.length ? `${missing.length} ` : ""}missing payday{missing.length === 1 ? "" : "s"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
