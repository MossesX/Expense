"use client";

/**
 * @file The welcome dialog — once per sign-in, the paydays the ledger is
 * missing (each with a switch, on by default) and whichever glances at the
 * month the settings asked for (owner, 2026-10-16).
 *
 * Content comes from `welcome.ts`; this file only draws it and runs the one
 * action, adding the ticked paydays through the same `paydayEntry` the
 * Paydays dialog uses, so the ids match and nothing can be added twice.
 */

import * as React from "react";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";

import { token } from "@axf/core";

import { MONO, StatTile } from "./bits";
import { money } from "./math";
import { WEEKDAYS, paydayEntry } from "./payday";
import { expensesSettings, paySchedule, useExpensesSettings } from "./settings";
import { expenseStore } from "./store";
import type { Expense } from "./types";
import { expenseUi } from "./ui";
import { buildWelcome } from "./welcome";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box>
      <Typography sx={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: token("dim"), mb: 0.6 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

const pretty = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()].short} ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
};

export default function WelcomeDialog({
  open,
  expenses,
  user,
  onClose,
  onOpenPaydays
}: {
  open: boolean;
  expenses: readonly Expense[];
  user: string | null;
  onClose: () => void;
  onOpenPaydays: () => void;
}) {
  const settings = useExpensesSettings();
  const schedule = React.useMemo(
    () => paySchedule(settings),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.paydayAmount, settings.paydayEvery, settings.paydayWeekday, settings.paydayAnchor, settings.paydayDayOfMonth, settings.paydaySince, settings.paydayPayer]
  );
  const model = React.useMemo(() => buildWelcome(expenses, settings, schedule), [expenses, settings, schedule]);

  const [ticked, setTicked] = React.useState<Set<string>>(new Set());
  const missingKey = model.missingPaydays.join("|");
  React.useEffect(() => {
    if (open) setTicked(new Set(model.missingPaydays));
    // Re-tick when the dialog opens or the set of missing dates changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, missingKey]);

  const toggle = (d: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });

  const addPaydays = () => {
    const dates = model.missingPaydays.filter((d) => ticked.has(d));
    if (!dates.length) return;
    const now = Date.now();
    const added = expenseStore.addMany(dates.map((d) => paydayEntry(schedule, d, now)));
    expenseUi.say(`Added ${added} payday${added === 1 ? "" : "s"}`);
    onClose();
  };

  const neverAgain = () => {
    expensesSettings.set("welcomeEnabled", false);
    expenseUi.say("Welcome dialog switched off — Settings › Welcome turns it back on");
    onClose();
  };

  const showPaydays = settings.welcomeMissingPaydays;
  const tickedCount = model.missingPaydays.filter((d) => ticked.has(d)).length;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: 15, fontWeight: 700, pb: 1 }}>
        Welcome back{user ? `, ${user}` : ""}
        <Typography component="span" sx={{ ml: 1, fontSize: 12, color: token("dim"), ...MONO }}>
          {model.today}
        </Typography>
      </DialogTitle>
      <DialogContent dividers sx={{ display: "grid", gap: 1.8 }}>
        {showPaydays && !model.scheduleReady && (
          <Section title="Paydays">
            <Alert
              severity="info"
              sx={{ py: 0 }}
              action={
                <Button size="small" color="inherit" onClick={onOpenPaydays}>
                  Set up
                </Button>
              }
            >
              No pay schedule yet. Say what day you are paid and the ledger will write the paydays for you.
            </Alert>
          </Section>
        )}

        {showPaydays && model.scheduleReady && (
          <Section title={model.missingPaydays.length ? `${model.missingPaydays.length} missing payday${model.missingPaydays.length === 1 ? "" : "s"}` : "Paydays"}>
            {model.missingPaydays.length === 0 ? (
              <Typography sx={{ fontSize: 12.5, color: token("ok") }}>Every payday through today is in the ledger.</Typography>
            ) : (
              <>
                <Typography sx={{ fontSize: 12, color: token("dim"), mb: 0.5 }}>
                  Ticked paydays are added as {money(schedule.amount)} income from {schedule.payer}. Untick any that did not happen.
                </Typography>
                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, maxHeight: 220, overflow: "auto" }}>
                  {model.missingPaydays.map((d) => (
                    <FormControlLabel
                      key={d}
                      control={<Switch size="small" checked={ticked.has(d)} onChange={() => toggle(d)} />}
                      label={<Typography sx={{ fontSize: 12.5, ...MONO }}>{pretty(d)}</Typography>}
                      sx={{ my: 0, mr: 0 }}
                    />
                  ))}
                </Box>
              </>
            )}
          </Section>
        )}

        {(model.month || model.nextPayday) && (
          <Section title="At a glance">
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              {model.month && (
                <>
                  <StatTile value={money(model.month.spent)} label="spent this month" sub={`${model.month.count} entries`} />
                  <StatTile value={`+${money(model.month.income)}`} label="income this month" />
                  <StatTile
                    value={`${model.month.net >= 0 ? "+" : ""}${money(model.month.net)}`}
                    label="net"
                    sub={model.month.net >= 0 ? "ahead" : "behind"}
                    subTone={model.month.net >= 0 ? "ok" : "warn"}
                  />
                </>
              )}
              {model.nextPayday && (
                <StatTile
                  value={pretty(model.nextPayday.date)}
                  label="next payday"
                  sub={model.nextPayday.days === 0 ? "today" : model.nextPayday.days === 1 ? "tomorrow" : `in ${model.nextPayday.days} days`}
                  subTone="ok"
                />
              )}
            </Box>
          </Section>
        )}

        {model.overBudget && model.overBudget.length > 0 && (
          <Section title="Over budget this month">
            <Stack spacing={0.4}>
              {model.overBudget.map((c) => (
                <Typography key={c.id} sx={{ fontSize: 12.5 }}>
                  <Box component="span" sx={{ color: token("warn"), fontWeight: 600 }}>{c.label}</Box>
                  <Box component="span" sx={{ ...MONO, color: token("dim"), ml: 1 }}>
                    {money(c.spent)} of {money(c.budget)}
                  </Box>
                </Typography>
              ))}
            </Stack>
          </Section>
        )}

        {model.topCategories && model.topCategories.length > 0 && (
          <Section title="Top categories this month">
            <Stack spacing={0.4}>
              {model.topCategories.map((c) => (
                <Typography key={c.id} sx={{ fontSize: 12.5 }}>
                  {c.label}
                  <Box component="span" sx={{ ...MONO, color: token("dim"), ml: 1 }}>{money(c.spent)}</Box>
                </Typography>
              ))}
            </Stack>
          </Section>
        )}

        {(model.unreconciled || model.disputed || model.recentImports) ? (
          <>
            <Divider />
            <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: "wrap" }}>
              {model.unreconciled ? (
                <Typography sx={{ fontSize: 12.5 }}>
                  <Box component="span" sx={{ ...MONO, color: token("warn") }}>{model.unreconciled}</Box> unreconciled
                </Typography>
              ) : null}
              {model.disputed ? (
                <Typography sx={{ fontSize: 12.5 }}>
                  <Box component="span" sx={{ ...MONO, color: token("warn") }}>{model.disputed}</Box> disputed
                </Typography>
              ) : null}
              {model.recentImports ? (
                <Typography sx={{ fontSize: 12.5 }}>
                  <Box component="span" sx={{ ...MONO }}>{model.recentImports}</Box> imported this week
                </Typography>
              ) : null}
            </Stack>
          </>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button size="small" color="inherit" onClick={neverAgain} sx={{ color: token("dim") }}>
          Don&apos;t show again
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={onClose}>
          Close
        </Button>
        {showPaydays && model.missingPaydays.length > 0 && (
          <Button size="small" variant="contained" color="success" disabled={!tickedCount} onClick={addPaydays}>
            Add {tickedCount} payday{tickedCount === 1 ? "" : "s"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
