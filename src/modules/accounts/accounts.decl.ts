/**
 * @file Accounts' DECLARATION — data only, importable by plain Node.
 *
 * Same hard rule as every other decl: **nothing but `import type`**. The
 * closure resolver (`scripts/lib/closure.mjs`), the suite gate and
 * `test/ctx-conformance.test.ts` all import this file under native type
 * stripping, so a runtime import here breaks three gates at once.
 *
 * The module is the studio's user-account engine AND the platform's one
 * identity system: account CRUD with roles, the profile engine (avatar, bio,
 * custom fields, presence), the social graph (buddies, blocks and the single
 * interaction guard every surface asks instead of keeping its own idea of who
 * may talk to whom), messaging generalised from DM pairs to N-member group
 * chats with per-member unread and delivery, the AI credit ledger, and the
 * administrator-controlled permission matrix that decides which registered
 * modules a signed-in user may open. Slot 11/12.
 *
 * The summary below is what the shipped agent (`agent/`, `npm run agent
 * accounts`) is DERIVED from, so it is not decoration: a summary that still
 * describes the pre-platform module ships an assistant that denies features the
 * module has.
 *
 * ── the map: seven areas, and what a right-click may NOT do ───────────────────
 *
 * **This is a WIDENING of the one-row decision, not a reversal of it** (P10,
 * 2026-08-15). What that decision said, and what still holds word for word:
 *
 * > every destructive action here — delete an account, revoke a module, issue a
 * > temp password, remove somebody's stored data — is an ADMIN operation that
 * > must go through the confirm-bearing surface in `AdminUserDetail` /
 * > `PermissionMatrix` / `RemoveDataDialog`, where the operator can see what
 * > they are about to do. A right-click row that revokes a module is a
 * > permission change made by accident, and the whole point of the matrix is
 * > that permission changes are deliberate.
 *
 * Not one row below deletes, revokes, issues or removes anything. **The map
 * NAVIGATES, OPENS, COPIES and LOCATES** — a right-click may summon the
 * deliberate surface, never substitute for it. That is the doctrine, and it is
 * what makes seven areas safe where seven areas of verbs would not be.
 *
 * What the original decision got wrong was only its conclusion about COVERAGE.
 * It reasoned that because the dangerous verbs must stay behind their surfaces,
 * the module should carry no `<id>.commands.ts` at all — and the suite that grew
 * around it since (a users table, a file browser, a policy cascade, a card
 * canvas, a theme section) is precisely the case where a reader has no idea
 * which of six tabs holds the thing they are looking at. That is the
 * inconsistent-coverage failure the area walk exists to have ended, arrived at
 * from the other side: not forty hand-written handlers, but one surface that
 * declined to have any.
 *
 * Two rows do write, and they are named here rather than buried: *Pin override*
 * and *Follow default* on `accounts.policy-row`. They are the policy editor's
 * own two gestures, each undone by the other, performed by the editor with no
 * confirm of its own, and fired through the editor rather than around it — so
 * the screen shows what happened. See `accounts.commands.ts`.
 *
 * **Nesting and the cap.** The deepest real chain is
 * `accounts.surface` → `accounts.suite` → a tab's row area, which is three, and
 * `accounts.card` / `accounts.policy-row` sit one deeper inside their tab —
 * four, exactly `MAX_CONTRIBUTING_AREAS`. The walk contributes the four
 * INNERMOST declared areas, so on the very deepest clicks `accounts.surface`
 * stays in the path and adds no rows. That costs nothing worth keeping: its one
 * row is a copy, and core's floor and universal band both carry a copy already.
 * Adding an eighth area nested inside these would start costing something real.
 *
 * ── one point: the admin suite is composable ─────────────────────────────────
 *
 * `accounts.admin-tab` (2026-08-15) is how another module puts an
 * administrator-only pane INSIDE this suite instead of building a second admin
 * console beside it. The host side is `adminTabs.ts` + `AdminSurface.tsx`; this
 * module imports no contributor, so "what plugs in here" stays a question the
 * registry answers. Its first contributor is AmberX Vid's moderation wing.
 *
 * ── settings: five rows, and what was refused ─────────────────────────────────
 *
 * The minimal-sui ceiling stands (owner, 2026-08-11): a setting earns its place
 * only when the surface cannot work properly without it. The reasoning, and the
 * candidates named and rejected, live in `settings.ts` beside the typed
 * adapter that reads these rows — this file declares them, that file explains
 * them, and `messagePollSeconds` is read by the store's own poll loop.
 *
 * The last two (P8, 2026-08-15) each gate an INTERACTION MODE rather than tune
 * an existing one, which is how they clear a ceiling three tuning knobs had to
 * argue their way past: with `floatablePanes` off there is no drag to configure
 * and no arrangement to keep, and `editUi` is the difference between chrome you
 * can move and chrome you cannot. `editUi` carries a `gate` — core's 0.0.23
 * seam for "this row is not everybody's" — because rearranging the app's chrome
 * is an administrator's job.
 */
import type { ModuleDecl } from "@axf/core";

export const ACCOUNTS_DECL: ModuleDecl = {
  id: "accounts",
  title: "Accounts",
  summary:
    "The studio's user-account engine, and the platform's one identity system: account CRUD with " +
    "roles, a profile engine (avatar, bio, custom fields, presence), the social graph — buddies, " +
    "blocks and the single interaction guard every other surface asks — messaging generalised " +
    "from DM pairs to N-member group chats with per-member unread and delivery over an SSE " +
    "presence channel, the AI credit ledger, and the administrator-controlled permission matrix " +
    "that decides which registered modules a signed-in user may open. Its admin suite hosts " +
    "contributed tabs, the first being AmberX Vid's moderation wing.",
  route: "/accounts",
  glyph: "icon-account",
  menus: {
    areas: [
      {
        id: "accounts.surface",
        title: "Accounts",
        description: "Anywhere on the accounts module — its own right-click surface."
      },
      {
        id: "accounts.suite",
        title: "Admin suite",
        description:
          "The administrator's tab strip — Dashboard, Users, Files, Policies, Storage, Audit, " +
          "Matrix, and whatever another module contributed. Everything below is nested inside it."
      },
      {
        id: "accounts.user-row",
        title: "Member",
        description:
          "A member: a row in the admin roster, in the member directory, or in the messenger's " +
          "thread list. Marked with the username, which is what every row here acts on."
      },
      {
        id: "accounts.file-row",
        title: "File or folder",
        description:
          "A node in the Files tab's tree — a member's data root, a directory inside it, or a " +
          "file. Every read underneath is the audited route, exactly as the tab's own controls are."
      },
      {
        id: "accounts.policy-row",
        title: "Policy row",
        description:
          "One field of the policy cascade in the editor — pinned here, or following the tier " +
          "above."
      },
      {
        id: "accounts.card",
        title: "Dashboard card",
        description: "One gauge on the admin dashboard's card canvas."
      },
      {
        id: "accounts.token-row",
        title: "Theme token",
        description:
          "One dial's row in the Theme Manager settings section. Declared here with the rest of " +
          "P10's map; its commands live beside the token index that answers them " +
          "(`plugins/theme-manager/theme-manager.commands.ts`)."
      }
    ],
    items: {
      "accounts.surface": [
        {
          id: "copy-selection",
          label: "Copy from Accounts",
          command: "ctx.copy",
          order: 10
        }
      ],
      /**
       * The suite itself. *Reset layout* is the same command the card area
       * offers, deliberately: a person whose cards are somewhere they cannot
       * find is the case this row exists for, and requiring them to right-click
       * a card to reach it would be requiring them to find one.
       */
      "accounts.suite": [
        { id: "refresh", label: "Refresh", command: "accounts.suite.refresh", order: 10 },
        { id: "reset-layout", label: "Reset layout", command: "accounts.layout.reset", order: 20 },
        { id: "sep", label: "", role: "separator", order: 30 },
        /**
         * "App settings", not "Settings". The universal band one band below
         * already carries *Module settings*, and two rows called Settings a
         * finger apart is an ambiguity worth spending two words on — this one
         * is the branding pack, the theme manager and the rest of `/settings`.
         */
        {
          id: "settings",
          label: "App settings",
          command: "accounts.session.settings",
          order: 40
        }
      ],
      /**
       * A member. The three admin destinations are gated on the role rather
       * than hidden by it — greyed, with the reason readable, per the
       * predicates' own docblock. The gate that DECIDES is the route, which
       * re-reads the role from disk on every request.
       */
      "accounts.user-row": [
        {
          id: "open-suite",
          label: "Open in admin suite",
          command: "accounts.user.open-suite",
          enabledWhen: "accounts.isAdministrator",
          order: 10
        },
        {
          id: "view-files",
          label: "View files",
          command: "accounts.user.view-files",
          enabledWhen: "accounts.isAdministrator",
          order: 20
        },
        {
          id: "view-storage",
          label: "View storage",
          command: "accounts.user.view-storage",
          enabledWhen: "accounts.isAdministrator",
          order: 30
        },
        { id: "sep", label: "", role: "separator", order: 40 },
        {
          id: "message",
          label: "Message user",
          command: "accounts.user.message",
          enabledWhen: "accounts.canMessage",
          order: 50
        },
        { id: "copy-id", label: "Copy user id", command: "accounts.user.copy-id", order: 60 }
      ],
      /**
       * A file. *Preview* and *Download* are file-only and say so on a folder
       * rather than vanishing; *Copy path* applies to both, which is why it sits
       * below the separator with no predicate at all.
       */
      "accounts.file-row": [
        {
          id: "preview",
          label: "Preview",
          command: "accounts.file.preview",
          enabledWhen: "accounts.fileTarget",
          order: 10
        },
        {
          id: "download",
          label: "Download",
          command: "accounts.file.download",
          enabledWhen: "accounts.fileTarget",
          order: 20
        },
        { id: "sep", label: "", role: "separator", order: 30 },
        { id: "copy-path", label: "Copy path", command: "accounts.file.copy-path", order: 40 }
      ],
      /**
       * The two write rows in the whole map, and the only ones — see the
       * docblock. They are each other's inverse, so exactly one of them is ever
       * live and the other says why it is not.
       */
      "accounts.policy-row": [
        {
          id: "pin",
          label: "Pin override",
          command: "accounts.policy.pin",
          enabledWhen: "accounts.policyUnpinned",
          order: 10
        },
        {
          id: "follow",
          label: "Follow default",
          command: "accounts.policy.unpin",
          enabledWhen: "accounts.policyPinned",
          order: 20
        },
        { id: "sep", label: "", role: "separator", order: 30 },
        {
          id: "copy-value",
          label: "Copy effective value",
          command: "accounts.policy.copy-value",
          order: 40
        }
      ],
      /**
       * A card. Neither reset is marked destructive: an arrangement is not
       * content, both are one gesture from being redone by hand, and painting
       * them red would spend the danger colour on the one thing here that
       * genuinely cannot lose anything.
       */
      "accounts.card": [
        {
          id: "configure",
          label: "Configure card…",
          command: "accounts.card.configure",
          order: 10
        },
        { id: "flip", label: "Flip orientation", command: "accounts.card.flip", order: 20 },
        { id: "sep", label: "", role: "separator", order: 30 },
        { id: "reset-card", label: "Reset this card", command: "accounts.card.reset", order: 40 },
        { id: "reset-layout", label: "Reset layout", command: "accounts.layout.reset", order: 50 }
      ],
      /**
       * A theme token. *Revert this token* is greyed on a row nobody has hand
       * edited, with the reason — which is also the fastest way to tell a colour
       * you chose from one the roll gave you.
       */
      "accounts.token-row": [
        {
          id: "locate",
          label: "Locate on page",
          command: "theme-manager.token.locate",
          order: 10
        },
        {
          id: "copy-value",
          label: "Copy value",
          command: "theme-manager.token.copy-value",
          order: 20
        },
        { id: "sep", label: "", role: "separator", order: 30 },
        {
          id: "revert",
          label: "Revert this token",
          command: "theme-manager.token.revert",
          enabledWhen: "theme-manager.token.edited",
          order: 40
        }
      ]
    }
  },
  settings: {
    ns: "accounts-settings",
    rows: [
      {
        key: "messagePollSeconds",
        label: "Message poll interval",
        hint: "Seconds between thread refreshes while the SSE presence stream is down. The stream is the primary channel; without this fallback cadence a tab that lost it never sees another message.",
        kind: "number",
        defaultValue: 5,
        min: 2,
        max: 60,
        step: 1
      },
      {
        key: "showOfflineMembers",
        label: "Show offline members",
        hint: "Off, the roster lists only members with a live presence connection — the only way a large directory stays usable when most of it is signed out.",
        kind: "switch",
        defaultValue: true
      },
      {
        key: "denseTables",
        label: "Dense tables",
        hint: "Tight row height in the member directory and the admin tables, so an operator can see a whole roster or permission matrix without scrolling.",
        kind: "switch",
        defaultValue: false
      },
      {
        key: "floatablePanes",
        label: "Floatable panes & toolbars (IDE style)",
        hint: "On, module panes and toolbars can be dragged out, floated, snap-mounted to an edge and flipped between horizontal and vertical, and where you put them is remembered for you. Off is the static studio, exactly — the switch gates a whole interaction mode, so there is no arrangement to keep and nothing to drag.",
        kind: "switch",
        defaultValue: false
      },
      {
        key: "editUi",
        label: "Edit UI",
        hint: "On, the app's chrome grows drag handles: the command bar and module toolbars can be moved, docked to any edge and reset from where they sit. Arranging is what this gates — an arrangement already made stays on screen for whoever made it with this off, which is why it is a mode and not a preference.",
        kind: "switch",
        defaultValue: false,
        // Rearranging the app's chrome is an administrator's job, so the switch
        // is offered to administrators only. `accounts` registers this gate
        // (`./lib/chromeEditing.ts`); core resolves it by name and never learns
        // what it means. Hiding it is not the boundary — the mode is derived
        // from the same role check, so a non-admin who reached the value could
        // not turn edit mode on with it.
        gate: "accounts.administrator"
      }
    ]
  },
  points: [
    {
      id: "accounts.admin-tab",
      title: "Admin suite tab",
      description:
        "A pane another module contributes into this module's admin suite — a moderation queue, " +
        "a quota console, a retention sweep. It exists so that a module growing an " +
        "administrator-only surface adds a TAB here instead of a second admin console with its " +
        "own nav entry and its own idea of what 'administrator' means. The contribution supplies " +
        "an id, a title, an optional pack glyph and summary, and a `load` thunk that imports the " +
        "pane; the suite's own administrator gate is the only gate it renders behind. A thunk " +
        "rather than the component itself, so the entry stays importable by plain Node, which " +
        "the closure resolver requires.",
      kind: "ui-surface",
      cardinality: "many",
      ordering: "priority",
      requires: ["id", "title", "load"]
    }
  ]
};
