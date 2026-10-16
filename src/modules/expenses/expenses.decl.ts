/**
 * @file The Expense Tracker's DECLARATION — data only, importable by plain Node.
 *
 * The closure resolver (scripts/lib/closure.mjs — the peel outward, the suite
 * inward) imports this under native type stripping, no JSX, to learn the
 * module's id, route and declared areas. So the one hard rule: **nothing but
 * `import type`**.
 *
 * Imported from GizmoX 2026-08-12 (owner: "import expenses module from
 * gizmox"). GizmoX's screen hung its actions on hand-written `useCtx` menus;
 * here they are DATA, per the AmberX contract — the screens mark areas, the
 * rows below compose over them, and `expenses.commands.ts` is the acting half.
 */
import type { ModuleDecl } from "@axf/core";

export const EXPENSES_DECL: ModuleDecl = {
  id: "expenses",
  title: "Expense Tracker",
  summary:
    "Receipt-shaped expense ledger ported from GizmoX: an editable grid with line items and " +
    "reconciliation, a rollup tree, and automatic period statements — integer-cents math " +
    "throughout, server-backed through the kv store.",
  route: "/expenses",
  glyph: "icon-book",
  menus: {
    areas: [
      {
        id: "expenses.expense",
        title: "Expense",
        description: "One expense — a grid row, a tree leaf, or a statement line."
      },
      {
        id: "expenses.node",
        title: "Rollup node",
        description: "A group row in the tree — a year, month or category subtotal."
      },
      {
        id: "expenses.surface",
        title: "Expense Tracker surface",
        description: "Anywhere on the screen, including empty space."
      },
      {
        id: "expenses.tab",
        title: "Expense Tracker tab",
        description:
          "One tab in the tab group — a view or an open report, docked in the strip or floating."
      },
      {
        id: "expenses.tabstrip",
        title: "Expense Tracker tab group",
        description:
          "The tab strip itself, a floating tab's frame, and the empty state when nothing is open."
      }
    ],
    items: {
      "expenses.expense": [
        {
          id: "reconcile-accept",
          label: "Accept printed total (adjust tax)",
          command: "expenses.expense.reconcile-accept",
          order: 10
        },
        {
          id: "trust-lines",
          label: "Trust the lines (clear printed total)",
          command: "expenses.expense.trust-lines",
          order: 20
        },
        { id: "sep-1", label: "", role: "separator", order: 30 },
        {
          id: "reimbursable",
          label: "Mark / unmark reimbursable",
          command: "expenses.expense.toggle-reimbursable",
          order: 40
        },
        {
          id: "disputed",
          label: "Not my charge (toggle)",
          command: "expenses.expense.toggle-disputed",
          order: 50
        },
        {
          id: "kind",
          label: "Mark as income / expense",
          command: "expenses.expense.toggle-kind",
          order: 55
        },
        { id: "copy-line", label: "Copy as a line", command: "expenses.expense.copy-line", order: 60 },
        { id: "sep-2", label: "", role: "separator", order: 70 },
        {
          id: "delete",
          label: "Delete expense",
          command: "expenses.expense.delete",
          role: "danger",
          order: 80
        },
        /*
         * The multi-row half of the owner's *"delete selected rows from
         * context menu or del key"*. `enabledWhen` rather than `when`, so the
         * row is always THERE and greys with the reason when there is nothing
         * selected — a row that appears and disappears teaches nobody that the
         * feature exists (`predicates.ts` argues the same in general).
         */
        {
          id: "delete-selected",
          label: "Delete selected expenses",
          command: "expenses.expense.delete-selected",
          role: "danger",
          enabledWhen: "expenses.selection",
          order: 90
        }
      ],
      "expenses.node": [
        { id: "copy-subtotal", label: "Copy this subtotal", command: "expenses.node.copy-subtotal", order: 10 }
      ],
      "expenses.surface": [
        { id: "add", label: "Add expense", command: "expenses.add", order: 10 },
        { id: "add-income", label: "Add income", command: "expenses.income.add", order: 20 },
        { id: "paydays", label: "Paydays…", command: "expenses.payday.open", order: 30 }
      ],
      "expenses.tab": [
        { id: "float", label: "Float as a window", command: "expenses.tab.float", order: 10 },
        { id: "dock", label: "Dock back into the strip", command: "expenses.tab.dock", order: 20 },
        { id: "sep-1", label: "", role: "separator", order: 30 },
        { id: "close", label: "Close tab", command: "expenses.tab.close", role: "danger", order: 40 },
        { id: "close-others", label: "Close other tabs", command: "expenses.tab.close-others", order: 50 }
      ],
      "expenses.tabstrip": [
        { id: "new-report", label: "New report", command: "expenses.report.new", order: 10 },
        { id: "open-report", label: "Open report…", command: "expenses.report.open", order: 20 },
        { id: "sep-1", label: "", role: "separator", order: 30 },
        { id: "save-ledger", label: "Save ledger…", command: "expenses.ledger.save", order: 40 },
        { id: "load-ledger", label: "Load ledger…", command: "expenses.ledger.load", order: 50 },
        { id: "import-ledger", label: "Import transactions…", command: "expenses.ledger.import", order: 55 },
        { id: "sep-2", label: "", role: "separator", order: 60 },
        { id: "restore", label: "Reopen the standard views", command: "expenses.tabs.restore", order: 70 }
      ]
    }
  },
  /** No extension points yet — a plugin seam is added when a real plugin
   *  needs one, never speculatively ("module drives the core"). */
  /** Settings as decl data (core 0.0.20). `confirmDelete` moved verbatim from
   *  `settings.ts`, whose docblock keeps the considered-and-refused list. The
   *  four `payday*` rows are the pay schedule (2026-09-15): they are settings
   *  rather than ledger data because a schedule is one value that outlives any
   *  entry it generates, and `payday.ts` derives everything else from them.
   *  The module's own Paydays dialog edits the same four rows. */
  settings: {
    ns: "expenses-settings",
    rows: [
      {
        key: "confirmDelete",
        label: "Confirm deletes",
        hint: "Ask before deleting an expense. There is no undo in this store.",
        kind: "switch",
        defaultValue: true
      },
      {
        key: "paydayAmount",
        label: "Payday amount ($)",
        hint: "Take-home pay per payday. 0 leaves the payday schedule switched off.",
        kind: "number",
        defaultValue: 0,
        min: 0,
        max: 1000000,
        step: 0.01
      },
      {
        key: "paydayEvery",
        label: "Paid every",
        hint: "How often a payday lands, counted from the first payday below.",
        kind: "select",
        defaultValue: "biweekly",
        options: [
          { value: "weekly", label: "Week" },
          { value: "biweekly", label: "Two weeks" },
          { value: "semimonthly", label: "1st and 15th" },
          { value: "monthly", label: "Month" }
        ]
      },
      {
        key: "paydayAnchor",
        label: "First payday (YYYY-MM-DD)",
        hint: "Any past payday. Paydays are generated from this date forward.",
        kind: "text",
        defaultValue: ""
      },
      {
        key: "paydayPayer",
        label: "Payer",
        hint: "Shown in the Merchant column of every generated payday.",
        kind: "text",
        defaultValue: "Payday"
      }
    ]
  },
  points: []
};
