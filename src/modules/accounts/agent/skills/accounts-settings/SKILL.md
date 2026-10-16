---
name: Accounts — settings
description: Every setting Accounts persists: Message poll interval, Show offline members, Dense tables, Floatable panes & toolbars (IDE style), Edit UI. Use when asked what a setting does, where it is, or what it defaults to.
---
# Accounts settings

Stored under the kv namespace `accounts-settings`. The user reaches them through the
gear on the module header, or the "Module settings" row on any right-click.

| Setting | Key | Kind | Default | What it does |
| --- | --- | --- | --- | --- |
| Message poll interval | `messagePollSeconds` | number | `5` | Seconds between thread refreshes while the SSE presence stream is down. The stream is the primary channel; without this fallback cadence a tab that lost it never sees another message. |
| Show offline members | `showOfflineMembers` | switch | `true` | Off, the roster lists only members with a live presence connection — the only way a large directory stays usable when most of it is signed out. |
| Dense tables | `denseTables` | switch | `false` | Tight row height in the member directory and the admin tables, so an operator can see a whole roster or permission matrix without scrolling. |
| Floatable panes & toolbars (IDE style) | `floatablePanes` | switch | `false` | On, module panes and toolbars can be dragged out, floated, snap-mounted to an edge and flipped between horizontal and vertical, and where you put them is remembered for you. Off is the static studio, exactly — the switch gates a whole interaction mode, so there is no arrangement to keep and nothing to drag. |
| Edit UI | `editUi` | switch | `false` | On, the app's chrome grows drag handles: the command bar and module toolbars can be moved, docked to any edge and reset from where they sit. Arranging is what this gates — an arrangement already made stays on screen for whoever made it with this off, which is why it is a mode and not a preference. |

Quote the hint when the user asks what a row means — it is the text they can see beside
it, so an answer that agrees with it is an answer they can check.
