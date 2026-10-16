/**
 * @file The session store — signed in or signed out, and nothing more.
 *
 * **This is a real store over a stub backend, and the distinction matters.**
 * AmberX has no authentication yet: the console banner says "local only"
 * because there is genuinely nothing to sign in to. But the context menu has
 * to show *Sign in* or *Sign out* depending on status (owner, 2026-08-09), and
 * a row that always says the same thing is a row that is lying half the time.
 *
 * So status is real state — subscribable, persisted, and flipped by real
 * commands — while the thing it describes is local. When an auth subsystem
 * lands it replaces `signIn`/`signOut` here and every reader keeps working,
 * because readers subscribe to the store rather than to whatever proves
 * identity this month.
 *
 * Never read during render on the server: `localStorage` does not exist there,
 * and a store that answers differently per runtime is exactly the hydration
 * mismatch this app already has one of. The context menu is the only consumer
 * and it renders solely in response to a click, which is client-side by
 * definition.
 */

export interface SessionState {
  signedIn: boolean;
  /** Display name for the header row. Null whenever signed out. */
  user: string | null;
}

const KEY = "axf:session@1";
const SIGNED_OUT: SessionState = { signedIn: false, user: null };

type Listener = () => void;

export class SessionStore {
  #state: SessionState = SIGNED_OUT;
  readonly #listeners = new Set<Listener>();
  #loaded = false;

  /** Read persisted status. Called lazily on first access from the client. */
  #load(): void {
    if (this.#loaded) return;
    this.#loaded = true;
    try {
      if (typeof window === "undefined" || !window.localStorage) return;
      const raw = window.localStorage.getItem(KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<SessionState>;
      this.#state = {
        signedIn: Boolean(parsed.signedIn),
        user: typeof parsed.user === "string" ? parsed.user : null
      };
    } catch {
      // Unparseable or unavailable storage means signed out, which is the
      // safe direction: it offers a sign-in, it never implies an identity.
    }
  }

  state = (): SessionState => {
    this.#load();
    return this.#state;
  };

  /** Server snapshot for `useSyncExternalStore` — always signed out, never
   *  touching storage, so SSR and the first client render agree. */
  serverState = (): SessionState => SIGNED_OUT;

  subscribe = (fn: Listener): (() => void) => {
    this.#listeners.add(fn);
    return () => void this.#listeners.delete(fn);
  };

  #set(next: SessionState): void {
    this.#state = next;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // A session that cannot persist should still apply for this tab.
    }
    for (const fn of this.#listeners) fn();
  }

  signIn(user = "local"): void {
    this.#load();
    this.#set({ signedIn: true, user });
  }

  signOut(): void {
    this.#load();
    this.#set(SIGNED_OUT);
  }
}

export const session = new SessionStore();
