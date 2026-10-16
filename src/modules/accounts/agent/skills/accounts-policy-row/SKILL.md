---
name: Accounts — Policy row
description: The operations available on policy row in Accounts: Pin override, Follow default, Copy effective value. Use when the user asks how to do one of these.
---
# Policy row

One field of the policy cascade in the editor — pinned here, or following the tier above.

Right-clicking this area (`accounts.policy-row`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| Pin override | `accounts.policy.pin` | enabled when `accounts.policyUnpinned` |
| Follow default | `accounts.policy.unpin` | enabled when `accounts.policyPinned` |
| Copy effective value | `accounts.policy.copy-value` | — |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
