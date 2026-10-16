/**
 * @file The assistant turn — subscription backend first, API fallback, both
 * sides persisted — and the prompts that make it THIS app's assistant.
 * Ported from xGallery's `ai/index.ts`; the modes are the port's own
 * (owner, 2026-10-16: *"switch for build and source code editing"*):
 *
 *   - **chat**  reads the source snapshot; may not change a file.
 *   - **edit**  edits a writable workspace copy; the diff is the review.
 *   - **build** edit, plus typecheck/build commands, with a git checkpoint
 *               before every turn and the changed files listed after it.
 *
 * Everything the assistant can touch is the per-user workspace copy under the
 * data directory — never the running app's files. **Node-only.**
 */
import { cliAvailable, runCli } from "./cli";
import { runApi } from "./api";
import { getCredentials } from "./credentials";
import { appendMessage, getConversation, getPrefs, updateConversation } from "./store";
import type { AssistantMode, PageContext, RunResult, StreamEvent } from "./types";
import { SOURCE_DIR, changedSince, checkpoint, codebaseOverview, ensureWorkspace, sourceVersion } from "./workspace";

let cliCache: { at: number; ok: boolean } | null = null;
export function cliOk(): boolean {
  if (!cliCache || Date.now() - cliCache.at > 60_000) cliCache = { at: Date.now(), ok: cliAvailable() };
  return cliCache.ok;
}

export interface AiStatus {
  assistantName: string;
  model: string;
  backends: { subscription: boolean; api: boolean };
  cliInstalled: boolean;
  sourceVersion: string;
}

export async function aiStatus(user: string, model: string): Promise<AiStatus> {
  const [prefs, creds] = await Promise.all([getPrefs(user), getCredentials(user)]);
  return {
    assistantName: prefs.assistantName,
    model,
    backends: { subscription: !!creds.subscriptionToken && cliOk(), api: !!creds.apiKey },
    cliInstalled: cliOk(),
    sourceVersion: sourceVersion()
  };
}

const APP_BLURB =
  "the AmberX Expense Tracker — a receipt-shaped expense ledger (an editable grid with line items and reconciliation, a rollup tree, " +
  "period statements and reports, paydays written from a schedule, bank-statement import by paste, CSV or photo with multi-check duplicate " +
  "detection, a welcome dialog, tabbed settings with a theme designer, and an Accounts companion for sign-in, members, messaging and admin). " +
  "It is a Next.js 16 app peeled from the AmberX studio: `app/` holds the routes, `src/modules/expenses/` the ledger module, " +
  "`src/modules/accounts/` the accounts companion, `vendor/axf-core/` the vendored framework (@axf/core: registry, commands, context menus, " +
  "settings, theme dials, toolbars), `src/server/` the Node-only server helpers, and it deploys as a Docker container on a VPS behind Traefik " +
  "on every push to main.";

function modeParagraph(mode: AssistantMode, cwd: string): string {
  switch (mode) {
    case "chat":
      return `Mode: CHAT. Source of truth is the read-only snapshot at ${cwd} (version ${sourceVersion()}). You can read and search it but must not modify files. If someone asks for a change, describe it precisely (files, functions, the diff) so they can switch to Edit or Build mode and have it applied.`;
    case "edit":
      return `Mode: EDIT SOURCE. Your working directory ${cwd} is a writable git workspace copied from snapshot ${sourceVersion()}. You may create, edit and delete files. Keep changes minimal and consistent with the existing style, keep server and client types in sync, and explain what you changed and why; the person reviews the resulting diff and can download it as a patch. Never touch secrets or the data directory.`;
    case "build":
      return `Mode: BUILD. Your working directory ${cwd} is a writable git workspace copied from snapshot ${sourceVersion()}. You have full access: read, search, create, edit and delete files, and run the typecheck (and build) to prove your change. A git checkpoint is taken before every turn and every file you change is listed after it, so work decisively and finish every change you start. End each turn with a short "Changes" list: file paths and what changed, plus anything the person must do (install a dependency, rebuild, redeploy). Nothing you do here touches the running app until the person applies the patch and deploys. Never write secrets into files, never touch the data directory, and never run destructive shell commands.`;
  }
}

export async function buildSystemPrompt(user: string, screenname: string, mode: AssistantMode, cwd: string, ctx?: PageContext): Promise<string> {
  const prefs = await getPrefs(user);
  const parts: string[] = [];
  parts.push(`You are ${prefs.assistantName}, the built-in assistant of ${APP_BLURB}`);
  parts.push(
    "You know this application inside out — its features and its source, which you can inspect with your file tools. Answer questions about how the app works, help people use it, explain and troubleshoot behaviour by reading the actual code, and give precise, well-structured answers. Prefer short paragraphs and lists; use code blocks for code, commands and file paths. Read files before making claims about code."
  );
  parts.push(`The person you are talking to is ${screenname} (@${user}).`);
  parts.push(modeParagraph(mode, cwd));
  if (ctx?.url || ctx?.selection || ctx?.element) {
    parts.push(`Current page context: ${ctx.url ? `URL ${ctx.url}` : ""}${ctx.title ? ` · title "${ctx.title}"` : ""}${ctx.element ? ` · right-clicked element: ${ctx.element}` : ""}${ctx.selection ? `\nSelected text:\n"""\n${ctx.selection.slice(0, 2000)}\n"""` : ""}`);
  }
  if (prefs.extraInstructions.trim()) parts.push(`Owner instructions:\n${prefs.extraInstructions.trim()}`);
  parts.push(`\n${codebaseOverview(cwd)}`);
  return parts.join("\n\n");
}

export interface AssistantTurn {
  user: string;
  screenname: string;
  conversationId: number;
  prompt: string;
  model: string;
  /** "auto" tries the subscription then the API; the others use one source alone. */
  connection: "auto" | "server" | "user-key";
  context?: PageContext;
  onEvent: (e: StreamEvent) => void;
  signal?: AbortSignal;
}

/** Run one assistant turn: subscription backend first, API fallback, persisting both sides. */
export async function assistantTurn(t: AssistantTurn): Promise<{ result: RunResult; messageId: number; changedFiles: string[] }> {
  const conv = await getConversation(t.user, t.conversationId);
  if (!conv) throw new Error("Conversation not found");
  const creds = await getCredentials(t.user);
  const mode = conv.mode;
  const cwd = mode === "chat" ? SOURCE_DIR : ensureWorkspace(t.user);
  const system = await buildSystemPrompt(t.user, t.screenname, mode, cwd, t.context);
  let beforeSha = "";
  if (mode === "build") {
    t.onEvent({ type: "status", text: "Checkpointing the workspace…" });
    beforeSha = checkpoint(cwd, `Before: ${t.prompt.replace(/\s+/g, " ").slice(0, 80)}`);
  }
  const history = conv.messages.slice(-40).map((m) => ({ role: m.role, content: m.content }));
  await appendMessage(t.user, conv.id, { role: "user", content: t.prompt, meta: { context: t.context ?? null } }, { title: t.prompt });

  const base = { prompt: t.prompt, systemPrompt: system, history, cwd, mode, model: t.model, subscriptionToken: creds.subscriptionToken, apiKey: creds.apiKey, signal: t.signal };
  let result: RunResult | null = null;
  let lastError: Error | null = null;
  const trySubscription = t.connection !== "user-key" && !!creds.subscriptionToken && cliOk();
  const tryApi = !!creds.apiKey && (t.connection !== "server" || creds.sources.api === "env");
  if (trySubscription) {
    try {
      t.onEvent({ type: "status", text: "Thinking on your Claude subscription…" });
      result = await runCli({ ...base, cliSessionId: conv.cliSessionId }, t.onEvent);
      if (result.cliSessionId) await updateConversation(t.user, conv.id, { cliSessionId: result.cliSessionId });
    } catch (e) {
      lastError = e as Error;
      console.warn("[ai] subscription backend failed:", lastError.message);
    }
  }
  if (!result && tryApi) {
    t.onEvent({ type: "status", text: lastError ? "Subscription unavailable, falling back to the API…" : "Thinking…" });
    result = await runApi(base, t.onEvent);
  }
  if (!result) throw lastError ?? new Error("The assistant is not connected yet: add a Claude subscription token or an API key in Settings › AI.");
  const changedFiles = mode === "build" ? changedSince(cwd, beforeSha) : [];
  if (changedFiles.length) result.toolsUsed.push(...changedFiles.map((f) => `changed:${f}`));
  const saved = await appendMessage(t.user, conv.id, { role: "assistant", content: result.text, meta: { backend: result.backend, tools: result.toolsUsed.slice(0, 50), model: t.model, changed: changedFiles.slice(0, 50) } });
  return { result, messageId: saved?.id ?? 0, changedFiles };
}
