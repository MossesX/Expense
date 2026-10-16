"use client";

/**
 * @file Actions › Dupe — possible duplicates inside the ledger, each pair
 * shown side by side with a three-way choice, scored by the algorithm in
 * `dupes.ts` and, on request, judged by Claude (owner, 2026-10-16: *"Dupe
 * that uses advanced algorithm and Claude ai subscription to find possible
 * duplicate transactions where not all fields match but price matches"*).
 *
 * Nothing is deleted until the one button at the bottom, and the default
 * choice is conservative: only a `likely` pair (or one Claude calls a
 * duplicate with confidence ≥ 0.7) pre-selects "delete the later one";
 * everything else starts at "keep both". The later entry is the default to
 * go because the earlier one is usually the original — the hand entry the
 * import doubled, the purchase date rather than the posting date.
 */

import * as React from "react";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Glyph, token } from "@axf/core";

import { Side } from "./ImageImportDialog";
import { findDuplicatePairs, toWire, type DupePair, type DupeTier, type DupeVerdict } from "./dupes";
import { deleteExpenses } from "./expenses.commands";
import { effectiveTotal } from "./math";
import { useExpensesSettings } from "./settings";
import { categoryOf, isIncome, type Expense } from "./types";

type Choice = "keep" | "a" | "b";

const TIER: Record<DupeTier, { label: string; color: "error" | "warning" | "default"; blurb: string }> = {
  likely: { label: "Likely", color: "error", blurb: "Same price, same or similar merchant, close dates — pre-set to delete the later one." },
  possible: { label: "Possible", color: "warning", blurb: "Same price and close dates with a partial merchant match — look, then decide." },
  weak: { label: "Same price only", color: "default", blurb: "Only the price and the dates line up. Usually two real purchases; ask Claude if unsure." }
};

const defaultChoice = (p: DupePair, v?: DupeVerdict): Choice => {
  if (v) {
    if (v.duplicate && v.confidence >= 0.7) return "b";
    if (!v.duplicate && v.confidence >= 0.6) return "keep";
  }
  return p.tier === "likely" ? "b" : "keep";
};

function SideOf({ e, title, tone }: { e: Expense; title: string; tone?: "accent" | "dim" }) {
  return <Side title={title} date={e.date} merchant={e.merchant} amount={effectiveTotal(e)} income={isIncome(e)} category={categoryOf(e.category).label} account={e.paymentMethod} tone={tone} />;
}

export default function DupeDialog({ open, expenses, onClose }: { open: boolean; expenses: readonly Expense[]; onClose: () => void }) {
  const prefs = useExpensesSettings();
  const [days, setDays] = React.useState(7);
  const [sameAccount, setSameAccount] = React.useState(false);
  const [includePayments, setIncludePayments] = React.useState(false);
  const [choices, setChoices] = React.useState<Map<number, Choice>>(new Map());
  const [verdicts, setVerdicts] = React.useState<Map<number, DupeVerdict>>(new Map());
  const [ai, setAi] = React.useState<{ state: "idle" | "running" | "done" | "error"; detail: string; source: string }>({ state: "idle", detail: "", source: "" });

  const pairs = React.useMemo(
    () => (open ? findDuplicatePairs(expenses, { days, sameAccountOnly: sameAccount, includePayments }) : []),
    [open, expenses, days, sameAccount, includePayments]
  );

  // A new scan (opened again, or the knobs moved) forgets the choices and
  // Claude's answers — both were about pairs that may no longer exist.
  React.useEffect(() => {
    setChoices(new Map());
    setVerdicts(new Map());
    setAi({ state: "idle", detail: "", source: "" });
  }, [open, days, sameAccount, includePayments]);

  const choiceOf = (p: DupePair): Choice => choices.get(p.index) ?? defaultChoice(p, verdicts.get(p.index));
  const setChoice = (index: number, c: Choice) => setChoices((m) => new Map(m).set(index, c));

  const toDelete = React.useMemo(() => {
    const ids = new Set<string>();
    for (const p of pairs) {
      const c = choiceOf(p);
      if (c === "a") ids.add(p.a.id);
      else if (c === "b") ids.add(p.b.id);
    }
    return ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairs, choices, verdicts]);

  const askClaude = async () => {
    if (!pairs.length) return;
    setAi({ state: "running", detail: "", source: "" });
    try {
      const res = await fetch("/api/expenses/dupes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairs: toWire(pairs), model: prefs.aiModel, mode: prefs.aiMode })
      });
      const body = (await res.json()) as { error?: string; verdicts?: DupeVerdict[]; source?: string };
      if (!res.ok || !body.verdicts) throw new Error(body.error ?? `HTTP ${res.status}`);
      const map = new Map<number, DupeVerdict>();
      for (const v of body.verdicts) if (pairs.some((p) => p.index === v.index)) map.set(v.index, v);
      setVerdicts(map);
      setChoices(new Map()); // Claude's answer resets the defaults; the person's clicks after it stand.
      const dup = [...map.values()].filter((v) => v.duplicate).length;
      setAi({ state: "done", detail: `Claude judged ${map.size} pair${map.size === 1 ? "" : "s"}: ${dup} duplicate${dup === 1 ? "" : "s"}`, source: body.source ?? "" });
    } catch (e) {
      setAi({ state: "error", detail: e instanceof Error ? e.message : String(e), source: "" });
    }
  };

  const commit = () => {
    const gone = deleteExpenses([...toDelete]);
    if (gone) onClose();
  };

  const tiers: DupeTier[] = ["likely", "possible", "weak"];
  const count = (t: DupeTier) => pairs.filter((p) => p.tier === t).length;

  return (
    <Dialog open={open} onClose={ai.state === "running" ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontSize: 15, fontWeight: 700, pb: 1, display: "flex", alignItems: "center", gap: 1 }}>
        <Glyph id="icon-search" size={16} />
        Possible duplicates
        <Chip size="small" variant="outlined" label={`${pairs.length} pair${pairs.length === 1 ? "" : "s"}`} sx={{ ml: 0.5 }} />
      </DialogTitle>
      <DialogContent dividers data-axf-dupes sx={{ display: "grid", gap: 1.4 }}>
        <Typography sx={{ fontSize: 12, color: token("dim") }}>
          Entries with the <b>same price</b> and the same kind within a few days of each other, scored by how alike the rest is.
          Ask Claude to read the pairs and say which are one transaction recorded twice — it knows a bank&apos;s abbreviation from a second purchase.
          Nothing is deleted until the button at the bottom.
        </Typography>

        <Stack direction="row" spacing={1.2} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
          <TextField
            size="small"
            type="number"
            label="Days apart (max)"
            value={days}
            onChange={(e) => setDays(Math.max(0, Math.min(60, Number(e.target.value) || 0)))}
            slotProps={{ htmlInput: { min: 0, max: 60, "data-axf-dupes-days": "" } }}
            sx={{ width: 150 }}
          />
          <FormControlLabel control={<Switch size="small" checked={sameAccount} onChange={(_, v) => setSameAccount(v)} />} label={<Typography sx={{ fontSize: 12.5 }}>Same account only</Typography>} />
          <FormControlLabel control={<Switch size="small" checked={includePayments} onChange={(_, v) => setIncludePayments(v)} />} label={<Typography sx={{ fontSize: 12.5 }}>Include card payments</Typography>} />
          <Box sx={{ flex: 1 }} />
          {tiers.map((t) => count(t) > 0 && <Chip key={t} size="small" color={TIER[t].color} variant="outlined" label={`${count(t)} ${TIER[t].label.toLowerCase()}`} />)}
          <Tooltip title={`Send the ${pairs.length} pairs (dates, merchants, amounts — never the whole ledger) to ${prefs.aiModel} on your Claude connection.`}>
            <span>
              <Button size="small" variant="contained" startIcon={ai.state === "running" ? <CircularProgress size={14} color="inherit" /> : <Glyph id="icon-sparkle" size={14} />} disabled={!pairs.length || ai.state === "running"} onClick={() => void askClaude()} data-axf-dupes-ask>
                {ai.state === "running" ? "Asking Claude…" : ai.state === "done" ? "Ask Claude again" : "Ask Claude"}
              </Button>
            </span>
          </Tooltip>
        </Stack>

        {ai.state === "error" && <Alert severity="error" sx={{ py: 0, fontSize: 12 }}>{ai.detail}</Alert>}
        {ai.state === "done" && (
          <Alert severity="success" sx={{ py: 0, fontSize: 12 }}>
            {ai.detail}{ai.source ? ` · via ${ai.source === "subscription" ? "your Claude subscription" : "the API key"}` : ""}. Its calls set the defaults below; your own clicks override them.
          </Alert>
        )}

        {!pairs.length && (
          <Alert severity="info">No two entries share a price within {days} day{days === 1 ? "" : "s"} of each other{sameAccount ? " on the same account" : ""}. Widen the window to look further apart.</Alert>
        )}

        {tiers.map((t) => {
          const rows = pairs.filter((p) => p.tier === t);
          if (!rows.length) return null;
          return (
            <Box key={t}>
              <Typography sx={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: t === "likely" ? token("err") : t === "possible" ? token("warn") : token("dim"), mb: 0.2 }}>
                {TIER[t].label} · {rows.length}
              </Typography>
              <Typography sx={{ fontSize: 11.5, color: token("dim"), mb: 0.8 }}>{TIER[t].blurb}</Typography>
              <Stack spacing={1}>
                {rows.map((p) => {
                  const v = verdicts.get(p.index);
                  const c = choiceOf(p);
                  return (
                    <Box key={p.index} data-axf-dupe-pair={p.index} data-axf-dupe-choice={c} sx={{ display: "grid", gap: 0.6, p: 1, border: `1px solid ${token(c === "keep" ? "edge" : "err")}`, borderRadius: 1, opacity: c === "keep" ? 1 : 0.95 }}>
                      <Box sx={{ display: "flex", gap: 1, alignItems: "stretch", flexWrap: "wrap" }}>
                        <Box sx={{ flex: 1, minWidth: 180, display: "grid", gap: 0.4, opacity: c === "a" ? 0.5 : 1 }}>
                          <SideOf e={p.a} title={`Earlier${c === "a" ? " · will be deleted" : ""}`} tone={c === "a" ? "dim" : "accent"} />
                        </Box>
                        <Typography sx={{ fontSize: 18, color: token("dim"), alignSelf: "center" }}>≈</Typography>
                        <Box sx={{ flex: 1, minWidth: 180, display: "grid", gap: 0.4, opacity: c === "b" ? 0.5 : 1 }}>
                          <SideOf e={p.b} title={`Later${c === "b" ? " · will be deleted" : ""}`} tone={c === "b" ? "dim" : "accent"} />
                        </Box>
                        <Box sx={{ minWidth: 200, display: "grid", gap: 0.5, alignContent: "start" }}>
                          <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
                            <Chip size="small" color={TIER[p.tier].color} variant="outlined" label={`score ${Math.round(p.score * 100)}`} sx={{ height: 18, fontSize: 10.5 }} />
                            {v && (
                              <Chip size="small" color={v.duplicate ? "error" : "success"} label={`Claude: ${v.duplicate ? "duplicate" : "not a duplicate"} · ${Math.round(v.confidence * 100)}%`} sx={{ height: 18, fontSize: 10.5 }} />
                            )}
                          </Stack>
                          <Typography sx={{ fontSize: 11, color: token("dim") }}>{p.why.join(" · ")}</Typography>
                          {v && <Typography sx={{ fontSize: 11.5 }}>{v.reason}</Typography>}
                          <ToggleButtonGroup size="small" exclusive value={c} onChange={(_, val: Choice | null) => val && setChoice(p.index, val)} sx={{ "& .MuiToggleButton-root": { py: 0.2, px: 0.9, fontSize: 11, textTransform: "none" } }}>
                            <ToggleButton value="keep">Keep both</ToggleButton>
                            <ToggleButton value="a" color="error">Delete earlier</ToggleButton>
                            <ToggleButton value="b" color="error">Delete later</ToggleButton>
                          </ToggleButtonGroup>
                        </Box>
                      </Box>
                    </Box>
                  );
                })}
              </Stack>
            </Box>
          );
        })}
      </DialogContent>
      <DialogActions>
        <Typography sx={{ fontSize: 12, color: token("dim"), mr: "auto", ml: 1 }}>
          {toDelete.size ? `${toDelete.size} entr${toDelete.size === 1 ? "y" : "ies"} marked for deletion` : "Nothing marked — every pair is kept"}
        </Typography>
        <Button size="small" onClick={onClose} disabled={ai.state === "running"}>Cancel</Button>
        <Button size="small" variant="contained" color="error" disabled={!toDelete.size || ai.state === "running"} onClick={commit} data-axf-dupes-delete>
          Delete {toDelete.size || ""} duplicate{toDelete.size === 1 ? "" : "s"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
