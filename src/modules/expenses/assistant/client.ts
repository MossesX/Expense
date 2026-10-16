"use client";

/**
 * @file The browser half of the assistant: the `/api/ai` calls, the SSE
 * reader for one turn (ported from xGallery's `streamTurn`), and the small
 * store the panel and its openers share — open/closed, the mode, the active
 * conversation, a queued draft with page context.
 */
import * as React from "react";

export type AssistantMode = "chat" | "edit" | "build";

export interface PageContext {
  url?: string;
  title?: string;
  selection?: string;
  element?: string;
}

export interface AiStatus {
  assistantName: string;
  model: string;
  backends: { subscription: boolean; api: boolean };
  cliInstalled: boolean;
  sourceVersion: string;
}

export interface ConversationSummary {
  id: number;
  title: string;
  mode: AssistantMode;
  createdAt: number;
  updatedAt: number;
  messages: number;
}

export interface AiMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  meta: { backend?: string; tools?: string[]; model?: string; changed?: string[]; context?: PageContext | null };
  createdAt: number;
}

export interface LiveTurn {
  text: string;
  status: string;
  tools: { name: string; input: string }[];
  error: string | null;
  changed: string[];
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

export const aiApi = {
  status: () => call<AiStatus>("/api/ai/status"),
  conversations: (mode?: AssistantMode) => call<{ conversations: ConversationSummary[] }>(`/api/ai/conversations${mode ? `?mode=${mode}` : ""}`),
  create: (mode: AssistantMode) => call<{ conversation: ConversationSummary }>("/api/ai/conversations", { method: "POST", body: JSON.stringify({ mode }) }),
  get: (id: number) => call<{ conversation: ConversationSummary; messages: AiMessage[] }>(`/api/ai/conversations/${id}`),
  setMode: (id: number, mode: AssistantMode) => call<{ conversation: ConversationSummary }>(`/api/ai/conversations/${id}`, { method: "PUT", body: JSON.stringify({ mode }) }),
  remove: (id: number) => call<{ ok: true }>(`/api/ai/conversations/${id}`, { method: "DELETE" }),
  workspace: () => call<{ diff: string; files: string[]; sourceVersion: string }>("/api/ai/workspace"),
  resetWorkspace: () => call<{ ok: true }>("/api/ai/workspace/reset", { method: "POST" })
};

/** Consume the server-sent event stream of one assistant turn. */
export async function streamTurn(conversationId: number, content: string, context: PageContext, onEvent: (event: string, data: Record<string, unknown>) => void, signal: AbortSignal): Promise<void> {
  const res = await fetch(`/api/ai/conversations/${conversationId}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content, context }), signal });
  if (!res.ok || !res.body) {
    let msg = `Request failed (${res.status})`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = "message";
      let data = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      try {
        onEvent(event, JSON.parse(data));
      } catch {
        /* ignore malformed */
      }
    }
  }
}

/* ------------------------------------------------------------- the store --- */

export interface AssistantUiState {
  readonly open: boolean;
  readonly mode: AssistantMode;
  readonly conversationId: number | null;
  readonly draft: { text: string; context: PageContext } | null;
}

const KEY = "axs:expenses:assistant@1";

const read = (): Pick<AssistantUiState, "mode" | "conversationId"> => {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { mode: "chat", conversationId: null };
    const p = JSON.parse(raw) as Partial<AssistantUiState>;
    return { mode: p.mode === "edit" || p.mode === "build" ? p.mode : "chat", conversationId: typeof p.conversationId === "number" ? p.conversationId : null };
  } catch {
    return { mode: "chat", conversationId: null };
  }
};

class AssistantUiStore {
  #state: AssistantUiState = { open: false, mode: "chat", conversationId: null, draft: null };
  #listeners = new Set<() => void>();
  #hydrated = false;

  subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };
  getState = (): AssistantUiState => this.#state;
  getServerState = (): AssistantUiState => ({ open: false, mode: "chat", conversationId: null, draft: null });

  #set(patch: Partial<AssistantUiState>): void {
    this.#state = { ...this.#state, ...patch };
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ mode: this.#state.mode, conversationId: this.#state.conversationId }));
    } catch {
      /* storage blocked */
    }
    for (const fn of this.#listeners) fn();
  }

  /** Called once from the panel, after mount — the stored mode and conversation. */
  hydrate(): void {
    if (this.#hydrated || typeof window === "undefined") return;
    this.#hydrated = true;
    this.#set(read());
  }
  open(draft?: { text?: string; context?: PageContext }): void {
    this.hydrate();
    this.#set({ open: true, draft: draft ? { text: draft.text ?? "", context: draft.context ?? {} } : this.#state.draft });
  }
  close(): void {
    if (this.#state.open) this.#set({ open: false });
  }
  toggle(): void {
    if (this.#state.open) this.close();
    else this.open();
  }
  setMode(mode: AssistantMode): void {
    this.#set({ mode });
  }
  setConversation(id: number | null): void {
    this.#set({ conversationId: id });
  }
  clearDraft(): void {
    if (this.#state.draft) this.#set({ draft: null });
  }
}

export const assistantUi = new AssistantUiStore();

export function useAssistantUi(): AssistantUiState {
  return React.useSyncExternalStore(assistantUi.subscribe, assistantUi.getState, assistantUi.getServerState);
}

/** What the page can tell the assistant about where the person is. */
export function pageContext(): PageContext {
  const sel = typeof window !== "undefined" ? (window.getSelection()?.toString().trim() ?? "") : "";
  return { url: typeof location !== "undefined" ? location.pathname + location.search : "", title: typeof document !== "undefined" ? document.title : "", selection: sel ? sel.slice(0, 4000) : undefined };
}
