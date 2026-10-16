"use client";

/**
 * @file The tab strip — docked tabs, each closable and each floatable.
 *
 * MUI `Tabs`/`Tab` as the rule requires, with two affordances added to the
 * label: **⇱ float** and **✕ close**. They are `ButtonBase`, and both stop
 * propagation — a close button that also selects the tab it is closing makes
 * the strip flicker through a tab that is about to disappear.
 *
 * Every tab marks `data-axf-area="expenses.tab"` and `data-axf-tab="<id>"`, so
 * the right-click rows (`expenses.decl.ts` → `expenses.commands.ts`) resolve
 * the tab they were opened over without a single handler here. The strip
 * itself marks `expenses.tabstrip`, so a right-click on the empty space beside
 * the tabs still offers the group's own actions.
 *
 * `Tabs` is given `value={false}` when nothing is docked. Handing it an id that
 * is not among its children makes MUI warn and draw no indicator, and "nothing
 * docked" is a real state here — see `EmptyTabState`.
 */

import * as React from "react";

import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { token } from "@axf/core";

import type { TabState } from "./tabs";

function TabLabel({
  tab,
  onFloat,
  onClose
}: {
  tab: TabState;
  onFloat: () => void;
  onClose: () => void;
}) {
  const control = {
    width: 16,
    height: 16,
    borderRadius: "3px",
    fontSize: 11,
    lineHeight: 1,
    color: token("dim"),
    flexShrink: 0,
    "&:hover": { background: `color-mix(in srgb, ${token("accent")} 20%, transparent)`, color: token("ink") }
  } as const;

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.6, maxWidth: 260 }}>
      <Typography
        component="span"
        sx={{ fontSize: 12.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {tab.title}
      </Typography>
      <Tooltip title="Undock as a floating window">
        <ButtonBase
          component="span"
          role="button"
          aria-label={`Float ${tab.title}`}
          sx={control}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onFloat();
          }}
        >
          ⇱
        </ButtonBase>
      </Tooltip>
      <Tooltip title="Close this tab">
        <ButtonBase
          component="span"
          role="button"
          aria-label={`Close ${tab.title}`}
          sx={{ ...control, "&:hover": { ...control["&:hover"], color: token("err") } }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          ✕
        </ButtonBase>
      </Tooltip>
    </Box>
  );
}

export default function TabGroup({
  tabs,
  activeId,
  onActivate,
  onFloat,
  onClose,
  trailing
}: {
  /** Docked tabs only — floating ones are drawn by `ExpenseWindows`. */
  tabs: readonly TabState[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onFloat: (id: string) => void;
  onClose: (id: string) => void;
  /** Actions pinned to the right of the strip (New report, Open, Save…). */
  trailing?: React.ReactNode;
}) {
  const value = activeId && tabs.some((t) => t.id === activeId) ? activeId : false;

  return (
    <Box
      data-axf-area="expenses.tabstrip"
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        borderBottom: `1px solid ${token("edge")}`,
        minHeight: 34
      }}
    >
      <Tabs
        value={value}
        onChange={(_, v: string) => onActivate(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{
          minHeight: 32,
          flex: 1,
          "& .MuiTab-root": { minHeight: 32, py: 0, px: 1.1, textTransform: "none", minWidth: 0 },
          "& .MuiTabs-flexContainer": { gap: 0.2 }
        }}
      >
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            value={tab.id}
            data-axf-area="expenses.tab"
            data-axf-tab={tab.id}
            data-axf-tab-title={tab.title}
            label={
              <TabLabel tab={tab} onFloat={() => onFloat(tab.id)} onClose={() => onClose(tab.id)} />
            }
          />
        ))}
      </Tabs>
      {trailing ? <Box sx={{ display: "flex", gap: 0.6, flexShrink: 0 }}>{trailing}</Box> : null}
    </Box>
  );
}
