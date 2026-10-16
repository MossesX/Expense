---
name: Accounts — overview
description: What Accounts is, the route it lives at, and the surfaces it publishes. Use for any question about what this module is for or where to find it.
---
# Accounts

The studio's user-account engine, and the platform's one identity system: account CRUD with roles, a profile engine (avatar, bio, custom fields, presence), the social graph — buddies, blocks and the single interaction guard every other surface asks — messaging generalised from DM pairs to N-member group chats with per-member unread and delivery over an SSE presence channel, the AI credit ledger, and the administrator-controlled permission matrix that decides which registered modules a signed-in user may open. Its admin suite hosts contributed tabs, the first being AmberX Vid's moderation wing.

## Where it is

- Route: `/accounts`
- Module id: `accounts` — contributions target it as `module:accounts`
- Glyph: `icon-account`

## What it publishes

- `accounts.admin-tab` — A pane another module contributes into this module's admin suite — a moderation queue, a quota console, a retention sweep. It exists so that a module growing an administrator-only surface adds a TAB here instead of a second admin console with its own nav entry and its own idea of what 'administrator' means. The contribution supplies an id, a title, an optional pack glyph and summary, and a `load` thunk that imports the pane; the suite's own administrator gate is the only gate it renders behind. A thunk rather than the component itself, so the entry stays importable by plain Node, which the closure resolver requires.

## Surfaces

- Context areas: `accounts.surface`, `accounts.suite`, `accounts.user-row`, `accounts.file-row`, `accounts.policy-row`, `accounts.card`, `accounts.token-row`
- Settings: 5 row(s) under `accounts-settings`
- Navigation: none declared
