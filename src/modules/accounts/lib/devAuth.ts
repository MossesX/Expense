/**
 * @file **Development auto-login** — the one place that decides whether the
 * session gate should sign somebody in instead of asking.
 *
 * Owner directive, 2026-08-15: *"remove auth gate for development keep signed in
 * as brett"*. On a development machine the gate is friction with nothing to
 * protect — every reload of a signed-out surface costs a sign-in, and the studio
 * gates every page.
 *
 * ## It MINTS a session; it does not bypass the gate
 *
 * The obvious implementation — "if dev, skip the check" — produces a
 * half-signed-in app that is worse than either state. The page gate would pass,
 * but `requireSession()` on every `/api/*` route would still refuse, `kvUser()`
 * would still resolve to the signed-out `local/` bucket, the accounts store
 * would still render as a stranger, and the right-click menu would still offer
 * "Sign in". Half the studio would work and the other half would fail in ways
 * that look like real bugs.
 *
 * So this issues a REAL `axs_session` token for a real account, exactly as
 * signing in would. Everything downstream is then correct by construction,
 * because nothing downstream can tell the difference — which is the point.
 *
 * ## Why it cannot leak into production
 *
 * Three independent conditions, checked HERE and nowhere else so there is one
 * answer to the question:
 *
 *   1. `NODE_ENV` must not be `production`. Read at module scope: a production
 *      build has this baked in and no request can change it.
 *   2. `AXF_DEV_USER` must be set. Running `next dev` is NOT enough — the
 *      feature is opt-in per machine, via `.env`, so a developer who does not
 *      want it never gets it and CI never gets it by accident.
 *   3. The named account must actually EXIST and be enabled, which the caller
 *      verifies against the real account store. A stale name signs nobody in
 *      rather than inventing a user.
 *
 * If the variable is set in a production build, that is a misconfiguration worth
 * shouting about rather than silently ignoring — see `devAuthUser`.
 */

/**
 * Read once, at module scope. A request cannot flip this, and a production
 * bundle has the comparison resolved at build time.
 */
const IS_PRODUCTION = process.env.NODE_ENV === "production";

/** The env var that turns it on, named for what it does. */
export const DEV_USER_ENV = "AXF_DEV_USER";

let warned = false;

/**
 * The username the gate should sign in automatically, or `null` when it should
 * do its normal job.
 *
 * Returns `null` in production ALWAYS, regardless of configuration — and warns
 * once when a production process was configured for it, because a silent ignore
 * would leave someone believing a machine is open when it is closed, or the
 * reverse.
 */
export function devAuthUser(): string | null {
  const configured = process.env[DEV_USER_ENV]?.trim();
  if (!configured) return null;

  if (IS_PRODUCTION) {
    if (!warned) {
      warned = true;
      console.error(
        `[accounts] ${DEV_USER_ENV}=${configured} is set in a PRODUCTION build and is being IGNORED. ` +
          `Development auto-login never applies in production; remove it from the environment.`
      );
    }
    return null;
  }

  return configured;
}

/** True when the gate is running in auto-login mode. Exported for surfaces that
 *  want to SAY so — an app that signs you in without asking should admit it. */
export function isDevAuthActive(): boolean {
  return devAuthUser() !== null;
}
