---
name: Expense Tracker tab
description: The operations available on expense tracker tab in Expense Tracker: Float as a window, Dock back into the strip, Close tab, Close other tabs. Use when the user asks how to do one of these.
---
# Expense Tracker tab

One tab in the tab group — a view or an open report, docked in the strip or floating.

Right-clicking this area (`expenses.tab`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| Float as a window | `expenses.tab.float` | — |
| Dock back into the strip | `expenses.tab.dock` | — |
| Close tab | `expenses.tab.close` | destructive |
| Close other tabs | `expenses.tab.close-others` | — |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
