/**
 * @file The accounts module's settings — a typed ADAPTER over the core store,
 * in the taskman shape: the module's typed view of the one framework store, so
 * the store's poll loop and the messenger/roster surfaces read
 * `AccountsSettings` fields rather than a `Record<string, SettingValue>`.
 *
 * The minimal-sui ceiling stands (owner, 2026-08-11): a setting earns its
 * place only when the surface cannot work properly without it. The three
 * original rows pass that test — the poll cadence decides how stale a signed-in
 * tab without a live stream may go, and the two booleans decide what the roster
 * and the admin tables can physically fit on screen. Considered and refused, so
 * the next session does not re-propose them: a presence on/off switch (presence
 * IS the stream; a switch would make "online" a preference), an unread-badge
 * toggle (an unread count you can hide is a message you lose), avatar-size /
 * theme knobs (the theme engine owns appearance), and a session-length knob
 * (`AXS_SESSION_HOURS` is a server-side security constant, not a preference).
 *
 * ── the two P8 rows, and why a MODE clears a ceiling a knob would not ─────────
 *
 * `floatablePanes` and `editUi` (2026-08-15) each gate a whole interaction
 * mode. That is the distinction worth keeping, because it is what stops this
 * file becoming the settings fleet the ceiling exists to prevent: a knob that
 * TUNES a behaviour has to prove the surface cannot work without the tuning,
 * and almost none can. A switch that decides whether a behaviour EXISTS is a
 * different animal — with `floatablePanes` off there is no drag to configure,
 * no arrangement to persist and no handle on screen, and the studio is byte-for
 * byte the static app it was; with it on, a person who cannot find their
 * toolbar has a real problem. The owner asked for both by name, and the
 * fallback for each is not "a slightly worse default" but "the feature is
 * absent".
 *
 * Refused ALONGSIDE them, for the same reason the six above were — every one of
 * these is a knob on a mode that is already switched, and the mode's own
 * default answers it:
 *
 *   · a snap-distance slider — `DOCK_SNAP_RANGE_PX` is 48px because that is
 *     what feels like an edge; a person tuning it is a person the default
 *     failed, and the fix is the default;
 *   · "remember layouts" — a layout that does not survive a reload is a layout
 *     nobody arranges twice, so persistence is the feature, not an option on it;
 *   · a per-toolbar "floatable" switch — that is fifty rows for one behaviour,
 *     and the drag handle already IS the per-bar affordance;
 *   · "show dock zones while dragging" — the ghost and the edges are how the
 *     flip is visible at all; hiding them makes the mode worse and nothing else;
 *   · a default float size — `DOCK_DEFAULT_FLOAT_SIZE` is what a panel measures
 *     before anyone has resized it, and after that the resize IS the setting.
 */
"use client";

import { getModuleSettings, settings as settingsRegistry, useModuleSettings } from "@axf/core";

export interface AccountsSettings {
  /** Seconds between message/thread polls while the presence stream is down.
   *  The stream is the primary channel; this is the fallback cadence. */
  messagePollSeconds: number;
  /** Show signed-out members in the roster (off = online members only). */
  showOfflineMembers: boolean;
  /** Tight row height in the member directory and the admin tables. */
  denseTables: boolean;
  /** Module panes and toolbars may float, snap-mount and flip (IDE style),
   *  with the arrangement kept per user. Off is the static studio, exactly. */
  floatablePanes: boolean;
  /** The chrome may be REARRANGED right now — handles on the command bar and
   *  module toolbars. Administrators only, and gated twice: the row carries
   *  `gate: "accounts.administrator"` so it is not offered to anyone else, and
   *  `./lib/chromeEditing.ts` ANDs the value with the live role, so a value set
   *  before a demotion (or written straight into the kv doc) does not grant it. */
  editUi: boolean;
}

export const DEFAULT_SETTINGS: AccountsSettings = {
  messagePollSeconds: 5,
  showOfflineMembers: true,
  denseTables: false,
  floatablePanes: false,
  editUi: false
};

const OWNER = "accounts";

/** Read the settings outside React — what the store's poll loop uses. Merged
 *  over the defaults so a read before registration (a bare unit test) still
 *  answers with the declared shape. */
export function getAccountsSettings(): AccountsSettings {
  return { ...DEFAULT_SETTINGS, ...getModuleSettings(OWNER) };
}

/** Live settings inside a component; safe under SSR (server sees defaults). */
export function useAccountsSettings(): AccountsSettings {
  const values = useModuleSettings(OWNER);
  return { ...DEFAULT_SETTINGS, ...values };
}

/** The write half, shaped like taskman's so call sites read the same:
 *  `accountsSettings.set("denseTables", true)`. */
export const accountsSettings = {
  getState: getAccountsSettings,
  set<K extends keyof AccountsSettings>(key: K, value: AccountsSettings[K]): void {
    settingsRegistry.get(OWNER)?.set(key, value);
  },
  reset(): void {
    settingsRegistry.get(OWNER)?.reset();
  },
  subscribe(fn: () => void): () => void {
    return settingsRegistry.get(OWNER)?.subscribe(fn) ?? (() => {});
  }
};
