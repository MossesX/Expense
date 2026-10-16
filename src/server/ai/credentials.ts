/**
 * @file The two Claude credentials, per signed-in user, with the container's
 * environment as a fallback for each (ported from xGallery's `getAiSettings`;
 * owner, 2026-10-16: *"connect to Claude subscription and fallback to api"*).
 *
 *   1. **Claude subscription** — a long-lived OAuth token from `claude
 *      setup-token`, used by Claude Code's CLI. Saved under the user's
 *      `expenses-ai-secret` kv namespace, else `CLAUDE_CODE_OAUTH_TOKEN`.
 *   2. **Anthropic API key** — the backup, billed per token. Same namespace,
 *      else `ANTHROPIC_API_KEY`.
 *
 * The `*-secret` namespace is written only by `/api/ai/settings` and is never
 * served by the generic kv route; the browser only ever sees masked forms.
 * **Node-only.**
 */
import Anthropic from "@anthropic-ai/sdk";

import { axfKv } from "../axfKv";

export const AI_SECRET_NS = "expenses-ai-secret";

/** A pasted token or key with every space and line break removed — a wrapped
 *  paste from a phone or an email arrives with them (owner, 2026-10-16). */
export const cleanSecret = (s: string): string => s.replace(/\s+/g, "");

export type CredentialSource = "none" | "settings" | "env";

export interface Credentials {
  subscriptionToken: string;
  apiKey: string;
  sources: { subscription: CredentialSource; api: CredentialSource };
}

interface SecretDoc {
  subscriptionToken?: string;
  apiKey?: string;
}

async function readSecrets(user: string): Promise<SecretDoc> {
  const doc = (await axfKv.read(user, AI_SECRET_NS)) as SecretDoc | null;
  return {
    subscriptionToken: typeof doc?.subscriptionToken === "string" ? cleanSecret(doc.subscriptionToken) : "",
    apiKey: typeof doc?.apiKey === "string" ? cleanSecret(doc.apiKey) : ""
  };
}

export async function getCredentials(user: string): Promise<Credentials> {
  const saved = await readSecrets(user);
  const envSub = cleanSecret(process.env.CLAUDE_CODE_OAUTH_TOKEN ?? "");
  const envKey = cleanSecret(process.env.ANTHROPIC_API_KEY ?? "");
  return {
    subscriptionToken: saved.subscriptionToken || envSub,
    apiKey: saved.apiKey || envKey,
    sources: {
      subscription: saved.subscriptionToken ? "settings" : envSub ? "env" : "none",
      api: saved.apiKey ? "settings" : envKey ? "env" : "none"
    }
  };
}

export async function saveCredentials(user: string, patch: { subscriptionToken?: string | null; apiKey?: string | null }): Promise<void> {
  const cur = await readSecrets(user);
  const next: SecretDoc = { ...cur };
  if (patch.subscriptionToken === null) next.subscriptionToken = "";
  else if (typeof patch.subscriptionToken === "string" && cleanSecret(patch.subscriptionToken)) next.subscriptionToken = cleanSecret(patch.subscriptionToken);
  if (patch.apiKey === null) next.apiKey = "";
  else if (typeof patch.apiKey === "string" && cleanSecret(patch.apiKey)) next.apiKey = cleanSecret(patch.apiKey);
  if (!next.subscriptionToken && !next.apiKey) await axfKv.remove(user, AI_SECRET_NS);
  else await axfKv.write(user, AI_SECRET_NS, { ...next, updatedAt: new Date().toISOString() });
}

export const maskKey = (key: string): string => (key.length <= 10 ? "••••" : `${key.slice(0, 7)}…${key.slice(-4)}`);

/** An SDK client on the API key, or null. The subscription has no SDK client — it runs through the CLI. */
export async function apiClient(user: string): Promise<Anthropic | null> {
  const c = await getCredentials(user);
  return c.apiKey ? new Anthropic({ apiKey: c.apiKey }) : null;
}
