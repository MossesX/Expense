---
name: Accounts — extension points
description: The points Accounts publishes and what a contribution to each must carry. Use for "how do I add to this module" and for diagnosing a contribution that renders nothing.
---
# What plugs into Accounts

A plugin contributes to one of these points; the module never imports the plugin. This is
also the closure rule the peel uses — a plugin is carried into this module's standalone
app exactly when it contributes to a point starting with `accounts.`.

## `accounts.admin-tab` — Admin suite tab

A pane another module contributes into this module's admin suite — a moderation queue, a quota console, a retention sweep. It exists so that a module growing an administrator-only surface adds a TAB here instead of a second admin console with its own nav entry and its own idea of what 'administrator' means. The contribution supplies an id, a title, an optional pack glyph and summary, and a `load` thunk that imports the pane; the suite's own administrator gate is the only gate it renders behind. A thunk rather than the component itself, so the entry stays importable by plain Node, which the closure resolver requires.

- Kind: ui-surface · cardinality: many
- Payload must carry: `id`, `title`, `load`
- Ordering: priority

A contribution missing a required field is refused at registration and the pane renders
the boundary, not the payload — check the registry report before assuming the component
is at fault.
