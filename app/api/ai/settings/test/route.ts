/** Verify one or both backends for real: a one-line turn through Claude Code, a model lookup on the API. */
import Anthropic from "@anthropic-ai/sdk";

import { cliOk } from "../../../../../src/server/ai/assistant";
import { pingCli } from "../../../../../src/server/ai/cli";
import { getCredentials } from "../../../../../src/server/ai/credentials";
import { caller, json, str } from "../../../../../src/server/ai/http";
import { savePrefs } from "../../../../../src/server/ai/store";
import { view } from "../route";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const c = await caller(request);
  const which = str((await json(request)).which, 20) || "both";
  const creds = await getCredentials(c.user);
  const out: { subscription?: { ok: boolean; detail: string }; api?: { ok: boolean; detail: string } } = {};
  if (which === "both" || which === "subscription") {
    if (!cliOk()) out.subscription = { ok: false, detail: "Claude Code CLI is not installed in this container" };
    else if (!creds.subscriptionToken) out.subscription = { ok: false, detail: "No subscription token saved" };
    else out.subscription = await pingCli(creds.subscriptionToken, c.model);
    await savePrefs(c.user, { subscriptionVerifiedAt: out.subscription.ok ? Date.now() : null, subscriptionVerifiedDetail: out.subscription.detail });
  }
  if (which === "both" || which === "api") {
    if (!creds.apiKey) out.api = { ok: false, detail: "No API key saved" };
    else {
      try {
        const client = new Anthropic({ apiKey: creds.apiKey, timeout: 20_000 });
        const m = await client.models.retrieve(c.model);
        out.api = { ok: true, detail: `Key accepted · ${m.display_name ?? c.model}` };
      } catch (e) {
        out.api = { ok: false, detail: e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : (e as Error).message };
      }
    }
    await savePrefs(c.user, { apiVerifiedAt: out.api.ok ? Date.now() : null, apiVerifiedDetail: out.api.detail });
  }
  return Response.json({ ...out, ...(await view(c.user)) });
}
