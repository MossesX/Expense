/**
 * @file Shared bits for the `/api/ai/*` routes: who is asking (and their
 * display name), and the model/connection the person's settings name.
 * **Node-only.**
 */
import { findAccount } from "@axs/modules/accounts/lib/accounts";

import { axfKv, kvUser } from "../axfKv";

export interface Caller {
  user: string;
  screenname: string;
  model: string;
  connection: "auto" | "server" | "user-key";
}

const MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"]);

export async function caller(request: Request): Promise<Caller> {
  const user = kvUser(request);
  const [account, settings] = await Promise.all([findAccount(user).catch(() => null), axfKv.read(user, "expenses-settings")]);
  const s = (settings as { settings?: Record<string, unknown> } | null)?.settings ?? {};
  const model = typeof s.aiModel === "string" && MODELS.has(s.aiModel) ? s.aiModel : "claude-opus-5-5";
  const connection = s.aiMode === "server" || s.aiMode === "user-key" ? s.aiMode : "auto";
  return { user, screenname: (account as { screenname?: string } | null)?.screenname || user, model, connection };
}

export async function json(request: Request): Promise<Record<string, unknown>> {
  try {
    const b = await request.json();
    return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
