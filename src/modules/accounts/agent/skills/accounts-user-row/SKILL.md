---
name: Accounts — Member
description: The operations available on member in Accounts: Open in admin suite, View files, View storage, Message user, Copy user id. Use when the user asks how to do one of these.
---
# Member

A member: a row in the admin roster, in the member directory, or in the messenger's thread list. Marked with the username, which is what every row here acts on.

Right-clicking this area (`accounts.user-row`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| Open in admin suite | `accounts.user.open-suite` | enabled when `accounts.isAdministrator` |
| View files | `accounts.user.view-files` | enabled when `accounts.isAdministrator` |
| View storage | `accounts.user.view-storage` | enabled when `accounts.isAdministrator` |
| Message user | `accounts.user.message` | enabled when `accounts.canMessage` |
| Copy user id | `accounts.user.copy-id` | — |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
