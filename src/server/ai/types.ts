/**
 * @file The assistant's shared shapes — ported from xGallery's `server/src/ai`
 * (owner, 2026-10-16: *"a port of the assistant in xGallery"*).
 */

export type Backend = "subscription" | "api";

/** What the person may do in a conversation: read the source, edit a
 *  workspace copy, or build (edit + typecheck/build commands, checkpointed). */
export type AssistantMode = "chat" | "edit" | "build";

export const MODES: readonly AssistantMode[] = ["chat", "edit", "build"];

export interface RunInput {
  prompt: string;
  systemPrompt: string;
  /** Prior turns for the API backend (the CLI keeps its own session). */
  history: { role: "user" | "assistant"; content: string }[];
  cwd: string;
  mode: AssistantMode;
  model: string;
  subscriptionToken: string;
  apiKey: string;
  cliSessionId?: string | null;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; input: string }
  | { type: "status"; text: string };

export interface RunResult {
  text: string;
  backend: Backend;
  cliSessionId?: string | null;
  toolsUsed: string[];
}

/** Per-user assistant preferences (not secrets — those are `expenses-ai-secret`). */
export interface AiPrefs {
  assistantName: string;
  extraInstructions: string;
  subscriptionVerifiedAt: number | null;
  subscriptionVerifiedDetail: string;
  apiVerifiedAt: number | null;
  apiVerifiedDetail: string;
}

export const DEFAULT_PREFS: AiPrefs = {
  assistantName: "Amber",
  extraInstructions: "",
  subscriptionVerifiedAt: null,
  subscriptionVerifiedDetail: "",
  apiVerifiedAt: null,
  apiVerifiedDetail: ""
};

export interface AiMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  meta: Record<string, unknown>;
  createdAt: number;
}

export interface AiConversation {
  id: number;
  title: string;
  mode: AssistantMode;
  cliSessionId: string | null;
  createdAt: number;
  updatedAt: number;
  messages: AiMessage[];
}

export interface PageContext {
  url?: string;
  title?: string;
  selection?: string;
  element?: string;
}
