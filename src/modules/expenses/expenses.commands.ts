/**
 * @file The behaviour behind the Expense Tracker's context-menu rows.
 *
 * The menu itself is DATA on `expenses.decl.ts`; the two meet only through a
 * command name (the taskman pattern, whose docblock carries the full account).
 * The engine parks the resolved click in `activeContext()`, and
 * `MenuContext.data` carries every `data-axf-*` attribute harvested up the
 * area chain — so the surfaces mark `data-axf-expense="<id>"` on their rows
 * and these handlers read `ctx.data.expense`.
 *
 * Plain functions over the `expenseStore` singleton: a command mutating it
 * lands on every mounted surface at once, with nothing wired through props.
 *
 * Registration is idempotent, and must run BEFORE
 * `registerModuleMenus(EXPENSES_DECL)` — the map's gate refuses an item naming
 * an unregistered command, which is what makes a typo here a loud boot failure
 * rather than a dead row. Each command is an inline `commands.register({ id:
 * "…" })` literal, which is also the shape `test/ctx-conformance.test.ts`
 * scans for.
 */
import { activeContext, commands, predicates } from "@axf/core";

import { GRID_COLUMNS, isColumnShown, showAllColumns, toggleColumn } from "./columns";

import { missingPaydays, paydayEntry, todayIso } from "./payday";
import { buildReportHtml, capturePalette, reportFileName } from "./report";
import { expenseSelection } from "./selection";
import { getExpensesSettings, paySchedule } from "./settings";
import { expenseStore, blankExpense, blankIncome } from "./store";
import { INCOME_CATEGORY, isIncome } from "./types";
import { expenseTabs } from "./tabs";
import { expenseUi } from "./ui";
import { assistantUi, pageContext } from "./assistant/client";
import { buildStatement, effectiveTotal, money, periodOf, periodsIn, reconcile } from "./math";

/** The click's harvested data — `{}` when a command is fired from a palette. */
function ctxData(): Record<string, string> {
  return activeContext()?.data ?? {};
}

/** The right-clicked expense, or undefined when the click carried none. */
function targetExpense() {
  const id = ctxData().expense ?? null;
  return id ? expenseStore.get(id) : undefined;
}

/**
 * The right-clicked tab's id.
 *
 * Falls back to the ACTIVE docked tab, so the same commands work from a
 * command palette or a keyboard binding where there is no click to read. A tab
 * command that only works from the strip is a command half the app cannot use.
 */
function targetTabId(): string | null {
  return ctxData().tab ?? expenseTabs.getState().activeId;
}

/**
 * Build a report over the newest period that has data, and open it in a tab.
 *
 * Shared by the menu row and the header button so "New report" means exactly
 * one thing. The palette is captured from the live theme here rather than
 * inside `buildReportHtml`, because this is the only layer that knows a
 * document exists — the builder stays pure and Node-safe.
 */
export function newReportTab(): string {
  const list = expenseStore.getState().list as Parameters<typeof buildStatement>[0];
  const periods = periodsIn([...list], "month");
  // With an empty ledger there is no period to pick, so report on the current
  // month: an honestly empty statement beats a button that does nothing.
  const period = periods[periods.length - 1] ?? periodOf("month", new Date().toISOString().slice(0, 10));
  const statement = buildStatement([...list], period);
  const title = `Expense statement — ${period.label}`;
  const html = buildReportHtml({ statement, title, palette: capturePalette() });
  const id = expenseTabs.openReport(
    { name: null, format: "html", content: html, period: period.key },
    title
  );
  // The suggested filename travels with the tab title, and `ReportTab` turns
  // it into a legal name when Save is pressed.
  expenseUi.say(`Report generated for ${period.label} — save it as ${reportFileName(statement)}`);
  return id;
}

/**
 * Write every payday the ledger is missing, from the schedule's first payday
 * through today. Shared by the Paydays dialog and the menu row so "fill" means
 * one thing. Returns how many were added — zero when the schedule is not set
 * up, which the dialog explains rather than this function.
 */
/** The delete itself, shared by the Del key / menu row (confirmation off) and
 *  the confirmation dialog. Prunes the selection BEFORE reporting, so it never
 *  keeps claiming rows that no longer exist. */
export function deleteExpenses(ids: readonly string[]): number {
  const gone = expenseStore.removeMany(ids);
  expenseSelection.prune(expenseStore.getState().list.map((e) => e.id));
  expenseUi.say(`Deleted ${gone} transaction${gone === 1 ? "" : "s"}`);
  return gone;
}

export function fillPaydays(until = todayIso()): number {
  const schedule = paySchedule();
  const list = expenseStore.getState().list;
  const dates = missingPaydays(list, schedule, until);
  if (!dates.length) return 0;
  const now = Date.now();
  const added = expenseStore.addMany(dates.map((d) => paydayEntry(schedule, d, now)));
  expenseUi.say(`Added ${added} payday${added === 1 ? "" : "s"} through ${until}`);
  return added;
}

let registered = false;

/** Idempotent, HMR-tolerant — the taskman precedent. */
export function registerExpensesCommands(): void {
  if (registered) return;
  registered = true;

  /* ------------------------------- predicates ------------------------------ */

  // Registered here, with the commands, because the map's gate refuses an item
  // naming an unregistered PREDICATE exactly as it refuses an unregistered
  // command — and both gates run in `registerModuleMenus`, which the subsystem
  // calls after this function.
  if (!predicates.has("expenses.selection")) {
    predicates.register({
      id: "expenses.selection",
      title: "One or more expenses are selected",
      test: () =>
        expenseSelection.size > 0 ? true : "no expenses are selected — tick some rows in the grid"
    });
  }

  /* ----------------------------- surface rows ----------------------------- */

  if (!commands.has("expenses.add")) {
    commands.register({
      id: "expenses.add",
      title: "Add expense",
      run: () => {
        expenseStore.add(blankExpense());
      }
    });
  }

  if (!commands.has("expenses.income.add")) {
    commands.register({
      id: "expenses.income.add",
      title: "Add a one-off income entry",
      run: () => {
        expenseStore.add(blankIncome());
      }
    });
  }

  if (!commands.has("expenses.payday.open")) {
    commands.register({
      id: "expenses.payday.open",
      title: "Set up the pay schedule and add missing paydays",
      run: () => expenseUi.openPayday()
    });
  }

  if (!commands.has("expenses.payday.fill")) {
    commands.register({
      id: "expenses.payday.fill",
      title: "Add every missing payday through today",
      run: () => {
        if (fillPaydays() === 0) expenseUi.openPayday();
      }
    });
  }

  /* ----------------------------- expense rows ----------------------------- */

  if (!commands.has("expenses.expense.toggle-kind")) {
    commands.register({
      id: "expenses.expense.toggle-kind",
      title: "Mark as income / expense",
      run: () => {
        const e = targetExpense();
        if (!e) return;
        const toIncome = !isIncome(e);
        // The category follows the kind: income has one category, and an
        // expense filed under "Income" would sit in the spending rollup as a
        // category nobody budgets. Everything else on the row is kept.
        expenseStore.update(e.id, {
          kind: toIncome ? "income" : "expense",
          category: toIncome ? INCOME_CATEGORY : e.category === INCOME_CATEGORY ? "other" : e.category
        });
      }
    });
  }

  if (!commands.has("expenses.expense.reconcile-accept")) {
    commands.register({
      id: "expenses.expense.reconcile-accept",
      title: "Accept the printed total (adjust tax to match)",
      run: () => {
        const e = targetExpense();
        if (!e) return;
        const rec = reconcile(e);
        // Nothing to reconcile without a printed total — a no-op beats writing
        // a zero adjustment that looks like an edit.
        if (rec.stated === null || rec.ok) return;
        expenseStore.update(e.id, { tax: e.tax + rec.delta });
      }
    });
  }

  if (!commands.has("expenses.expense.trust-lines")) {
    commands.register({
      id: "expenses.expense.trust-lines",
      title: "Trust the lines (clear the printed total)",
      run: () => {
        const e = targetExpense();
        if (e) expenseStore.update(e.id, { statedTotal: null });
      }
    });
  }

  if (!commands.has("expenses.expense.toggle-reimbursable")) {
    commands.register({
      id: "expenses.expense.toggle-reimbursable",
      title: "Mark / unmark reimbursable",
      run: () => {
        const e = targetExpense();
        if (e) expenseStore.update(e.id, { reimbursable: !e.reimbursable });
      }
    });
  }

  if (!commands.has("expenses.expense.toggle-disputed")) {
    commands.register({
      id: "expenses.expense.toggle-disputed",
      title: "Not my charge (zero from every total)",
      run: () => {
        const e = targetExpense();
        if (!e) return;
        const next = !e.disputed;
        expenseStore.update(e.id, {
          disputed: next,
          disputeNote: next ? (e.disputeNote ?? "") : e.disputeNote
        });
      }
    });
  }

  if (!commands.has("expenses.expense.copy-line")) {
    commands.register({
      id: "expenses.expense.copy-line",
      title: "Copy the expense as a tab-separated line",
      run: () => {
        const e = targetExpense();
        if (!e) return;
        void navigator.clipboard.writeText(
          `${e.date}\t${e.merchant}\t${e.category}\t${money(effectiveTotal(e))}`
        );
      }
    });
  }

  if (!commands.has("expenses.expense.delete")) {
    commands.register({
      id: "expenses.expense.delete",
      title: "Delete the expense",
      run: () => {
        const e = targetExpense();
        if (!e) return;
        if (getExpensesSettings().confirmDelete) {
          const ok = window.confirm(
            `Delete "${e.merchant}" (${money(effectiveTotal(e))})? There is no undo.`
          );
          if (!ok) return;
        }
        expenseStore.remove(e.id);
      }
    });
  }

  if (!commands.has("expenses.expense.delete-selected")) {
    commands.register({
      id: "expenses.expense.delete-selected",
      title: "Delete every selected expense",
      run: () => {
        const ids = expenseSelection.ids();
        if (!ids.length) return;
        // With confirmation on, the dialog SHOWS the rows before deleting
        // (DeleteSelectedDialog); off, the delete is immediate.
        if (getExpensesSettings().confirmDelete) expenseUi.openDeleteSelected();
        else deleteExpenses(ids);
      }
    });
  }

  /* ------------------------------ View › columns --------------------------- */

  // One toggle command and one `checkedWhen` predicate per hideable column
  // (`columns.ts`): the context menu's View submenu draws each column's state
  // from the predicate and flips it through the command. Both in a loop over
  // the same list the grid reads, so a column cannot be in the menu and not in
  // the grid or the other way round.
  for (const col of GRID_COLUMNS) {
    if (!predicates.has(`expenses.col.${col.id}`)) {
      predicates.register({
        id: `expenses.col.${col.id}`,
        title: `The ${col.label} column is shown`,
        test: () => (isColumnShown(col.id) ? true : `the ${col.label} column is hidden`)
      });
    }
    if (!commands.has(`expenses.col.toggle-${col.id}`)) {
      commands.register({
        id: `expenses.col.toggle-${col.id}`,
        title: `Show / hide the ${col.label} column`,
        run: () => toggleColumn(col.id)
      });
    }
  }
  if (!commands.has("expenses.view.columns")) {
    commands.register({
      id: "expenses.view.columns",
      title: "Choose which grid columns are shown",
      run: () => expenseUi.openColumns()
    });
  }
  if (!commands.has("expenses.col.show-all")) {
    commands.register({
      id: "expenses.col.show-all",
      title: "Show every grid column",
      run: () => showAllColumns()
    });
  }

  /* ------------------------------- Actions ------------------------------- */

  if (!commands.has("expenses.actions.dupes")) {
    commands.register({
      id: "expenses.actions.dupes",
      title: "Find possible duplicate transactions (same price, fields may differ)",
      run: () => expenseUi.openDupes()
    });
  }

  if (!commands.has("expenses.ledger.scan-image")) {
    commands.register({
      id: "expenses.ledger.scan-image",
      title: "Read transactions from statement images, skipping duplicates",
      run: () => expenseUi.openScan()
    });
  }

  if (!commands.has("expenses.assistant.open")) {
    commands.register({
      id: "expenses.assistant.open",
      title: "Open the assistant",
      run: () => assistantUi.open({ context: pageContext() })
    });
  }

  if (!commands.has("expenses.assistant.ask")) {
    commands.register({
      id: "expenses.assistant.ask",
      title: "Ask the assistant about the selection or the page",
      run: () => {
        const ctx = pageContext();
        assistantUi.open({ text: ctx.selection ? "Explain this:" : "", context: ctx });
      }
    });
  }

  if (!commands.has("expenses.settings.open")) {
    commands.register({
      id: "expenses.settings.open",
      title: "Open the Expense Tracker settings",
      run: () => expenseUi.openSettings()
    });
  }

  if (!commands.has("expenses.filter.advanced")) {
    commands.register({
      id: "expenses.filter.advanced",
      title: "Open the advanced filter — choose which columns the filter searches",
      run: () => expenseUi.openFilterDialog()
    });
  }

  /* -------------------------------- tab rows ------------------------------- */

  if (!commands.has("expenses.tab.float")) {
    commands.register({
      id: "expenses.tab.float",
      title: "Undock a tab into a floating window",
      run: () => {
        const id = targetTabId();
        if (id) expenseTabs.float(id);
      }
    });
  }

  if (!commands.has("expenses.tab.dock")) {
    commands.register({
      id: "expenses.tab.dock",
      title: "Dock a floating tab back into the strip",
      run: () => {
        const id = targetTabId();
        if (id) expenseTabs.dock(id);
      }
    });
  }

  if (!commands.has("expenses.tab.close")) {
    commands.register({
      id: "expenses.tab.close",
      title: "Close a tab",
      run: () => {
        const id = targetTabId();
        if (id) expenseTabs.close(id);
      }
    });
  }

  if (!commands.has("expenses.tab.close-others")) {
    commands.register({
      id: "expenses.tab.close-others",
      title: "Close every other tab",
      run: () => {
        const id = targetTabId();
        if (id) expenseTabs.closeOthers(id);
      }
    });
  }

  if (!commands.has("expenses.tabs.restore")) {
    commands.register({
      id: "expenses.tabs.restore",
      title: "Reopen the Grid, Tree and Statements views",
      run: () => expenseTabs.restoreBaseTabs()
    });
  }

  /* ------------------------------ report rows ------------------------------ */

  if (!commands.has("expenses.report.new")) {
    commands.register({
      id: "expenses.report.new",
      title: "Generate a report and open it in a new tab",
      run: () => void newReportTab()
    });
  }

  if (!commands.has("expenses.report.open")) {
    commands.register({
      id: "expenses.report.open",
      title: "Open a report from the saved directory",
      run: () => expenseUi.openDialog("reports")
    });
  }

  if (!commands.has("expenses.ledger.save")) {
    commands.register({
      id: "expenses.ledger.save",
      title: "Save the ledger to the saved directory",
      run: () => expenseUi.openDialog("save")
    });
  }

  if (!commands.has("expenses.ledger.import")) {
    commands.register({
      id: "expenses.ledger.import",
      title: "Import transactions from a bank export or a pasted list, skipping duplicates",
      run: () => expenseUi.openImport()
    });
  }

  if (!commands.has("expenses.ledger.load")) {
    commands.register({
      id: "expenses.ledger.load",
      title: "Load a saved ledger, replacing the current one",
      run: () => expenseUi.openDialog("load")
    });
  }

  /* ------------------------------- node rows ------------------------------ */

  if (!commands.has("expenses.node.copy-subtotal")) {
    commands.register({
      id: "expenses.node.copy-subtotal",
      title: "Copy a rollup node's subtotal",
      run: () => {
        // `data-axf-node-label` arrives camelCased: the walk strips the `axf`
        // prefix off the dataset key (`axfNodeLabel` → `nodeLabel`).
        const data = ctxData();
        const label = data.nodeLabel ?? null;
        const total = data.nodeTotal ?? null;
        if (label === null || total === null) return;
        void navigator.clipboard.writeText(`${label}\t${money(Number(total))}`);
      }
    });
  }
}
