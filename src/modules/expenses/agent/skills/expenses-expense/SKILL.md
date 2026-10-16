---
name: Expense Tracker — Expense
description: The operations available on expense in Expense Tracker: Accept printed total (adjust tax), Trust the lines (clear printed total), Mark / unmark reimbursable, Not my charge (toggle), Copy as a line, Delete expense. Use when the user asks how to do one of these.
---
# Expense

One expense — a grid row, a tree leaf, or a statement line.

Right-clicking this area (`expenses.expense`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| Accept printed total (adjust tax) | `expenses.expense.reconcile-accept` | — |
| Trust the lines (clear printed total) | `expenses.expense.trust-lines` | — |
| Mark / unmark reimbursable | `expenses.expense.toggle-reimbursable` | — |
| Not my charge (toggle) | `expenses.expense.toggle-disputed` | — |
| Copy as a line | `expenses.expense.copy-line` | — |
| Delete expense | `expenses.expense.delete` | destructive |
| Delete selected expenses | `expenses.expense.delete-selected` | destructive; enabled when `expenses.selection` |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
