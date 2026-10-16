/**
 * @file Claude subsystem data layout — per-user subtrees under the two roots
 * (P2 of `default-state`).
 *
 *     data/claude/conversations/<user>/<uuid>.json
 *     data/claude/projects/<user>/<uuid>.json
 *
 * The same scoping the kv store gets from `kvUser()`: the signed-in username
 * owns the subtree, `"local"` owns the signed-out one. This is its own module
 * for the reason `expensesPaths.ts` is one: TWO consumers must agree on the
 * path and must never drift — the Claude stores (`src/claude/{store,projects}`)
 * read and write a user's subtree, and the accounts module's factory reset
 * deletes exactly one user's subtree and nothing else. It deliberately imports
 * nothing of the subsystem, so the accounts module can name the paths without
 * touching `claude/store` — the consumer-proof greps refuse that import for
 * good reason. **Node-path only, server-only** — never import from a client
 * component.
 */
import path from "node:path";

import { dataPath } from "./dataRoot";

export const CLAUDE_CONVERSATIONS_ROOT = dataPath("claude", "conversations");

export const CLAUDE_PROJECTS_ROOT = dataPath("claude", "projects");

/** Same username grammar the accounts store enforces at creation — the
 *  session is trusted for identity, this guard is for path hygiene only. */
const USER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,31}$/;

/** One user's conversations subtree, or `null` when the name cannot be a
 *  directory. */
export function claudeConversationsUserDir(username: string): string | null {
  if (!USER_RE.test(username)) return null;
  return path.join(CLAUDE_CONVERSATIONS_ROOT, username);
}

/** One user's projects subtree, or `null` when the name cannot be a directory. */
export function claudeProjectsUserDir(username: string): string | null {
  if (!USER_RE.test(username)) return null;
  return path.join(CLAUDE_PROJECTS_ROOT, username);
}
