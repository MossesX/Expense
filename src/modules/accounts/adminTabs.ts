"use client";

/**
 * @file `accounts.admin-tab` — the admin suite's COMPOSITION SEAM, host side.
 *
 * The suite is where administration lives. When another module grows something
 * only an administrator may do — a moderation queue, a quota console, a
 * retention sweep — the wrong answer is a second admin screen with its own nav
 * entry, its own gate and its own idea of what "administrator" means. The right
 * one is a tab in the suite that already holds the users table, the permission
 * matrix and the audit trail.
 *
 * So the suite declares a point and reads the registry, exactly as AmberArt does
 * for `amberart.tool` (`modules/amberart/host.ts`) and the Claude workspace does
 * for its two panels. Consequences worth stating, because they are the reason
 * this is a point rather than an import:
 *
 * - **Accounts imports no contributor.** `AdminSurface` reads
 *   `registry.contributionsTo()` and nothing else, so a module can put a tab in
 *   the suite without the suite ever naming it — and "what plugs in here" stays
 *   a question a machine can answer, which is what makes the peel computable.
 * - **The gate is the SUITE's, once.** A contributed tab renders inside the
 *   admin surface, which only exists for `permissions.administrator`. A wing
 *   that gated itself would be a second answer to the same question, and the
 *   second answer is the one that gets forgotten. (Its ROUTES still gate
 *   themselves — a screen is not a security boundary.)
 * - **The payload carries a `load` thunk, never a component.** Same rule the
 *   plugin points learned the hard way: a field holding a component drags a
 *   `.tsx` into a data import, and the closure resolver reads these declarations
 *   under plain Node. A thunk costs nothing and code-splits the tab.
 */

import * as React from "react";

import { registry } from "@axf/core";
import type { Contribution } from "@axf/core";

/**
 * The point id. Spelled again as a literal in `accounts.decl.ts`, which may
 * import nothing but types — the decl's hard rule, and the reason this is not
 * a shared constant. The two are pinned to each other by the registry itself:
 * a contribution to an id the decl does not declare is refused, loudly.
 */
export const ADMIN_TAB_POINT = "accounts.admin-tab";

/** What a contributor provides. Every field in `requires` is checked at
 *  registration, so a malformed contribution is refused BY NAME rather than
 *  rendering as a blank tab. */
export interface AdminTabPayload {
  /** Unique tab id — also the Tabs value. */
  readonly id: string;
  /** The tab's label. */
  readonly title: string;
  /** A branding-pack glyph id. Icons are never Material here. */
  readonly glyph?: string;
  /** One line the tab shows above its content, so a tab is self-describing. */
  readonly summary?: string;
  /** How to LOAD the panel — a thunk, never the component itself. */
  readonly load: () => Promise<{ default: React.ComponentType }>;
}

export type AdminTabContribution = Contribution<AdminTabPayload>;

/** A contributed tab, flattened with the module that brought it. */
export interface ResolvedAdminTab extends Omit<AdminTabPayload, "load"> {
  readonly from: string;
  readonly Pane: React.LazyExoticComponent<React.ComponentType>;
}

/**
 * Every contributed tab, in the point's order (priority, then id).
 *
 * Read per mount rather than subscribed: contributions arrive during boot,
 * before any route renders, and a tab registered later needs a remount — which
 * is what a dev reload does anyway. Same call the AmberArt rail makes, for the
 * same reason.
 */
export function useContributedAdminTabs(): ResolvedAdminTab[] {
  return React.useMemo(() => {
    return registry.contributionsTo<AdminTabPayload>(ADMIN_TAB_POINT).map(({ payload, from }) => {
      const { load, ...rest } = payload;
      return { ...rest, from, Pane: React.lazy(load) };
    });
  }, []);
}
