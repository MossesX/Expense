/**
 * @file The accounts module's client store — the one live copy of "who am I,
 * what may I open, who else is here, and what did they send me", shared by the
 * entry screens, the messenger, the roster, the admin surfaces and P6's
 * BootedHost permission gate through `useSyncExternalStore` (firecrawl's
 * arrangement: server-backed, optimistic writes, surfaced save errors).
 *
 * The server snapshot is the SIGNED-OUT DEFAULT, for the reason taskman's
 * docblock spells out: the server cannot know this visitor's cookie, and a
 * guess is a visible flip when it is wrong. First subscribe probes
 * `GET /api/accounts/session`; everything else keys off that answer.
 *
 * ── the core sync, and why it is the whole point of this file ────────────────
 *
 * Core's `SessionStore` (`session` from `@axf/core`) is "a real store over a
 * stub backend" whose own docblock promised: *"When an auth subsystem lands it
 * replaces `signIn`/`signOut` here and every reader keeps working."* This store
 * is that landing. Whenever the studio session resolves signed-in it calls
 * `coreSession.signIn(username)`, and on logout/expiry `coreSession.signOut()`
 * — which flips the universal context-menu row and both `session.*` predicates
 * with ZERO core edits, because core's readers subscribe to the store rather
 * than to whatever proves identity this month.
 *
 * ── channels ─────────────────────────────────────────────────────────────────
 *
 * The presence SSE stream (`/api/accounts/presence`) is the primary live
 * channel: roster flips and message delivery arrive on it, and holding it open
 * IS being online. The poll loop (cadence = the `messagePollSeconds` setting)
 * is the fallback — it only fetches while the stream is down, so a healthy tab
 * costs one idle timer. Presence itself has no REST snapshot by design
 * (connection = presence), so while polling, "online" degrades to the
 * per-thread flags the messages route reports.
 *
 * Sends are optimistic: the message lands in state first, the POST follows,
 * and a failed save surfaces on `saveError` and takes the phantom message back
 * — a message that silently didn't send is a conversation two people remember
 * differently. Any 401 anywhere is treated as expiry and signs the whole
 * store out, cookie truth beating client hope.
 */
"use client";

import * as React from "react";

import { session as coreSession } from "@axf/core";

import { accountsSettings, getAccountsSettings } from "./settings";
import { LOGIN_PATH, isPublicPath } from "./lib/publicPaths";
import { threadIdFor } from "./lib/types";
import type {
  AccountMe,
  AccountPublic,
  AccountRole,
  AccountsEvent,
  EffectivePermissions,
  Message,
  Presence,
  Thread,
  ThreadSummary,
} from "./lib/types";

/** A thread-list row as the messages route serves it — summary + liveness. */
export type ThreadRow = ThreadSummary & { online?: boolean };

export interface AccountsState {
  /** False until the first session probe answers — the entry screen's spinner
   *  gate. The server snapshot is never "loaded". */
  readonly loaded: boolean;
  readonly session: AccountMe | null;
  readonly permissions: EffectivePermissions | null;
  readonly users: readonly AccountPublic[];
  readonly threads: readonly ThreadRow[];
  /** Total unread across every thread — the nav badge's number. */
  readonly unread: number;
  readonly presence: readonly Presence[];
  /** The conversation on screen, full history — `openThread()` loads it and
   *  optimistic sends append to it. Null when no window is open. */
  readonly openThread: Thread | null;
  /** Set when the last send failed — the composer shows it, a retry clears it. */
  readonly saveError: string | null;
  /** True while the presence stream is up. Published because a SURFACE has to
   *  know: the poll loop below refreshes the thread SUMMARIES, but the open
   *  conversation is the messenger's own, so it re-reads it on the same cadence
   *  while this is false — and says which channel it is on. */
  readonly streamLive: boolean;
}

const SERVER_STATE: AccountsState = {
  loaded: false,
  session: null,
  permissions: null,
  users: [],
  threads: [],
  unread: 0,
  presence: [],
  openThread: null,
  saveError: null,
  streamLive: false,
};

/** What a session-route answer carries when it carries a session. */
interface SessionPayload {
  signedIn?: boolean;
  me?: AccountMe;
  permissions?: EffectivePermissions;
  error?: string;
}

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Per-user kv namespace remembering that this account has already been given
 *  the designed default once. Per-user because `kvUser()` resolves the
 *  `axs_session` cookie, so the marker lands in the signed-in user's tree. */
const APPEARANCE_INIT_NS = "appearance-init";

const asError = (body: SessionPayload | null, fallback: string): string =>
  (body && typeof body.error === "string" && body.error) || fallback;

class AccountsStore {
  #state: AccountsState = SERVER_STATE;
  #listeners = new Set<() => void>();
  #probing = false;
  #stream: EventSource | null = null;
  #streamLive = false;
  #pollTimer: ReturnType<typeof setInterval> | null = null;
  #settingsUnsub: (() => void) | null = null;
  /**
   * Where `#leaveGatedPage` sends somebody whose session just died.
   *
   * `/login` is the FLOOR, not the intent. `proxy.ts` sends signed-out
   * navigations to the `login`-role `x_landing` asset, and a client bounce that
   * kept its own answer would be the studio's front door spelled twice — a
   * signed-out visitor would see the landing when the server turned them away
   * and the bare card when the cookie died under an open page, which is the
   * same screen disagreeing with itself.
   *
   * The route is REGISTERED rather than imported (`StudioShell` calls
   * `setFrontDoor`) because this module must not depend on the landing catalog:
   * accounts is peelable, and a peel that takes accounts and leaves the shell
   * would otherwise have to carry the whole x_landing/logo-kit graph to
   * resolve one string. Nothing registering is exactly the case the floor is
   * for — the bounce still lands somewhere real.
   */
  #frontDoor: string = LOGIN_PATH;
  #coreUnsub: (() => void) | null = null;
  /** True only for the instant `#adoptSession` flips core — see the watcher. */
  #adopting = false;

  subscribe = (fn: () => void): (() => void) => {
    void this.#ensureLoaded();
    this.#watchCoreSession();
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  /**
   * The core sync's RETURN LEG, and the reason it exists.
   *
   * `#adoptSession` / `#becomeSignedOut` push this store's truth INTO core so
   * the universal ctx-menu row and both `session.*` predicates agree with it.
   * That leg always worked. The other one did not: core's `session.signOut`
   * command (`core/ctx/commands.ts`) only flips core's own localStorage store,
   * so right-clicking → **Sign out** turned the row into "Sign in" while the
   * `axs_session` COOKIE stayed valid and this store stayed signed in. The
   * user was told they had left and had not — which on a shared machine is a
   * security defect, not a cosmetic one. Found by the P7 live probe, which
   * signs out through exactly that row and then timed out waiting for the
   * login card that never came.
   *
   * Core cannot call the accounts API (core never depends on studio), so the
   * adaptation belongs here: watch core, and when it goes signed-out while
   * this store still holds a session, perform the REAL logout.
   *
   * No loop is possible, and it is the state that guarantees it rather than a
   * flag: `logout()` ends in `#becomeSignedOut()`, which nulls `session`
   * BEFORE core re-emits, so the re-entrant callback finds nothing to do.
   *
   * ## The OTHER direction, and why it is the same defect (P10, 2026-08-15)
   *
   * Core's floor also carries **Sign in**, and `session.signIn` flips core's
   * stub store to `{ signedIn: true, user: "local" }` — which was honest while
   * AmberX had no authentication and stopped being honest the day `proxy.ts`
   * gated the studio. It produced the mirror of the bug above: the chrome saying
   * "Sign out (local)" with no `axs_session` cookie anywhere, i.e. being told you
   * ARE signed in when you are not. Same shape, same seriousness, same reason it
   * cannot be fixed in core — core never depends on studio, so `session.signIn`
   * has nothing to call.
   *
   * So the watcher adapts that leg too: core going signed-in while this store
   * holds no session means something flipped the stub rather than a login
   * succeeding, and the honest answer is to put core back and send the person to
   * the real front door — which is exactly `#leaveGatedPage`, including its
   * refusal to bounce off a public path (right-clicking *Sign in* on `/login`
   * should leave you on `/login`).
   *
   * `#adopting` is what keeps a REAL login out of that branch. `#adoptSession`
   * calls `coreSession.signIn()` before it publishes its own state, so without
   * the flag every successful login would emit once with `session` still null
   * and be mistaken for the stub. The flag rather than a reordering: this is the
   * most load-bearing store in the module and its emit order is depended on
   * above, so the narrower change is the right one.
   */
  #watchCoreSession(): void {
    if (this.#coreUnsub || typeof window === "undefined") return;
    this.#coreUnsub = coreSession.subscribe(() => {
      if (!coreSession.state().signedIn) {
        if (!this.#state.session) return;
        void this.logout();
        return;
      }
      if (this.#state.session || this.#adopting) return;
      // Terminates: `signOut()` re-enters this callback with `#state.session`
      // already null, which the first branch returns from.
      coreSession.signOut();
      this.#leaveGatedPage();
    });
  }

  getState = (): AccountsState => this.#state;
  getServerState = (): AccountsState => SERVER_STATE;

  #emit(): void {
    for (const fn of this.#listeners) fn();
  }

  #set(patch: Partial<AccountsState>): void {
    this.#state = { ...this.#state, ...patch };
    this.#emit();
  }

  /* ── session ───────────────────────────────────────────────────────────── */

  async #ensureLoaded(): Promise<void> {
    if (this.#state.loaded || this.#probing || typeof window === "undefined") return;
    this.#probing = true;
    try {
      const res = await fetch("/api/accounts/session");
      const body = (await res.json()) as SessionPayload;
      if (body.signedIn && body.me && body.permissions) {
        this.#adoptSession(body.me, body.permissions);
      } else {
        this.#becomeSignedOut();
      }
    } catch {
      // The route being down reads as signed out; the login action retries it.
      // No bounce — an unreachable route is not a dead session.
      this.#becomeSignedOut(false);
    } finally {
      this.#probing = false;
    }
  }

  /** A session answered signed-in: publish it, flip core, open the channels. */
  #adoptSession(me: AccountMe, permissions: EffectivePermissions): void {
    // THE core sync — the reason this store exists. Flips the universal
    // ctx-menu row and both `session.*` predicates without touching core.
    //
    // `#adopting` around the flip, not around the whole method: it exists only
    // to tell the watcher that THIS emit is a real login rather than the stub
    // row being clicked, and the emit is synchronous inside `signIn`.
    this.#adopting = true;
    try {
      coreSession.signIn(me.username);
    } finally {
      this.#adopting = false;
    }
    this.#set({ loaded: true, session: me, permissions });
    void this.#ensureDefaultAppearance();
    this.#openStream();
    this.#startPoll();
    void this.refreshUsers();
    void this.refreshThreads();
  }

  /**
   * A user who has never been given the designed default gets it, ONCE.
   *
   * The default-state contract (`src/defaults/default-state.ts`) was built to
   * be the state every new user starts from, but nothing applied it: it was
   * read only by the factory reset and the State tab, so a brand-new account's
   * first sign-in landed on whatever the app's boot floor happened to be. The
   * P7 live probe measured it — computed `--axf-accent` came back `#ff7a1a`
   * (the identity floor) where the contract's seed says `#f9ae3d`.
   *
   * It runs HERE, client-side after sign-in, rather than at boot on purpose.
   * The theme persists in `localStorage` — per BROWSER, not per user — so the
   * default cannot be stated once at boot and still be per-user; and the
   * boot/pre-paint path is the one this project has already broken three ways
   * (see PLANNING-STATE's theme-flash section: the SSR snapshot, the
   * signature, and the two module graphs). Applying through the SAME
   * `applyStateSnapshot()` the State tab uses keeps one apply path, after
   * hydration, where no server render can disagree with it.
   *
   * The marker is written BEFORE the apply, and that order is the safety: if
   * the write lands and the apply fails, the user keeps the floor and is asked
   * once. If the order were reversed and the marker write failed, every future
   * sign-in would re-apply the default over whatever theme the user had since
   * chosen — silently undoing their work, which is the worse failure.
   *
   * `reloadRequired` is deliberately NOT acted on: theme and packs apply live,
   * which is what a person sees, and the kv-backed surfaces (chrome, dashboard
   * arrangement) come up right on the next navigation. Reloading the page out
   * from under someone who just signed in would be a jarring way to save them
   * one stale pane.
   */
  async #ensureDefaultAppearance(): Promise<void> {
    if (typeof window === "undefined") return;
    try {
      const res = await fetch(`/api/axf/kv/${APPEARANCE_INIT_NS}`);
      if (res.ok) {
        const doc = (await res.json()) as { doc?: { initialized?: boolean } };
        if (doc.doc?.initialized) return;
      } else if (res.status !== 404) {
        return; // kv unreachable — say nothing rather than guess and clobber
      }
      const marked = await fetch(`/api/axf/kv/${APPEARANCE_INIT_NS}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ doc: { initialized: true, at: new Date().toISOString() } }),
      });
      if (!marked.ok) return; // could not remember — do not risk a repeat
      const { applyStateSnapshot } = await import("./state-snapshot");
      const { defaultStateSnapshot } = await import("@axs/defaults/default-state");
      await applyStateSnapshot(defaultStateSnapshot());
    } catch {
      // First-run polish must never break a sign-in.
    }
  }

  /**
   * Logout, expiry, or a signed-out probe — one exit, so no channel leaks.
   *
   * `bounce` is false for the ONE caller that reaches this without an answer
   * from the server: a probe whose fetch threw. That case reads as signed out
   * locally (the surfaces render their signed-out state and the login action
   * retries it), but it is not evidence the session ended — and a network blip
   * must not throw a signed-in person off the page they are working on.
   */
  #becomeSignedOut(bounce = true): void {
    coreSession.signOut();
    this.#closeStream();
    this.#stopPoll();
    this.#set({ ...SERVER_STATE, loaded: true });
    if (bounce) this.#leaveGatedPage();
  }

  /**
   * A session ending under an already-open page has to end the PAGE too.
   *
   * `proxy.ts` gates navigations, which is everything the server can see — but
   * the tab a person is looking at was fetched while the cookie was alive, and
   * nothing takes it off the screen when the cookie dies. Signing out on
   * `/buildmgr` used to leave the Build Manager sitting there, fully rendered
   * and quietly 401-ing, which is the same defect the core-session watcher
   * above was written for in miniature: being told you have left and not
   * having left.
   *
   * A full `location.replace` rather than a client route change, for the same
   * reason `./LoginScreen` uses one going the other way — the verdict lives on
   * the server, so the trip has to reach it. Public paths are exempt: a
   * signed-out probe on `/login` or an invitation landing is the NORMAL state
   * there, and bouncing would be a loop.
   */
  #leaveGatedPage(): void {
    if (typeof window === "undefined") return;
    const here = window.location.pathname;
    if (isPublicPath(here)) return;
    const from = `${here}${window.location.search}`;
    const door = this.#frontDoor;
    window.location.replace(from === "/" ? door : `${door}?next=${encodeURIComponent(from)}`);
  }

  /**
   * Tell the store where the studio's front door is — see `#frontDoor`.
   *
   * A falsy or non-public route is REFUSED rather than adopted. The bounce is
   * the one navigation a signed-out visitor cannot opt out of, so a door that
   * is itself behind the gate would redirect to itself forever — the lock-out
   * `lib/publicPaths.ts` exists to prevent, arrived at from the client side.
   * Refusing leaves the floor in place, which is the whole point of having one.
   *
   * Returns the door in effect AFTER the call, so a caller — and the test that
   * pins this — can see whether the route was adopted rather than having to
   * infer it from a bounce that only happens in a browser.
   */
  setFrontDoor(route: string | null | undefined): string {
    if (route && route.startsWith("/") && isPublicPath(route)) this.#frontDoor = route;
    return this.#frontDoor;
  }

  /** Every fetch funnels its status through here: a 401 anywhere means the
   *  cookie died under us, and the store signs out rather than half-works. */
  #expired(res: Response): boolean {
    if (res.status !== 401) return false;
    if (this.#state.session) this.#becomeSignedOut();
    return true;
  }

  async login(username: string, password: string): Promise<ActionResult> {
    try {
      const res = await fetch("/api/accounts/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "login", username, password }),
      });
      const body = (await res.json()) as SessionPayload;
      if (!res.ok || !body.signedIn || !body.me || !body.permissions) {
        return { ok: false, error: asError(body, `login failed (HTTP ${res.status})`) };
      }
      this.#adoptSession(body.me, body.permissions);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `login failed: ${String(err)}` };
    }
  }

  async logout(): Promise<void> {
    try {
      await fetch("/api/accounts/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
    } catch {
      // The cookie may survive a network blip, but this tab chose to leave —
      // signing the client out regardless is the least surprising outcome.
    }
    this.#becomeSignedOut();
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<ActionResult> {
    try {
      const res = await fetch("/api/accounts/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "change-password", currentPassword, newPassword }),
      });
      if (this.#expired(res)) return { ok: false, error: "session expired — sign in again" };
      const body = (await res.json()) as SessionPayload;
      if (!res.ok || !body.signedIn || !body.me || !body.permissions) {
        return { ok: false, error: asError(body, `change failed (HTTP ${res.status})`) };
      }
      // Fresh `me` (temp flag cleared) without re-running the full adoption —
      // the channels are already open.
      this.#set({ session: body.me, permissions: body.permissions });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `change failed: ${String(err)}` };
    }
  }

  /**
   * Name yourself — the profile pane's identity row. It goes through the
   * ACCOUNT (`/api/accounts/session`, `set-screenname`) rather than the profile
   * route on purpose: the profile engine re-syncs `screenname` from the account
   * on every read, so this is the only write that both halves see. The
   * directory is refreshed too, because the roster renders the same string.
   */
  async setScreenname(screenname: string): Promise<ActionResult> {
    try {
      const res = await fetch("/api/accounts/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "set-screenname", screenname }),
      });
      if (this.#expired(res)) return { ok: false, error: "session expired — sign in again" };
      const body = (await res.json()) as SessionPayload;
      if (!res.ok || !body.signedIn || !body.me || !body.permissions) {
        return { ok: false, error: asError(body, `rename failed (HTTP ${res.status})`) };
      }
      this.#set({ session: body.me, permissions: body.permissions });
      void this.refreshUsers();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `rename failed: ${String(err)}` };
    }
  }

  /** Re-probe the session — what a profile edit that changes `me` calls. */
  async refreshSession(): Promise<void> {
    if (typeof window === "undefined") return;
    try {
      const res = await fetch("/api/accounts/session");
      const body = (await res.json()) as SessionPayload;
      if (body.signedIn && body.me && body.permissions) {
        this.#set({ loaded: true, session: body.me, permissions: body.permissions });
      } else if (this.#state.session) {
        this.#becomeSignedOut();
      }
    } catch {
      /* unreadable — keep what is on screen (taskman's reload rule) */
    }
  }

  /* ── directory + threads ───────────────────────────────────────────────── */

  async refreshUsers(): Promise<void> {
    if (!this.#state.session) return;
    try {
      const res = await fetch("/api/accounts/users");
      if (this.#expired(res) || !res.ok) return;
      const body = (await res.json()) as { users?: AccountPublic[] };
      if (Array.isArray(body.users)) this.#set({ users: body.users });
    } catch {
      /* keep what is on screen */
    }
  }

  async refreshThreads(): Promise<void> {
    if (!this.#state.session) return;
    try {
      const res = await fetch("/api/accounts/messages");
      if (this.#expired(res) || !res.ok) return;
      const body = (await res.json()) as { threads?: ThreadRow[]; unread?: number };
      if (Array.isArray(body.threads)) {
        this.#set({ threads: body.threads, unread: typeof body.unread === "number" ? body.unread : 0 });
      }
    } catch {
      /* keep what is on screen */
    }
  }

  /** Load one conversation into `openThread`, marking it read in the same
   *  call (the window is open on it — that is what reading is). */
  async openThread(withUser: string): Promise<void> {
    if (!this.#state.session) return;
    try {
      const res = await fetch(
        `/api/accounts/messages?with=${encodeURIComponent(withUser)}&markRead=1`,
      );
      if (this.#expired(res) || !res.ok) return;
      const body = (await res.json()) as { thread?: Thread };
      if (!body.thread) return;
      // The read-stamp just zeroed this thread's unread; reflect it locally
      // rather than paying for a second list fetch.
      const threads = this.#state.threads.map((t) =>
        t.id === body.thread!.id ? { ...t, unread: 0 } : t,
      );
      this.#set({
        openThread: body.thread,
        threads,
        unread: threads.reduce((n, t) => n + t.unread, 0),
      });
    } catch {
      /* keep what is on screen */
    }
  }

  closeThread(): void {
    if (this.#state.openThread) this.#set({ openThread: null });
  }

  async markThreadRead(withUser: string): Promise<void> {
    if (!this.#state.session) return;
    try {
      const res = await fetch("/api/accounts/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "mark-read", with: withUser }),
      });
      if (this.#expired(res) || !res.ok) return;
      const id = threadIdFor(this.#state.session!.username, withUser);
      const threads = this.#state.threads.map((t) => (t.id === id ? { ...t, unread: 0 } : t));
      this.#set({ threads, unread: threads.reduce((n, t) => n + t.unread, 0) });
    } catch {
      /* keep what is on screen */
    }
  }

  /* ── administration — thin relays over the users route ─────────────────── */

  /**
   * POST one admin action to `/api/accounts/users` and relay the verdict. The
   * SERVER is the guard — each store function behind that route re-reads the
   * acting account and refuses itself (`requireAdmin`, the self-lockout
   * checks), so this relays the refusal text VERBATIM rather than pre-judging,
   * and refreshes the directory on success so every open surface repaints.
   */
  async #usersAction(payload: Record<string, unknown>): Promise<ActionResult> {
    try {
      const res = await fetch("/api/accounts/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (this.#expired(res)) return { ok: false, error: "session expired — sign in again" };
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        return {
          ok: false,
          error: (typeof body.error === "string" && body.error) || `request failed (HTTP ${res.status})`,
        };
      }
      void this.refreshUsers();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  addUser(username: string, tempPassword: string, role: AccountRole): Promise<ActionResult> {
    return this.#usersAction({ action: "add-user", username, tempPassword, role });
  }

  updateUser(
    username: string,
    patch: { role?: AccountRole; disabled?: boolean },
  ): Promise<ActionResult> {
    return this.#usersAction({ action: "update-user", username, ...patch });
  }

  resetPassword(username: string, tempPassword: string): Promise<ActionResult> {
    return this.#usersAction({ action: "reset-password", username, tempPassword });
  }

  removeUser(username: string): Promise<ActionResult> {
    return this.#usersAction({ action: "remove-user", username });
  }

  /* ── sending — optimistic, with the failure surfaced ───────────────────── */

  async sendMessage(to: string, text: string): Promise<ActionResult> {
    const me = this.#state.session;
    if (!me) return { ok: false, error: "sign in first" };

    const optimistic: Message = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      threadId: threadIdFor(me.username, to),
      from: me.username,
      to,
      text,
      sentAt: new Date().toISOString(),
      deliveredAt: null,
      readAt: null,
    };
    this.#applyMessage(optimistic);

    try {
      const res = await fetch("/api/accounts/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "send", to, text }),
      });
      if (this.#expired(res)) return { ok: false, error: "session expired — sign in again" };
      const body = (await res.json()) as { ok?: boolean; message?: Message; error?: string };
      if (!res.ok || !body.ok || !body.message) {
        this.#retractMessage(optimistic.id);
        const error = (typeof body.error === "string" && body.error) || `send failed (HTTP ${res.status})`;
        this.#set({ saveError: `Send failed: ${error}` });
        return { ok: false, error };
      }
      // Swap the phantom for the stored message (real id + delivery stamp).
      this.#replaceMessage(optimistic.id, body.message);
      if (this.#state.saveError) this.#set({ saveError: null });
      return { ok: true };
    } catch (err) {
      this.#retractMessage(optimistic.id);
      this.#set({ saveError: `Send failed: ${String(err)}` });
      return { ok: false, error: String(err) };
    }
  }

  /** Land a message in the open thread + the summaries — used by both the
   *  optimistic send and the SSE delivery, so the two channels cannot drift. */
  #applyMessage(m: Message): void {
    const me = this.#state.session;
    if (!me) return;

    let open = this.#state.openThread;
    if (open && open.id === m.threadId && !open.messages.some((x) => x.id === m.id)) {
      open = { ...open, messages: [...open.messages, m], updatedAt: m.sentAt };
    }

    const mine = m.from.toLowerCase() === me.username.toLowerCase();
    // A GROUP message carries no `to` — it is addressed to the room. So "is
    // this for me" is "did somebody else send it", and on a DM that is exactly
    // what `to === me` already meant.
    const group = m.to === "";
    const peer = mine ? m.to : m.from;
    const existing = this.#state.threads.find((t) => t.id === m.threadId);
    // Unread counts messages FOR me in threads I am not looking at.
    const toMe = group ? !mine : m.to.toLowerCase() === me.username.toLowerCase();
    const openHere = open !== null && open.id === m.threadId;
    const threads: readonly ThreadRow[] = existing
      ? this.#state.threads.map((t) =>
          t.id === m.threadId
            ? {
                ...t,
                lastMessage: m,
                updatedAt: m.sentAt,
                unread: toMe && !openHere ? t.unread + 1 : t.unread,
              }
            : t,
        )
      : group
        ? // A group we have never listed: its title and membership are not in
          // this message and must not be guessed, so ask rather than invent.
          this.#state.threads
        : [
            {
              id: m.threadId,
              kind: "dm",
              with: peer,
              title: null,
              members: [me.username, peer],
              lastMessage: m,
              unread: toMe && !openHere ? 1 : 0,
              updatedAt: m.sentAt,
            },
            ...this.#state.threads,
          ];

    this.#set({
      openThread: open,
      threads,
      unread: threads.reduce((n, t) => n + t.unread, 0),
    });
    if (group && !existing) void this.refreshThreads();
    // A thread that arrived open gets its read-stamp persisted server-side too.
    if (toMe && openHere && !group) void this.markThreadRead(peer);
  }

  #retractMessage(id: string): void {
    const open = this.#state.openThread;
    this.#set({
      openThread: open
        ? { ...open, messages: open.messages.filter((m) => m.id !== id) }
        : open,
      threads: this.#state.threads.map((t) =>
        t.lastMessage?.id === id ? { ...t, lastMessage: null } : t,
      ),
    });
  }

  #replaceMessage(localId: string, real: Message): void {
    const open = this.#state.openThread;
    this.#set({
      openThread: open
        ? {
            ...open,
            // The SSE delivery can land the STORED message before the POST
            // answers (the server streams a send to both parties, the sender
            // included). Mapping the phantom onto it would then put the same
            // id in the list twice — drop the phantom instead.
            messages: open.messages.some((m) => m.id === real.id)
              ? open.messages.filter((m) => m.id !== localId)
              : open.messages.map((m) => (m.id === localId ? real : m)),
          }
        : open,
      threads: this.#state.threads.map((t) =>
        t.lastMessage?.id === localId ? { ...t, lastMessage: real } : t,
      ),
    });
  }

  /* ── the live channel + its fallback ───────────────────────────────────── */

  #openStream(): void {
    if (typeof window === "undefined" || this.#stream) return;
    const es = new EventSource("/api/accounts/presence");
    this.#stream = es;
    es.onopen = () => {
      this.#streamLive = true;
      this.#set({ streamLive: true });
    };
    es.onerror = () => {
      // EventSource reconnects on its own; until it does, the poll loop
      // carries the messages. A dead COOKIE (not a dead socket) surfaces as a
      // 401 on the next poll fetch, which signs the store out properly.
      this.#streamLive = false;
      this.#set({ streamLive: false });
    };
    es.onmessage = (ev) => {
      let event: AccountsEvent;
      try {
        event = JSON.parse(ev.data) as AccountsEvent;
      } catch {
        return;
      }
      if (event.type === "roster") {
        const byName = new Map(event.roster.map((p) => [p.username.toLowerCase(), p.online]));
        this.#set({
          presence: event.roster,
          threads: this.#state.threads.map((t) =>
            // "Online" is a question about a PERSON. A group has no single
            // peer, so it keeps whatever the route said (nothing) rather than
            // being told the empty username is offline.
            t.kind === "dm" ? { ...t, online: byName.get(t.with.toLowerCase()) ?? false } : t,
          ),
        });
      } else if (event.type === "message") {
        this.#applyMessage(event.message);
      } else if (event.type === "threads") {
        // Payload-free by design: a group was opened, joined, left or renamed,
        // and the refetch is what scopes the answer to this member.
        void this.refreshThreads();
      }
      // "ping" is the keep-alive — nothing to do.
    };
  }

  #closeStream(): void {
    this.#streamLive = false;
    if (this.#state.streamLive) this.#set({ streamLive: false });
    this.#stream?.close();
    this.#stream = null;
  }

  #startPoll(): void {
    this.#stopPoll();
    if (typeof window === "undefined") return;
    const seconds = Math.max(1, getAccountsSettings().messagePollSeconds);
    this.#pollTimer = setInterval(() => {
      // The stream is the primary channel; poll only while it is down.
      if (!this.#streamLive) void this.refreshThreads();
    }, seconds * 1000);
    // A cadence change re-arms the timer — subscribed once, for the store's life.
    this.#settingsUnsub ??= accountsSettings.subscribe(() => {
      if (this.#state.session) this.#startPoll();
    });
  }

  #stopPoll(): void {
    if (this.#pollTimer) clearInterval(this.#pollTimer);
    this.#pollTimer = null;
  }
}

/** One store per runtime — every accounts surface and the BootedHost gate
 *  read this instance. */
export const accountsStore = new AccountsStore();

/** Live account state; safe under SSR (server renders signed out). */
export function useAccountsState(): AccountsState {
  return React.useSyncExternalStore(
    accountsStore.subscribe,
    accountsStore.getState,
    accountsStore.getServerState,
  );
}

/**
 * May the current user open `moduleId`? — the verdict P6's BootedHost gate
 * consumes. True while signed out (a single-operator studio stays fully open
 * until an administrator says otherwise — the permission engine's own
 * default-allow rule) and for administrators; otherwise the grant verdict.
 */
export function usePermission(moduleId: string): boolean {
  const { session, permissions } = useAccountsState();
  if (!session || !permissions) return true;
  if (permissions.administrator) return true;
  return !permissions.deniedModules.includes(moduleId);
}
