---
name: Accounts — File or folder
description: The operations available on file or folder in Accounts: Preview, Download, Copy path. Use when the user asks how to do one of these.
---
# File or folder

A node in the Files tab's tree — a member's data root, a directory inside it, or a file. Every read underneath is the audited route, exactly as the tab's own controls are.

Right-clicking this area (`accounts.file-row`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| Preview | `accounts.file.preview` | enabled when `accounts.fileTarget` |
| Download | `accounts.file.download` | enabled when `accounts.fileTarget` |
| Copy path | `accounts.file.copy-path` | — |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
