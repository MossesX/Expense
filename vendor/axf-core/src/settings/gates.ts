/**
 * @file Named GATES for settings rows — "should this person be offered this
 * switch at all", answered by a NAME the host resolves.
 *
 * ## Why this exists, and why core does not know what a "role" is
 *
 * The admin `Edit UI` switch (P8) is the first row in the framework that is
 * genuinely not everybody's: rearranging the app's chrome is an administrator's
 * job, and a switch offered to somebody who cannot use it is a control that
 * lies. But `SettingRow` is DATA on the module contract, `SettingsDialog` is
 * core's, and core has no idea what an administrator is — its own
 * `auth/session.ts` carries `signedIn` and a display name and deliberately
 * nothing else, because "AmberX has no authentication yet" was true when it was
 * written and roles arrived later, in a MODULE.
 *
 * So the row names a gate and core resolves it the way it resolves every other
 * behaviour that belongs to somebody else: by name, through a registry, at the
 * moment it is needed. `accounts` registers `accounts.administrator`; core
 * never learns what it means.
 *
 * ## Fail-OPEN, deliberately
 *
 * An unregistered gate renders the row. That is the opposite of the default a
 * permission check would take, and it is right here for the reason this
 * codebase states everywhere it hides something: **hiding a row is not a
 * security boundary.** A gate decides what is worth putting in front of
 * somebody; the thing the switch controls is refused (or simply inert) on its
 * own terms. Failing closed would mean a peel that took a module and left the
 * module that registers its gate silently loses settings, with nothing on
 * screen to say why — settings that vanish are far more expensive than settings
 * that appear.
 *
 * A registration is therefore reported when it REPLACES nothing and when it is
 * consulted before it exists, so the "why is my row missing" question has an
 * answer in the console rather than in a bisect.
 */
"use client";

import * as React from "react";

/** A gate: does the person looking at this dialog get this row? */
export type SettingsGate = () => boolean;

type Listener = () => void;

/**
 * Gate name → test. One entry per name, like the command registry and unlike a
 * `SurfaceRegistry`: there is no "active candidate" here, a name means one
 * thing. Re-registering the same name REPLACES, because a host re-evaluating
 * its module scope under HMR must not throw on its own second pass — the
 * command registry takes the same position for the same reason.
 */
export class SettingsGateRegistry {
  readonly #gates = new Map<string, SettingsGate>();
  readonly #missing = new Set<string>();
  readonly #listeners = new Set<Listener>();
  #version = 0;

  register(name: string, test: SettingsGate): () => void {
    if (!name.trim() || /\s/.test(name)) {
      throw new Error(`a settings gate name must be non-empty and contain no whitespace (got "${name}")`);
    }
    if (typeof test !== "function") {
      throw new Error(`settings gate "${name}" has no test function`);
    }
    this.#gates.set(name, test);
    this.#missing.delete(name);
    this.#bump();
    return () => {
      if (this.#gates.get(name) === test) {
        this.#gates.delete(name);
        this.#bump();
      }
    };
  }

  has(name: string): boolean {
    return this.#gates.has(name);
  }

  ids(): string[] {
    return [...this.#gates.keys()].sort();
  }

  /**
   * Does the row show? See the fail-open note above. A gate that THROWS is
   * treated as open for the same reason, and warns — one bad gate must not cost
   * the reader every setting the owner declares.
   */
  holds(name: string): boolean {
    const gate = this.#gates.get(name);
    if (!gate) {
      // Warned once per name: a dialog re-renders on every keystroke in a text
      // row, and a console line per frame is a console nobody reads.
      if (!this.#missing.has(name)) {
        this.#missing.add(name);
        if (typeof console !== "undefined") {
          console.warn(
            `[axf] no settings gate registered as "${name}" — the row is shown ` +
              `(gates fail open: hiding a row is not a security boundary)`
          );
        }
      }
      return true;
    }
    try {
      return gate() !== false;
    } catch (e) {
      if (typeof console !== "undefined") {
        console.warn(`[axf] settings gate "${name}" threw — the row is shown: ${String(e)}`);
      }
      return true;
    }
  }

  /** Tell readers a gate's ANSWER changed (a sign-in, a demotion). The gates
   *  themselves are plain functions and cannot notify, so whoever owns the
   *  state behind one calls this when it moves. */
  bump(): void {
    this.#bump();
  }

  #bump(): void {
    this.#version += 1;
    for (const fn of this.#listeners) fn();
  }

  version = (): number => this.#version;

  /** Zero on the server: no host has registered anything during an SSR pass,
   *  and a differing number would tear the dialog's first frame. */
  serverVersion = (): number => 0;

  subscribe = (fn: Listener): (() => void) => {
    this.#listeners.add(fn);
    return () => void this.#listeners.delete(fn);
  };
}

/** The process-wide gate registry. */
export const settingsGates = new SettingsGateRegistry();

/** Register a gate. The host calls this at subsystem start, beside its command
 *  registrations, for the same reason: a name resolved when it is needed. */
export function registerSettingsGate(name: string, test: SettingsGate): () => void {
  return settingsGates.register(name, test);
}

/** Re-render a settings surface when a gate is registered or announces a
 *  change. The value is a version counter and is not meant to be read. */
export function useSettingsGates(): number {
  return React.useSyncExternalStore(
    settingsGates.subscribe,
    settingsGates.version,
    settingsGates.serverVersion
  );
}
