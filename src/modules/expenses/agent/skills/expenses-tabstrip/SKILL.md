---
name: Expense Tracker tab group
description: The operations available on expense tracker tab group in Expense Tracker: New report, Open report…, Save ledger…, Load ledger…, Import transactions…, Scan statement images…, Ask the assistant…, Advanced filter…, Settings…, Reopen the standard views. Use when the user asks how to do one of these.
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
| Scan statement images… | `expenses.ledger.scan-image` | Pick the account, choose one or more photos or screenshots (up to 12); Claude reads each, the lines are joined, and duplicates — against the ledger or between overlapping images — are shown as pairs with a keep-both switch. |
| Ask the assistant… | `expenses.assistant.ask` | Opens the assistant drawer with the current selection as context. Chat reads the source; Edit source and Build modes change a workspace copy. |
| Advanced filter… | `expenses.filter.advanced` | The header filter field's text plus switches for which columns it searches. |
| Settings… | `expenses.settings.open` | The tabbed settings dialog — General, Grid & filter, Paydays, Welcome, Import, Theme. |
| Import transactions… | `expenses.ledger.import` | Paste a bank list or choose a CSV export; duplicates against the ledger are detected several ways and left unticked. |
| Reopen the standard views | `expenses.tabs.restore` | — |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
