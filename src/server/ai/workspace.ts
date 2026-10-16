/**
 * @file The assistant's view of this application's source — ported from
 * xGallery's `workspace.ts`.
 *
 * SOURCE_DIR holds a read-only snapshot of the repository (baked into the
 * Docker image at /app/source; the repository root in development). Each
 * user's WORKSPACE is a writable copy under the data directory that the
 * assistant edits in Edit and Build modes; its git diff is the patch the
 * person reviews. The workspace is re-seeded whenever the snapshot's version
 * changes. **Node-only.**
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { dataPath } from "../dataRoot";

export const SOURCE_DIR = process.env.SOURCE_DIR ?? path.resolve(process.cwd());

const IGNORE = new Set(["node_modules", ".next", "dist", ".git", "data", "ai-workspace", ".turbo", "assets"]);
const TEXT_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".css", ".html", ".yml", ".yaml", ".sh", ".txt", ".toml", ".svg", "Dockerfile", ".dockerignore", ".gitignore", ".env.example"]);
const MAX_FILE = 200_000;

export function isTextFile(p: string): boolean {
  const base = path.basename(p);
  return TEXT_EXT.has(base) || TEXT_EXT.has(path.extname(base));
}

function hasGit(): boolean {
  try {
    return spawnSync("git", ["--version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

export function sourceVersion(): string {
  const f = path.join(SOURCE_DIR, ".source-version");
  if (existsSync(f)) return readFileSync(f, "utf8").trim();
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: SOURCE_DIR, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "dev";
  }
}

const USER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

export function workspaceDir(user: string): string {
  if (!USER_RE.test(user)) throw new Error("bad user");
  return dataPath("ai-workspace", user);
}

const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "Expense assistant", GIT_AUTHOR_EMAIL: "assistant@expenses", GIT_COMMITTER_NAME: "Expense assistant", GIT_COMMITTER_EMAIL: "assistant@expenses" };

/** Create or refresh the user's writable workspace from the snapshot. */
export function ensureWorkspace(user: string, force = false): string {
  const ws = workspaceDir(user);
  const marker = path.join(ws, ".source-version");
  const version = sourceVersion();
  const stale = !existsSync(marker) || readFileSync(marker, "utf8").trim() !== version;
  if (force || stale) {
    rmSync(ws, { recursive: true, force: true });
    mkdirSync(ws, { recursive: true });
    cpSync(SOURCE_DIR, ws, { recursive: true, filter: (src) => src === SOURCE_DIR || !IGNORE.has(path.basename(src)) });
    rmSync(path.join(ws, ".git"), { recursive: true, force: true });
    writeFileSync(marker, version);
    if (hasGit()) {
      const run = (args: string[]) => spawnSync("git", args, { cwd: ws, stdio: "ignore", env: gitEnv });
      run(["init", "-q"]);
      run(["add", "-A"]);
      run(["commit", "-q", "-m", `Snapshot ${version}`, "--no-verify"]);
    }
  }
  return ws;
}

/** Build mode: a commit before each turn, so the person can see exactly what one turn changed. */
export function checkpoint(ws: string, message: string): string {
  if (!hasGit()) return "";
  const run = (args: string[]) => spawnSync("git", args, { cwd: ws, encoding: "utf8", env: gitEnv });
  run(["add", "-A"]);
  run(["commit", "-q", "-m", message.slice(0, 120), "--no-verify", "--allow-empty"]);
  return (run(["rev-parse", "HEAD"]).stdout ?? "").trim();
}

/** Files changed since `sinceSha` (Build mode's checkpoint), including untracked. */
export function changedSince(ws: string, sinceSha: string): string[] {
  if (!hasGit() || !sinceSha) return [];
  const run = (args: string[]) => spawnSync("git", args, { cwd: ws, encoding: "utf8", env: gitEnv });
  run(["add", "-A", "-N"]);
  return (run(["diff", "--name-only", sinceSha]).stdout ?? "").split("\n").filter(Boolean);
}

/** Resolve an assistant-supplied path inside a root, refusing escapes. */
export function safePath(root: string, rel: string): string {
  const target = path.resolve(root, rel.replace(/^[/\\]+/, ""));
  const relative = path.relative(root, target);
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) throw new Error("Path escapes the project");
  return target;
}

export function listFiles(root: string, dir = ".", depth = 6): string[] {
  const out: string[] = [];
  const walk = (d: string, level: number) => {
    if (level > depth) return;
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const name of entries.sort()) {
      if (IGNORE.has(name)) continue;
      const abs = path.join(d, name);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (st.isDirectory()) walk(abs, level + 1);
      else out.push(`${rel} (${st.size}b)`);
    }
  };
  walk(safePath(root, dir), 0);
  return out;
}

export function readFile(root: string, rel: string, startLine?: number, endLine?: number): string {
  const abs = safePath(root, rel);
  if (!existsSync(abs) || statSync(abs).isDirectory()) throw new Error(`No such file: ${rel}`);
  if (!isTextFile(abs)) throw new Error(`Not a text file: ${rel}`);
  let text = readFileSync(abs, "utf8");
  if (text.length > MAX_FILE) text = text.slice(0, MAX_FILE) + "\n…(truncated)";
  const lines = text.split("\n");
  const s = Math.max(1, startLine ?? 1);
  const e = Math.min(lines.length, endLine ?? lines.length);
  return lines.slice(s - 1, e).map((l, i) => `${String(s + i).padStart(4)}  ${l}`).join("\n");
}

export function searchCode(root: string, pattern: string, dir = ".", maxHits = 60): string {
  let re: RegExp;
  try {
    re = new RegExp(pattern, "i");
  } catch {
    re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }
  const hits: string[] = [];
  const walk = (d: string) => {
    if (hits.length >= maxHits) return;
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const name of entries.sort()) {
      if (IGNORE.has(name)) continue;
      const abs = path.join(d, name);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(abs);
      else if (isTextFile(abs) && st.size <= MAX_FILE) {
        const rel = path.relative(root, abs).split(path.sep).join("/");
        const lines = readFileSync(abs, "utf8").split("\n");
        for (let i = 0; i < lines.length && hits.length < maxHits; i++) if (re.test(lines[i])) hits.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
      }
    }
  };
  walk(safePath(root, dir));
  return hits.length ? hits.join("\n") : "No matches.";
}

export function writeFile(root: string, rel: string, contents: string): string {
  const abs = safePath(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, contents);
  return `Wrote ${rel} (${Buffer.byteLength(contents)} bytes)`;
}

export function editFile(root: string, rel: string, oldText: string, newText: string): string {
  const abs = safePath(root, rel);
  if (!existsSync(abs)) throw new Error(`No such file: ${rel}`);
  const text = readFileSync(abs, "utf8");
  const idx = text.indexOf(oldText);
  if (idx < 0) throw new Error("old_text was not found in the file (it must match exactly, including whitespace)");
  if (text.indexOf(oldText, idx + 1) >= 0) throw new Error("old_text matches more than once; include more surrounding context");
  writeFileSync(abs, text.slice(0, idx) + newText + text.slice(idx + oldText.length));
  return `Edited ${rel}`;
}

/** Build mode's one shell affordance for the API backend: typecheck the workspace. */
export function runCheck(root: string, which: "typecheck"): string {
  const r = spawnSync("npx", ["tsc", "--noEmit", "-p", root], { cwd: root, encoding: "utf8", timeout: 5 * 60_000, maxBuffer: 8 * 1024 * 1024 });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  return r.status === 0 ? `${which}: clean` : `${which} failed (exit ${r.status}):\n${out.slice(0, 20_000)}`;
}

/** The person's review surface: what the assistant changed in the workspace since the snapshot. */
export function workspaceDiff(user: string): { diff: string; files: string[] } {
  const ws = workspaceDir(user);
  if (!existsSync(ws) || !hasGit()) return { diff: "", files: [] };
  const run = (args: string[]) => spawnSync("git", args, { cwd: ws, encoding: "utf8", maxBuffer: 20 * 1024 * 1024, env: gitEnv });
  run(["add", "-A", "-N"]);
  // Against the FIRST commit (the snapshot), so Build mode's checkpoints do not hide earlier turns.
  const root = (run(["rev-list", "--max-parents=0", "HEAD"]).stdout ?? "").trim().split("\n")[0] ?? "HEAD";
  const files = (run(["diff", "--name-only", root]).stdout ?? "").split("\n").filter(Boolean);
  const diff = run(["diff", root]).stdout ?? "";
  return { diff, files };
}

export function resetWorkspace(user: string): void {
  ensureWorkspace(user, true);
}

/** A compact map of the codebase for the system prompt. */
export function codebaseOverview(root: string): string {
  const readme = existsSync(path.join(root, "README.md")) ? readFileSync(path.join(root, "README.md"), "utf8").slice(0, 6000) : "";
  const tree = listFiles(root, ".", 4)
    .filter((f) => !/\.(svg|png|jpg|webp)/.test(f) && !f.startsWith("vendor/"))
    .slice(0, 400)
    .join("\n");
  return `# Repository file map (path (bytes)) — vendor/axf-core (the framework) is omitted here but readable\n${tree}\n\n# README.md (excerpt)\n${readme}`;
}
