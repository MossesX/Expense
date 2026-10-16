---
name: Expense Tracker surface
description: The operations available on expense tracker surface in Expense Tracker: Add expense. Use when the user asks how to do one of these.
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

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
