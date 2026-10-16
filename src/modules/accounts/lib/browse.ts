/**
 * @file **Read-only browsing of one member's registered data roots** — the
 * engine behind `/api/accounts/admin/files`.
 *
 * ## What it is, and the one thing it is not
 *
 * Four reads — list the roots, list a directory, preview a file, fetch a file's
 * bytes — over the SAME registry `./storage` accounts against
 * (`USER_DATA_ROOTS`). One registry, so a root that is counted is a root that
 * can be looked at and vice versa; the day amberxvid registers its vaults, both
 * capabilities arrive together and neither has a list of its own to update.
 *
 * There is **no write, no delete and no move** here, and there is no
 * `if (allowWrite)` waiting to be flipped. An administrator's reach into a
 * member's data is a reading reach; deleting a member's things stays where the
 * module already put it, behind the confirm surfaces in `./admin`.
 *
 * ## The fence
 *
 * Every path is resolved and then verified, in this order, and the order is the
 * guarantee:
 *
 * 1. the relative path is refused outright if it is absolute or carries a `..`
 *    segment or a NUL — cheap, and it makes the common attempt say what it was;
 * 2. it is `path.resolve`d against the root's own base directory;
 * 3. the result is verified to be the base or to sit UNDER it — the
 *    resolve-then-verify-prefix fence every path guard in this repo uses;
 * 4. and both sides are put through `realpath` and verified AGAIN, which is
 *    what makes a symlink pointing out of the tree a refusal rather than a
 *    door. `./storage`'s walk skips symlinks for the same reason from the
 *    other direction: it will not COUNT bytes that are not the member's, and
 *    this will not SHOW them.
 *
 * ## Shared roots are the trap, and they are handled by name
 *
 * Three registered roots (`profile`, `credits`, `messages`) resolve to a
 * directory holding EVERY member's documents side by side; the registry narrows
 * them with an `owns` predicate. A browser that walked such a root as "this
 * member's files" would hand an administrator the whole studio's private
 * conversations while the screen said one member's name — the exact failure the
 * predicate exists to prevent, arriving through a different door.
 *
 * So a root with `owns` is **flat and filtered**: one path segment, never
 * recursed, and the predicate is re-asked before a file is previewed or
 * downloaded, not only when it is listed. That mirrors `./storage`'s measure
 * step, whose note already says a shared root is never recursed.
 *
 * Server-only (node imports) — imported by API routes only.
 */

import fsp from "node:fs/promises";
import path from "node:path";

import { USER_DATA_ROOTS, type UserDataRoot } from "./storage";

/* ================================== shapes ==================================== */

export type BrowseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; status: number };

const deny = (status: number, error: string): BrowseResult<never> => ({ ok: false, error, status });

/** One root as the browser's rail renders it. */
export interface RootInfo {
  id: string;
  title: string;
  /** These bytes belong to other members too — the surface says so. */
  shared: boolean;
  /** False when the root has no directory for this member (never written to,
   *  or a username the root refuses to make a path segment of). */
  present: boolean;
  /** Flat-and-filtered rather than a tree — see the header. */
  flat: boolean;
}

/** One row of a directory listing. */
export interface BrowseEntry {
  name: string;
  kind: "dir" | "file";
  /** Files only; a directory's size is not walked — that is a rescan's job. */
  bytes: number;
  modifiedAt: string;
}

export interface DirListing {
  rootId: string;
  /** The path INSIDE the root, forward-slashed. `""` is the root itself. */
  path: string;
  entries: BrowseEntry[];
}

export interface FilePreview {
  rootId: string;
  path: string;
  bytes: number;
  modifiedAt: string;
  /** Null when the file is binary — there is no useful text to show, and
   *  rendering the bytes as UTF-8 would produce a screenful of replacement
   *  characters that looks like corruption rather than like a PNG. */
  text: string | null;
  binary: boolean;
  /** True when only the head of the file was read. */
  truncated: boolean;
}

export interface FileBytes {
  rootId: string;
  path: string;
  name: string;
  /**
   * `Uint8Array<ArrayBuffer>`, not the default `Uint8Array<ArrayBufferLike>` —
   * a web `Response` body will not take the loose form, because it could be
   * backed by a `SharedArrayBuffer`. Naming the concrete buffer here is what
   * lets the route hand these bytes straight to a `NextResponse`.
   *
   * It is a COPY of what `readFile` returned rather than a view onto it: Node
   * serves small reads out of a pooled buffer, and a view would keep the whole
   * pool alive (and expose whatever else is in it) for as long as the response
   * is being written.
   */
  bytes: Uint8Array<ArrayBuffer>;
  contentType: string;
}

/* ================================ the fence =================================== */

/** Windows compares paths case-insensitively; a prefix check that did not would
 *  refuse a legitimate path whose drive letter arrived in the other case. */
const cmp = (p: string): string => (process.platform === "win32" ? p.toLowerCase() : p);

/** Is `abs` the base itself, or under it? The prefix is compared WITH the
 *  separator appended so `/data/accounts-evil` cannot pass as being inside
 *  `/data/accounts`. */
function within(base: string, abs: string): boolean {
  const b = cmp(base);
  const a = cmp(abs);
  return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep);
}

/** The relative path, normalised to forward slashes and stripped of leading and
 *  trailing separators — the one spelling every response and every audit record
 *  uses, so `a/b`, `/a/b` and `a\b` do not become three different records of
 *  the same act. */
export function normalizeRel(rel: string): string {
  return rel.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

export interface Resolved {
  root: UserDataRoot;
  /** The root's base directory for this member, absolute and real. */
  base: string;
  /** The requested target, absolute and real. */
  abs: string;
  /** The requested target relative to the base, forward-slashed. */
  rel: string;
}

/**
 * **Resolve a request inside a root, or refuse it.** Every other function here
 * goes through this and none of them re-derives a path.
 *
 * A refusal is deliberately unhelpful about WHY beyond "outside the root": an
 * error distinguishing "that escaped the fence" from "that does not exist"
 * would answer questions about the filesystem outside the member's tree, which
 * is the thing being fenced off.
 */
export async function resolveInRoot(
  rootId: string,
  username: string,
  rawRel: string,
): Promise<BrowseResult<Resolved>> {
  const root = USER_DATA_ROOTS.get(rootId);
  if (!root) return deny(404, `"${rootId}" is not a registered data root`);

  const baseRaw = root.resolve(username);
  if (!baseRaw) return deny(400, `"${username}" cannot be a path segment in the ${root.title} root`);

  const rel = normalizeRel(rawRel ?? "");
  if (rel.includes("\0")) return deny(400, "that path is not a path");
  if (path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) {
    return deny(400, "the path is relative to the root — an absolute path is refused");
  }
  if (rel.split("/").some((seg) => seg === "..")) {
    return deny(400, "the path may not climb out of the root");
  }
  // A shared root is one flat directory of everybody's documents; descending is
  // refused BEFORE the predicate rather than after, so the refusal names the
  // real reason rather than "you do not own that".
  if (root.owns && rel.includes("/")) {
    return deny(400, `the ${root.title} root is a flat, shared directory — it has no subdirectories to open`);
  }

  const base = path.resolve(baseRaw);
  const abs = path.resolve(base, rel);
  if (!within(base, abs)) return deny(400, "that path is outside the root");

  // Real paths, and the fence again. This is what catches a symlink inside the
  // tree pointing anywhere else on the machine; the check above cannot, because
  // the escape is not visible in the string.
  let realBase: string;
  try {
    realBase = await fsp.realpath(base);
  } catch {
    return deny(404, `the ${root.title} root has nothing for "${username}" yet`);
  }
  let realAbs: string;
  try {
    realAbs = await fsp.realpath(abs);
  } catch {
    return deny(404, "no such file or directory");
  }
  if (!within(realBase, realAbs)) return deny(400, "that path is outside the root");

  return { ok: true, value: { root, base: realBase, abs: realAbs, rel } };
}

/** Is this entry of a SHARED root this member's? Non-shared roots own their
 *  whole subtree, so they answer true without asking. */
async function ownedBy(root: UserDataRoot, name: string, username: string, abs: string): Promise<boolean> {
  if (!root.owns) return true;
  try {
    return (await root.owns(name, username, abs)) === true;
  } catch {
    // A predicate that threw has not said yes. On a shared root that means the
    // entry stays invisible, which is the safe direction: the cost is a file an
    // administrator cannot see, not a file belonging to somebody else that they
    // can.
    return false;
  }
}

/* ================================== reads ===================================== */

/** Every registered root, with whether this member has anything in it. The
 *  browser's rail; nothing here reads a file. */
export async function listRoots(username: string): Promise<RootInfo[]> {
  const out: RootInfo[] = [];
  for (const root of USER_DATA_ROOTS.all()) {
    const dir = root.resolve(username);
    let present = false;
    if (dir) {
      try {
        present = (await fsp.stat(dir)).isDirectory();
      } catch {
        present = false;
      }
    }
    out.push({
      id: root.id,
      title: root.title,
      shared: root.shared === true,
      present,
      flat: root.owns !== undefined,
    });
  }
  return out;
}

/** List one directory. Names only plus a stat each — never recursive, so the
 *  cost of opening a folder is the folder, not the subtree under it. */
export async function listDir(
  rootId: string,
  username: string,
  rawRel: string,
): Promise<BrowseResult<DirListing>> {
  const resolved = await resolveInRoot(rootId, username, rawRel);
  if (!resolved.ok) return resolved;
  const { root, abs, rel } = resolved.value;

  let stat: Awaited<ReturnType<typeof fsp.stat>>;
  try {
    stat = await fsp.stat(abs);
  } catch {
    return deny(404, "no such file or directory");
  }
  if (!stat.isDirectory()) return deny(400, "that is a file, not a directory");

  let names: string[];
  try {
    names = await fsp.readdir(abs);
  } catch {
    return deny(403, "that directory could not be read");
  }

  const entries: BrowseEntry[] = [];
  for (const name of names) {
    const child = path.join(abs, name);
    let childStat: Awaited<ReturnType<typeof fsp.lstat>>;
    try {
      childStat = await fsp.lstat(child);
    } catch {
      continue; // raced a delete
    }
    // Symlinks are not listed at all. Following one would leave the fence;
    // showing it un-followed would put a row on screen that cannot be opened.
    if (childStat.isSymbolicLink()) continue;
    if (!childStat.isDirectory() && !childStat.isFile()) continue;
    if (!(await ownedBy(root, name, username, child))) continue;
    entries.push({
      name,
      kind: childStat.isDirectory() ? "dir" : "file",
      bytes: childStat.isFile() ? childStat.size : 0,
      modifiedAt: new Date(childStat.mtimeMs).toISOString(),
    });
  }

  // Directories first, then by name — the order a person expects, computed here
  // so every client agrees rather than each sorting its own way.
  entries.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1,
  );

  return { ok: true, value: { rootId: root.id, path: rel, entries } };
}

/** Bytes read for a preview. Generous enough for any document this studio
 *  writes, small enough that previewing a stray gigabyte costs a page rather
 *  than the process. */
export const PREVIEW_MAX = 256 * 1024;

/** How much of the head is sampled for the binary test. A text file with a NUL
 *  in the first 8 KB is a file no preview would have rendered usefully anyway. */
const BINARY_SNIFF = 8 * 1024;

/** Read the head of a file as text, or say it is binary. */
export async function previewFile(
  rootId: string,
  username: string,
  rawRel: string,
): Promise<BrowseResult<FilePreview>> {
  const target = await resolveFile(rootId, username, rawRel);
  if (!target.ok) return target;
  const { root, abs, rel, size, mtimeMs } = target.value;

  let head: Buffer;
  let handle: Awaited<ReturnType<typeof fsp.open>> | null = null;
  try {
    handle = await fsp.open(abs, "r");
    const buf = Buffer.alloc(Math.min(size, PREVIEW_MAX));
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    head = buf.subarray(0, bytesRead);
  } catch {
    return deny(403, "that file could not be read");
  } finally {
    await handle?.close().catch(() => undefined);
  }

  const binary = head.subarray(0, BINARY_SNIFF).includes(0);
  return {
    ok: true,
    value: {
      rootId: root.id,
      path: rel,
      bytes: size,
      modifiedAt: new Date(mtimeMs).toISOString(),
      text: binary ? null : head.toString("utf8"),
      binary,
      truncated: size > head.length,
    },
  };
}

/**
 * The cap on a download.
 *
 * It exists because the bytes are buffered rather than streamed, and it is set
 * where it is because every document this store writes is orders of magnitude
 * below it — a member's whole footprint is measured in megabytes by the
 * accounting in `./storage`. A file over the cap is refused with its real size
 * named, which tells an operator to go and look at it on disk rather than
 * leaving them with a request that dies silently.
 */
export const DOWNLOAD_MAX = 64 * 1024 * 1024;

const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".mdx": "text/markdown; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".html": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".zip": "application/zip",
};

/**
 * A member's file, whole.
 *
 * `.html` and `.svg` map to types that the browser will not execute as a
 * document in the case that matters — the route sends everything as an
 * attachment, and the type is here so a saved file opens in the right thing,
 * not so a member's stored HTML can be rendered in the administrator's origin.
 */
export async function readFileBytes(
  rootId: string,
  username: string,
  rawRel: string,
): Promise<BrowseResult<FileBytes>> {
  const target = await resolveFile(rootId, username, rawRel);
  if (!target.ok) return target;
  const { root, abs, rel, size } = target.value;

  if (size > DOWNLOAD_MAX) {
    return deny(
      413,
      `that file is ${(size / (1024 * 1024)).toFixed(1)} MB and downloads here are capped at ` +
        `${DOWNLOAD_MAX / (1024 * 1024)} MB — read it on the machine instead.`,
    );
  }

  let buf: Buffer;
  try {
    buf = await fsp.readFile(abs);
  } catch {
    return deny(403, "that file could not be read");
  }

  const ext = path.extname(rel).toLowerCase();
  return {
    ok: true,
    value: {
      rootId: root.id,
      path: rel,
      name: path.basename(rel) || root.id,
      bytes: new Uint8Array(buf),
      contentType: CONTENT_TYPES[ext] ?? "application/octet-stream",
    },
  };
}

/** Resolve, insist it is a real file, and re-ask a shared root's predicate.
 *  Shared by preview and download so neither can be the one that forgets. */
async function resolveFile(
  rootId: string,
  username: string,
  rawRel: string,
): Promise<BrowseResult<Resolved & { size: number; mtimeMs: number }>> {
  const resolved = await resolveInRoot(rootId, username, rawRel);
  if (!resolved.ok) return resolved;
  const { root, abs, rel } = resolved.value;
  if (!rel) return deny(400, "that is the root directory, not a file");

  let stat: Awaited<ReturnType<typeof fsp.lstat>>;
  try {
    stat = await fsp.lstat(abs);
  } catch {
    return deny(404, "no such file");
  }
  if (stat.isSymbolicLink()) return deny(400, "that path is outside the root");
  if (!stat.isFile()) return deny(400, "that is a directory, not a file");

  // The predicate again, on the way to the bytes. Listing filtered it once, but
  // a client can ask for a path it was never shown, and "you cannot see it in
  // the list" is not a check.
  if (!(await ownedBy(root, path.basename(rel), username, abs))) {
    return deny(404, "no such file");
  }

  return { ok: true, value: { ...resolved.value, size: stat.size, mtimeMs: stat.mtimeMs } };
}
