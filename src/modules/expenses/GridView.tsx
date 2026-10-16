/**
 * @file **Grid view** — the flat, editable expense table.
 *
 * Every money column is computed by `./math`, never stored twice, so the
 * subtotal / tax / total columns cannot disagree with the tree or the
 * statement. Amount fields accept expressions (`12.99*3`, `40+8.50`) through
 * `evalAmount`, which is a restricted parser rather than `eval`.
 *
 * The **reconciliation column (Δ)** is the reason the grid earns its place
 * beside the tree: it shows the difference between a receipt's printed total
 * and what its lines actually add up to — reported, never auto-corrected.
 *
 * Ported from GizmoX with its `DataTable` replaced by a plain MUI `Table`
 * (sort state + expandable rows are ~40 lines, and AmberX carries no shared
 * table component to drift against), and its per-row `useCtx` menus replaced
 * by the AmberX contract: each row marks `data-axf-area="expenses.expense"`
 * plus `data-axf-expense`, and the rows a right-click composes are DATA on
 * `expenses.decl.ts`, acting through `expenses.commands.ts`.
 *
 * ## Multi-select (2026-08-12)
 *
 * Owner: *"allow multiple select rows and delete selected rows from context
 * menu or del key"*. Selection is a **checkbox column**, not a click on the
 * row — every cell in this grid is click-to-edit, so a row-click that also
 * selected would make choosing rows and editing them the same gesture. Plain
 * click toggles one, shift-click takes the range in the CURRENT display order
 * (which is why the order is passed in rather than recomputed in the store),
 * and the header box is a select-all with a real indeterminate state.
 *
 * Right-clicking a row that is not selected resets the selection to it. That
 * is what every file manager does, and it is what stops "Delete selected"
 * acting on a selection scrolled off-screen that the reader has forgotten
 * about.
 */
"use client";

import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableSortLabel from "@mui/material/TableSortLabel";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Glyph, token } from "@axf/core";

import { KindChip, MONO, MoneyCell, PaymentCell, SourceChip, StatTile, TextCell, autoDashIso, capitalizeWords } from "./bits";
import { CARDS, useHiddenCards, type CardId } from "./cards";
import { expenseSelection, useExpenseSelection } from "./selection";
import { useExpensesSettings } from "./settings";
import { CATEGORIES, INCOME_CATEGORY, isIncome, type Expense, type LineItem } from "./types";
import {
  effectiveTotal,
  lineTotal,
  money,
  net,
  reconcile,
  runningBalance,
  subtotal,
  sumIncome,
  sumSpent,
  taxRate
} from "./math";
import { uid } from "./id";

type SortKey =
  | "date"
  | "kind"
  | "merchant"
  | "category"
  | "payment"
  | "subtotal"
  | "tax"
  | "stated"
  | "recon"
  | "total"
  | "balance";

function LineItems({
  expense,
  onChange,
  onExpenseChange
}: {
  expense: Expense;
  onChange: (items: LineItem[]) => void;
  onExpenseChange: (patch: Partial<Expense>) => void;
}) {
  const set = (id: string, patch: Partial<LineItem>) =>
    onChange(expense.items.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const label = {
    fontSize: 9,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: token("dim"),
    flexShrink: 0
  } as const;

  return (
    <Box sx={{ pl: 2, py: 0.6 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.4 }}>
        <Typography sx={label}>Line items</Typography>
        <Button
          size="small"
          sx={{ fontSize: 10.5, minWidth: 0, py: 0 }}
          onClick={() => onChange([...expense.items, { id: uid("li"), description: "Item", unit: 0, qty: 1 }])}
        >
          Add line
        </Button>
        <Button
          size="small"
          sx={{ fontSize: 10.5, minWidth: 0, py: 0, color: expense.disputed ? token("warn") : token("dim") }}
          onClick={() => {
            const next = !expense.disputed;
            onExpenseChange({ disputed: next, disputeNote: next ? (expense.disputeNote ?? "") : expense.disputeNote });
          }}
        >
          {expense.disputed ? "Not my charge ✓" : "Not my charge"}
        </Button>
      </Box>

      <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, mb: 0.6 }}>
        <Typography sx={label}>Notes</Typography>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <TextCell value={expense.note ?? ""} onCommit={(v) => onExpenseChange({ note: v || undefined })} width={420} />
        </Box>
      </Box>

      {expense.disputed && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            mb: 0.6,
            px: 1,
            py: 0.5,
            borderRadius: "var(--axf-radius-tight)",
            border: `1px solid ${token("warn")}`,
            opacity: 0.9
          }}
        >
          <Typography sx={{ ...label, color: token("warn") }}>Dispute note</Typography>
          <TextField
            autoFocus
            size="small"
            variant="standard"
            fullWidth
            defaultValue={expense.disputeNote ?? ""}
            placeholder="Why isn't this yours? (fraud, wrong card, duplicate charge…)"
            onBlur={(e) => onExpenseChange({ disputeNote: e.target.value || undefined })}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            sx={{ "& input": { fontSize: 12, py: 0.2 } }}
          />
          <Typography sx={{ ...MONO, fontSize: 10.5, color: token("warn"), flexShrink: 0 }}>
            excluded · $0.00
          </Typography>
        </Box>
      )}

      {expense.items.map((i) => (
        <Box key={i.id} sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.25 }}>
          {i.uncertain && (
            <Tooltip title="The parser was unsure about this line — check it against the receipt.">
              <Box sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: token("warn"), flexShrink: 0 }} />
            </Tooltip>
          )}
          <Box sx={{ width: 260 }}>
            <TextCell value={i.description} onCommit={(v) => set(i.id, { description: v, uncertain: false })} width={240} />
          </Box>
          <TextField
            size="small"
            variant="standard"
            type="number"
            value={i.qty}
            onChange={(e) => set(i.id, { qty: Math.max(0, Number(e.target.value) || 0) })}
            sx={{ width: 58, "& input": { ...MONO, fontSize: 11.5, py: 0.2 } }}
          />
          <Box sx={{ width: 110 }}>
            <MoneyCell value={i.unit} onCommit={(c) => set(i.id, { unit: c ?? 0, uncertain: false })} />
          </Box>
          <Typography sx={{ ...MONO, width: 110, fontSize: 11.8, color: token("dim") }}>
            {money(lineTotal(i))}
          </Typography>
          <Button
            size="small"
            color="error"
            sx={{ fontSize: 10.5, minWidth: 0, py: 0 }}
            onClick={() => onChange(expense.items.filter((x) => x.id !== i.id))}
          >
            remove
          </Button>
        </Box>
      ))}
      {!expense.items.length && (
        <Typography sx={{ fontSize: 11.5, color: token("dim") }}>
          No line items — add one, or the total is zero.
        </Typography>
      )}
    </Box>
  );
}

export function GridView({
  expenses,
  onUpdate,
  onAdd,
  onAddIncome,
  onPaydays,
  compact = false
}: {
  expenses: Expense[];
  onUpdate: (id: string, patch: Partial<Expense>) => void;
  onAdd: () => void;
  /** A one-off income row. Optional so a host without the header wiring still renders. */
  onAddIncome?: () => void;
  /** Open the Paydays dialog. */
  onPaydays?: () => void;
  /** Inside a floating window: drop the stat tiles and the hint line, which
   *  are page furniture and eat a small window's whole height. */
  compact?: boolean;
}) {
  const prefs = useExpensesSettings();
  const [sortKey, setSortKey] = React.useState<SortKey>("date");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");
  // The default sort is a setting (2026-10-16); it lands after the settings
  // doc loads and again whenever it is changed, which is also what makes the
  // settings dialog's change visible at once.
  React.useEffect(() => {
    const keys: SortKey[] = ["date", "kind", "merchant", "category", "payment", "subtotal", "tax", "stated", "recon", "total", "balance"];
    if (keys.includes(prefs.defaultSort as SortKey)) setSortKey(prefs.defaultSort as SortKey);
    setSortDir(prefs.defaultSortDir === "asc" ? "asc" : "desc");
  }, [prefs.defaultSort, prefs.defaultSortDir]);
  const [openRows, setOpenRows] = React.useState<Record<string, boolean>>({});
  const selected = useExpenseSelection();
  const cards = useHiddenCards();
  const [cardsMenu, setCardsMenu] = React.useState<HTMLElement | null>(null);
  const show = (id: CardId) => !cards.hidden.has(id);

  const totals = React.useMemo(
    () => ({
      spent: sumSpent(expenses),
      income: sumIncome(expenses),
      net: net(expenses),
      incomeCount: expenses.filter(isIncome).length,
      tax: expenses.reduce((n, e) => n + (e.disputed || isIncome(e) ? 0 : e.tax), 0),
      sub: expenses.reduce((n, e) => n + (e.disputed || isIncome(e) ? 0 : subtotal(e)), 0),
      unreconciled: expenses.filter((e) => !e.disputed && !reconcile(e).ok).length
    }),
    [expenses]
  );

  /** Flip a row's kind; the category follows (see the command of the same name). */
  const toggleKind = React.useCallback(
    (e: Expense) => {
      const toIncome = !isIncome(e);
      onUpdate(e.id, {
        kind: toIncome ? "income" : "expense",
        category: toIncome ? INCOME_CATEGORY : e.category === INCOME_CATEGORY ? "other" : e.category
      });
    },
    [onUpdate]
  );

  // The running balance is cumulative in DATE order per expense, so it stays
  // correct under any display sort. The "Date" column sorts by the SAME rank
  // the balance accumulated through, so same-day ties keep the column climbing.
  const balanceRows = React.useMemo(() => runningBalance(expenses), [expenses]);
  const balances = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const row of balanceRows) map.set(row.expense.id, row.balance);
    return map;
  }, [balanceRows]);
  const dateOrder = React.useMemo(() => {
    const map = new Map<string, number>();
    balanceRows.forEach((row, i) => map.set(row.expense.id, i));
    return map;
  }, [balanceRows]);

  const sortValue = React.useCallback(
    (e: Expense, key: SortKey): number | string => {
      switch (key) {
        case "date": return dateOrder.get(e.id) ?? 0;
        case "kind": return isIncome(e) ? 1 : 0;
        case "merchant": return e.merchant.toLowerCase();
        case "category": return e.category;
        case "payment": return e.paymentMethod ?? "";
        case "subtotal": return subtotal(e);
        case "tax": return e.tax;
        case "stated": return e.statedTotal ?? 0;
        case "recon": return Math.abs(reconcile(e).delta);
        case "total": return effectiveTotal(e);
        case "balance": return balances.get(e.id) ?? 0;
      }
    },
    [dateOrder, balances]
  );

  const sorted = React.useMemo(() => {
    const rows = [...expenses];
    rows.sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      const cmp = typeof va === "string" ? va.localeCompare(String(vb)) : va - Number(vb);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [expenses, sortKey, sortDir, sortValue]);

  const header = (key: SortKey, label: string, hint?: string) => (
    <TableCell sx={{ py: 0.4, whiteSpace: "nowrap" }} sortDirection={sortKey === key ? sortDir : false}>
      <Tooltip title={hint ?? ""} disableHoverListener={!hint}>
        <TableSortLabel
          active={sortKey === key}
          direction={sortKey === key ? sortDir : "desc"}
          onClick={() => {
            if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
            else {
              setSortKey(key);
              setSortDir("desc");
            }
          }}
          sx={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: token("dim") }}
        >
          {label}
        </TableSortLabel>
      </Tooltip>
    </TableCell>
  );

  const cell = { py: prefs.denseRows ? 0 : 0.3, borderColor: token("edge") } as const;

  /** Display order — what a shift-click range is taken along. */
  const order = React.useMemo(() => sorted.map((r) => r.id), [sorted]);
  const selectedHere = order.filter((id) => selected.has(id)).length;

  return (
    <Box>
      {!compact && (
        <Box sx={{ display: "flex", gap: 1, mb: 1.2, flexWrap: "wrap", alignItems: "stretch" }}>
          {show("count") && <StatTile value={String(expenses.length - totals.incomeCount)} label="expenses" />}
          {show("spent") && <StatTile value={money(totals.spent)} label="spent" />}
          {show("income") && (
            <StatTile
              value={money(totals.income)}
              label="income"
              sub={totals.incomeCount ? `${totals.incomeCount} entr${totals.incomeCount === 1 ? "y" : "ies"}` : "none yet — add a payday"}
            />
          )}
          {show("net") && (
            <StatTile
              value={`${totals.net > 0 ? "+" : ""}${money(totals.net)}`}
              label="net"
              sub={totals.net >= 0 ? "income − spent" : "spent more than earned"}
              subTone={totals.net >= 0 ? "ok" : "warn"}
            />
          )}
          {show("tax") && <StatTile value={money(totals.tax)} label="tax" sub={`on ${money(totals.sub)} subtotal`} />}
          {show("unreconciled") && (
            <StatTile
              value={String(totals.unreconciled)}
              label="unreconciled"
              sub={totals.unreconciled ? "printed total ≠ line sum" : "every receipt adds up"}
              subTone={totals.unreconciled ? "warn" : "ok"}
            />
          )}
          {/* Which cards show is a per-browser choice (`cards.ts`). A small
              menu rather than an × on each tile: a hidden tile has no × to
              bring it back with. */}
          <Button
            size="small"
            onClick={(e) => setCardsMenu(e.currentTarget)}
            aria-haspopup="menu"
            aria-expanded={Boolean(cardsMenu)}
            sx={{ fontSize: 11, color: token("dim"), alignSelf: "center", minWidth: 0 }}
          >
            Cards ▾
          </Button>
          <Menu anchorEl={cardsMenu} open={Boolean(cardsMenu)} onClose={() => setCardsMenu(null)}>
            {CARDS.map((c) => (
              <MenuItem key={c.id} dense onClick={() => cards.toggle(c.id)} sx={{ fontSize: 12, py: 0.2 }}>
                <Checkbox size="small" checked={show(c.id)} sx={{ p: 0.4, mr: 0.6 }} tabIndex={-1} disableRipple />
                {c.label}
              </MenuItem>
            ))}
            <MenuItem
              dense
              onClick={() => {
                cards.reset();
                setCardsMenu(null);
              }}
              sx={{ fontSize: 11.5, color: token("dim"), borderTop: `1px solid ${token("edge")}`, mt: 0.4 }}
            >
              Reset to default
            </MenuItem>
          </Menu>
        </Box>
      )}

      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1, flexWrap: "wrap" }}>
        <Button size="small" variant="outlined" onClick={onAdd}>
          Add expense
        </Button>
        {onAddIncome && (
          <Button size="small" variant="outlined" color="success" onClick={onAddIncome}>
            Add income
          </Button>
        )}
        {onPaydays && (
          <Tooltip title="Set a pay schedule and add every missing payday through today.">
            <Button size="small" variant="outlined" color="success" onClick={onPaydays}>
              Paydays…
            </Button>
          </Tooltip>
        )}
        {selectedHere > 0 ? (
          <>
            <Typography variant="caption" sx={{ ...MONO, color: token("accent") }}>
              {selectedHere} selected
            </Typography>
            <Button size="small" onClick={() => expenseSelection.clear()}>
              Clear
            </Button>
          </>
        ) : null}
        {!compact && prefs.showHints && (
          <Typography variant="caption" sx={{ color: token("dim") }}>
            Click any cell to edit. Amount fields accept arithmetic — <code>12.99*3</code>, <code>40+8.50</code>.
            Tick rows to select (shift for a range) and press <code>Del</code>; right-click a row for its
            actions. Click a row&apos;s kind chip to flip it between expense and income.
          </Typography>
        )}
      </Box>

      <Paper variant="outlined" sx={{ overflow: "auto" }}>
        <Table size="small" sx={{ minWidth: 1260 }}>
          <TableHead>
            <TableRow sx={{ "& th": { borderColor: token("edge"), background: token("panel2") } }}>
              <TableCell padding="checkbox" sx={{ width: 34, py: 0.4 }}>
                <Tooltip title={selectedHere === order.length && order.length ? "Deselect all" : "Select all"}>
                  <Checkbox
                    size="small"
                    sx={{ p: 0.25 }}
                    checked={order.length > 0 && selectedHere === order.length}
                    indeterminate={selectedHere > 0 && selectedHere < order.length}
                    disabled={!order.length}
                    slotProps={{ input: { "aria-label": "Select every expense" } }}
                    onChange={(_, checked) => {
                      if (checked) expenseSelection.all(order);
                      else expenseSelection.clear();
                    }}
                  />
                </Tooltip>
              </TableCell>
              <TableCell sx={{ width: 30, py: 0.4 }} />
              {header("date", "Date")}
              {header("kind", "Kind", "Expense (money out) or income (money in). Click a chip to flip it.")}
              {header("merchant", "Merchant")}
              {header("category", "Category")}
              {header("payment", "Account")}
              <TableCell sx={{ py: 0.4, fontSize: 11, color: token("dim"), textTransform: "uppercase" }}>Lines</TableCell>
              {header("subtotal", "Subtotal")}
              {header("tax", "Tax")}
              <TableCell sx={{ py: 0.4, fontSize: 11, color: token("dim"), textTransform: "uppercase" }}>Tip</TableCell>
              {header("stated", "Printed", "The total printed on the receipt. Blank means trust the computed figure.")}
              {header("recon", "Δ", "Printed total minus the sum of the lines. Reported, never auto-corrected.")}
              {header("total", "Total")}
              {header("balance", "Balance", "Running net balance — income minus spending, cumulative in date order, correct under any display sort.")}
              <TableCell sx={{ py: 0.4, fontSize: 11, color: token("dim"), textTransform: "uppercase" }}>Source</TableCell>
              <TableCell sx={{ py: 0.4, fontSize: 11, color: token("dim"), textTransform: "uppercase" }}>Notes</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.map((r) => {
              const rec = reconcile(r);
              const open = Boolean(openRows[r.id]);
              const picked = selected.has(r.id);
              const income = isIncome(r);
              const balance = balances.get(r.id) ?? 0;
              return (
                <React.Fragment key={r.id}>
                  <TableRow
                    hover
                    data-axf-area="expenses.expense"
                    data-axf-expense={r.id}
                    data-axf-merchant={r.merchant}
                    data-axf-selected={picked ? "1" : "0"}
                    selected={picked}
                    // A right-click outside the selection takes it over, so the
                    // menu's "Delete selected" can never act on rows the reader
                    // cannot see. Inside it, the selection is left alone.
                    onContextMenu={() => {
                      if (!picked) expenseSelection.only(r.id);
                    }}
                    sx={
                      r.disputed
                        ? { opacity: 0.55, "& td": { textDecoration: "line-through" } }
                        : !rec.ok
                          ? { "& td": { background: "color-mix(in srgb, var(--axf-warn) 7%, transparent)" } }
                          : income
                            ? { "& td": { background: "color-mix(in srgb, var(--axf-ok) 8%, transparent)" } }
                            : {}
                    }
                  >
                    <TableCell padding="checkbox" sx={cell}>
                      <Checkbox
                        size="small"
                        sx={{ p: 0.25 }}
                        checked={picked}
                        slotProps={{ input: { "aria-label": `Select ${r.merchant}` } }}
                        // onClick, not onChange: the modifier keys live on the
                        // mouse event, and onChange does not carry them.
                        onClick={(e) => {
                          if (e.shiftKey) expenseSelection.range(r.id, order);
                          else expenseSelection.toggle(r.id);
                        }}
                      />
                    </TableCell>
                    <TableCell sx={cell}>
                      <IconButton
                        size="small"
                        aria-label={open ? "collapse line items" : "expand line items"}
                        onClick={() => setOpenRows((o) => ({ ...o, [r.id]: !open }))}
                        sx={{ p: 0.25 }}
                      >
                        <Glyph
                          id="icon-chevron-down"
                          size={12}
                          style={{ transform: open ? "none" : "rotate(-90deg)", transition: "transform 120ms" }}
                        />
                      </IconButton>
                    </TableCell>
                    <TableCell sx={cell}>
                      <TextCell value={r.date} onCommit={(v) => onUpdate(r.id, { date: autoDashIso(v) || v })} width={100} />
                    </TableCell>
                    <TableCell sx={cell}>
                      <KindChip kind={income ? "income" : "expense"} onToggle={() => toggleKind(r)} />
                    </TableCell>
                    <TableCell sx={cell}>
                      <TextCell value={r.merchant} onCommit={(v) => onUpdate(r.id, { merchant: capitalizeWords(v) })} width={170} />
                    </TableCell>
                    <TableCell sx={cell}>
                      <TextField
                        select
                        size="small"
                        variant="standard"
                        value={r.category}
                        onChange={(e) => onUpdate(r.id, { category: e.target.value })}
                        sx={{ width: 150, "& .MuiInputBase-input": { fontSize: 11.8, py: 0.2 } }}
                      >
                        {CATEGORIES.map((c) => (
                          <MenuItem key={c.id} value={c.id} sx={{ fontSize: 12 }}>
                            <Box component="span" sx={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", bgcolor: c.color, mr: 0.8 }} />
                            {c.label}
                          </MenuItem>
                        ))}
                      </TextField>
                    </TableCell>
                    <TableCell sx={cell}>
                      <PaymentCell value={r.paymentMethod ?? ""} onCommit={(v) => onUpdate(r.id, { paymentMethod: v || undefined })} />
                    </TableCell>
                    <TableCell sx={cell}>
                      <Typography sx={{ fontSize: 11.5, color: token("dim") }}>{r.items.length}</Typography>
                    </TableCell>
                    <TableCell sx={cell}>
                      <Typography sx={{ ...MONO, fontSize: 11.8, color: token("dim") }}>{money(subtotal(r))}</Typography>
                    </TableCell>
                    <TableCell sx={cell}>
                      <Tooltip title={`${taxRate(r).toFixed(2)}% of subtotal`}>
                        <Box>
                          <MoneyCell value={r.tax} onCommit={(c) => onUpdate(r.id, { tax: c ?? 0 })} />
                        </Box>
                      </Tooltip>
                    </TableCell>
                    <TableCell sx={cell}>
                      <MoneyCell value={r.tip} onCommit={(c) => onUpdate(r.id, { tip: c ?? 0 })} />
                    </TableCell>
                    <TableCell sx={cell}>
                      <MoneyCell value={r.statedTotal} onCommit={(c) => onUpdate(r.id, { statedTotal: c })} allowNull />
                    </TableCell>
                    <TableCell sx={cell}>
                      {rec.stated === null ? (
                        <Typography sx={{ fontSize: 11, color: token("dim") }}>—</Typography>
                      ) : rec.ok ? (
                        <Typography sx={{ fontSize: 11, color: token("ok") }}>✓</Typography>
                      ) : (
                        <Tooltip title={`Printed total is ${money(rec.delta)} away from the sum of the lines.`}>
                          <Typography sx={{ ...MONO, fontSize: 11.5, color: token("warn") }}>
                            {rec.delta > 0 ? "+" : ""}
                            {money(rec.delta)}
                          </Typography>
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell sx={cell}>
                      <Typography sx={{ ...MONO, fontSize: 12.2, fontWeight: 600, color: income ? token("ok") : undefined }}>
                        {income ? "+" : ""}
                        {money(effectiveTotal(r))}
                      </Typography>
                    </TableCell>
                    <TableCell sx={cell}>
                      <Typography sx={{ ...MONO, fontSize: 11.8, color: balance < 0 ? token("dim") : token("ok") }}>
                        {money(balance)}
                      </Typography>
                    </TableCell>
                    <TableCell sx={cell}>
                      <SourceChip source={r.source} />
                    </TableCell>
                    <TableCell sx={cell}>
                      <TextCell value={r.note ?? ""} onCommit={(v) => onUpdate(r.id, { note: v || undefined })} width={210} />
                    </TableCell>
                  </TableRow>
                  {open && (
                    <TableRow data-axf-area="expenses.expense" data-axf-expense={r.id} data-axf-merchant={r.merchant}>
                      <TableCell colSpan={17} sx={{ py: 0, borderColor: token("edge"), background: token("panel") }}>
                        <LineItems
                          expense={r}
                          onChange={(items) => onUpdate(r.id, { items })}
                          onExpenseChange={(patch) => onUpdate(r.id, patch)}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              );
            })}
            {!sorted.length && (
              <TableRow>
                <TableCell colSpan={17} sx={{ py: 2, textAlign: "center", color: token("dim"), fontSize: 12 }}>
                  No expenses yet — add one.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  );
}
