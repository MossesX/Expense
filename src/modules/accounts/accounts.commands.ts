/**
 * @file The behaviour behind the accounts area map — P10's acting half.
 *
 * The menus themselves are DATA on `accounts.decl.ts`; this is where the rows
 * become behaviour, and the two meet only through a command NAME. Same split
 * every other module in this package runs on (`taskman.commands.ts` is the
 * house exemplar), and the same ordering rule: this must be registered BEFORE
 * `registerModuleMenus(ACCOUNTS_DECL)`, because the map's gate refuses an item
 * naming an unregistered command or predicate. That is what makes a typo in the
 * decl a loud boot failure rather than a dead row.
 *
 * ## THE DOCTRINE THESE COMMANDS ARE WRITTEN UNDER
 *
 * Every verb below **navigates, opens, copies or locates**. Not one of them
 * deletes an account, revokes a module, issues a credential or removes stored
 * data. Those operations stay behind the confirm-bearing surfaces that own them
 * (`AdminUserDetail`, `PermissionMatrix`, `RemoveDataDialog`), and the map's job
 * is to SUMMON that surface, never to substitute for it. See the decl's docblock
 * for why the one-row menu was written that way in the first place, and why
 * widening it does not reverse the reasoning.
 *
 * The two rows that write — *Pin override* and *Follow default* — are the
 * exception that proves the rule rather than a hole in it. They are the policy
 * editor's OWN two gestures, they are reversible by each other, the editor
 * itself performs them with no confirm, and they are fired here through the
 * editor rather than around it (see the event seam below) so the screen shows
 * what happened. A row that pinned a policy silently, off-screen, would be the
 * thing this doctrine forbids; a row that presses the editor's own button in
 * front of you is not.
 *
 * ## How a command knows WHAT was right-clicked
 *
 * A `CommandHandler` takes no arguments by contract (core `commands.ts`), so the
 * engine parks the resolved click in `activeContext()` and `MenuContext.data`
 * carries every `data-axf-*` harvested up the chain, innermost winning. The
 * surfaces mark what they are — `data-axf-user`, `data-axf-file-path`,
 * `data-axf-policy-key`, `data-axf-card` — and these handlers read them back
 * out. Nothing here re-reads the DOM: the walk already ran.
 *
 * ## The event seam, and why three surfaces need one
 *
 * A command runs outside React and several of these rows have to act ON a
 * screen's own state — the dashboard's card layout, the policy editor's pin
 * buttons, the files tab's preview pane. Reaching into those from here would
 * mean a second copy of each screen's logic; so instead one CustomEvent carries
 * a discriminated signal and the screen that owns the state handles it. That is
 * `shell-commands.ts` → `ShellOverlays` exactly, the pattern this package
 * already proved, and it keeps the acting half of every gesture in the one file
 * that can also draw the result.
 *
 * Navigation does NOT go through the seam. `window.location.assign` is what
 * every other cross-surface jump in this studio uses (`NavMenu`, the modules
 * menu, the store's own bounce), and a client-side route change here would
 * leave the destination tab reading a `?user=` the server never saw.
 */
"use client";

import { activeContext, commands, predicates, settingsUi } from "@axf/core";

import { fileDownloadUrl } from "./adminApi";
import { isAdministrator } from "./lib/chromeEditing";
import { accountsStore } from "./store";

/* ============================== the event seam =============================== */

/** The one event every screen-scoped row is delivered on. */
export const ACCOUNTS_CTX_EVENT = "axs:accounts-ctx";

/**
 * What a screen-scoped row asks its screen to do.
 *
 * ONE union on ONE event rather than an event per gesture, for the reason
 * `ShellSignal` gives: a listener that has to know six event names is a
 * listener that misses the seventh, and a union is checked by the compiler at
 * both ends.
 */
export type AccountsCtxSignal =
  /** Re-read the admin suite's live sources. */
  | { kind: "suite-refresh" }
  /** Swap a dashboard card's slot between wide and tall. */
  | { kind: "card-flip"; card: string }
  /** One card back to its shipped place. */
  | { kind: "card-reset"; card: string }
  /** Every card back to its shipped place. */
  | { kind: "layout-reset" }
  /** Pin / un-pin one policy row, through the editor's own handlers. */
  | { kind: "policy-pin"; subject: string; key: string }
  | { kind: "policy-unpin"; subject: string; key: string }
  /** Open one file in the files tab's preview pane. */
  | { kind: "file-preview"; root: string; path: string };

function signal(detail: AccountsCtxSignal): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<AccountsCtxSignal>(ACCOUNTS_CTX_EVENT, { detail }));
}

/**
 * Subscribe to the seam. Exported so the three listening screens share one
 * definition of the cast rather than each writing `(e as CustomEvent<…>).detail`
 * and one of them getting the type wrong silently.
 */
export function onAccountsCtx(handle: (s: AccountsCtxSignal) => void): () => void {
  const listener = (e: Event) => handle((e as CustomEvent<AccountsCtxSignal>).detail);
  window.addEventListener(ACCOUNTS_CTX_EVENT, listener);
  return () => window.removeEventListener(ACCOUNTS_CTX_EVENT, listener);
}

/* ================================== helpers ================================== */

/** The click's harvested data — `{}` when a command is fired from a palette. */
function ctxData(): Record<string, string> {
  return activeContext()?.data ?? {};
}

/**
 * Put text on the system clipboard.
 *
 * A local three-liner rather than core's `ctx.copy`: that handler copies the
 * SELECTION, and every copy row here copies a value the click carried instead.
 * The legacy `execCommand` fallback core keeps is deliberately not repeated —
 * these rows run in the studio's own chrome, where the async API is available,
 * and a silent failure is reported by the row simply not being enabled rather
 * than by a second code path nobody exercises.
 */
function copy(text: string): void {
  if (!text) return;
  void navigator.clipboard?.writeText(text).catch(() => {
    // Permission refused between opening the menu and clicking. Nothing to
    // undo — the clipboard is unchanged, which is the honest outcome.
  });
}

/** Every cross-surface jump. A full document load, deliberately — see the header. */
function go(url: string): void {
  if (typeof window !== "undefined") window.location.assign(url);
}

/** A deep link into the admin suite, built in ONE place so five rows cannot
 *  disagree about the parameter names the three tabs read. */
function suiteUrl(tab: string, params: Record<string, string> = {}): string {
  const query = new URLSearchParams({ surface: "admin", tab, ...params });
  return `/accounts?${query.toString()}`;
}

/** Where a signed-out visitor is sent. The store owns the answer (the shell
 *  registers the real front door on it); calling `setFrontDoor` with nothing
 *  is its documented read — it adopts only a route it is given. */
function frontDoor(): string {
  return accountsStore.setFrontDoor(null);
}

let registered = false;

/* ================================ registration ================================ */

/** Register every accounts command and predicate. Idempotent — a dev-server
 *  remount re-evaluates this module against a registry that kept its handlers,
 *  and `CommandRegistry.register` throws on a duplicate name. */
export function registerAccountsCommands(): void {
  if (registered) return;
  registered = true;

  /* ------------------------------- the session ----------------------------- */

  /**
   * Sign in — which means GO TO THE FRONT DOOR, not "become signed in".
   *
   * Core ships `session.signIn` on the always-present floor of every menu
   * (`core/ctx/default-menu.ts`), and core's handler flips its own stub store to
   * `{ signedIn: true, user: "local" }`. That was honest while AmberX had no
   * authentication; since the studio was gated it is not — it makes the chrome
   * say "Sign out (local)" while no `axs_session` cookie exists, which is being
   * told you are signed in when you are not. It is the exact mirror of the
   * defect `store.ts`'s core-session watcher was written for, and the watcher is
   * where it is fixed (core never depends on studio, so the adaptation cannot
   * live in core).
   *
   * This command is the same act named properly, for the bar and for the map:
   * the only thing that can produce a session is the login screen, so that is
   * where it goes, carrying `?next=` so the person lands back where they were.
   */
  commands.register({
    id: "accounts.session.signIn",
    title: "Sign in",
    icon: "icon-account",
    run: () => {
      if (typeof window === "undefined") return;
      const here = `${window.location.pathname}${window.location.search}`;
      const door = frontDoor();
      go(here === "/" || here.startsWith(door) ? door : `${door}?next=${encodeURIComponent(here)}`);
    }
  });

  /**
   * Sign out — the REAL one: the server drops the cookie, the store closes its
   * channels, core's session flips and the page leaves any gated surface.
   *
   * Core's floor row (`session.signOut`) already reaches this, by a longer
   * route: it flips core's store, and `store.ts`'s watcher adapts that into this
   * same `logout()`. Naming it directly is what lets the command bar's account
   * chip and any future hotkey fire the real thing without depending on that
   * adaptation being in place.
   */
  commands.register({
    id: "accounts.session.signOut",
    title: "Sign out",
    icon: "icon-account",
    run: () => void accountsStore.logout()
  });

  /** The app settings page — where branding, the theme manager and the rest of
   *  the app-wide appearance live. Deliberately NOT core's `module.settings.open`,
   *  which opens the settings of whatever module is hosted on the route. */
  commands.register({
    id: "accounts.session.settings",
    title: "App settings",
    icon: "icon-gear",
    run: () => go("/settings")
  });

  /** The account chip's own destination — this person's member surface. */
  commands.register({
    id: "accounts.session.account",
    title: "Your account",
    icon: "icon-account",
    run: () => go("/accounts?surface=profile")
  });

  /* -------------------------------- user rows ------------------------------ */

  const targetUser = (): string | null => ctxData().user ?? null;

  commands.register({
    id: "accounts.user.open-suite",
    title: "Open member in the admin suite",
    run: () => {
      const user = targetUser();
      if (user) go(suiteUrl("users", { user }));
    }
  });

  commands.register({
    id: "accounts.user.view-files",
    title: "View a member's files",
    run: () => {
      const user = targetUser();
      if (user) go(suiteUrl("files", { user }));
    }
  });

  /**
   * View storage — the member's own gauge, not the roster-wide tab.
   *
   * The Storage TAB is the accounting view over everybody and lists only the
   * largest footprints, so a link to it for one member lands on a table that may
   * not contain them. `AdminUserDetail`'s storage card is that member's actual
   * measurement, so this goes to the Users tab with the row selected and the
   * card asked for — which is a different destination from *Open in admin
   * suite*, as two rows with two labels have to be.
   */
  commands.register({
    id: "accounts.user.view-storage",
    title: "View a member's storage",
    run: () => {
      const user = targetUser();
      if (user) go(suiteUrl("users", { user, card: "storage" }));
    }
  });

  commands.register({
    id: "accounts.user.message",
    title: "Message a member",
    icon: "icon-chat",
    run: () => {
      const user = targetUser();
      if (user) go(`/accounts?surface=messages&peer=${encodeURIComponent(user)}`);
    }
  });

  commands.register({
    id: "accounts.user.copy-id",
    title: "Copy a member's user id",
    run: () => copy(targetUser() ?? "")
  });

  /* -------------------------------- file rows ------------------------------ */

  const fileTarget = (): { owner: string; root: string; path: string } | null => {
    const data = ctxData();
    if (!data.fileRoot || !data.filePath || !data.fileOwner) return null;
    return { owner: data.fileOwner, root: data.fileRoot, path: data.filePath };
  };

  commands.register({
    id: "accounts.file.preview",
    title: "Preview a file",
    run: () => {
      const file = fileTarget();
      if (file) signal({ kind: "file-preview", root: file.root, path: file.path });
    }
  });

  /**
   * Download — through the SAME audited URL the preview pane's own button uses.
   *
   * `fileDownloadUrl` names the route that writes an audit record before the
   * bytes move and 500s if that write fails (`adminApi.ts`). A menu row that
   * fetched the file some other way would be the one unrecorded read on a tab
   * whose whole banner promises there are none.
   */
  commands.register({
    id: "accounts.file.download",
    title: "Download a file",
    run: () => {
      const file = fileTarget();
      if (file) go(fileDownloadUrl(file.owner, file.root, file.path));
    }
  });

  commands.register({
    id: "accounts.file.copy-path",
    title: "Copy a file's path",
    run: () => {
      const data = ctxData();
      // The ROOT-qualified path, which is the address the browse routes take —
      // a bare relative path is ambiguous across a member's several data roots.
      // A ROOT's own row carries an empty relative path, and `<root>:` is the
      // honest address of the top of that tree rather than nothing at all.
      if (data.fileRoot) copy(data.filePath ? `${data.fileRoot}:${data.filePath}` : data.fileRoot);
      else if (data.filePath) copy(data.filePath);
    }
  });

  /* ------------------------------- policy rows ----------------------------- */

  const policyTarget = (): { subject: string; key: string } | null => {
    const data = ctxData();
    return data.policySubject && data.policyKey
      ? { subject: data.policySubject, key: data.policyKey }
      : null;
  };

  commands.register({
    id: "accounts.policy.pin",
    title: "Pin a policy override",
    run: () => {
      const row = policyTarget();
      if (row) signal({ kind: "policy-pin", subject: row.subject, key: row.key });
    }
  });

  commands.register({
    id: "accounts.policy.unpin",
    title: "Follow the tier above for a policy row",
    run: () => {
      const row = policyTarget();
      if (row) signal({ kind: "policy-unpin", subject: row.subject, key: row.key });
    }
  });

  /** The value IN FORCE, as the editor spells it — the row marks its own
   *  formatted value, so the copy and the screen can never disagree. */
  commands.register({
    id: "accounts.policy.copy-value",
    title: "Copy a policy's effective value",
    run: () => copy(ctxData().policyValue ?? "")
  });

  /* ------------------------------ dashboard cards --------------------------- */

  const targetCard = (): string | null => ctxData().card ?? null;

  /**
   * Configure card — which opens the ACCOUNTS SETTINGS, and that is the honest
   * destination rather than a placeholder for one.
   *
   * A card declares its own title, glyph, shapes and place in `adminCards.tsx`;
   * none of that is a reader's to change. What a reader CAN configure about a
   * card is whether the canvas is arrangeable at all, and that is exactly the
   * two rows `accounts.decl.ts` declares — `floatablePanes` and `editUi`. So the
   * row opens the module's settings dialog, in place, over the canvas it
   * governs. Inventing a per-card dialog with nothing in it would be the dead
   * button this project refuses to draw.
   */
  commands.register({
    id: "accounts.card.configure",
    title: "Configure the dashboard cards",
    icon: "icon-gear",
    run: () => settingsUi.open("accounts")
  });

  commands.register({
    id: "accounts.card.flip",
    title: "Flip a card between wide and tall",
    run: () => {
      const card = targetCard();
      if (card) signal({ kind: "card-flip", card });
    }
  });

  commands.register({
    id: "accounts.card.reset",
    title: "Reset one card to its shipped place",
    run: () => {
      const card = targetCard();
      if (card) signal({ kind: "card-reset", card });
    }
  });

  commands.register({
    id: "accounts.layout.reset",
    title: "Reset the dashboard layout",
    icon: "icon-reload",
    run: () => signal({ kind: "layout-reset" })
  });

  /* ------------------------------- the suite ------------------------------- */

  commands.register({
    id: "accounts.suite.refresh",
    title: "Re-read the admin suite",
    icon: "icon-sync",
    run: () => signal({ kind: "suite-refresh" })
  });

  /* ------------------------------- predicates ------------------------------ */

  /*
   * Availability, never presence. Every predicate below greys a row and SAYS
   * why rather than removing it — the rule `taskman.commands.ts` states and the
   * one this map most needs, because an administrator's rows disappearing for a
   * member would teach both of them that the menu is inconsistent.
   *
   * The one exception is the two session rows, which use `when` (absence): "you
   * are not signed in" is not a temporary condition a reason could explain away,
   * it is which of two menus you are looking at.
   */

  if (!predicates.has("accounts.signedIn")) {
    predicates.register({
      id: "accounts.signedIn",
      title: "Somebody is signed in",
      test: () => (accountsStore.getState().session ? true : "nobody is signed in")
    });
  }

  if (!predicates.has("accounts.signedOut")) {
    predicates.register({
      id: "accounts.signedOut",
      title: "Nobody is signed in",
      test: () => (accountsStore.getState().session ? "you are already signed in" : true)
    });
  }

  /**
   * The admin gate on the map.
   *
   * Named `accounts.isAdministrator` and NOT `accounts.administrator`, which is
   * the SETTINGS gate (`lib/chromeEditing.ts`). Two registries would not
   * collide, but one string meaning two things in one module is how the wrong
   * one gets edited.
   *
   * Hiding a row is not the boundary and is not claimed to be — every route
   * these rows navigate to re-reads the administrator role from disk per
   * request. This decides what is worth putting in front of somebody, which is
   * the same thing the nav rows and the suite's tab have always decided.
   */
  if (!predicates.has("accounts.isAdministrator")) {
    predicates.register({
      id: "accounts.isAdministrator",
      title: "The signed-in user administers this studio",
      test: () =>
        isAdministrator() ? true : "the admin suite is for administrators"
    });
  }

  if (!predicates.has("accounts.canMessage")) {
    predicates.register({
      id: "accounts.canMessage",
      title: "The signed-in user may send messages",
      test: () => {
        const permissions = accountsStore.getState().permissions;
        if (!permissions) return "nobody is signed in";
        return permissions.administrator === true || permissions.canMessage === true
          ? true
          : "messaging is switched off for your account";
      }
    });
  }

  if (!predicates.has("accounts.fileTarget")) {
    predicates.register({
      id: "accounts.fileTarget",
      title: "The pointer is over a file rather than a folder",
      test: (ctx) =>
        ctx.data.fileKind === "file" ? true : "that is a folder, not a file"
    });
  }

  /*
   * The two policy predicates are each other's inverse ON PURPOSE, and they are
   * both registered rather than one being `!` of the other, because a row's
   * `enabledWhen` names a predicate and a negation has nowhere to live in the
   * data. The reasons they return differ, which is the whole value: "already
   * pinned" and "not pinned" are different sentences to read.
   */
  if (!predicates.has("accounts.policyPinned")) {
    predicates.register({
      id: "accounts.policyPinned",
      title: "This policy row carries a pinned override",
      test: (ctx) =>
        ctx.data.policyPinned === "1" ? true : "this row is already following the tier above"
    });
  }

  if (!predicates.has("accounts.policyUnpinned")) {
    predicates.register({
      id: "accounts.policyUnpinned",
      title: "This policy row is following the tier above",
      test: (ctx) => (ctx.data.policyPinned === "1" ? "this row is already pinned" : true)
    });
  }
}
