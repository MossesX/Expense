/**
 * @file `/api/ai/settings` — the assistant's connection and persona for the
 * signed-in user. GET answers masked (never a secret); PUT saves a patch:
 * { assistantName?, extraInstructions?, subscriptionToken?, apiKey?,
 *   clearSubscriptionToken?, clearApiKey? }.
 */
import { cliOk } from "../../../../src/server/ai/assistant";
import { getCredentials, maskKey, saveCredentials } from "../../../../src/server/ai/credentials";
import { caller, json, str } from "../../../../src/server/ai/http";
import { getPrefs, savePrefs, usage } from "../../../../src/server/ai/store";
import { sourceVersion } from "../../../../src/server/ai/workspace";

export const dynamic = "force-dynamic";

export async function view(user: string) {
  const [prefs, creds, used] = await Promise.all([getPrefs(user), getCredentials(user), usage(user)]);
  return {
    settings: {
      ...prefs,
      hasSubscriptionToken: !!creds.subscriptionToken,
      hasApiKey: !!creds.apiKey,
      subscriptionMasked: creds.subscriptionToken ? maskKey(creds.subscriptionToken) : null,
      apiKeyMasked: creds.apiKey ? maskKey(creds.apiKey) : null,
      sources: creds.sources,
      usage: used
    },
    cliInstalled: cliOk(),
    sourceVersion: sourceVersion()
  };
}

export async function GET(request: Request): Promise<Response> {
  const c = await caller(request);
  return Response.json(await view(c.user));
}

export async function PUT(request: Request): Promise<Response> {
  const c = await caller(request);
  const b = await json(request);
  const prefsPatch: Record<string, unknown> = {};
  if (typeof b.assistantName === "string") prefsPatch.assistantName = b.assistantName;
  if (typeof b.extraInstructions === "string") prefsPatch.extraInstructions = b.extraInstructions;
  const credPatch: { subscriptionToken?: string | null; apiKey?: string | null } = {};
  if (b.clearSubscriptionToken === true) credPatch.subscriptionToken = null;
  else if (str(b.subscriptionToken, 4000).trim()) credPatch.subscriptionToken = str(b.subscriptionToken, 4000);
  if (b.clearApiKey === true) credPatch.apiKey = null;
  else if (str(b.apiKey, 4000).trim()) credPatch.apiKey = str(b.apiKey, 4000);
  if ("subscriptionToken" in credPatch) Object.assign(prefsPatch, { subscriptionVerifiedAt: null, subscriptionVerifiedDetail: "" });
  if ("apiKey" in credPatch) Object.assign(prefsPatch, { apiVerifiedAt: null, apiVerifiedDetail: "" });
  if (Object.keys(credPatch).length) await saveCredentials(c.user, credPatch);
  if (Object.keys(prefsPatch).length) await savePrefs(c.user, prefsPatch);
  return Response.json(await view(c.user));
}
