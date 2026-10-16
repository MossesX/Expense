"use client";

/**
 * @file The Expense Tracker's settings dialog — rebuilt after the peel
 * (owner, 2026-10-16) as a tabbed dialog over the SAME rows the decl declares
 * and core's registry persists, plus a Theme tab that is not a setting at all
 * but the per-browser theme store.
 *
 * Why a module-owned dialog rather than core's `SettingsDialog`: core's is a
 * flat list of every row, right for a module with four of them and wrong for
 * one with forty. The rows are still DATA on the decl — this file adds
 * sections (`settings.ts` → `SECTIONS`), per-section reset, and the Theme tab.
 * Core's dialog is intercepted by the module (`ExpensesModule`) so the shell's
 * gear and the header's gear open the same thing.
 */

import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import AiSettingsPanel from "./assistant/AiSettingsPanel";

import { token } from "@axf/core";
import type { SettingRow, SettingValue } from "@axf/core";

import ThemeTab from "./ThemeTab";
import { EXPENSES_DECL } from "./expenses.decl";
import { FILTER_COLUMNS, parseColumns } from "./filter";
import { DEFAULT_SETTINGS, SECTIONS, expensesSettings, useExpensesSettings, type SettingKey } from "./settings";
import { expenseUi } from "./ui";

const ROWS: ReadonlyMap<string, SettingRow> = new Map((EXPENSES_DECL.settings?.rows ?? []).map((r) => [r.key, r]));

function RowControl({ row, value, onChange }: { row: SettingRow; value: SettingValue; onChange: (v: SettingValue) => void }) {
  switch (row.kind) {
    case "switch":
      return <Switch size="small" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} slotProps={{ input: { "aria-label": row.label } }} />;
    case "number":
      return (
        <TextField
          size="small"
          type="number"
          value={String(value)}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n)) return;
            onChange(Math.min(row.max ?? Infinity, Math.max(row.min ?? -Infinity, n)));
          }}
          slotProps={{ input: { sx: { width: 110 } }, htmlInput: { min: row.min, max: row.max, step: row.step ?? 1, "aria-label": row.label } }}
        />
      );
    case "select":
      return (
        <TextField select size="small" value={String(value)} onChange={(e) => onChange(e.target.value)} sx={{ minWidth: 180 }} slotProps={{ htmlInput: { "aria-label": row.label } }}>
          {(row.options ?? []).map((o) => (
            <MenuItem key={o.value} value={o.value} sx={{ fontSize: 12.5 }}>
              {o.label}
            </MenuItem>
          ))}
        </TextField>
      );
    case "text":
      return <TextField size="small" value={String(value)} onChange={(e) => onChange(e.target.value)} sx={{ minWidth: 180 }} slotProps={{ htmlInput: { "aria-label": row.label } }} />;
  }
}

export default function ExpensesSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const values = useExpensesSettings();
  const [tab, setTab] = React.useState<string>(SECTIONS[0].id);

  const set = (key: string, v: SettingValue) => expensesSettings.set(key as SettingKey, v as never);
  const section = SECTIONS.find((s) => s.id === tab) ?? null;

  const resetSection = () => {
    if (!section) return;
    for (const key of section.keys) set(key, DEFAULT_SETTINGS[key]);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontSize: 15, fontWeight: 700, pb: 0 }}>
        Expense Tracker settings
        <Typography component="span" sx={{ ml: 1, fontSize: 12, color: token("dim"), fontFamily: token("mono") }}>
          expenses
        </Typography>
      </DialogTitle>
      <Tabs
        value={tab}
        onChange={(_, v: string) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ px: 2, borderBottom: `1px solid ${token("edge")}`, minHeight: 36, "& .MuiTab-root": { minHeight: 36, fontSize: 12.5, textTransform: "none", py: 0.5 } }}
      >
        {SECTIONS.map((s) => (
          <Tab key={s.id} value={s.id} label={s.title} />
        ))}
        <Tab value="theme" label="Theme" />
      </Tabs>
      <DialogContent sx={{ minHeight: 360 }}>
        {tab === "theme" ? (
          <ThemeTab />
        ) : section ? (
          <Stack spacing={1.6}>
            <Typography sx={{ fontSize: 12, color: token("dim") }}>{section.blurb}</Typography>
            {section.id === "ai" && <AiSettingsPanel />}
            {section.keys.map((key) => {
              const row = ROWS.get(key);
              if (!row) return null;
              const value = values[key] as SettingValue;
              return (
                <Box key={key} sx={{ display: "flex", alignItems: "center", gap: 2, justifyContent: "space-between" }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{row.label}</Typography>
                    <Typography sx={{ fontSize: 11.5, color: token("dim") }}>{row.hint}</Typography>
                    {key === "filterColumns" && (
                      <Typography sx={{ fontSize: 11.5, color: token("dim"), mt: 0.3 }}>
                        Now:{" "}
                        {parseColumns(String(value)).length
                          ? FILTER_COLUMNS.filter((c) => parseColumns(String(value)).includes(c.id)).map((c) => c.label).join(", ")
                          : "every column"}
                        {" · "}
                        <Button
                          size="small"
                          sx={{ p: 0, minWidth: 0, fontSize: 11.5, textTransform: "none", verticalAlign: "baseline" }}
                          onClick={() => {
                            onClose();
                            expenseUi.openFilterDialog();
                          }}
                        >
                          open the advanced filter
                        </Button>
                      </Typography>
                    )}
                  </Box>
                  <RowControl row={row} value={value} onChange={(v) => set(key, v)} />
                </Box>
              );
            })}
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions>
        {tab !== "theme" && (
          <Button size="small" color="inherit" onClick={resetSection} sx={{ color: token("dim") }}>
            Reset this section
          </Button>
        )}
        <Button size="small" color="inherit" onClick={() => expensesSettings.reset()} sx={{ color: token("dim") }}>
          Reset all
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="contained" onClick={onClose}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}
