---
name: Accounts — Admin suite
description: The operations available on admin suite in Accounts: Refresh, Reset layout, App settings. Use when the user asks how to do one of these.
---
# Admin suite

The administrator's tab strip — Dashboard, Users, Files, Policies, Storage, Audit, Matrix, and whatever another module contributed. Everything below is nested inside it.

Right-clicking this area (`accounts.suite`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| Refresh | `accounts.suite.refresh` | — |
| Reset layout | `accounts.layout.reset` | — |
| App settings | `accounts.session.settings` | — |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
