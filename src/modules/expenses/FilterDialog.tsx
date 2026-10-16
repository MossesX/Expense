"use client";

/**
 * @file The advanced filter — the header field's text, plus WHICH columns it
 * searches and whether every word must match.
 *
 * Opens pre-filled with whatever the header field holds, so it is a
 * refinement of the search in progress rather than a second search. The
 * column switches start with none on, which means every column (see
 * `filter.ts`); switching some on narrows the search to those. The columns and
 * the match mode persist as settings — they are how this person searches — and
 * the text does not, because a search is a moment.
 */

import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { token } from "@axf/core";

import { FILTER_COLUMNS, parseColumns, serializeColumns, type FilterColumn } from "./filter";
import { expensesSettings, useExpensesSettings } from "./settings";
import { expenseUi, useExpensesUi } from "./ui";

export default function FilterDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ui = useExpensesUi();
  const saved = useExpensesSettings();
  const [text, setText] = React.useState("");
  const [columns, setColumns] = React.useState<Set<FilterColumn>>(new Set());
  const [matchAll, setMatchAll] = React.useState(true);

  React.useEffect(() => {
    if (!open) return;
    setText(ui.filterText);
    setColumns(new Set(parseColumns(saved.filterColumns)));
    setMatchAll(saved.filterMatchAll);
    // Seeded on OPEN only — the field is then the draft, not a mirror.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (id: FilterColumn) =>
    setColumns((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const apply = () => {
    const ordered = FILTER_COLUMNS.map((c) => c.id).filter((id) => columns.has(id));
    expensesSettings.set("filterColumns", serializeColumns(ordered));
    expensesSettings.set("filterMatchAll", matchAll);
    expenseUi.setFilterText(text);
    onClose();
  };

  const clear = () => {
    expenseUi.setFilterText("");
    onClose();
  };

  const chosen = FILTER_COLUMNS.filter((c) => columns.has(c.id)).map((c) => c.label);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: 15, fontWeight: 700, pb: 1 }}>Advanced filter</DialogTitle>
      <DialogContent dividers sx={{ display: "grid", gap: 1.4 }}>
        <TextField
          autoFocus
          size="small"
          label="Filter"
          placeholder="walmart 2026-09"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") apply();
          }}
          helperText={
            chosen.length ? `Searching ${chosen.join(", ")}` : "Searching every column — switch some on below to narrow it"
          }
        />

        <Box>
          <Typography sx={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: token("dim"), mb: 0.5 }}>
            Columns
          </Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: "0 12px" }}>
            {FILTER_COLUMNS.map((c) => (
              <FormControlLabel
                key={c.id}
                control={<Switch size="small" checked={columns.has(c.id)} onChange={() => toggle(c.id)} />}
                label={
                  <Box>
                    <Typography sx={{ fontSize: 12.5 }}>{c.label}</Typography>
                    <Typography sx={{ fontSize: 11, color: token("dim") }}>{c.hint}</Typography>
                  </Box>
                }
                sx={{ alignItems: "flex-start", my: 0.4, mr: 0 }}
              />
            ))}
          </Box>
        </Box>

        <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
          <FormControlLabel
            control={<Switch size="small" checked={matchAll} onChange={(e) => setMatchAll(e.target.checked)} />}
            label={<Typography sx={{ fontSize: 12.5 }}>Every word must match</Typography>}
          />
          <Typography sx={{ fontSize: 11, color: token("dim") }}>
            {matchAll ? "“walmart sep” needs both" : "“walmart target” finds either"}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={clear} disabled={!ui.filterText && !text}>
          Clear filter
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={onClose}>
          Cancel
        </Button>
        <Button size="small" variant="contained" onClick={apply}>
          Apply
        </Button>
      </DialogActions>
    </Dialog>
  );
}
