/**
 * @file The studio's half of core's dock/float engine (P8): where a layout is
 * KEPT, who may rearrange one, and the two settings that switch the whole thing
 * on.
 *
 * Core owns the geometry and the interaction and deliberately owns neither of
 * those answers — `dock/store.ts` takes a `DockPersistence` argument because it
 * has no transport, and `dockMode` is a pair of booleans a host pushes in
 * because core has no idea what an administrator is. This file is that host.
 *
 * ## The adapter is the settings spine, batched HERE
 *
 * Layouts persist through the same per-user kv transport every module's
 * settings document uses (`/api/axf/kv/<ns>`, keyed off the `axs_session`
 * cookie by `kvUser()`), so an arrangement follows the person across browsers
 * rather than living in one profile's `localStorage`.
 *
 * They are NOT settings ROWS, and the distinction is core's own: a setting is a
 * scalar with a control, and *"a setting that needs a structure is a document,
 * and documents belong to the module's own store"* (`settings/decl.ts`). A dock
 * state is a structure. So it is one document — `dock-layouts` — holding every
 * panel this person has moved.
 *
 * Core's adapter contract is per-ID (`load(id)`), which is what lets the
 * batching live here: eight floatable panels asking at once share ONE read
 * behind `#doc`, and core never learns that its eight calls were one request.
 * Writes are debounced for the same reason in reverse — a drag calls `save` on
 * every pointer move, and a PUT per frame would be a request storm nobody
 * asked for. The final state always lands because the timer is reset, not
 * skipped.
 *
 * ## Two gates on one switch, and why that is not belt-and-braces
 *
 * `editUi` is offered only to administrators (core's `SettingRow.gate`, 0.0.23)
 * AND the mode is `value && administrator`. Those are different claims: the
 * first is about what is worth putting on screen, the second is what actually
 * decides. Core's gate deliberately FAILS OPEN — an unregistered gate shows its
 * row — so the visibility half is by design not a boundary, and something has
 * to be. The `&&` below is it. A person demoted mid-session loses edit mode on
 * the next permission probe without anyone writing to their settings document,
 * which is also why the mode is derived on every render rather than latched.
 *
 * Note what is NOT claimed: this is not a security boundary either, and does
 * not need to be. Nothing edit mode reaches is privileged — the worst a forced
 * `editUi` buys is the ability to rearrange your own chrome, which the other
 * switch grants outright.
 */
"use client";

import * as React from "react";

import {
  commands,
  defaultKv,
  dockLayouts,
  dockMode,
  registerSettingsGate,
  settingsGates
} from "@axf/core";
import type { DockPersistence, DockState } from "@axf/core";

import { accountsStore, useAccountsState } from "../store";
import { useAccountsSettings } from "../settings";

/** The kv namespace holding every panel this user has arranged. */
export const DOCK_LAYOUTS_NS = "dock-layouts";

/** The gate name `accounts.decl.ts` spells on the `editUi` row. Spelled twice
 *  on purpose — the decl may import nothing but types, which is the same rule
 *  (and the same reason) as `ADMIN_TAB_POINT` in `../adminTabs`. */
export const ADMIN_GATE = "accounts.administrator";

const DOC_VERSION = 1;
/** Long enough that a drag is one write, short enough that a person who drags
 *  and immediately closes the tab keeps their arrangement. */
const WRITE_DEBOUNCE_MS = 250;

/** Is the signed-in user an administrator, right now? Read from the store
 *  rather than a React hook: the gate is a plain function core calls, and the
 *  reset commands are fired from a context menu that has no hooks either. */
export function isAdministrator(): boolean {
  return accountsStore.getState().permissions?.administrator === true;
}

/**
 * The per-user kv adapter. One document, one shared read, debounced writes.
 *
 * A failed read leaves the defaults standing and is never written back — one
 * dropped request must not wipe an arrangement, the rule every store in this
 * codebase states and `ToolbarPrefsStore` states most explicitly.
 */
export function kvDockPersistence(): DockPersistence {
  const kv = defaultKv();
  let doc: Promise<Record<string, unknown>> | null = null;
  /** What has changed since the last PUT, merged over what was read. */
  let pending: Record<string, DockState | null> = {};
  let timer: ReturnType<typeof setTimeout> | null = null;

  const read = (): Promise<Record<string, unknown>> => {
    doc ??= Promise.resolve(kv.read(DOCK_LAYOUTS_NS))
      .then((d) => {
        if (!d || d.v !== DOC_VERSION) return {};
        const panels = (d as { panels?: unknown }).panels;
        return typeof panels === "object" && panels !== null && !Array.isArray(panels)
          ? (panels as Record<string, unknown>)
          : {};
      })
      .catch(() => ({}));
    return doc;
  };

  const flush = async (): Promise<void> => {
    timer = null;
    const batch = pending;
    pending = {};
    if (!Object.keys(batch).length) return;
    const base = { ...(await read()) };
    for (const [id, state] of Object.entries(batch)) {
      if (state) base[id] = state;
      else delete base[id];
    }
    // The in-memory document is the one the next `load` answers from, so it has
    // to advance whether or not the PUT lands — otherwise a panel re-registered
    // after a failed write reads back its pre-drag place.
    doc = Promise.resolve(base);
    await kv.write(DOCK_LAYOUTS_NS, { v: DOC_VERSION, panels: base }).catch(() => {
      // Route down: the arrangement holds for the session.
    });
  };

  return {
    load: async (id) => (await read())[id] ?? null,
    save: (id, state) => {
      pending[id] = state;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void flush(), WRITE_DEBOUNCE_MS);
    }
  };
}

/* ── the reset affordances ────────────────────────────────────────────────── */

/** The global reset, as a NAME. */
export const RESET_LAYOUTS_COMMAND = "ui.layout.reset-all";

/**
 * The way back, as a command.
 *
 * `<Floatable>` already draws a reset beside every handle it renders, which is
 * the per-panel affordance and the one that matters most — it travels with the
 * thing that can be lost. This is the OTHER case: a panel dragged somewhere its
 * own handle is hard to reach, or one whose id the person has no way to name.
 * A command rather than only a button, so a menu row, a hotkey and a bar item
 * can all fire it without any of them importing the engine.
 *
 * `CommandHandler` takes no argument (core: *"everything except `run` is
 * DATA"*), so there is deliberately no per-id variant here — the per-id reset
 * is the handle's button, where the id is already known.
 *
 * Guarded on `has` rather than a module flag: core's registry throws on a
 * duplicate id, and under HMR this module can re-evaluate while core's registry
 * does not.
 */
export function registerLayoutCommands(): void {
  if (commands.has(RESET_LAYOUTS_COMMAND)) return;
  commands.register({
    id: RESET_LAYOUTS_COMMAND,
    title: "Reset every toolbar and pane layout",
    icon: "icon-undo",
    run: () => dockLayouts.resetAll()
  });
}

/* ── the bridge ───────────────────────────────────────────────────────────── */

let installed = false;

/**
 * Install the adapter and the gate ONCE per runtime, then keep core's mode
 * switches in step with this user's settings and role.
 *
 * Mounted by `StudioShell`, so it is on every route — a layout that only
 * applied on the screens that remembered to mount something is the per-route
 * chrome mistake the shell's own docblock records. Renders nothing.
 */
export function ChromeEditingBridge(): null {
  const settings = useAccountsSettings();
  const { permissions, session } = useAccountsState();
  const administrator = permissions?.administrator === true;

  // The adapter needs a signed-in user to key its document, so it is installed
  // in an effect rather than at module scope — and re-installed when the user
  // changes, which re-reads every panel already registered (`install()` says
  // so). Without that, signing in as somebody else would show their chrome the
  // previous user's arrangement until a reload.
  React.useEffect(() => {
    if (!installed) {
      installed = true;
      if (!settingsGates.has(ADMIN_GATE)) registerSettingsGate(ADMIN_GATE, isAdministrator);
      registerLayoutCommands();
    }
    dockLayouts.install(kvDockPersistence());
  }, [session?.username]);

  // Core's gate is a plain function and cannot announce that its ANSWER moved,
  // so the thing that knows — this component, watching the permission probe —
  // tells it. Without this a dialog left open across a promotion keeps hiding
  // the row the person has just earned.
  React.useEffect(() => {
    settingsGates.bump();
  }, [administrator]);

  React.useEffect(() => {
    dockMode.set({
      // See the docblock: the `&&` is what decides, the row's `gate` only
      // decides what is worth showing.
      editing: settings.editUi && administrator,
      floatable: settings.floatablePanes
    });
  }, [settings.editUi, settings.floatablePanes, administrator]);

  return null;
}
