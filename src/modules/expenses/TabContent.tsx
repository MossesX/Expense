"use client";

/**
 * @file What a tab DRAWS, resolved from its kind — and the one place that
 * mapping lives.
 *
 * A tab renders in two frames: the docked panel under the strip, and a floating
 * window. Both go through here, so a floated Grid is the same component over
 * the same store as the docked one — two views of one ledger, live, which is
 * the property that makes floating worth having at all (the Task Manager's
 * windows make the same argument in the same words).
 *
 * A second renderer per frame is how the two drift, and the drift shows up as
 * "the floating copy does not update", which is the least debuggable class of
 * bug this arrangement can produce.
 */

import * as React from "react";

import Typography from "@mui/material/Typography";

import { token } from "@axf/core";

import { GridView } from "./GridView";
import ReportTab from "./ReportTab";
import { Statements } from "./Statements";
import { TreeView } from "./TreeView";
import type { TabState } from "./tabs";
import type { Expense } from "./types";

export interface TabContentProps {
  tab: TabState;
  expenses: Expense[];
  onUpdate: (id: string, patch: Partial<Expense>) => void;
  onAdd: () => void;
  onAddIncome?: () => void;
  onPaydays?: () => void;
  /** True in a floating window — the grid trims its chrome there. */
  compact?: boolean;
}

export default function TabContent({ tab, expenses, onUpdate, onAdd, onAddIncome, onPaydays, compact }: TabContentProps) {
  switch (tab.kind) {
    case "grid":
      return (
        <GridView
          expenses={expenses}
          onUpdate={onUpdate}
          onAdd={onAdd}
          onAddIncome={onAddIncome}
          onPaydays={onPaydays}
          compact={compact}
        />
      );
    case "tree":
      return <TreeView expenses={expenses} />;
    case "statements":
      return <Statements expenses={expenses} />;
    case "report":
      return <ReportTab tab={tab} />;
    default:
      // Unreachable through `TabKind`, but a tab restored from a future shape
      // should say so rather than render blank.
      return (
        <Typography sx={{ fontSize: 12, color: token("err") }}>
          Unknown tab kind — close this tab.
        </Typography>
      );
  }
}
