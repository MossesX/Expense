/**
 * @file **Statements** — automatic period statement generation.
 *
 * Pick a granularity (month / quarter / year) and every period that has data
 * is offered; selecting one builds a complete statement from `./math`'s
 * `buildStatement`: opening and closing balance, subtotal / tax / tip / total,
 * the category split with shares, top merchants, budget variance, the
 * period-over-period change, and the list of receipts whose printed total does
 * not match their lines.
 *
 * "Automatic" means the statement is derived, never authored: there is nothing
 * to fill in and nothing to save. Regenerating after an edit produces the new
 * truth rather than a second document to reconcile against the first.
 *
 * Export is markdown — the clipboard, or a print window over the same text.
 * (GizmoX's themed HTML export rode on the Data Grid's Export Studio, which
 * stayed in GizmoX with the Data Grid.)
 */
"use client";

import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";

import { token } from "@axf/core";

import { MONO, StatTile } from "./bits";
import { categoryOf, isIncome, type Expense } from "./types";
import {
  buildStatement,
  effectiveTotal,
  money,
  periodsIn,
  statementMarkdown,
  type PeriodKind
} from "./math";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.4, display: "grid", gap: 0.6 }}>
      <Typography sx={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: token("dim") }}>
        {title}
      </Typography>
      {children}
    </Paper>
  );
}

export function Statements({ expenses }: { expenses: Expense[] }) {
  const [kind, setKind] = React.useState<PeriodKind>("month");
  const periods = React.useMemo(() => periodsIn(expenses, kind), [expenses, kind]);
  const [key, setKey] = React.useState<string | null>(null);

  // The newest period with data is the one a person almost always wants.
  const active = periods.find((p) => p.key === key) ?? periods[periods.length - 1] ?? null;

  const statement = React.useMemo(
    () => (active ? buildStatement(expenses, active) : null),
    [expenses, active]
  );

  const [copied, setCopied] = React.useState(false);
  const copy = React.useCallback(async () => {
    if (!statement) return;
    try {
      await navigator.clipboard.writeText(statementMarkdown(statement));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the print path still works */
    }
  }, [statement]);

  const print = React.useCallback(() => {
    if (!statement) return;
    const w = window.open("", "_blank", "width=760,height=900");
    if (!w) return;
    const pre = w.document.createElement("pre");
    pre.style.cssText = "font: 12px/1.5 monospace; white-space: pre-wrap; padding: 24px;";
    pre.textContent = statementMarkdown(statement);
    w.document.title = `Expense statement — ${statement.period.label}`;
    w.document.body.appendChild(pre);
    w.print();
  }, [statement]);

  if (!expenses.length) {
    return (
      <Typography sx={{ fontSize: 12, color: token("dim") }}>
        No expenses yet — statements are derived from the ledger, so add expenses on the Grid tab
        first.
      </Typography>
    );
  }

  return (
    <Box sx={{ display: "grid", gap: 1.2 }}>
      {/* ------------------------------------------------------- period picker */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={kind}
          onChange={(_, v: PeriodKind | null) => {
            if (v) {
              setKind(v);
              setKey(null);
            }
          }}
        >
          <ToggleButton value="month">Month</ToggleButton>
          <ToggleButton value="quarter">Quarter</ToggleButton>
          <ToggleButton value="year">Year</ToggleButton>
        </ToggleButtonGroup>
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="outlined" onClick={() => void copy()} disabled={!statement}>
          {copied ? "Copied" : "Copy markdown"}
        </Button>
        <Button size="small" variant="outlined" onClick={print} disabled={!statement}>
          Print
        </Button>
      </Box>

      <Box sx={{ display: "flex", gap: 0.6, flexWrap: "wrap" }}>
        {periods.map((p) => (
          <Chip
            key={p.key}
            size="small"
            label={p.label}
            color={active?.key === p.key ? "primary" : "default"}
            variant={active?.key === p.key ? "filled" : "outlined"}
            onClick={() => setKey(p.key)}
            sx={{ height: 22 }}
          />
        ))}
      </Box>

      {statement && (
        <>
          {/* -------------------------------------------------------- headline */}
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            <StatTile value={money(statement.opening)} label="opening" />
            <StatTile value={money(statement.subtotal)} label="subtotal" />
            <StatTile value={money(statement.tax)} label="tax" />
            <StatTile value={money(statement.tip)} label="tip / service" />
            <StatTile value={money(statement.total)} label="spent" />
            <StatTile value={money(statement.income)} label="income" />
            <StatTile
              value={`${statement.net > 0 ? "+" : ""}${money(statement.net)}`}
              label="net"
              subTone={statement.net >= 0 ? "ok" : "warn"}
              sub={statement.net >= 0 ? "income − spent" : "spent more than earned"}
            />
            <StatTile value={money(statement.closing)} label="closing" />
            {statement.changePct !== null && (
              <StatTile
                value={`${statement.changePct > 0 ? "+" : ""}${statement.changePct}%`}
                label="vs previous"
                subTone={statement.changePct > 0 ? "warn" : "ok"}
                sub={statement.previousTotal !== null ? `was ${money(statement.previousTotal)}` : undefined}
              />
            )}
          </Box>

          <Box sx={{ display: "grid", gap: 1.2, gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" }, alignItems: "start" }}>
            {/* ------------------------------------------------ category split */}
            <Section title={`By category · ${statement.categories.length}`}>
              {statement.categories.map((c) => {
                const color = categoryOf(c.key).color;
                return (
                  <Box key={c.key} sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.3 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: color, flexShrink: 0 }} />
                    <Typography sx={{ fontSize: 12, minWidth: 150 }} noWrap>
                      {c.label}
                    </Typography>
                    <Typography sx={{ fontSize: 10.5, color: token("dim") }}>{c.count}</Typography>
                    <Box sx={{ flex: 1, minWidth: 40 }}>
                      <LinearProgress
                        variant="determinate"
                        value={Math.min(100, c.share)}
                        sx={{
                          height: 4,
                          borderRadius: 2,
                          backgroundColor: token("edge"),
                          "& .MuiLinearProgress-bar": { backgroundColor: color }
                        }}
                      />
                    </Box>
                    <Typography sx={{ ...MONO, fontSize: 10.5, color: token("dim"), width: 44, textAlign: "right" }}>
                      {c.share}%
                    </Typography>
                    <Typography sx={{ ...MONO, fontSize: 11.8, width: 96, textAlign: "right" }}>
                      {money(c.total)}
                    </Typography>
                  </Box>
                );
              })}
            </Section>

            {/* -------------------------------------- variance + top merchants */}
            <Box sx={{ display: "grid", gap: 1.2 }}>
              {statement.variance.length > 0 && (
                <Section title="Budget variance (monthly budgets)">
                  {statement.variance.map((v) => (
                    <Box key={v.categoryId} sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.25 }}>
                      <Typography sx={{ fontSize: 12, minWidth: 150 }} noWrap>
                        {v.label}
                      </Typography>
                      <Typography sx={{ ...MONO, fontSize: 10.5, color: token("dim") }}>
                        {v.budget ? money(v.budget) : "untracked"}
                      </Typography>
                      <Box sx={{ flex: 1 }} />
                      {v.usedPct !== null && (
                        <Typography
                          sx={{ ...MONO, fontSize: 10.5, color: v.usedPct > 100 ? token("err") : token("dim") }}
                        >
                          {v.usedPct}%
                        </Typography>
                      )}
                      <Typography
                        sx={{
                          ...MONO,
                          fontSize: 11.5,
                          width: 96,
                          textAlign: "right",
                          color: v.delta > 0 && v.budget ? token("err") : token("ink")
                        }}
                      >
                        {money(v.spent)}
                      </Typography>
                    </Box>
                  ))}
                </Section>
              )}

              <Section title={`Top merchants · ${statement.merchants.length}`}>
                {statement.merchants.map((m) => (
                  <Box key={m.key} sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.25 }}>
                    <Typography sx={{ fontSize: 12, minWidth: 150 }} noWrap>
                      {m.label}
                    </Typography>
                    <Typography sx={{ fontSize: 10.5, color: token("dim") }}>{m.count}</Typography>
                    <Box sx={{ flex: 1 }} />
                    <Typography sx={{ ...MONO, fontSize: 10.5, color: token("dim"), width: 44, textAlign: "right" }}>
                      {m.share}%
                    </Typography>
                    <Typography sx={{ ...MONO, fontSize: 11.8, width: 96, textAlign: "right" }}>
                      {money(m.total)}
                    </Typography>
                  </Box>
                ))}
              </Section>
            </Box>
          </Box>

          {/* --------------------------------------------------- unreconciled */}
          {statement.unreconciled.length > 0 && (
            <Section title={`Unreconciled receipts · ${statement.unreconciled.length}`}>
              {statement.unreconciled.map((u) => (
                <Box key={u.expense.id} sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.25 }}>
                  <Typography sx={{ ...MONO, fontSize: 11.5, color: token("dim") }}>{u.expense.date}</Typography>
                  <Typography sx={{ fontSize: 12 }} noWrap>
                    {u.expense.merchant}
                  </Typography>
                  <Box sx={{ flex: 1 }} />
                  <Typography sx={{ ...MONO, fontSize: 11.5, color: token("warn") }}>
                    printed total differs by {u.delta > 0 ? "+" : ""}
                    {money(u.delta)}
                  </Typography>
                </Box>
              ))}
            </Section>
          )}

          {/* ------------------------------------------------------- the lines */}
          <Section title={`Entries · ${statement.expenses.length}`}>
            <Box sx={{ maxHeight: 280, overflow: "auto" }}>
              {statement.expenses.map((e) => (
                <Box
                  key={e.id}
                  data-axf-area="expenses.expense"
                  data-axf-expense={e.id}
                  data-axf-merchant={e.merchant}
                  sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.25 }}
                >
                  <Typography sx={{ ...MONO, fontSize: 11.5, color: token("dim") }}>{e.date}</Typography>
                  <Typography sx={{ fontSize: 12, textDecoration: e.disputed ? "line-through" : "none" }} noWrap>
                    {e.merchant}
                  </Typography>
                  <Typography sx={{ fontSize: 10.5, color: token("dim") }}>{categoryOf(e.category).label}</Typography>
                  <Box sx={{ flex: 1 }} />
                  <Typography sx={{ ...MONO, fontSize: 11.8, color: isIncome(e) ? token("ok") : undefined }}>
                    {isIncome(e) ? "+" : ""}
                    {money(effectiveTotal(e))}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Section>
        </>
      )}
    </Box>
  );
}
