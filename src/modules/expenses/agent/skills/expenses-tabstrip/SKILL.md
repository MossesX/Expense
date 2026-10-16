---
name: Expense Tracker tab group
description: The operations available on expense tracker tab group in Expense Tracker: New report, Open report…, Save ledger…, Load ledger…, Reopen the standard views. Use when the user asks how to do one of these.
---
# Expense Tracker tab group

The tab strip itself, a floating tab's frame, and the empty state when nothing is open.

Right-clicking this area (`expenses.tabstrip`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| New report | `expenses.report.new` | — |
| Open report… | `expenses.report.open` | — |
| Save ledger… | `expenses.ledger.save` | — |
| Load ledger… | `expenses.ledger.load` | — |
| Reopen the standard views | `expenses.tabs.restore` | — |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
