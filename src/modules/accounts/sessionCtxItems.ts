/**
 * @file The session's rows on the UNIVERSAL band — every right-click in the
 * app, everywhere, session-aware.
 *
 * ## What was already there, and what this adds
 *
 * The step this file answers asks for three session entries on the universal
 * band: **Sign in** when signed out, **Sign out** and **Settings** when signed
 * in. Two of the three were already on every menu and are not repeated here:
 * core's `default-menu.ts` FLOOR carries the session row unconditionally, below
 * the universal band and unsuppressible by any area, precisely so that a menu
 * cannot vary in whether it has the basics. Contributing a second *Sign out*
 * one band above it would draw the same act twice, three rows apart, which is
 * the ambiguity the floor exists to prevent rather than a widening of coverage.
 *
 * So the same three are on every right-click — and this file is what made that
 * true, in two edits rather than two rows:
 *
 * 1. **Settings** and **Your account** are contributed below, session-gated.
 *    Neither existed anywhere on a menu before.
 * 2. The floor's **Sign in** was made REAL. It flipped core's stub store to
 *    `{ signedIn: true, user: "local" }`, so the chrome claimed a session that
 *    no `axs_session` cookie backed. `store.ts`'s core-session watcher now
 *    adapts that leg the same way it already adapted Sign out — see its
 *    docblock, which carries the whole reasoning.
 *
 * ## `ctx.item`, not a second mechanism
 *
 * A menu row a module puts in somebody else's area is an ordinary contribution
 * to the ordinary `ctx.item` point (core `ctx/contributions.ts`), which is why
 * the peel closure counts it for free. `when` rather than `enabledWhen` on both:
 * "you are not signed in" is not a temporary condition a reason could explain
 * away — it is which of two menus you are looking at.
 *
 * Data only, `import type` for everything but the helper, so this stays as
 * cheap to import as the decl beside it.
 */
import { ctxItems } from "@axf/core";
import type { Contribution, CtxItemPayload } from "@axf/core";

export const ACCOUNTS_SESSION_CTX_ITEMS: Contribution<CtxItemPayload>[] = ctxItems(
  "accounts",
  "universal",
  [
    {
      id: "account",
      label: "Your account",
      icon: "icon-account",
      command: "accounts.session.account",
      when: "accounts.signedIn",
      // Below the assistant's row (60) and above the app settings, so the two
      // session rows read as one pair rather than as two unrelated additions.
      order: 70
    },
    {
      id: "app-settings",
      label: "App settings",
      icon: "icon-gear",
      command: "accounts.session.settings",
      when: "accounts.signedIn",
      order: 72
    }
  ]
);
