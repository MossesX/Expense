/**
 * @file The **vault** client — the browser's half of `/api/expenses/files`.
 *
 * One place that knows the endpoint, its query shape and its failure modes, so
 * the four surfaces that use it (save, load, open report, find & import) all
 * fail the same way. Every call resolves to a `{ ok }` union rather than
 * throwing: these run from click handlers, and an unhandled rejection in a
 * click handler is a button that does nothing and says nothing.
 *
 * The TYPES live here rather than in the route, and the route imports them.
 * That direction is deliberate — the route is Node-only (`node:fs`), so a
 * client file importing types *from* it would be one careless `import` away
 * from dragging `node:fs` into the browser bundle, which typechecks fine and
 * fails at runtime. This way the shared vocabulary sits on the safe side.
 */

export type VaultKind = "report" | "save";
export type VaultFormat = "html" | "markdown" | "json";

/** A file in the saved directory. */
export interface VaultFile {
  name: string;
  kind: VaultKind;
  format: VaultFormat;
  bytes: number;
  /** Epoch ms of the last write. */
  modified: number;
  /** The document's own title when it has one, else the bare filename. */
  title: string;
}

/** A report-shaped file found elsewhere in the project by the scan. */
export interface FoundFile {
  /** Root-relative, POSIX separators — displayable and re-postable as-is. */
  relPath: string;
  bytes: number;
  modified: number;
  title: string;
  format: VaultFormat;
  /** Why the scanner thinks this is an expense report. */
  reason: string;
  /** True when a file of this name is already in the vault. */
  present: boolean;
}

const ENDPOINT = "/api/expenses/files";

export type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

async function call<T>(url: string, init?: RequestInit): Promise<Result<T>> {
  try {
    const res = await fetch(url, init);
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: String(data.error ?? `request failed (${res.status})`) };
    }
    return { ok: true, ...(data as T) };
  } catch (e) {
    // Offline, dev server restarting, route missing — one sentence the surface
    // can render, never a thrown promise nobody catches.
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Everything in the saved directory for one kind, newest first. */
export function listVault(kind: VaultKind): Promise<Result<{ files: VaultFile[] }>> {
  return call(`${ENDPOINT}?kind=${kind}`);
}

/** One file's metadata and its full text. */
export function readVault(
  kind: VaultKind,
  name: string
): Promise<Result<{ file: VaultFile; content: string }>> {
  return call(`${ENDPOINT}?kind=${kind}&name=${encodeURIComponent(name)}`);
}

/** Write a file into the saved directory, creating it if need be. */
export function writeVault(
  kind: VaultKind,
  name: string,
  content: string
): Promise<Result<{ file: VaultFile }>> {
  return call(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, name, content })
  });
}

export function deleteVault(kind: VaultKind, name: string): Promise<Result<Record<string, never>>> {
  return call(`${ENDPOINT}?kind=${kind}&name=${encodeURIComponent(name)}`, { method: "DELETE" });
}

/**
 * Hunt the project for report-shaped files that are not in the vault yet.
 *
 * `truncated` is surfaced rather than swallowed — the walk is capped, and a
 * capped list presented as complete is a wrong answer wearing a green tick.
 */
export function scanForReports(): Promise<Result<{ found: FoundFile[]; truncated: boolean; root: string }>> {
  return call(`${ENDPOINT}?scan=1`);
}

/** Copy a scanned file into the saved directory under its own name. */
export function importFound(kind: VaultKind, relPath: string): Promise<Result<{ file: VaultFile }>> {
  return call(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, importPath: relPath })
  });
}

/** `12.4 kB` — vault listings show size, and bytes are unreadable at a glance. */
export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** `12 Aug 18:40` — vault listings show when, and epochs are unreadable. */
export function humanWhen(ms: number): string {
  const d = new Date(ms);
  const month = d.toLocaleString(undefined, { month: "short" });
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getDate()} ${month} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
