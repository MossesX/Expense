"use client";

/**
 * @file Delete the selected transactions — after showing them.
 *
 * The old confirm was a `window.confirm` naming a count and a sum. A count is
 * not a list: the thing a person needs before an irreversible delete is to SEE
 * the rows, especially ones ticked three screens up (owner, 2026-10-16:
 * *"confirmation dialog that displays a grid with the marked transactions"*).
 * This is that grid. It reads the live selection, so a row unticked while
 * the dialog is open drops out of it.
 */

import * as React from "react";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";

import { token } from "@axf/core";

import { MONO } from "./bits";
import { deleteExpenses } from "./expenses.commands";
import { effectiveTotal, money } from "./math";
import { useExpenseSelection } from "./selection";
import { categoryOf, isIncome, type Expense } from "./types";

export default function DeleteSelectedDialog({
  open,
  expenses,
  onClose
}: {
  open: boolean;
  expenses: readonly Expense[];
  onClose: () => void;
}) {
  const selected = useExpenseSelection();
  const rows = React.useMemo(
    () => expenses.filter((e) => selected.has(e.id)).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    [expenses, selected]
  );
  const spent = rows.reduce((n, e) => n + (isIncome(e) ? 0 : effectiveTotal(e)), 0);
  const income = rows.reduce((n, e) => n + (isIncome(e) ? effectiveTotal(e) : 0), 0);

  const confirm = () => {
    deleteExpenses(rows.map((r) => r.id));
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontSize: 15, fontWeight: 700, pb: 1 }}>
        Delete {rows.length} selected transaction{rows.length === 1 ? "" : "s"}?
      </DialogTitle>
      <DialogContent dividers sx={{ display: "grid", gap: 1.2 }}>
        {rows.length === 0 ? (
          <Alert severity="info">Nothing is selected any more.</Alert>
        ) : (
          <>
            <Alert severity="warning" sx={{ py: 0 }}>
              There is no undo in this store. These rows are removed from the ledger the moment you confirm.
            </Alert>
            <Box sx={{ overflow: "auto", maxHeight: 420, border: `1px solid ${token("edge")}`, borderRadius: 1 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Date</TableCell>
                    <TableCell>Kind</TableCell>
                    <TableCell>Merchant</TableCell>
                    <TableCell>Category</TableCell>
                    <TableCell>Account</TableCell>
                    <TableCell align="right">Total</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((e) => (
                    <TableRow key={e.id} hover>
                      <TableCell sx={{ ...MONO, whiteSpace: "nowrap" }}>{e.date}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          variant="outlined"
                          label={isIncome(e) ? "income" : "expense"}
                          sx={{ height: 18, color: isIncome(e) ? token("ok") : undefined }}
                        />
                      </TableCell>
                      <TableCell>
                        {e.merchant}
                        {e.disputed && (
                          <Chip size="small" variant="outlined" label="disputed" sx={{ ml: 0.8, height: 18, color: token("warn") }} />
                        )}
                      </TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>{categoryOf(e.category).label}</TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>{e.paymentMethod ?? ""}</TableCell>
                      <TableCell align="right" sx={{ ...MONO, whiteSpace: "nowrap", color: isIncome(e) ? token("ok") : undefined }}>
                        {isIncome(e) ? "+" : ""}
                        {money(effectiveTotal(e))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
            <Typography sx={{ fontSize: 12, color: token("dim") }}>
              Removing <Box component="span" sx={{ ...MONO, color: token("ink") }}>{money(spent)}</Box> of spending
              {income > 0 && (
                <>
                  {" "}and <Box component="span" sx={{ ...MONO, color: token("ok") }}>+{money(income)}</Box> of income
                </>
              )}
              .
            </Typography>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onClose}>
          Cancel
        </Button>
        <Button size="small" variant="contained" color="error" disabled={!rows.length} onClick={confirm}>
          Delete {rows.length || ""}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
