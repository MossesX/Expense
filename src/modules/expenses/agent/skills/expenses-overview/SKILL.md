---
name: Expense Tracker — overview
description: What Expense Tracker is, the route it lives at, and the surfaces it publishes. Use for any question about what this module is for or where to find it.
---
# Expense Tracker

Receipt-shaped expense ledger ported from GizmoX: an editable grid with line items and reconciliation, a rollup tree, and automatic period statements — integer-cents math throughout, server-backed through the kv store.

## Where it is

- Route: `/expenses`
- Module id: `expenses` — contributions target it as `module:expenses`
- Glyph: `icon-book`

## What it publishes

- No extension points: nothing plugs into this module.

## Surfaces

- Context areas: `expenses.expense`, `expenses.node`, `expenses.surface`, `expenses.tab`, `expenses.tabstrip`
- Settings: 1 row(s) under `expenses-settings`
- Navigation: none declared
