/**
 * @file The `/login` screen — the login card plus the one thing a card mounted
 * on its own route needs and a card mounted inside a module does not: knowing
 * where to go once the session exists.
 *
 * ## The return trip
 *
 * `proxy.ts` puts the intended path in `?next=`. It is read from
 * `window.location` in an effect rather than through `useSearchParams` because
 * this component only ever acts on it client-side, and reading it that way
 * keeps the route out of the Suspense-boundary requirement a search-param hook
 * imposes on every ancestor. `safeNext` decides what is followable — an
 * unvalidated `next` is an open redirect, and a `next` pointing back at
 * `/login` is an infinite bounce.
 *
 * ## Why a full navigation rather than a router push
 *
 * `window.location.replace` reloads through the server, which is the point: the
 * gate is a server-side check over a cookie that did not exist a moment ago, so
 * the destination has to be fetched with the new cookie attached. A client-side
 * push would hand back a route the router may already hold a signed-out render
 * of. `replace` rather than `assign` so Back does not walk into the login
 * screen the visitor has just left.
 *
 * The forced change-password step is NOT a stopping point here: the effect
 * waits for `mustChangePassword` to clear, so a temp-password sign-in stays on
 * this screen for the change and only then travels on.
 *
 * ## The assistant arrives open (2026-08-15)
 *
 * Owner directive: whatever a sign-in lands on opens with the module assistant
 * already up, so the first thing a person sees after the gate is something that
 * can be asked a question rather than a screen they have to find the chat on.
 *
 * It is fired HERE, on the way out, rather than by the landing page — because
 * "the landing" is not one route. `?next=` means a sign-in can land on any
 * surface in the studio, and the only thing every one of those arrivals has in
 * common is that it came through this screen. A flag on `/` would miss all of
 * them; a flag on every route is the per-route chrome mistake `StudioShell`'s
 * docblock already records.
 *
 * Firing it BEFORE the navigation works, and is not a trick: the assistant
 * store persists `open` to `sessionStorage` on every mutation (see its
 * `#persist`), and `sessionStorage` is per-TAB — it is the one thing that
 * survives the full document load `replace` performs. The window itself does
 * not exist on this route (`/login` renders `ChromelessShell`), which is
 * precisely why this goes through the command registry: a NAME resolved at the
 * moment it runs, not an import of a plugin this module must not depend on. If
 * the assistant is absent — a peel that took accounts and left the plugin —
 * `run` logs the miss and answers `false`, and the sign-in travels on
 * unchanged. Opening the assistant is never allowed to be a way to fail a
 * login, so the redirect is not conditional on it.
 *
 * `boot()` is awaited because the command is registered by the studio
 * subsystem's `start()`, and an unbooted registry would answer the same way an
 * absent plugin does — a silent no-op that looks like the feature is off. The
 * call is idempotent (`StudioShell` already started the same promise at module
 * scope), so the await is a join, not a second boot.
 *
 * ## Role landings (P8, 2026-08-15)
 *
 * An administrator signing in lands on the admin suite; everybody else lands on
 * the studio dashboard. It is decided HERE, in the same expression that already
 * decides the destination, for the reason the whole file exists: this is the
 * one place every arrival passes through, and it is the one place that knows
 * the answer at the moment it is needed. A redirect fired after the landing
 * page mounted would be a client-side guess — it would flash the wrong screen,
 * it would fight the browser's Back button, and it would have to be repeated on
 * every route an admin might land on.
 *
 * **`?next=` still wins, and that is the important half.** A person who was
 * sent to `/login` from somewhere is going back to that somewhere: the role
 * landing is what happens when nobody asked for anything, not an override of a
 * request. Sending an administrator who clicked a deep link to the admin
 * dashboard instead would make every bookmark in the studio unreliable for
 * exactly the people who use it most.
 *
 * Both destinations go through `safeNext`, so the landing cannot become a way
 * around the open-redirect check — it is a default handed to the same
 * sanitiser, never a second path to `window.location`.
 */
"use client";

import * as React from "react";

import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";

import { commands } from "@axf/core";

import LoginCard from "./LoginCard";
import { safeNext } from "./lib/publicPaths";
import { useAccountsState } from "./store";
import { boot } from "../../boot";

/** The command the studio's assistant plugin registers for "put the window up".
 *  A name, so this screen depends on the registry and not on the assistant. */
const OPEN_ASSISTANT = "assistant.open";

/**
 * Where an administrator lands: the admin suite's Dashboard tab.
 *
 * A URL rather than a component reference, because the destination has to
 * survive a full document load — the whole reason this screen uses
 * `location.replace`. `AccountsModule` and `AdminPane` read these two
 * parameters, which also makes the tab deep-linkable for everybody: the same
 * mechanism that lands a sign-in is the one that makes an admin surface
 * bookmarkable, and one mechanism is why there is no second one to keep in step.
 */
const ADMIN_LANDING = "/accounts?surface=admin&tab=dashboard";

/** Where everybody else lands: the studio dashboard. */
const USER_LANDING = "/";

export default function LoginScreen() {
  const state = useAccountsState();
  const done = state.loaded && state.session !== null && !state.session.mustChangePassword;
  // The verdict, not the raw role: `effectivePermissions` is what every other
  // gate in the studio asks, and asking a second source here is how two answers
  // to one question start disagreeing.
  const administrator = state.permissions?.administrator === true;

  React.useEffect(() => {
    if (!done || typeof window === "undefined") return;
    const asked = new URLSearchParams(window.location.search).get("next");
    const next = safeNext(asked ?? (administrator ? ADMIN_LANDING : USER_LANDING));
    let alive = true;
    void boot()
      .catch(() => undefined)
      .then(() => {
        if (!alive) return;
        commands.run(OPEN_ASSISTANT);
        window.location.replace(next);
      });
    return () => {
      alive = false;
    };
  }, [done, administrator]);

  // Until the first session probe answers there is nothing honest to draw: the
  // server render is signed-out by construction (`./store`), so painting the
  // card here would flash a login form at somebody who is already signed in.
  if (!state.loaded || done) {
    return (
      <Box sx={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CircularProgress size={26} />
      </Box>
    );
  }

  return <LoginCard me={state.session} />;
}
