/**
 * @file **Tree view** — the same expenses, rolled up.
 *
 * Year → month → category → expense → line item, with every node carrying the
 * total of everything beneath it and its share of its parent. The grid answers
 * "what did I spend on"; the tree answers "where did it go", and the two read
 * from one store and one math module so they can never disagree by a cent.
 *
 * The grouping axis is switchable (category-first instead of time-first),
 * because "which month was expensive" and "which category is expensive" are
 * different questions over identical data.
 *
 * Ported from GizmoX with `GX.*` → `token()`, Material icons → the pack's
 * chevron glyph, and the per-node `useCtx` menu → the AmberX contract: a node
 * row marks `data-axf-area="expenses.node"` (an expense leaf marks
 * `expenses.expense` instead, so it composes the full expense command set) and
 * the menu rows live on the decl.
 */
"use client";

import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";

import { Glyph, token } from "@axf/core";

import { MONO } from "./bits";
import { categoryOf, type Expense } from "./types";
import { effectiveTotal, lineTotal, money, net, spending, sumIncome, withShares } from "./math";

type Axis = "time" | "category";

interface Node {
  key: string;
  label: string;
  total: number;
  count: number;
  share: number;
  color?: string;
  depth: number;
  children: Node[];
  /** Leaf payload, when the node *is* an expense. */
  expense?: Expense;
}

/** Build one level: group, total, then hand the shares out. */
function level(
  list: Expense[],
  keyOf: (e: Expense) => string,
  labelOf: (k: string, sample: Expense) => string,
  depth: number,
  colorOf?: (k: string) => string
): Node[] {
  const map = new Map<string, Expense[]>();
  for (const e of list) {
    const k = keyOf(e);
    map.set(k, [...(map.get(k) ?? []), e]);
  }
  const raw = [...map.entries()].map(([key, group]) => ({
    key,
    label: labelOf(key, group[0]),
    count: group.length,
    total: group.reduce((n, e) => n + effectiveTotal(e), 0),
    share: 0,
    color: colorOf?.(key),
    depth,
    children: [] as Node[]
  }));
  const shared = withShares(raw.map(({ key, label, count, total, share }) => ({ key, label, count, total, share })));
  return raw.map((r, i) => ({ ...r, share: shared[i].share }));
}

const MONTH_LABEL = (key: string) => {
  const [y, m] = key.split("-");
  return new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  });
};

function expenseNodes(list: Expense[], depth: number): Node[] {
  const shared = withShares(
    list.map((e) => ({ key: e.id, label: e.merchant, count: e.items.length, total: effectiveTotal(e), share: 0 }))
  );
  return list
    .map((e, i) => ({
      key: e.id,
      label: `${e.date} · ${e.merchant}`,
      total: effectiveTotal(e),
      count: e.items.length,
      share: shared[i].share,
      depth,
      expense: e,
      children: e.items.map((li) => ({
        key: li.id,
        label: `${li.qty} × ${li.description}`,
        total: lineTotal(li),
        count: 0,
        share: 0,
        depth: depth + 1,
        children: []
      }))
    }))
    .sort((a, b) => b.total - a.total);
}

function buildTree(list: Expense[], axis: Axis): Node[] {
  if (axis === "category") {
    return level(list, (e) => e.category, (k) => categoryOf(k).label, 0, (k) => categoryOf(k).color)
      .sort((a, b) => b.total - a.total)
      .map((cat) => {
        const inCat = list.filter((e) => e.category === cat.key);
        return {
          ...cat,
          children: level(inCat, (e) => e.date.slice(0, 7), (k) => MONTH_LABEL(k), 1)
            .sort((a, b) => a.key.localeCompare(b.key))
            .map((m) => ({
              ...m,
              children: expenseNodes(
                inCat.filter((e) => e.date.slice(0, 7) === m.key),
                2
              )
            }))
        };
      });
  }

  return level(list, (e) => e.date.slice(0, 4), (k) => k, 0)
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((year) => {
      const inYear = list.filter((e) => e.date.slice(0, 4) === year.key);
      return {
        ...year,
        children: level(inYear, (e) => e.date.slice(0, 7), (k) => MONTH_LABEL(k), 1)
          .sort((a, b) => a.key.localeCompare(b.key))
          .map((month) => {
            const inMonth = inYear.filter((e) => e.date.slice(0, 7) === month.key);
            return {
              ...month,
              children: level(
                inMonth,
                (e) => e.category,
                (k) => categoryOf(k).label,
                2,
                (k) => categoryOf(k).color
              )
                .sort((a, b) => b.total - a.total)
                .map((cat) => ({
                  ...cat,
                  children: expenseNodes(
                    inMonth.filter((e) => e.category === cat.key),
                    3
                  )
                }))
            };
          })
      };
    });
}

function NodeRow({
  node,
  open,
  onToggle
}: {
  node: Node;
  open: Record<string, boolean>;
  onToggle: (key: string) => void;
}) {
  const isOpen = Boolean(open[node.key]);
  const hasKids = node.children.length > 0;
  const leaf = node.depth >= 3 && !hasKids;

  const rowSx = {
    display: "flex",
    alignItems: "center",
    gap: 0.7,
    pl: node.depth * 2.1 + 0.4,
    pr: 1,
    py: 0.35,
    borderRadius: "var(--axf-radius-tight)",
    cursor: hasKids ? "pointer" : "default",
    "&:hover": { background: token("panel2") }
  } as const;

  /* An expense leaf composes the expense commands; every other node offers the
     node rows (copy subtotal). Two literal-attribute branches rather than a
     spread of a computed object, because the ctx-conformance gate reads the
     MARKERS from source — an area marked only through a variable is an area
     the scanner (rightly) cannot vouch for. */
  const row = node.expense ? (
    <Box
      onClick={() => hasKids && onToggle(node.key)}
      data-axf-area="expenses.expense"
      data-axf-expense={node.expense.id}
      data-axf-merchant={node.expense.merchant}
      sx={rowSx}
    >
      {rowContent(node, isOpen, hasKids, leaf)}
    </Box>
  ) : (
    <Box
      onClick={() => hasKids && onToggle(node.key)}
      data-axf-area="expenses.node"
      data-axf-node-label={node.label}
      data-axf-node-total={String(node.total)}
      sx={rowSx}
    >
      {rowContent(node, isOpen, hasKids, leaf)}
    </Box>
  );

  return (
    <Box>
      {row}
      {isOpen &&
        node.children.map((c) => (
          <NodeRow key={c.key} node={c} open={open} onToggle={onToggle} />
        ))}
    </Box>
  );
}

function rowContent(node: Node, isOpen: boolean, hasKids: boolean, leaf: boolean) {
  return (
    <>
        <Box sx={{ width: 16, flexShrink: 0, display: "inline-flex" }}>
          {hasKids && (
            <Glyph
              id="icon-chevron-down"
              size={12}
              style={{ transform: isOpen ? "none" : "rotate(-90deg)", transition: "transform 120ms" }}
            />
          )}
        </Box>
        {node.color && (
          <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: node.color, flexShrink: 0 }} />
        )}
        <Typography
          sx={{
            fontSize: node.depth === 0 ? 13.2 : leaf ? 11.6 : 12.4,
            fontWeight: node.depth === 0 ? 700 : node.depth === 1 ? 600 : 400,
            color: leaf ? token("dim") : token("ink"),
            minWidth: 0
          }}
          noWrap
        >
          {node.label}
        </Typography>
        {node.count > 0 && node.depth < 3 && (
          <Typography sx={{ fontSize: 10, color: token("dim") }}>
            {node.count} item{node.count === 1 ? "" : "s"}
          </Typography>
        )}
        {node.expense?.reimbursable && (
          <Chip size="small" variant="outlined" label="reimbursable" sx={{ height: 16, fontSize: 9.5 }} />
        )}
        {node.expense?.disputed && (
          <Chip size="small" variant="outlined" label="disputed · $0" sx={{ height: 16, fontSize: 9.5, color: token("warn") }} />
        )}
        <Box sx={{ flex: 1 }} />
        {node.share > 0 && node.depth < 3 && (
          <Box sx={{ width: 70, flexShrink: 0 }}>
            <LinearProgress
              variant="determinate"
              value={Math.min(100, node.share)}
              sx={{
                height: 4,
                borderRadius: 2,
                backgroundColor: token("edge"),
                "& .MuiLinearProgress-bar": { backgroundColor: node.color ?? token("accent") }
              }}
            />
          </Box>
        )}
        {node.share > 0 && node.depth < 3 && (
          <Typography sx={{ ...MONO, fontSize: 10.5, color: token("dim"), width: 42, textAlign: "right" }}>
            {node.share}%
          </Typography>
        )}
        <Typography
          sx={{
            ...MONO,
            fontSize: node.depth === 0 ? 12.6 : 11.8,
            fontWeight: node.depth <= 1 ? 700 : 400,
            width: 108,
            textAlign: "right",
            flexShrink: 0
          }}
        >
          {money(node.total)}
        </Typography>
    </>
  );
}

export function TreeView({ expenses: all }: { expenses: Expense[] }) {
  const [axis, setAxis] = React.useState<Axis>("time");
  const [open, setOpen] = React.useState<Record<string, boolean>>({});

  // The tree answers "where did it go" — a spending rollup. Income would sit
  // in a month as a category that inflates the month's total by exactly the
  // amount that was NOT spent, so it stays out of the nodes and is reported
  // beside the grand total instead.
  const expenses = React.useMemo(() => spending(all), [all]);
  const income = sumIncome(all);
  const netTotal = net(all);
  const tree = React.useMemo(() => buildTree(expenses, axis), [expenses, axis]);
  const grandTotal = expenses.reduce((n, e) => n + effectiveTotal(e), 0);

  // Top two levels start open — a tree that opens fully collapsed makes the
  // reader do work the default could have done.
  React.useEffect(() => {
    const next: Record<string, boolean> = {};
    for (const a of tree) {
      next[a.key] = true;
      for (const b of a.children) next[b.key] = true;
    }
    setOpen(next);
  }, [tree]);

  const expandAll = (want: boolean) => {
    const next: Record<string, boolean> = {};
    const walk = (nodes: Node[]) => {
      for (const n of nodes) {
        next[n.key] = want;
        walk(n.children);
      }
    };
    walk(tree);
    setOpen(next);
  };

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1, flexWrap: "wrap" }}>
        <Button
          size="small"
          variant={axis === "time" ? "contained" : "outlined"}
          onClick={() => setAxis("time")}
          sx={{ fontSize: 11.5 }}
        >
          Year → month → category
        </Button>
        <Button
          size="small"
          variant={axis === "category" ? "contained" : "outlined"}
          onClick={() => setAxis("category")}
          sx={{ fontSize: 11.5 }}
        >
          Category → month
        </Button>
        <Button size="small" onClick={() => expandAll(true)} sx={{ fontSize: 11.5 }}>
          Expand all
        </Button>
        <Button size="small" onClick={() => expandAll(false)} sx={{ fontSize: 11.5 }}>
          Collapse all
        </Button>
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: 11.5, color: token("dim") }}>
          {expenses.length} expenses · every node totals what is beneath it
        </Typography>
        <Typography sx={{ ...MONO, fontSize: 13, fontWeight: 700 }}>{money(grandTotal)}</Typography>
        {income > 0 && (
          <Typography sx={{ ...MONO, fontSize: 11.5, color: token("ok") }} title="Income is kept out of the rollup">
            +{money(income)} in · net {netTotal > 0 ? "+" : ""}{money(netTotal)}
          </Typography>
        )}
      </Box>

      <Paper variant="outlined" sx={{ p: 0.6, maxHeight: 560, overflow: "auto" }}>
        {tree.map((n) => (
          <NodeRow key={n.key} node={n} open={open} onToggle={(k) => setOpen((o) => ({ ...o, [k]: !o[k] }))} />
        ))}
        {!tree.length && (
          <Typography sx={{ fontSize: 12, color: token("dim"), p: 1.2 }}>
            Nothing to roll up yet — add an expense on the Grid tab.
          </Typography>
        )}
      </Paper>
    </Box>
  );
}
