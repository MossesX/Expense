---
name: Expense Tracker — Rollup node
description: The operations available on rollup node in Expense Tracker: Copy this subtotal. Use when the user asks how to do one of these.
---
# Rollup node

A group row in the tree — a year, month or category subtotal.

Right-clicking this area (`expenses.node`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| Copy this subtotal | `expenses.node.copy-subtotal` | — |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
