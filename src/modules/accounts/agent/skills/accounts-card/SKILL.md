---
name: Accounts — Dashboard card
description: The operations available on dashboard card in Accounts: Configure card…, Flip orientation, Reset this card, Reset layout. Use when the user asks how to do one of these.
---
# Dashboard card

One gauge on the admin dashboard's card canvas.

Right-clicking this area (`accounts.card`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| Configure card… | `accounts.card.configure` | — |
| Flip orientation | `accounts.card.flip` | — |
| Reset this card | `accounts.card.reset` | — |
| Reset layout | `accounts.layout.reset` | — |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
