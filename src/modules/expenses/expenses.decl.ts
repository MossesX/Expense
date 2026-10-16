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
        { id: "paydays", label: "Paydays…", command: "expenses.payday.open", order: 30 },
        // On the SURFACE — the outermost area — so a right-click anywhere in
        // the module offers them (owner, 2026-10-16: "settings interface
        // accessed by icon in banner and context menu").
        { id: "sep-ai", label: "", role: "separator", order: 80 },
        { id: "ask-assistant", label: "Ask the assistant…", command: "expenses.assistant.ask", order: 81 },
        { id: "settings", label: "Settings…", command: "expenses.settings.open", order: 82 }
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
        { id: "scan-image", label: "Scan statement image…", command: "expenses.ledger.scan-image", order: 56 },
        { id: "sep-filter", label: "", role: "separator", order: 57 },
        { id: "advanced-filter", label: "Advanced filter…", command: "expenses.filter.advanced", order: 58 },
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
      /* ---- general ---- */
      {
        key: "confirmDelete",
        label: "Confirm deletes",
        hint: "Show the selected rows and ask before deleting. There is no undo in this store.",
        kind: "switch",
        defaultValue: true
      },
      {
        key: "defaultAccount",
        label: "Default account",
        hint: "The Account column a new expense starts with.",
        kind: "select",
        defaultValue: "",
        options: [
          { value: "", label: "None" },
          { value: "Discover", label: "Discover" },
          { value: "Capital One", label: "Capital One" },
          { value: "Cash App", label: "Cash App" },
          { value: "Venmo", label: "Venmo" },
          { value: "Cash", label: "Cash" },
          { value: "Drawer", label: "Drawer" }
        ]
      },
      {
        key: "defaultCategory",
        label: "Default category",
        hint: "The category a new expense starts with.",
        kind: "select",
        defaultValue: "other",
        options: [
          { value: "fuel", label: "Fuel & convenience" },
          { value: "groceries", label: "Groceries" },
          { value: "dining", label: "Dining & takeout" },
          { value: "transfers", label: "Transfers & loans" },
          { value: "personal", label: "Personal care" },
          { value: "clothing", label: "Clothing" },
          { value: "software", label: "Software & subscriptions" },
          { value: "utilities", label: "Phone & utilities" },
          { value: "transport", label: "Transport" },
          { value: "hardware", label: "Hardware & auto" },
          { value: "health", label: "Health & pharmacy" },
          { value: "pending", label: "Pending / uncleared" },
          { value: "other", label: "Other" }
        ]
      },
      {
        key: "startView",
        label: "Open on",
        hint: "Which view is active when the ledger opens.",
        kind: "select",
        defaultValue: "remember",
        options: [
          { value: "remember", label: "Whatever was open" },
          { value: "grid", label: "Grid" },
          { value: "tree", label: "Tree" },
          { value: "statements", label: "Statements" }
        ]
      },
      {
        key: "toastSeconds",
        label: "Toast duration (s)",
        hint: "How long a confirmation message stays at the bottom of the screen.",
        kind: "number",
        defaultValue: 4,
        min: 1,
        max: 30,
        step: 1
      },
      /* ---- grid & filter ---- */
      {
        key: "showHints",
        label: "Show grid hints",
        hint: "The line under the buttons explaining arithmetic amounts, selection and the Del key.",
        kind: "switch",
        defaultValue: true
      },
      {
        key: "denseRows",
        label: "Dense rows",
        hint: "Tighter grid rows — more on screen, less air.",
        kind: "switch",
        defaultValue: false
      },
      {
        key: "defaultSort",
        label: "Default sort",
        hint: "The column the grid sorts by when it opens.",
        kind: "select",
        defaultValue: "date",
        options: [
          { value: "date", label: "Date" },
          { value: "merchant", label: "Merchant" },
          { value: "category", label: "Category" },
          { value: "payment", label: "Account" },
          { value: "total", label: "Total" },
          { value: "balance", label: "Balance" }
        ]
      },
      {
        key: "defaultSortDir",
        label: "Default sort direction",
        hint: "Newest or largest first, or the other way round.",
        kind: "select",
        defaultValue: "desc",
        options: [
          { value: "desc", label: "Descending" },
          { value: "asc", label: "Ascending" }
        ]
      },
      {
        key: "filterMatchAll",
        label: "Filter needs every word",
        hint: "On: a row must contain every word typed. Off: any one word is enough.",
        kind: "switch",
        defaultValue: true
      },
      {
        key: "filterColumns",
        label: "Filter columns",
        hint: "Comma-separated column ids the filter searches. Empty = every column. The advanced filter dialog edits this with switches.",
        kind: "text",
        defaultValue: ""
      },
      {
        key: "statementPeriod",
        label: "Statement period",
        hint: "The period the Statements view opens on.",
        kind: "select",
        defaultValue: "month",
        options: [
          { value: "month", label: "Month" },
          { value: "quarter", label: "Quarter" },
          { value: "year", label: "Year" }
        ]
      },
      /* ---- paydays ---- */
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
        hint: "How often a payday lands.",
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
        key: "paydayWeekday",
        label: "Payday is a",
        hint: "The day of the week a weekly or two-weekly payday lands on.",
        kind: "select",
        defaultValue: "5",
        options: [
          { value: "0", label: "Sunday" },
          { value: "1", label: "Monday" },
          { value: "2", label: "Tuesday" },
          { value: "3", label: "Wednesday" },
          { value: "4", label: "Thursday" },
          { value: "5", label: "Friday" },
          { value: "6", label: "Saturday" }
        ]
      },
      {
        key: "paydayDayOfMonth",
        label: "Day of the month",
        hint: "For a monthly schedule. Short months clamp to their last day.",
        kind: "number",
        defaultValue: 1,
        min: 1,
        max: 31,
        step: 1
      },
      {
        key: "paydayAnchor",
        label: "A known payday (YYYY-MM-DD)",
        hint: "Two-weekly only: settles which week. The Paydays dialog picks it from the last two occurrences of the weekday.",
        kind: "text",
        defaultValue: ""
      },
      {
        key: "paydaySince",
        label: "Generate since (YYYY-MM-DD)",
        hint: "Paydays before this date are never added. Empty = the ledger's earliest entry.",
        kind: "text",
        defaultValue: ""
      },
      {
        key: "paydayPayer",
        label: "Payer",
        hint: "Shown in the Merchant column of every generated payday.",
        kind: "text",
        defaultValue: "Payday"
      },
      /* ---- welcome ---- */
      {
        key: "welcomeEnabled",
        label: "Welcome dialog",
        hint: "Show a welcome dialog once per sign-in with the sections ticked below.",
        kind: "switch",
        defaultValue: true
      },
      {
        key: "welcomeMissingPaydays",
        label: "Missing paydays",
        hint: "List paydays through today the ledger does not hold, each with a switch, and add the ticked ones.",
        kind: "switch",
        defaultValue: true
      },
      {
        key: "welcomeMonthSummary",
        label: "This month so far",
        hint: "Spent, income and net for the current month.",
        kind: "switch",
        defaultValue: true
      },
      {
        key: "welcomeNextPayday",
        label: "Next payday",
        hint: "When the next payday lands and how many days away it is.",
        kind: "switch",
        defaultValue: true
      },
      {
        key: "welcomeOverBudget",
        label: "Categories over budget",
        hint: "Categories whose spending this month passed their budget.",
        kind: "switch",
        defaultValue: true
      },
      {
        key: "welcomeTopCategories",
        label: "Top categories",
        hint: "The three categories with the most spending this month.",
        kind: "switch",
        defaultValue: false
      },
      {
        key: "welcomeUnreconciled",
        label: "Unreconciled receipts",
        hint: "Entries whose printed total disagrees with their lines.",
        kind: "switch",
        defaultValue: false
      },
      {
        key: "welcomeDisputed",
        label: "Disputed charges",
        hint: "Entries marked “not my charge”.",
        kind: "switch",
        defaultValue: false
      },
      {
        key: "welcomeRecentImports",
        label: "Recent imports",
        hint: "How many entries the last seven days of imports added.",
        kind: "switch",
        defaultValue: false
      },
      /* ---- import ---- */
      {
        key: "importAccount",
        label: "Import account",
        hint: "The account the import dialog starts on.",
        kind: "select",
        defaultValue: "Capital One",
        options: [
          { value: "Discover", label: "Discover" },
          { value: "Capital One", label: "Capital One" },
          { value: "Cash App", label: "Cash App" },
          { value: "Venmo", label: "Venmo" },
          { value: "Cash", label: "Cash" },
          { value: "Drawer", label: "Drawer" }
        ]
      },
      {
        key: "importSkipPayments",
        label: "Leave card payments unticked",
        hint: "A payment to the card is neither spending nor income; ticking one files it under Transfers.",
        kind: "switch",
        defaultValue: true
      },
      {
        key: "importDateSlack",
        label: "Duplicate date slack (days)",
        hint: "How far apart two dates may be and still count as the same purchase — posting usually trails buying by a day or two.",
        kind: "number",
        defaultValue: 4,
        min: 0,
        max: 14,
        step: 1
      },
      {
        key: "importAmountSlack",
        label: "Duplicate amount slack ($)",
        hint: "How far apart two amounts may be, with the same merchant and close dates, and still count as one purchase.",
        kind: "number",
        defaultValue: 1,
        min: 0,
        max: 50,
        step: 0.5
      },
      {
        key: "extraAccounts",
        label: "Extra accounts",
        hint: "Comma-separated account names beyond the built-in ones, offered wherever an account is chosen. The image import's “add new account” writes here.",
        kind: "text",
        defaultValue: ""
      },
      /* ---- AI ---- */
      {
        key: "aiMode",
        label: "Claude connection",
        hint: "Auto tries your own API key first, then the server's credential (a Claude subscription signed in on the host, or its ANTHROPIC_API_KEY). Choose one to use it alone.",
        kind: "select",
        defaultValue: "auto",
        options: [
          { value: "auto", label: "My key, then the server" },
          { value: "server", label: "Server only (subscription / server key)" },
          { value: "user-key", label: "My API key only" }
        ]
      },
      {
        key: "aiModel",
        label: "Model",
        hint: "Which Claude reads images and answers the assistant.",
        kind: "select",
        defaultValue: "claude-opus-5-5",
        options: [
          { value: "claude-opus-5-5", label: "Claude Opus 5.5 (default)" },
          { value: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (faster)" },
          { value: "claude-haiku-5-5", label: "Claude Haiku 5.5 (cheapest)" },
          { value: "claude-fable-5-1", label: "Claude Fable 5.1 (most capable)" }
        ]
      }
    ]
  },
  points: []
};
