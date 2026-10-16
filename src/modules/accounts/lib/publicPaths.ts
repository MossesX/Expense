/**
 * @file **The signed-out allow-list** — the only page paths the studio serves
 * without a session, named ONCE.
 *
 * Two readers need this answer and they run in different worlds: `proxy.ts`
 * (Node, before a route renders) turns it into a redirect, and the accounts
 * store (browser, when a session ends under a live page) turns it into a
 * bounce. Written twice they would drift, and the drift is not cosmetic —
 * either half getting `/login` wrong makes the login screen redirect to
 * itself forever, which is a lock-out with no way back in.
 *
 * So this module has NO imports and no runtime of its own: nothing here may
 * stop it being loadable from either side.
 *
 * ## What earns a place
 *
 * A path belongs here only when a person with no account is *meant* to arrive
 * at it. Today that is the login screen, the invitation landing — whose own
 * docblock calls it "the one page in AmberX Vid a signed-out stranger is meant
 * to reach", the token in its URL being that page's gate, and a session gate in
 * front of it would make every invitation unusable — and the `x_landing` login
 * landing, which is a front door by definition: gated, it would redirect every
 * visitor to /login and could never be seen by the audience it exists for.
 *
 * `/login-landing/*` is a PREFIX entry, so the landing and anything under it are
 * served signed out. That is a deliberate widening (owner, 2026-08-15: "make it
 * public everyone should see the same login landing page"); the first version
 * listed the landing exactly and kept its then-child `/gallery` gated. That
 * child is gone — the route was deleted on 2026-08-16 and the asset browser's
 * live previews supersede it — so the prefix currently matches only the landing
 * itself. It stays a PREFIX deliberately, and the standing warning with it:
 * nothing placed under here may carry anything a signed-out stranger must not
 * see, because it is a shop window and a new child route inherits that without
 * anyone re-deciding it.
 *
 * API routes are NOT governed by this list. Each one carries its own gate
 * (`requireSession` and friends), and several are reached by things that have
 * no cookie to offer at all — the tray service, the hotkey plugin, the
 * `.newtask.` capture curl. Gating them here would break those integrations
 * while proving nothing the routes do not already prove.
 */

/** The login screen — the destination the gate redirects TO, so it can never
 *  be behind the gate. */
export const LOGIN_PATH = "/login";

/**
 * Page paths reachable signed out. A trailing `/*` entry matches the prefix
 * and everything under it; every other entry is exact.
 */
export const PUBLIC_PATHS: readonly string[] = [LOGIN_PATH, "/amberxvid/invite/*", "/login-landing/*"];

/** Is `pathname` on the allow-list? Trailing slashes are ignored, so `/login`
 *  and `/login/` cannot disagree about whether the login screen is public. */
export function isPublicPath(pathname: string): boolean {
  const clean = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return PUBLIC_PATHS.some((entry) =>
    entry.endsWith("/*")
      ? clean === entry.slice(0, -2) || clean.startsWith(entry.slice(0, -1))
      : clean === entry,
  );
}

/**
 * Sanitise a `?next=` value into somewhere it is safe to send a browser.
 *
 * Only a same-site absolute path survives: anything starting `//` or carrying
 * a scheme is an open redirect (`/login?next=//evil.example` would otherwise
 * hand a freshly-authenticated visitor to another origin), and a public path
 * is refused too — bouncing back to `/login` after a successful sign-in is the
 * loop this whole file exists to prevent. Everything else answers `/`.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  const path = next.split("?")[0].split("#")[0];
  return isPublicPath(path) ? "/" : next;
}
