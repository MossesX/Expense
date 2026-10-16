/**
 * @file `/api/expenses/files` — the Expense Tracker's **saved directory**.
 *
 *   GET    ?kind=report                 → { files: VaultFile[] }
 *   GET    ?kind=report&name=x.html     → { file, content }
 *   GET    ?scan=1                      → { found: FoundFile[] }
 *   POST   { kind, name, content, format }  → { ok, file }   (save)
 *   POST   { kind, importPath }             → { ok, file }   (import a found file)
 *   DELETE ?kind=report&name=x.html     → { ok }
 *
 * ## Why this is a DIRECTORY and not the kv store
 *
 * The ledger itself lives in the kv store (`/api/expenses`), and that is right:
 * it is one document the app owns and rewrites whole. Reports are not that.
 * They are FILES — a person saves one, mails it, prints it, drops one in from
 * somewhere else, and expects to find it again by name. The owner's words for
 * the two halves were *"open report that opens from saved directory"* and
 * *"find saved reports and import them"*, and neither is expressible over a
 * single kv document: a directory is the feature, not an implementation detail.
 *
 * ## Per-user since P2 of `default-state`
 *
 * The vault is scoped exactly the way the kv store is: every request resolves
 * its owner through `kvUser()` (the verified `axs_session` cookie's username,
 * `"local"` signed out) and reads/writes ONLY that user's subtree:
 *
 *     data/axf/expenses/<user>/reports/*.{html,md}     generated + imported reports
 *     data/axf/expenses/<user>/saves/*.json            ledger snapshots (Save / Load)
 *
 * The paths live in `src/server/expensesPaths.ts` because the accounts
 * module's factory reset deletes one user's subtree and the two must agree.
 * The pre-P2 store (`data/axf/expenses/{reports,saves}`, no user level) is
 * migrated ONCE into the `"local"` user's tree — idempotent (a rename happens
 * only while a legacy dir exists, and never over an existing target) and
 * journaled to `.migration.json` beside the trees it moved.
 *
 * ## The scan, and why it is bounded rather than clever
 *
 * "Find saved reports" means looking OUTSIDE the vault — that is the whole
 * point of it, otherwise the list route already answers. But a filesystem walk
 * driven by a browser request is a denial-of-service and an information leak
 * wearing a helpful hat, so the limits are structural rather than advisory:
 * the walk starts at the project root and cannot escape it, it skips the four
 * directories that hold a million files each, it stops dead at
 * {@link SCAN_MAX_ENTRIES}, and — new with the per-user split — it never
 * enters the vault root at all, because walking it would surface OTHER users'
 * reports as import candidates. A truncated scan SAYS it was truncated
 * (`truncated: true`) — a capped walk that reports a complete-looking list is
 * the silent-wrong-answer this project spends its guard budget avoiding.
 *
 * **Node-only.** Never import from a client component.
 */
import { mkdir, readFile, readdir, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { REPORT_MARKER } from "../../../../src/modules/expenses/report";
import type {
  FoundFile,
  VaultFile,
  VaultFormat,
  VaultKind
} from "../../../../src/modules/expenses/vault";
import { kvUser } from "../../../../src/server/axfKv";
import { EXPENSES_VAULT_ROOT, expensesUserDir } from "../../../../src/server/expensesPaths";
import { AXF_ROOT } from "../../../../src/server/paths";

export const dynamic = "force-dynamic";

/* ------------------------------------------------------------------ paths */

/** The directory name each kind lives under, inside a user's subtree. */
const KIND_DIR: Record<VaultKind, string> = { report: "reports", save: "saves" };

/** One user's pair of vault directories. An identity the accounts grammar
 *  would refuse (structurally impossible for a verified session, but the
 *  guard is cheap) degrades to the signed-out owner rather than to a crash. */
function dirsFor(user: string): Record<VaultKind, string> {
  const base = expensesUserDir(user) ?? expensesUserDir("local")!;
  return {
    report: path.join(base, KIND_DIR.report),
    save: path.join(base, KIND_DIR.save)
  };
}

/** Extensions a kind will accept, first one being its default. */
const ALLOWED: Record<VaultKind, readonly string[]> = {
  report: [".html", ".md"],
  save: [".json"]
};

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const SCAN_MAX_ENTRIES = 6000;
const SCAN_MAX_DEPTH = 7;
const SCAN_SNIFF_BYTES = 4096;
/** Never walked: each is enormous, generated, or none of our business. */
const SCAN_SKIP = new Set([
  "node_modules",
  ".next",
  ".git",
  ".venv",
  "dist",
  "build-output",
  ".turbo",
  ".history"
]);

function kindOf(raw: string | null): VaultKind {
  return raw === "save" ? "save" : "report";
}

function formatOf(name: string): VaultFormat {
  const ext = path.extname(name).toLowerCase();
  if (ext === ".json") return "json";
  if (ext === ".md") return "markdown";
  return "html";
}

/* -------------------------------------------------------------- migration */

/** Where the pre-P2 vault lived: no user level, straight under the root. */
const LEGACY_DIRS: Record<VaultKind, string> = {
  report: path.join(EXPENSES_VAULT_ROOT, KIND_DIR.report),
  save: path.join(EXPENSES_VAULT_ROOT, KIND_DIR.save)
};

/** The migration's own journal — what moved, and when. */
const MIGRATION_JOURNAL = path.join(EXPENSES_VAULT_ROOT, ".migration.json");

let migration: Promise<void> | null = null;

/**
 * Move the pre-P2 vault into the `"local"` user's tree, ONCE.
 *
 * Idempotent by construction rather than by flag: a file is renamed only while
 * it still sits in a legacy directory, never over an existing target, and an
 * emptied legacy directory is removed — so the second run (and every run after
 * it) finds nothing to do. A collision (same name already migrated) keeps the
 * migrated copy and leaves the legacy file where it is, loudly listed in the
 * journal, because silently overwriting either copy would destroy a file this
 * code did not create. Failures degrade to "not migrated yet, retry next
 * process" — never to a crash on a read path.
 */
function migrateLegacyVault(): Promise<void> {
  return (migration ??= (async () => {
    const moved: string[] = [];
    const skipped: string[] = [];
    for (const kind of ["report", "save"] as const) {
      const legacy = LEGACY_DIRS[kind];
      let names: string[];
      try {
        names = await readdir(legacy);
      } catch {
        continue; // no legacy directory — already migrated, or never existed
      }
      const target = dirsFor("local")[kind];
      await mkdir(target, { recursive: true });
      for (const name of names) {
        const from = path.join(legacy, name);
        const to = path.join(target, name);
        try {
          await stat(to);
          skipped.push(`${kind}/${name} (target already exists)`);
        } catch {
          try {
            await rename(from, to);
            moved.push(`${kind}/${name}`);
          } catch (err) {
            skipped.push(`${kind}/${name} (${err instanceof Error ? err.message : String(err)})`);
          }
        }
      }
      // Empty-only removal on purpose: a legacy dir still holding skipped
      // files stays visible as unfinished business rather than vanishing.
      try {
        await rmdir(legacy);
      } catch {
        /* not empty, or already gone */
      }
    }
    if (moved.length || skipped.length) {
      let entries: unknown[] = [];
      try {
        const prior = JSON.parse(await readFile(MIGRATION_JOURNAL, "utf8"));
        if (Array.isArray(prior)) entries = prior;
      } catch {
        /* first entry */
      }
      entries.push({
        at: new Date().toISOString(),
        migration: "pre-P2 vault → per-user tree (owner: local)",
        moved,
        skipped
      });
      await writeFile(MIGRATION_JOURNAL, JSON.stringify(entries, null, 2), "utf8");
    }
  })());
}

/* ------------------------------------------------------------------ names */

/**
 * The name guard — the only thing standing between a query string and the
 * filesystem, so it is an allowlist and it runs on EVERY path that touches a
 * name (read, write, delete, import).
 *
 * `path.basename` alone is not enough: it would silently rewrite
 * `../../etc/passwd` into `passwd` and then happily serve it from the vault,
 * which is a refusal turned into a different file. A rejected name is
 * REJECTED.
 */
function badName(name: string, kind: VaultKind): string | null {
  if (!name || name.length > 120) return "a filename must be 1–120 characters";
  if (name !== path.basename(name)) return "a filename cannot contain a path";
  if (name.startsWith(".")) return "a filename cannot start with a dot";
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(name)) {
    return "a filename may use letters, digits, spaces, dot, dash and underscore only";
  }
  const ext = path.extname(name).toLowerCase();
  if (!ALLOWED[kind].includes(ext)) {
    return `a ${kind} file must end in ${ALLOWED[kind].join(" or ")}`;
  }
  return null;
}

/* ----------------------------------------------------------------- titles */

/**
 * The document's own title, so the browser lists what a report CALLS itself
 * rather than the slug someone typed into a save box.
 */
function titleOf(name: string, text: string): string {
  const format = formatOf(name);
  if (format === "html") {
    const m = /<title>([\s\S]{0,200}?)<\/title>/i.exec(text);
    if (m) return decodeEntities(m[1].trim());
  } else if (format === "markdown") {
    const m = /^#\s+(.{1,200})$/m.exec(text);
    if (m) return m[1].trim();
  } else {
    /*
     * `text` is the first few kB of the file, not the file — so a full parse
     * only succeeds on a SMALL snapshot, and every real one (a 164-expense
     * ledger is ~90 kB) would silently fall through to its filename. That is
     * exactly the bug this comment replaces: it looked deliberate, because a
     * filename is a plausible title, and the 1 kB test file parsed fine.
     *
     * So: parse when the head IS the whole file, and otherwise pull the field
     * out of the head textually. `buildSnapshot` writes `title` third, so it is
     * always inside the sniff window; a file that hides its title further down
     * still degrades to the filename, which is the honest floor.
     */
    try {
      const doc = JSON.parse(text) as { title?: unknown };
      if (typeof doc.title === "string" && doc.title.trim()) return doc.title.trim();
    } catch {
      const m = /"title"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text);
      if (m) {
        const title = m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\").trim();
        if (title) return title;
      }
    }
  }
  return name.replace(/\.[^.]+$/, "");
}

/** Just enough to make a `<title>` readable — this is a label, not a renderer. */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/* ------------------------------------------------------------------ listing */

async function listVault(dirs: Record<VaultKind, string>, kind: VaultKind): Promise<VaultFile[]> {
  const dir = dirs[kind];
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    // No directory yet is not an error — it is an empty vault, which is what a
    // first run (and every user who has never saved) genuinely has.
    return [];
  }
  const files: VaultFile[] = [];
  for (const name of names) {
    if (badName(name, kind)) continue;
    const full = path.join(dir, name);
    try {
      const info = await stat(full);
      if (!info.isFile()) continue;
      const head = (await readFile(full, "utf8")).slice(0, SCAN_SNIFF_BYTES);
      files.push({
        name,
        kind,
        format: formatOf(name),
        bytes: info.size,
        modified: info.mtimeMs,
        title: titleOf(name, head)
      });
    } catch {
      /* vanished or unreadable between readdir and stat — skip it */
    }
  }
  // Newest first: a report you just generated is the one you want to reopen.
  return files.sort((a, b) => b.modified - a.modified);
}

/* -------------------------------------------------------------------- scan */

/**
 * Does this file look like an expense report? Two tiers, and the strong one is
 * a marker THIS module writes (`buildReportHtml` emits it), so a report we
 * generated is always recognised even if it was renamed to something opaque.
 */
function sniff(name: string, head: string): string | null {
  if (head.includes(REPORT_MARKER)) return "carries the Expense Tracker report marker";
  const lower = `${name}\n${head}`.toLowerCase();
  if (lower.includes("expense statement")) return "contains an expense statement heading";
  if (/expense|statement|ledger/.test(name.toLowerCase())) return "filename looks like a report";
  return null;
}

async function scanForReports(
  dirs: Record<VaultKind, string>
): Promise<{ found: FoundFile[]; truncated: boolean }> {
  const present = new Set((await listVault(dirs, "report")).map((f) => f.name));
  const found: FoundFile[] = [];
  let seen = 0;
  let truncated = false;

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (truncated || depth > SCAN_MAX_DEPTH) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (truncated) return;
      if (++seen > SCAN_MAX_ENTRIES) {
        truncated = true;
        return;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SCAN_SKIP.has(entry.name)) continue;
        // The whole vault root, every user's subtree included: the requester's
        // own files are already listable, and another user's are not this
        // requester's to discover.
        if (full === EXPENSES_VAULT_ROOT) continue;
        await walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (ext !== ".html" && ext !== ".md") continue;
      try {
        const info = await stat(full);
        if (info.size > MAX_BODY_BYTES) continue;
        const head = (await readFile(full, "utf8")).slice(0, SCAN_SNIFF_BYTES);
        const reason = sniff(entry.name, head);
        if (!reason) continue;
        found.push({
          relPath: path.relative(AXF_ROOT, full).split(path.sep).join("/"),
          bytes: info.size,
          modified: info.mtimeMs,
          title: titleOf(entry.name, head),
          format: formatOf(entry.name),
          reason,
          present: present.has(entry.name)
        });
      } catch {
        /* unreadable — not a candidate */
      }
    }
  };

  await walk(AXF_ROOT, 0);
  found.sort((a, b) => b.modified - a.modified);
  return { found, truncated };
}

/* ------------------------------------------------------------------ routes */

export async function GET(request: Request): Promise<Response> {
  await migrateLegacyVault();
  const dirs = dirsFor(kvUser(request));
  const url = new URL(request.url);

  if (url.searchParams.get("scan") === "1") {
    const { found, truncated } = await scanForReports(dirs);
    return Response.json({ found, truncated, root: AXF_ROOT });
  }

  const kind = kindOf(url.searchParams.get("kind"));
  const name = url.searchParams.get("name");

  if (!name) return Response.json({ files: await listVault(dirs, kind) });

  const problem = badName(name, kind);
  if (problem) return Response.json({ error: problem }, { status: 400 });

  const full = path.join(dirs[kind], name);
  try {
    const info = await stat(full);
    const content = await readFile(full, "utf8");
    const file: VaultFile = {
      name,
      kind,
      format: formatOf(name),
      bytes: info.size,
      modified: info.mtimeMs,
      title: titleOf(name, content)
    };
    return Response.json({ file, content });
  } catch {
    return Response.json({ error: `no ${kind} named "${name}"` }, { status: 404 });
  }
}

export async function POST(request: Request): Promise<Response> {
  await migrateLegacyVault();
  const dirs = dirsFor(kvUser(request));
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json({ error: "document too large" }, { status: 413 });
  }
  let body: { kind?: unknown; name?: unknown; content?: unknown; importPath?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "body is not JSON" }, { status: 400 });
  }

  const kind = kindOf(typeof body.kind === "string" ? body.kind : null);

  /* ---- import: copy a scanned file into the vault, keeping its name ---- */
  if (typeof body.importPath === "string") {
    const rel = body.importPath.split("/").join(path.sep);
    const source = path.resolve(AXF_ROOT, rel);
    // Resolve THEN contain. A path that escapes the root after resolution is
    // refused by name; trimming it to something safe would import a different
    // file than the one asked for, silently.
    if (source !== AXF_ROOT && !source.startsWith(AXF_ROOT + path.sep)) {
      return Response.json({ error: "that path is outside the project" }, { status: 400 });
    }
    // The scan no longer surfaces vault paths, but an import is a POST anyone
    // can shape — refuse a source inside ANY user's vault by the same rule the
    // scan skips it: another user's report is not this requester's to copy.
    if (source.startsWith(EXPENSES_VAULT_ROOT + path.sep)) {
      return Response.json({ error: "that path is inside the saved directory" }, { status: 400 });
    }
    const name = path.basename(source);
    const problem = badName(name, kind);
    if (problem) return Response.json({ error: problem }, { status: 400 });
    let content: string;
    try {
      content = await readFile(source, "utf8");
    } catch {
      return Response.json({ error: `cannot read ${body.importPath}` }, { status: 404 });
    }
    const file = await writeVault(dirs, kind, name, content);
    return Response.json({ ok: true, file });
  }

  /* ---------------------------------- save --------------------------------- */
  if (typeof body.name !== "string" || typeof body.content !== "string") {
    return Response.json({ error: "body needs { name, content } or { importPath }" }, { status: 400 });
  }
  const problem = badName(body.name, kind);
  if (problem) return Response.json({ error: problem }, { status: 400 });

  const file = await writeVault(dirs, kind, body.name, body.content);
  return Response.json({ ok: true, file });
}

async function writeVault(
  dirs: Record<VaultKind, string>,
  kind: VaultKind,
  name: string,
  content: string
): Promise<VaultFile> {
  const dir = dirs[kind];
  await mkdir(dir, { recursive: true });
  const full = path.join(dir, name);
  await writeFile(full, content, "utf8");
  const info = await stat(full);
  return {
    name,
    kind,
    format: formatOf(name),
    bytes: info.size,
    modified: info.mtimeMs,
    title: titleOf(name, content.slice(0, SCAN_SNIFF_BYTES))
  };
}

export async function DELETE(request: Request): Promise<Response> {
  await migrateLegacyVault();
  const dirs = dirsFor(kvUser(request));
  const url = new URL(request.url);
  const kind = kindOf(url.searchParams.get("kind"));
  const name = url.searchParams.get("name") ?? "";
  const problem = badName(name, kind);
  if (problem) return Response.json({ error: problem }, { status: 400 });
  await rm(path.join(dirs[kind], name), { force: true });
  return Response.json({ ok: true });
}
