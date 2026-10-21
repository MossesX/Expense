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
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Snackbar from "@mui/material/Snackbar";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Glyph, commands, settingsUi, token } from "@axf/core";

import { MONO } from "./bits";
import ColumnsDialog from "./ColumnsDialog";
import { hiddenSet } from "./columns";
import DeleteSelectedDialog from "./DeleteSelectedDialog";
import DupeDialog from "./DupeDialog";
import EmptyTabState from "./EmptyTabState";
import ExpenseWindows from "./ExpenseWindows";
import ExpensesSettingsDialog from "./ExpensesSettingsDialog";
import FilterDialog from "./FilterDialog";
import ImageImportDialog from "./ImageImportDialog";
import ImportDialog from "./ImportDialog";
import PaydayDialog from "./PaydayDialog";
import WelcomeDialog from "./WelcomeDialog";
import AssistantPanel from "./assistant/AssistantPanel";
import { assistantUi, pageContext } from "./assistant/client";
import TabContent from "./TabContent";
import TabGroup from "./TabGroup";
import VaultDialog from "./VaultDialog";
import { newReportTab } from "./expenses.commands";
import { applyFilter, filterActive, parseColumns, type FilterSpec } from "./filter";
import { money, net, sumIncome, sumSpent } from "./math";
import { DEFAULT_SETTINGS, paySchedule, useExpensesSettings, type ExpensesSettings } from "./settings";
import { expenseSelection, useExpenseSelection } from "./selection";
import { blankExpense, blankIncome, expenseStore, useExpenses } from "./store";
import { expenseTabs, useExpenseTabs } from "./tabs";
import { expenseUi, useExpensesUi } from "./ui";
import { isIncome, type Expense } from "./types";
import type { VaultFile } from "./vault";
import { buildWelcome, welcomeHasContent } from "./welcome";

import { WELCOMED_PREFIX } from "./welcomeMarker";

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
  const prefs = useExpensesSettings();
  // The header's Actions menu — anchored to its button, so it is component
  // state; the context menu offers the same rows as a submenu. View opens the
  // Columns dialog, shared with the context menu's View….
  const [actionsAnchor, setActionsAnchor] = React.useState<HTMLElement | null>(null);
  const hidden = React.useMemo(() => hiddenSet(prefs.hiddenColumns), [prefs.hiddenColumns]);

  /* ------------------------------------------------------------- the filter */
  const filterSpec = React.useMemo<FilterSpec>(
    () => ({ text: ui.filterText, columns: parseColumns(prefs.filterColumns), matchAll: prefs.filterMatchAll }),
    [ui.filterText, prefs.filterColumns, prefs.filterMatchAll]
  );
  const filtering = filterActive(filterSpec);
  const shown = React.useMemo(() => (filtering ? applyFilter(list, filterSpec) : list), [list, filterSpec, filtering]);

  const spent = sumSpent(list);
  const income = sumIncome(list);
  const balance = net(list);
  const incomeCount = list.filter(isIncome).length;
  const disputed = list.filter((e) => e.disputed).length;

  const docked = tabs.filter((t) => t.window === null);
  const floating = tabs.filter((t) => t.window !== null);
  const active = docked.find((t) => t.id === activeId) ?? null;

  /* ------------------------------------------------- Ctrl/⌘ J: the assistant */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j" && !e.repeat) {
        e.preventDefault();
        assistantUi.open({ context: pageContext() });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

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
    const timer = window.setTimeout(() => expenseUi.clearToast(), Math.max(1, prefs.toastSeconds) * 1000);
    return () => window.clearTimeout(timer);
  }, [ui.toast, prefs.toastSeconds]);

  /* ------------------------------------------- the shell's gear opens OURS */
  // Core's SettingsDialog is a flat list of every row; this module's is tabbed
  // (ExpensesSettingsDialog). The ModuleHost gear and the universal "Module
  // settings" row open core's by owner id — intercept that and open ours.
  React.useEffect(() => {
    const check = () => {
      if (settingsUi.openFor() === "expenses") {
        settingsUi.close();
        expenseUi.openSettings();
      }
    };
    check();
    return settingsUi.subscribe(check);
  }, []);

  /* ------------------------------------------------ start view + welcome */
  // Once per sign-in per tab, after the ledger has loaded: the start view the
  // settings name, then the welcome dialog if it has anything to say. The
  // marker is keyed by user and cleared when the session signs out, so the
  // next sign-in in the same tab is welcomed again.
  const welcomed = React.useRef(false);
  const [welcomeUser, setWelcomeUser] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!ready || welcomed.current) return;
    welcomed.current = true;
    let cancelled = false;
    void (async () => {
      // Both read HERE rather than off a hook. The settings hook answers
      // defaults until core's store has loaded, and that load races the
      // ledger's — a welcome built on defaults would say "no pay schedule" to
      // someone who has one. And core's session store is only flipped by the
      // Accounts screen, which this route never mounts, so WHO is signed in
      // comes from the accounts whoami route, the same answer the gate used.
      let stored: Partial<ExpensesSettings> = {};
      let user: string | null = null;
      try {
        const [settingsRes, whoRes] = await Promise.all([
          fetch("/api/axf/kv/expenses-settings", { cache: "no-store" }),
          fetch("/api/accounts/session", { cache: "no-store" })
        ]);
        if (settingsRes.ok) {
          const body = (await settingsRes.json()) as { doc?: { settings?: Partial<ExpensesSettings> } };
          stored = body.doc?.settings ?? {};
        }
        if (whoRes.ok) {
          const body = (await whoRes.json()) as { signedIn?: boolean; me?: { username?: string; screenname?: string } };
          if (body.signedIn && body.me) user = body.me.screenname || body.me.username || null;
        }
      } catch {
        /* unreachable routes — defaults, which still welcome */
      }
      if (cancelled) return;
      setWelcomeUser(user);
      const current: ExpensesSettings = { ...DEFAULT_SETTINGS, ...stored };
      if (current.startView !== "remember" && ["grid", "tree", "statements"].includes(current.startView)) {
        expenseTabs.activate(current.startView);
      }
      if (!current.welcomeEnabled) return;
      const key = `${WELCOMED_PREFIX}${user ?? "local"}`;
      try {
        if (window.sessionStorage.getItem(key)) return;
        window.sessionStorage.setItem(key, "1");
      } catch {
        /* storage blocked — welcome every load, which is the honest fallback */
      }
      const model = buildWelcome(expenseStore.getState().list, current, paySchedule(current));
      if (welcomeHasContent(model, current)) expenseUi.openWelcome();
    })();
    return () => {
      cancelled = true;
    };
    // Deliberately on readiness only: the welcome is a sign-in event, not a
    // reaction to every later change of the list or the settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const onAdd = React.useCallback(() => {
    const e = blankExpense();
    add({
      ...e,
      category: prefs.defaultCategory || e.category,
      paymentMethod: prefs.defaultAccount || e.paymentMethod
    });
  }, [add, prefs.defaultCategory, prefs.defaultAccount]);
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
        <Tooltip title="Read transactions from a photo or screenshot of a statement — duplicates are shown side by side before anything is written.">
          <Button size="small" variant="outlined" onClick={() => expenseUi.openScan()} startIcon={<Glyph id="icon-image" size={14} />}>
            Scan images
          </Button>
        </Tooltip>
        <Tooltip title="Choose which grid columns are shown. Also View… in the right-click menu.">
          <Button size="small" variant="outlined" data-axf-expenses-view onClick={() => expenseUi.openColumns()}>
            View{hidden.size ? ` (${hidden.size} hidden)` : ""}
          </Button>
        </Tooltip>
        <Tooltip title="Ledger-wide operations.">
          <Button size="small" variant="outlined" data-axf-expenses-actions onClick={(e) => setActionsAnchor(e.currentTarget)} endIcon={<Glyph id="icon-chevron-down" size={12} />}>
            Actions
          </Button>
        </Tooltip>
        <Menu open={Boolean(actionsAnchor)} anchorEl={actionsAnchor} onClose={() => setActionsAnchor(null)} slotProps={{ list: { dense: true, "data-axf-expenses-actions-menu": "" } as never }}>
          <MenuItem onClick={() => { setActionsAnchor(null); expenseUi.openDupes(); }} sx={{ fontSize: 12.5, py: 0.4 }}>
            <ListItemIcon sx={{ minWidth: 28 }}><Glyph id="icon-search" size={14} /></ListItemIcon>
            <ListItemText primary="Dupe — find possible duplicates…" secondary="Same price, other fields may differ · algorithm + Claude" slotProps={{ primary: { sx: { fontSize: 12.5 } }, secondary: { sx: { fontSize: 11 } } }} />
          </MenuItem>
        </Menu>
        <Tooltip title={selected.size ? `Delete ${selected.size} selected — you will see them first` : "Select rows to delete them"}>
          <span>
            <IconButton
              size="small"
              aria-label="Delete selected transactions"
              data-axf-expenses-trash={selected.size ? "ready" : "idle"}
              disabled={!selected.size}
              onClick={() => commands.run("expenses.expense.delete-selected")}
              sx={{ color: selected.size ? token("err") : token("dim") }}
            >
              <Glyph id="icon-trash" size={16} />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Expense Tracker settings">
          <IconButton size="small" aria-label="Expense Tracker settings" data-axf-expenses-gear onClick={() => expenseUi.openSettings()}>
            <Glyph id="icon-gear" size={16} />
          </IconButton>
        </Tooltip>
        {/* The settings affordance moved to the SHELL (core 0.0.20): the gear
            on ModuleHost and the universal "Module settings" row open the one
            SettingsDialog. */}
      </Stack>

      {/* ------------------------------------------------------------ filter */}
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <TextField
          size="small"
          placeholder="Filter — merchant, amount, 2026-09, category…"
          value={ui.filterText}
          onChange={(e) => expenseUi.setFilterText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") expenseUi.setFilterText("");
          }}
          data-axf-expenses-filter
          sx={{ width: { xs: "100%", sm: 360 }, "& input": { fontSize: 12.5, py: 0.7 } }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Glyph id="icon-search" size={14} />
                </InputAdornment>
              ),
              endAdornment: (
                <InputAdornment position="end">
                  {ui.filterText && (
                    <IconButton size="small" aria-label="Clear filter" onClick={() => expenseUi.setFilterText("")} sx={{ p: 0.3 }}>
                      <Glyph id="icon-close" size={12} />
                    </IconButton>
                  )}
                  <Tooltip title="Advanced filter — choose the columns it searches">
                    <IconButton size="small" aria-label="Advanced filter" data-axf-expenses-filter-advanced onClick={() => expenseUi.openFilterDialog()} sx={{ p: 0.3 }}>
                      <Glyph id="icon-filter" size={14} />
                    </IconButton>
                  </Tooltip>
                </InputAdornment>
              )
            }
          }}
        />
        {filtering && (
          <Chip
            size="small"
            variant="outlined"
            label={`${shown.length} of ${list.length} match`}
            onDelete={() => expenseUi.setFilterText("")}
            sx={{ height: 22, ...MONO, color: token("accent") }}
          />
        )}
        {filtering && filterSpec.columns.length > 0 && (
          <Typography sx={{ fontSize: 11, color: token("dim") }}>in {filterSpec.columns.join(", ")}</Typography>
        )}
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
          <TabContent tab={active} expenses={shown} onUpdate={update} onAdd={onAdd} onAddIncome={onAddIncome} onPaydays={onPaydays} />
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

      <ImageImportDialog open={ui.scanning} expenses={list} onClose={() => expenseUi.closeScan()} />

      <ColumnsDialog open={ui.columns} onClose={() => expenseUi.closeColumns()} />

      <DupeDialog open={ui.dupes} expenses={list} onClose={() => expenseUi.closeDupes()} />

      <AssistantPanel />

      <DeleteSelectedDialog open={ui.deleting} expenses={list} onClose={() => expenseUi.closeDeleteSelected()} />

      <FilterDialog open={ui.filterDialog} onClose={() => expenseUi.closeFilterDialog()} />

      <ExpensesSettingsDialog open={ui.settings} onClose={() => expenseUi.closeSettings()} />

      <WelcomeDialog
        open={ui.welcome}
        expenses={list}
        user={welcomeUser}
        onClose={() => expenseUi.closeWelcome()}
        onOpenPaydays={() => {
          expenseUi.closeWelcome();
          expenseUi.openPayday();
        }}
      />

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
