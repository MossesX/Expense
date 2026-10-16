/**
 * @file Backend 1: Claude Code's CLI on a Claude subscription — ported from
 * xGallery's `cli.ts`.
 *
 * The CLI authenticates with a long-lived OAuth token (`claude setup-token`
 * on the person's own machine, pasted into Settings › AI, or the container's
 * `CLAUDE_CODE_OAUTH_TOKEN`). Each conversation maps to a CLI session so the
 * model keeps its own context across turns; the working directory is the
 * source snapshot or the writable workspace, so the built-in Read/Grep/Glob
 * tools give it the whole codebase, and Edit/Write/Bash are allowed only in
 * the Edit and Build modes. **Node-only.**
 */
import { spawn, spawnSync } from "node:child_process";

import type { AssistantMode, RunInput, RunResult, StreamEvent } from "./types";

const BIN = () => process.env.CLAUDE_BIN ?? "claude";

export function cliAvailable(): boolean {
  try {
    return spawnSync(BIN(), ["--version"], { stdio: "ignore", timeout: 8000 }).status === 0;
  } catch {
    return false;
  }
}

const READ_TOOLS = ["Read", "Grep", "Glob", "LS"];
const EDIT_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit", "Bash(git diff *)", "Bash(git status *)", "Bash(ls *)", "Bash(cat *)"];
const BUILD_TOOLS = ["Bash(npm run typecheck *)", "Bash(npm run build *)", "Bash(npx tsc *)", "Bash(npm test *)"];

export function toolsFor(mode: AssistantMode): string[] {
  if (mode === "chat") return READ_TOOLS;
  if (mode === "edit") return [...READ_TOOLS, ...EDIT_TOOLS];
  return [...READ_TOOLS, ...EDIT_TOOLS, ...BUILD_TOOLS];
}

function cliEnv(token: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token, CI: "1", TERM: "dumb" };
  // The CLI must run on the subscription: strip the API-key variables so it
  // cannot silently bill the API instead.
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

export async function runCli(input: RunInput, onEvent: (e: StreamEvent) => void): Promise<RunResult> {
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--no-chrome"];
  if (input.model) args.push("--model", input.model);
  if (input.cliSessionId) args.push("--resume", input.cliSessionId);
  args.push("--append-system-prompt", input.systemPrompt);
  args.push("--permission-mode", input.mode === "chat" ? "default" : "acceptEdits");
  args.push("--allowedTools", ...toolsFor(input.mode));
  if (input.mode === "chat") args.push("--disallowedTools", "Edit", "Write", "MultiEdit", "NotebookEdit", "Bash");
  args.push("--", input.prompt);

  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(BIN(), args, { cwd: input.cwd, env: cliEnv(input.subscriptionToken), stdio: ["ignore", "pipe", "pipe"] });
    let text = "";
    let sessionId = input.cliSessionId ?? null;
    let stderr = "";
    let buffer = "";
    let streamedChars = 0;
    const toolsUsed: string[] = [];
    const timer = setTimeout(() => child.kill("SIGTERM"), input.timeoutMs ?? 10 * 60_000);
    input.signal?.addEventListener("abort", () => child.kill("SIGTERM"));

    const handle = (line: string) => {
      if (!line.trim()) return;
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      if (typeof ev.session_id === "string") sessionId = ev.session_id;
      const type = ev.type as string;
      if (type === "stream_event") {
        const e = ev.event as { type?: string; delta?: { type?: string; text?: string } };
        if (e?.type === "content_block_delta" && e.delta?.type === "text_delta" && e.delta.text) {
          text += e.delta.text;
          streamedChars += e.delta.text.length;
          onEvent({ type: "text", text: e.delta.text });
        }
      } else if (type === "assistant") {
        const msg = ev.message as { content?: { type: string; text?: string; name?: string; input?: unknown }[] };
        for (const block of msg?.content ?? []) {
          if (block.type === "tool_use" && block.name) {
            toolsUsed.push(block.name);
            onEvent({ type: "tool", name: block.name, input: summarizeInput(block.input) });
          } else if (block.type === "text" && block.text && streamedChars === 0) {
            text += block.text;
            onEvent({ type: "text", text: block.text });
          }
        }
      } else if (type === "result") {
        if (ev.is_error && typeof ev.result === "string" && !text) {
          text = ev.result;
          onEvent({ type: "text", text: ev.result });
        }
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        handle(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (buffer) handle(buffer);
      if (code !== 0 && !text) {
        const detail = stderr.trim().split("\n").slice(-3).join(" ");
        reject(new Error(`Claude Code exited with code ${code}${detail ? `: ${detail}` : ""}`));
        return;
      }
      resolve({ text, backend: "subscription", cliSessionId: sessionId, toolsUsed });
    });
  });
}

function summarizeInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const o = input as Record<string, unknown>;
  const key = ["file_path", "path", "pattern", "command", "query"].find((k) => typeof o[k] === "string");
  return key ? String(o[key]).slice(0, 160) : "";
}

/** One non-streaming turn through the CLI — used to verify a token and to read an image. */
export function runCliOnce(opts: { token: string; model?: string; prompt: string; cwd: string; allowedTools?: string[]; timeoutMs?: number }): Promise<{ ok: boolean; text: string; detail: string }> {
  return new Promise((resolve) => {
    const args = ["-p", "--output-format", "json", "--max-turns", String(opts.allowedTools?.length ? 6 : 1), "--no-chrome"];
    if (opts.allowedTools?.length) args.push("--allowedTools", ...opts.allowedTools, "--permission-mode", "default");
    args.push("--disallowedTools", "Bash", "Edit", "Write", "MultiEdit", "NotebookEdit");
    if (opts.model) args.push("--model", opts.model);
    args.push("--", opts.prompt);
    let out = "";
    let err = "";
    const child = spawn(BIN(), args, { cwd: opts.cwd, env: cliEnv(opts.token), stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ ok: false, text: "", detail: "Timed out waiting for Claude Code" });
    }, opts.timeoutMs ?? 90_000);
    child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, text: "", detail: e.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      let parsed: { is_error?: boolean; result?: string } | null = null;
      try {
        const line = out.trim().split("\n").find((l) => l.trim().startsWith("{")) ?? "{}";
        parsed = JSON.parse(line);
      } catch {
        parsed = null;
      }
      const result = String(parsed?.result ?? "").trim();
      if (code === 0 && parsed && !parsed.is_error) resolve({ ok: true, text: result, detail: `Claude Code answered: ${result.slice(0, 80) || "ok"}` });
      else resolve({ ok: false, text: "", detail: `${result || err.trim().split("\n").filter(Boolean).slice(-4).join(" ") || "no output"} (exit ${code})`.slice(0, 400) });
    });
  });
}

export const pingCli = (token: string, model: string | undefined) =>
  runCliOnce({ token, model, prompt: "Reply with exactly: OK", cwd: process.cwd() }).then(({ ok, detail }) => ({ ok, detail }));
