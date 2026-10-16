---
name: Accounts — Theme token
description: The operations available on theme token in Accounts: Locate on page, Copy value, Revert this token. Use when the user asks how to do one of these.
---
# Theme token

One dial's row in the Theme Manager settings section. Declared here with the rest of P10's map; its commands live beside the token index that answers them (`plugins/theme-manager/theme-manager.commands.ts`).

Right-clicking this area (`accounts.token-row`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| Locate on page | `theme-manager.token.locate` | — |
| Copy value | `theme-manager.token.copy-value` | — |
| Revert this token | `theme-manager.token.revert` | enabled when `theme-manager.token.edited` |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
