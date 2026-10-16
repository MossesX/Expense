---
name: Expense Tracker — settings
description: Every setting Expense Tracker persists: Confirm deletes. Use when asked what a setting does, where it is, or what it defaults to.
---
# Expense Tracker settings

Stored under the kv namespace `expenses-settings`. The user reaches them through the
gear on the module header, or the "Module settings" row on any right-click.

| Setting | Key | Kind | Default | What it does |
| --- | --- | --- | --- | --- |
| Confirm deletes | `confirmDelete` | switch | `true` | Ask before deleting an expense. There is no undo in this store. |

Quote the hint when the user asks what a row means — it is the text they can see beside
it, so an answer that agrees with it is an answer they can check.
