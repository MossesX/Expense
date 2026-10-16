/**
 * @file Backend 2: the Anthropic API (an API key) — ported from xGallery's
 * `api.ts`. Used when the subscription backend is not configured or fails.
 * The model gets the same codebase through client-side tools that read the
 * workspace; write tools exist only in Edit and Build modes, and Build adds a
 * typecheck tool. **Node-only.**
 */
import Anthropic from "@anthropic-ai/sdk";

import type { AssistantMode, RunInput, RunResult, StreamEvent } from "./types";
import { editFile, listFiles, readFile, runCheck, searchCode, writeFile } from "./workspace";

function tools(mode: AssistantMode): Anthropic.Tool[] {
  const base: Anthropic.Tool[] = [
    {
      name: "list_files",
      description: "List files in the application source tree (path and size). Use dir to narrow, e.g. \"src/modules/expenses\".",
      input_schema: { type: "object", properties: { dir: { type: "string" } }, additionalProperties: false }
    },
    {
      name: "read_file",
      description: "Read a source file, with line numbers. Optional start_line/end_line to read a slice.",
      input_schema: { type: "object", properties: { path: { type: "string" }, start_line: { type: "integer" }, end_line: { type: "integer" } }, required: ["path"], additionalProperties: false }
    },
    {
      name: "search_code",
      description: "Search the source for a regular expression (case-insensitive). Returns file:line: text matches.",
      input_schema: { type: "object", properties: { pattern: { type: "string" }, dir: { type: "string" } }, required: ["pattern"], additionalProperties: false }
    }
  ];
  if (mode === "chat") return base;
  const writes: Anthropic.Tool[] = [
    {
      name: "write_file",
      description: "Create or overwrite a file in the workspace with the given contents.",
      eager_input_streaming: true,
      input_schema: { type: "object", properties: { path: { type: "string" }, contents: { type: "string" } }, required: ["path", "contents"], additionalProperties: false }
    },
    {
      name: "edit_file",
      description: "Replace one exact occurrence of old_text with new_text in a file. old_text must match exactly and be unique.",
      eager_input_streaming: true,
      input_schema: { type: "object", properties: { path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" } }, required: ["path", "old_text", "new_text"], additionalProperties: false }
    }
  ];
  if (mode === "edit") return [...base, ...writes];
  return [
    ...base,
    ...writes,
    {
      name: "typecheck",
      description: "Run the TypeScript typecheck over the workspace and return its output. Use after editing.",
      input_schema: { type: "object", properties: {}, additionalProperties: false }
    }
  ];
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function runTool(cwd: string, name: string, input: unknown): string {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  switch (name) {
    case "list_files":
      return listFiles(cwd, str(o.dir) || ".").join("\n") || "Empty.";
    case "read_file":
      if (!str(o.path)) throw new Error("path is required");
      return readFile(cwd, str(o.path), typeof o.start_line === "number" ? o.start_line : undefined, typeof o.end_line === "number" ? o.end_line : undefined);
    case "search_code":
      if (!str(o.pattern)) throw new Error("pattern is required");
      return searchCode(cwd, str(o.pattern), str(o.dir) || ".");
    case "write_file":
      if (!str(o.path) || typeof o.contents !== "string") throw new Error("path and contents are required");
      return writeFile(cwd, str(o.path), o.contents);
    case "edit_file":
      if (!str(o.path) || typeof o.old_text !== "string" || typeof o.new_text !== "string") throw new Error("path, old_text and new_text are required");
      return editFile(cwd, str(o.path), o.old_text, o.new_text);
    case "typecheck":
      return runCheck(cwd, "typecheck");
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

export async function runApi(input: RunInput, onEvent: (e: StreamEvent) => void): Promise<RunResult> {
  const client = new Anthropic({ apiKey: input.apiKey, timeout: 10 * 60_000 });
  const messages: Anthropic.MessageParam[] = [...input.history.map((m) => ({ role: m.role, content: m.content })), { role: "user", content: input.prompt }];
  const toolDefs = tools(input.mode);
  const toolsUsed: string[] = [];
  let finalText = "";
  let jsonRetries = 0;
  for (let round = 0; round < 40; round++) {
    const stream = client.messages.stream(
      {
        model: input.model,
        max_tokens: 64000,
        system: [{ type: "text", text: input.systemPrompt, cache_control: { type: "ephemeral" } }],
        tools: toolDefs,
        messages
      },
      { signal: input.signal }
    );
    let turnText = "";
    stream.on("text", (delta) => {
      turnText += delta;
      onEvent({ type: "text", text: delta });
    });
    let message: Anthropic.Message;
    try {
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
      continue;
    }
    finalText += turnText;
    if (message.stop_reason === "refusal") {
      onEvent({ type: "status", text: "The model declined this request." });
      break;
    }
    if (message.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: message.content });
      continue;
    }
    const toolUses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0 || message.stop_reason === "max_tokens") break;
    messages.push({ role: "assistant", content: message.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const t of toolUses) {
      toolsUsed.push(t.name);
      const o = (t.input && typeof t.input === "object" ? t.input : {}) as Record<string, unknown>;
      onEvent({ type: "tool", name: t.name, input: str(o.path) || str(o.pattern) || str(o.dir) });
      try {
        results.push({ type: "tool_result", tool_use_id: t.id, content: runTool(input.cwd, t.name, t.input) });
      } catch (e) {
        results.push({ type: "tool_result", tool_use_id: t.id, is_error: true, content: (e as Error).message });
      }
    }
    messages.push({ role: "user", content: results });
    if (turnText) finalText += "\n\n";
  }
  return { text: finalText.trim(), backend: "api", toolsUsed };
}
