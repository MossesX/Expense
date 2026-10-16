/**
 * @file Expense vault layout — per-user subtrees under one root (P2 of
 * `default-state`).
 *
 *     data/axf/expenses/<user>/reports/*.{html,md}
 *     data/axf/expenses/<user>/saves/*.json
 *
 * The same scoping the kv store gets from `kvUser()`: the signed-in username
 * owns the subtree, `"local"` owns the signed-out one. This is its own module
 * because TWO consumers must agree on the path and must never drift: the
 * `/api/expenses/files` route (reads and writes a user's vault) and the
 * accounts module's factory reset (deletes exactly one user's subtree and
 * nothing else). **Node-path only, server-only** — never import from a client
 * component.
 */
import path from "node:path";

import { dataPath } from "./dataRoot";

export const EXPENSES_VAULT_ROOT = dataPath("axf", "expenses");

/** Same username grammar the accounts store enforces at creation — the
 *  session is trusted for identity, this guard is for path hygiene only. */
const USER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,31}$/;

/** One user's vault subtree, or `null` when the name cannot be a directory. */
export function expensesUserDir(username: string): string | null {
  if (!USER_RE.test(username)) return null;
  return path.join(EXPENSES_VAULT_ROOT, username);
}
