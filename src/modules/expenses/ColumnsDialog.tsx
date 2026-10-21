"use client";

/**
 * @file View › Columns — every hideable grid column with a checkbox (owner,
 * 2026-10-21: *"make view in context menu open popup dialog listing all
 * columns with checkmarks, hide/show toggle instantly when checkbox
 * changes"*).
 *
 * Each tick writes the `hiddenColumns` setting straight away, so the grid
 * behind the dialog updates as you click; there is no Apply. Date and
 * Merchant are listed ticked and disabled — they cannot be hidden
 * (`columns.ts`), and listing them still shows the whole set of columns.
 */

import * as React from "react";

import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";

import { GRID_COLUMNS, hiddenSet, setColumnShown, showAllColumns } from "./columns";
import { useExpensesSettings } from "./settings";

const FIXED = [
  { id: "date", label: "Date" },
  { id: "merchant", label: "Merchant" }
] as const;

export default function ColumnsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const prefs = useExpensesSettings();
  const hidden = React.useMemo(() => hiddenSet(prefs.hiddenColumns), [prefs.hiddenColumns]);
  const label = { "& .MuiFormControlLabel-label": { fontSize: 13 } } as const;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth data-axf-expenses-columns-dialog="">
      <DialogTitle sx={{ fontSize: 15, pb: 0.5 }}>Columns</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", py: 0.5 }}>
        {FIXED.map((c) => (
          <FormControlLabel
            key={c.id}
            control={<Checkbox size="small" checked disabled sx={{ py: 0.4 }} />}
            label={`${c.label} (always shown)`}
            sx={label}
          />
        ))}
        {GRID_COLUMNS.map((c) => (
          <FormControlLabel
            key={c.id}
            control={
              <Checkbox
                size="small"
                checked={!hidden.has(c.id)}
                onChange={(_, checked) => setColumnShown(c.id, checked)}
                sx={{ py: 0.4 }}
              />
            }
            label={c.label}
            sx={label}
          />
        ))}
      </DialogContent>
      <DialogActions>
        <Button size="small" disabled={!hidden.size} onClick={() => showAllColumns()}>
          Show all
        </Button>
        <Button size="small" variant="contained" onClick={onClose}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}
