/**
 * @file The assistant's per-user documents in the kv store — preferences
 * (`expenses-ai`) and conversations (`expenses-ai-chats`). xGallery kept these
 * in SQLite; the peel has the studio's kv primitive and nothing else, so one
 * document per user holds every conversation, capped. **Node-only.**
 */
import { axfKv } from "../axfKv";
import { DEFAULT_PREFS, MODES, type AiConversation, type AiMessage, type AiPrefs, type AssistantMode } from "./types";

export const PREFS_NS = "expenses-ai";
export const CHATS_NS = "expenses-ai-chats";

const MAX_CONVERSATIONS = 30;
const MAX_MESSAGES = 200;

export async function getPrefs(user: string): Promise<AiPrefs> {
  const doc = (await axfKv.read(user, PREFS_NS)) as Partial<AiPrefs> | null;
  return { ...DEFAULT_PREFS, ...(doc ?? {}) };
}

export async function savePrefs(user: string, patch: Partial<AiPrefs>): Promise<AiPrefs> {
  const cur = await getPrefs(user);
  const next: AiPrefs = { ...cur };
  if (typeof patch.assistantName === "string" && patch.assistantName.trim()) next.assistantName = patch.assistantName.trim().slice(0, 40);
  if (typeof patch.extraInstructions === "string") next.extraInstructions = patch.extraInstructions.slice(0, 8000);
  for (const k of ["subscriptionVerifiedAt", "apiVerifiedAt"] as const) if (k in patch) next[k] = typeof patch[k] === "number" ? patch[k] : null;
  for (const k of ["subscriptionVerifiedDetail", "apiVerifiedDetail"] as const) if (typeof patch[k] === "string") next[k] = patch[k].slice(0, 300);
  await axfKv.write(user, PREFS_NS, next as unknown as Record<string, unknown>);
  return next;
}

interface ChatsDoc {
  v: 1;
  nextId: number;
  conversations: AiConversation[];
}

async function readChats(user: string): Promise<ChatsDoc> {
  const doc = (await axfKv.read(user, CHATS_NS)) as Partial<ChatsDoc> | null;
  return { v: 1, nextId: typeof doc?.nextId === "number" ? doc.nextId : 1, conversations: Array.isArray(doc?.conversations) ? doc.conversations : [] };
}

async function writeChats(user: string, doc: ChatsDoc): Promise<void> {
  doc.conversations.sort((a, b) => b.updatedAt - a.updatedAt);
  doc.conversations = doc.conversations.slice(0, MAX_CONVERSATIONS);
  await axfKv.write(user, CHATS_NS, doc as unknown as Record<string, unknown>);
}

export const summary = (c: AiConversation) => ({ id: c.id, title: c.title, mode: c.mode, createdAt: c.createdAt, updatedAt: c.updatedAt, messages: c.messages.length });

export async function listConversations(user: string, mode?: AssistantMode) {
  const doc = await readChats(user);
  return doc.conversations.filter((c) => !mode || c.mode === mode).map(summary);
}

export async function createConversation(user: string, mode: AssistantMode, title?: string): Promise<AiConversation> {
  const doc = await readChats(user);
  const now = Date.now();
  const conv: AiConversation = { id: doc.nextId++, title: title?.trim().slice(0, 80) || "New conversation", mode: MODES.includes(mode) ? mode : "chat", cliSessionId: null, createdAt: now, updatedAt: now, messages: [] };
  doc.conversations.unshift(conv);
  await writeChats(user, doc);
  return conv;
}

export async function getConversation(user: string, id: number): Promise<AiConversation | null> {
  const doc = await readChats(user);
  return doc.conversations.find((c) => c.id === id) ?? null;
}

export async function updateConversation(user: string, id: number, patch: Partial<Pick<AiConversation, "title" | "mode" | "cliSessionId">>): Promise<AiConversation | null> {
  const doc = await readChats(user);
  const conv = doc.conversations.find((c) => c.id === id);
  if (!conv) return null;
  if (typeof patch.title === "string" && patch.title.trim()) conv.title = patch.title.trim().slice(0, 80);
  if (patch.mode && MODES.includes(patch.mode)) {
    conv.mode = patch.mode;
    // A mode change means different tools and a different working directory:
    // the CLI session's context would be wrong, so it starts over.
    conv.cliSessionId = null;
  }
  if ("cliSessionId" in patch) conv.cliSessionId = patch.cliSessionId ?? null;
  conv.updatedAt = Date.now();
  await writeChats(user, doc);
  return conv;
}

export async function deleteConversation(user: string, id: number): Promise<boolean> {
  const doc = await readChats(user);
  const before = doc.conversations.length;
  doc.conversations = doc.conversations.filter((c) => c.id !== id);
  if (doc.conversations.length === before) return false;
  await writeChats(user, doc);
  return true;
}

export async function appendMessage(user: string, id: number, msg: Omit<AiMessage, "id" | "createdAt">, extra?: { title?: string; cliSessionId?: string | null }): Promise<AiMessage | null> {
  const doc = await readChats(user);
  const conv = doc.conversations.find((c) => c.id === id);
  if (!conv) return null;
  const m: AiMessage = { ...msg, id: doc.nextId++, createdAt: Date.now() };
  conv.messages.push(m);
  if (conv.messages.length > MAX_MESSAGES) conv.messages = conv.messages.slice(-MAX_MESSAGES);
  if (extra?.title && conv.title === "New conversation") conv.title = extra.title.replace(/\s+/g, " ").slice(0, 60);
  if (extra && "cliSessionId" in extra && extra.cliSessionId) conv.cliSessionId = extra.cliSessionId;
  conv.updatedAt = m.createdAt;
  await writeChats(user, doc);
  return m;
}

/** Turn counts per backend, for the settings page's "used so far". */
export async function usage(user: string): Promise<{ subscription: number; api: number; lastBackend: string | null; lastAt: number | null }> {
  const doc = await readChats(user);
  const out = { subscription: 0, api: 0, lastBackend: null as string | null, lastAt: null as number | null };
  const all = doc.conversations.flatMap((c) => c.messages.filter((m) => m.role === "assistant")).sort((a, b) => b.createdAt - a.createdAt);
  for (const m of all) {
    const backend = String(m.meta.backend ?? "");
    if (backend === "subscription") out.subscription++;
    else if (backend === "api") out.api++;
    if (!out.lastBackend && backend) {
      out.lastBackend = backend;
      out.lastAt = m.createdAt;
    }
  }
  return out;
}
