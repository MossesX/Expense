---
name: Expense Tracker surface
description: The operations available on expense tracker surface in Expense Tracker: Add expense, Add income, Paydays…, View › (hide or show grid columns), Actions › Dupe (find possible duplicates), Ask the assistant…, Settings…. Use when the user asks how to do one of these.
---
# Expense Tracker surface

Anywhere on the screen, including empty space.

Right-clicking this area (`expenses.surface`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| Add expense | `expenses.add` | — |
| Add income | `expenses.income.add` | — |
| Paydays… | `expenses.payday.open` | — |
| View › \<column\> | `expenses.col.toggle-<column>` | A submenu with one toggle per hideable grid column (kind, category, account, lines, subtotal, tax, tip, printed, delta, total, balance, source, notes), drawn shown / hidden; "Show all columns" (`expenses.col.show-all`) resets. The header’s View button lists the same. |
| Actions › Dupe — find possible duplicates… | `expenses.actions.dupes` | Pairs of entries with the same price within a few days, scored by merchant similarity, date gap, account and source; "Ask Claude" judges each pair on the Claude connection; each pair is shown side by side with Keep both / Delete earlier / Delete later before anything is removed. |
| Ask the assistant… | `expenses.assistant.ask` | Opens the assistant drawer, prefilled with the selection. |
| Settings… | `expenses.settings.open` | — |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
