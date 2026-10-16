"use client";

/**
 * @file Expense Tracker module — the /expenses screen.
 *
 * Imported from GizmoX 2026-08-12: the three-view surface (Grid · Tree ·
 * Statements) over ONE store and ONE math module, so the grid, the rollup and
 * the statement can never disagree by a cent.
 *
 * Deliberate departures from the GizmoX original, each because the backend it
 * rode on stayed in GizmoX:
 *
 *   - **No "Import receipt" tab** — the parse ran through GizmoX's claude
 *     subsystem (vision over an uploaded image). AmberX's claude subsystem was
 *     stripped in v0.3.0; a tab whose one button 500s is a dead surface.
 *   - **No "Sync from Data Grid"** — the converter read GizmoX's Data Grid
 *     module store. There is no Data Grid here.
 *
 * What replaced GizmoX's chrome: context menus are DATA on `expenses.decl.ts`
 * (the screen only marks `data-axf-area`), the sui is the minimal AmberX shape
 * (one switch, own dialog, own button — see `ExpensesSui`), and the header is
 * plain MUI over `token()` — no GX kit, no watermark, no Material icons.
 *
 * ── The tab group (2026-08-12 evening) ──────────────────────────────────────
 *
 * The three views used to be a fixed `Tabs` over one `useState`. The owner
 * asked for reports as documents and for tabs that come out of the strip:
 * *"new report which opens in a new tab because for this layout report
 * displayed in tab group … allow undocking tab and floating as window. if last
 * tab is removed, floated, or closed display animated amberx logo in empty
 * tab."*
 *
 * So the strip is a real group now (`tabs.ts` holds the model, and says why it
 * is a store), a report is a tab (`ReportTab`), a floated tab is a window
 * (`ExpenseWindows`), and an empty group is a surface of its own
 * (`EmptyTabState`) rather than a blank rectangle.
 *
 * Three things this file owns because nothing smaller can:
 *
 *   1. **The Del key.** A document listener, so it works over the grid, over a
 *      floated grid, and from the empty space beside them — the owner asked for
 *      "context menu or del key", and a listener bound to one table would only
 *      honour half of that. It stands down while a text field has focus, or
 *      Del in a merchant name would delete the row being renamed.
 *   2. **Pruning the selection** whenever the ledger changes underneath it.
 *   3. **The vault dialogs**, which context-menu commands request through
 *      `ui.ts` because a plain function cannot mount React.
 */

import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Glyph, commands, token } from "@axf/core";

import { MONO } from "./bits";
import EmptyTabState from "./EmptyTabState";
import ExpenseWindows from "./ExpenseWindows";
import ImportDialog from "./ImportDialog";
import PaydayDialog from "./PaydayDialog";
import TabContent from "./TabContent";
import TabGroup from "./TabGroup";
import VaultDialog from "./VaultDialog";
import { newReportTab } from "./expenses.commands";
import { money, net, sumIncome, sumSpent } from "./math";
import { expenseSelection, useExpenseSelection } from "./selection";
import { blankExpense, blankIncome, useExpenses } from "./store";
import { expenseTabs, useExpenseTabs } from "./tabs";
import { expenseUi, useExpensesUi } from "./ui";
import { isIncome, type Expense } from "./types";
import type { VaultFile } from "./vault";

/** True when the keystroke belongs to something being typed into. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
}

export default function ExpensesModule() {
  const { list, ready, error, add, update, replaceAll } = useExpenses();
  const { tabs, activeId } = useExpenseTabs();
  const selected = useExpenseSelection();
  const ui = useExpensesUi();

  const spent = sumSpent(list);
  const income = sumIncome(list);
  const balance = net(list);
  const incomeCount = list.filter(isIncome).length;
  const disputed = list.filter((e) => e.disputed).length;

  const docked = tabs.filter((t) => t.window === null);
  const floating = tabs.filter((t) => t.window !== null);
  const active = docked.find((t) => t.id === activeId) ?? null;

  /* ------------------------------------------------------------ the Del key */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" || e.repeat) return;
      if (isTyping(e.target)) return;
      if (!expenseSelection.size) return;
      e.preventDefault();
      // Through the command, not a direct call: the menu row and the key must
      // be the same action, including the confirm and the toast, or the two
      // drift the first time one of them is changed.
      commands.run("expenses.expense.delete-selected");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  /* -------------------------------------------- keep the selection truthful */
  React.useEffect(() => {
    expenseSelection.prune(list.map((e) => e.id));
  }, [list]);

  /* ----------------------------------------------------------------- toasts */
  React.useEffect(() => {
    if (!ui.toast) return;
    const timer = window.setTimeout(() => expenseUi.clearToast(), 4000);
    return () => window.clearTimeout(timer);
  }, [ui.toast]);

  const onAdd = React.useCallback(() => add(blankExpense()), [add]);
  const onAddIncome = React.useCallback(() => add(blankIncome()), [add]);
  const onPaydays = React.useCallback(() => expenseUi.openPayday(), []);

  const openSavedReport = React.useCallback((file: VaultFile, content: string) => {
    expenseTabs.openReport(
      { name: file.name, format: file.format === "markdown" ? "markdown" : "html", content },
      file.title
    );
  }, []);

  const loadLedger = React.useCallback(
    (next: Expense[], from: VaultFile) => {
      replaceAll(next);
      expenseSelection.clear();
      expenseUi.say(`Loaded ${next.length} expenses from ${from.name}`);
    },
    [replaceAll]
  );

  return (
    <Box
      data-axf-area="expenses.surface"
      sx={{ display: "flex", flexDirection: "column", gap: 1.2, p: 1.6, minHeight: "100%" }}
    >
      {/* ------------------------------------------------------------ header */}
      <Stack direction="row" spacing={1.2} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <Glyph id="icon-book" size={22} />
        <Typography sx={{ fontSize: 19, fontWeight: 700 }}>Expense Tracker</Typography>
        <Chip size="small" variant="outlined" label={`${list.length - incomeCount} expenses`} sx={{ height: 20 }} />
        {incomeCount > 0 && (
          <Chip size="small" variant="outlined" label={`${incomeCount} income`} sx={{ height: 20, color: token("ok") }} />
        )}
        {disputed > 0 && (
          <Chip size="small" variant="outlined" label={`${disputed} disputed`} sx={{ height: 20, color: token("warn") }} />
        )}
        {selected.size > 0 && (
          <Chip
            size="small"
            label={`${selected.size} selected`}
            sx={{ height: 20, ...MONO, color: token("accent") }}
            onDelete={() => expenseSelection.clear()}
          />
        )}
        <Tooltip title="Spent · income · net (income minus spent)">
          <Stack direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
            <Typography sx={{ ...MONO, fontSize: 14, fontWeight: 700 }}>{money(spent)}</Typography>
            <Typography sx={{ ...MONO, fontSize: 12, color: token("ok") }}>+{money(income)}</Typography>
            <Typography sx={{ ...MONO, fontSize: 13, fontWeight: 700, color: balance >= 0 ? token("ok") : token("warn") }}>
              {balance > 0 ? "+" : ""}
              {money(balance)}
            </Typography>
          </Stack>
        </Tooltip>
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="outlined" onClick={onAdd}>
          Add expense
        </Button>
        <Button size="small" variant="outlined" color="success" onClick={onAddIncome}>
          Add income
        </Button>
        <Tooltip title="Set a pay schedule and add every missing payday through today.">
          <Button size="small" variant="outlined" color="success" onClick={onPaydays}>
            Paydays…
          </Button>
        </Tooltip>
        <Tooltip title="Snapshot the ledger into the saved directory.">
          <Button size="small" variant="outlined" onClick={() => expenseUi.openDialog("save")}>
            Save
          </Button>
        </Tooltip>
        <Tooltip title="Replace the ledger from a saved snapshot.">
          <Button size="small" variant="outlined" onClick={() => expenseUi.openDialog("load")}>
            Load
          </Button>
        </Tooltip>
        <Tooltip title="Add transactions from a bank export or a pasted list — duplicates are detected and skipped.">
          <Button size="small" variant="outlined" onClick={() => expenseUi.openImport()}>
            Import
          </Button>
        </Tooltip>
        {/* The settings affordance moved to the SHELL (core 0.0.20): the gear
            on ModuleHost and the universal "Module settings" row open the one
            SettingsDialog. */}
      </Stack>

      {/* -------------------------------------------------------- tab group */}
      <TabGroup
        tabs={docked}
        activeId={activeId}
        onActivate={(id) => expenseTabs.activate(id)}
        onFloat={(id) => expenseTabs.float(id)}
        onClose={(id) => expenseTabs.close(id)}
        trailing={
          <>
            <Tooltip title="Build a report from the newest period and open it in its own tab.">
              <Button size="small" variant="contained" onClick={() => newReportTab()}>
                New report
              </Button>
            </Tooltip>
            <Button size="small" variant="outlined" onClick={() => expenseUi.openDialog("reports")}>
              Open report
            </Button>
          </>
        }
      />

      {!ready && <Typography sx={{ fontSize: 12, color: token("dim") }}>Loading expenses…</Typography>}
      {error && (
        <Typography sx={{ ...MONO, fontSize: 12, color: token("err") }}>
          Store unavailable: {error}
        </Typography>
      )}

      {ready && active && (
        <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          <TabContent tab={active} expenses={list} onUpdate={update} onAdd={onAdd} onAddIncome={onAddIncome} onPaydays={onPaydays} />
        </Box>
      )}

      {ready && !active && (
        <EmptyTabState
          onRestoreViews={() => expenseTabs.restoreBaseTabs()}
          onNewReport={() => newReportTab()}
          onOpenReport={() => expenseUi.openDialog("reports")}
        />
      )}

      {ready && !error && !list.length && active?.kind === "grid" && (
        <Typography variant="caption" sx={{ color: token("dim") }}>
          No expenses and no seed — this module starts honestly empty. Add an expense; every cell
          edits in place, amounts take arithmetic, and a right-click carries the row&apos;s actions.
        </Typography>
      )}

      {/* Floating tabs live outside the flow — they are `position: fixed`. */}
      <ExpenseWindows tabs={floating} expenses={list} onUpdate={update} onAdd={onAdd} />

      <PaydayDialog open={ui.payday} expenses={list} onClose={() => expenseUi.closePayday()} />

      <ImportDialog open={ui.importing} expenses={list} onClose={() => expenseUi.closeImport()} />

      <VaultDialog
        open={ui.dialog !== null}
        mode={ui.dialog ?? "reports"}
        expenses={list}
        onClose={() => expenseUi.closeDialog()}
        onOpenReport={openSavedReport}
        onLoadLedger={loadLedger}
      />

      <Snackbar
        open={Boolean(ui.toast)}
        message={ui.toast ?? ""}
        onClose={() => expenseUi.clearToast()}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />

    </Box>
  );
}
