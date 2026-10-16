/**
 * @file Shared pieces of the Expense Tracker's views — the inline editing
 * cells, the stat tiles and the source chip.
 *
 * Ported from GizmoX's GridView, with the GizmoX kit swapped for what AmberX
 * actually has: `GX.*` tokens → `token()`, `GxChip`/`StatTile` → the local MUI
 * shapes below, `@mui/icons-material` → nothing (the pack owns icons, and
 * these cells need none).
 */
"use client";

import * as React from "react";

import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { token } from "@axf/core";

import { PAYMENT_METHODS, type ExpenseKind, type ExpenseSource } from "./types";
import { evalAmount, money } from "./math";

export const MONO = { fontFamily: "var(--axf-mono)", fontVariantNumeric: "tabular-nums" } as const;

/** Digits-only ISO date entry — typing `20260728` renders `2026-07-28`. */
export function autoDashIso(text: string): string {
  const digits = text.replace(/\D/g, "").slice(0, 8);
  const parts = [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8)];
  return parts.filter(Boolean).join("-");
}

/** The Data Grid's merchant-capitalisation habit, carried with the port. */
export function capitalizeWords(text: string): string {
  return text.replace(/\b\p{L}/gu, (ch) => ch.toUpperCase());
}

/** One headline figure. GizmoX's StatTile, as a plain MUI Paper. */
export function StatTile({
  value,
  label,
  sub,
  subTone
}: {
  value: string;
  label: string;
  sub?: string;
  subTone?: "ok" | "warn";
}) {
  return (
    <Paper variant="outlined" sx={{ px: 1.4, py: 0.8, minWidth: 110 }}>
      <Typography sx={{ ...MONO, fontSize: 15, fontWeight: 700 }}>{value}</Typography>
      <Typography sx={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: token("dim") }}>
        {label}
      </Typography>
      {sub ? (
        <Typography sx={{ fontSize: 10.5, color: subTone ? token(subTone) : token("dim") }}>
          {sub}
        </Typography>
      ) : null}
    </Paper>
  );
}

/** Where an expense came from, as a small chip. */
export function SourceChip({ source }: { source: ExpenseSource }) {
  return (
    <Chip
      size="small"
      variant="outlined"
      label={source}
      sx={{
        height: 18,
        fontSize: 10.5,
        color:
          source === "receipt"
            ? token("accent")
            : source === "manual"
              ? token("info")
              : source === "payday"
                ? token("ok")
                : token("dim")
      }}
    />
  );
}

/**
 * The income/expense flag as a clickable chip — one click flips it. A chip
 * rather than a select because there are exactly two values and the column
 * has to stay narrow; a chip rather than a switch because the word is the
 * point ("income" should be readable at a glance in a column of "expense").
 */
export function KindChip({ kind, onToggle }: { kind: ExpenseKind; onToggle: () => void }) {
  const income = kind === "income";
  return (
    <Chip
      size="small"
      variant={income ? "filled" : "outlined"}
      label={income ? "income" : "expense"}
      onClick={onToggle}
      title={income ? "Money in — click to make this an expense" : "Money out — click to make this income"}
      sx={{
        height: 18,
        fontSize: 10.5,
        cursor: "pointer",
        ...(income
          ? { color: token("page"), bgcolor: token("ok"), "&:hover": { bgcolor: token("ok"), opacity: 0.85 } }
          : { color: token("dim") })
      }}
    />
  );
}

/** A money cell that commits on blur/Enter and accepts arithmetic
 *  (`12.99*3`, `40+8.50`) through `evalAmount` — never `eval`. */
export function MoneyCell({
  value,
  onCommit,
  width = 96,
  allowNull = false
}: {
  value: number | null;
  onCommit: (cents: number | null) => void;
  width?: number;
  allowNull?: boolean;
}) {
  const [text, setText] = React.useState("");
  const [editing, setEditing] = React.useState(false);

  const commit = () => {
    setEditing(false);
    const t = text.trim();
    if (!t) {
      if (allowNull) onCommit(null);
      return;
    }
    const cents = evalAmount(t);
    if (cents !== null) onCommit(cents);
  };

  if (!editing) {
    return (
      <Typography
        onClick={() => {
          setText(value === null ? "" : (value / 100).toFixed(2));
          setEditing(true);
        }}
        sx={{ ...MONO, fontSize: 11.8, cursor: "text", "&:hover": { color: token("accent") } }}
      >
        {value === null ? "—" : money(value)}
      </Typography>
    );
  }
  return (
    <TextField
      autoFocus
      size="small"
      variant="standard"
      value={text}
      placeholder="12.99*3"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
      sx={{ width, "& input": { ...MONO, fontSize: 11.8, py: 0.2 } }}
    />
  );
}

/** A text cell with the same commit-on-blur behaviour. */
export function TextCell({
  value,
  onCommit,
  width = 150,
  placeholder = "—"
}: {
  value: string;
  onCommit: (v: string) => void;
  width?: number;
  placeholder?: string;
}) {
  const [text, setText] = React.useState(value);
  const [editing, setEditing] = React.useState(false);
  React.useEffect(() => setText(value), [value]);

  if (!editing) {
    return (
      <Typography
        onClick={() => setEditing(true)}
        sx={{
          fontSize: 12.3,
          cursor: "text",
          color: value ? token("ink") : token("dim"),
          "&:hover": { color: token("accent") }
        }}
        noWrap
      >
        {value || placeholder}
      </Typography>
    );
  }
  return (
    <TextField
      autoFocus
      size="small"
      variant="standard"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (text !== value) onCommit(text);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setText(value);
          setEditing(false);
        }
      }}
      sx={{ width, "& input": { fontSize: 12.3, py: 0.2 } }}
    />
  );
}

/** A payment-account cell — pick a known account or type a one-off. */
export function PaymentCell({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [editing, setEditing] = React.useState(false);
  const [text, setText] = React.useState("");

  if (!editing) {
    return (
      <Typography
        noWrap
        onClick={() => {
          setText(value);
          setEditing(true);
        }}
        sx={{
          fontSize: 11.8,
          cursor: "text",
          color: value ? token("ink") : token("dim"),
          "&:hover": { color: token("accent") }
        }}
      >
        {value || "—"}
      </Typography>
    );
  }
  const commit = (v: string) => {
    setEditing(false);
    if (v !== value) onCommit(v);
  };
  return (
    <Autocomplete
      freeSolo
      openOnFocus
      options={PAYMENT_METHODS}
      value={text}
      onInputChange={(_, v) => setText(v)}
      onBlur={() => commit(text)}
      onChange={(_, v) => commit(typeof v === "string" ? v : text)}
      size="small"
      sx={{ minWidth: 110 }}
      renderInput={(params) => (
        <TextField
          {...params}
          autoFocus
          variant="standard"
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(false);
          }}
          sx={{ "& input": { fontSize: 11.8, py: 0 } }}
        />
      )}
    />
  );
}
