/**
 * @file Named appearance states + factory reset — the per-user STATE engine
 * (P1 of `default-state`).
 *
 * A saved state is P0's `AppearanceStateSnapshot`
 * (src/defaults/default-state.ts) under a display name: theme
 * seed/options/overrides, pack selection per slot, chrome asset choices
 * (banner bar / nav menu / dashboard arrangement), and the settings/data
 * baselines that carry wrapper/look bindings and installed-module enablement —
 * appearance ONLY, never module data. The server never invents appearance
 * state: `saveState` persists what the CLIENT captured, re-validated and
 * rebuilt key-by-key in {@link parseSnapshot}, so nothing beyond the snapshot
 * shape (a module document, a smuggled extra field) can ride along into the
 * store or back out of it on apply.
 *
 * Layout: `<dataRoot>/states/<username>/<slug>.json` (`./paths`), one file per
 * state, slug kv-name-safe (`[a-z0-9-]`, derived from the display name).
 * House posture throughout (`./fsCore`): degrade never crash — a junk file is
 * skipped by list and answers 404 to apply — atomic writes, every mutation in
 * the journal.
 *
 * `factoryReset(username)` is the destructive half: it deletes the user's kv
 * tree (`data/axf/kv/<username>/` — per-user settings docs, chrome assets,
 * every module's kv namespace) plus the per-module data subtrees, then returns
 * `defaultStateSnapshot()` for the CLIENT to apply. Deleting IS the restore:
 * P0 records that the default data baseline is the ABSENCE of per-user
 * documents, so a reset writes nothing. Saved appearance states deliberately
 * SURVIVE a reset — they are the user's own captures, and re-applying one
 * afterwards is the point of keeping them.
 *
 * Server-only (node imports) — imported by API routes only.
 */

import fsp from "node:fs/promises";
import path from "node:path";
import {
  defaultStateSnapshot,
  type AppearanceStateSnapshot,
  type ThemeStateSnapshot,
} from "@axs/defaults/default-state";
import { KV_ROOT } from "@axs/server/axfKv";
import { claudeConversationsUserDir, claudeProjectsUserDir } from "@axs/server/claudePaths";
import { expensesUserDir } from "@axs/server/expensesPaths";
import { appendJournal, readJsonFile, writeJsonAtomic } from "./fsCore";
import { statesDir } from "./paths";

/* ---------------------------------- shapes ------------------------------------ */

/** One named appearance state, as persisted and as served to apply. */
export interface SavedState {
  /** kv-name-safe id derived from the display name — the filename stem. */
  slug: string;
  /** The display name exactly as the user typed it. */
  name: string;
  /** ISO timestamp of the save (a re-save under the same slug refreshes it). */
  savedAt: string;
  /** The CLIENT-captured appearance snapshot, P0's shape. */
  snapshot: AppearanceStateSnapshot;
}

/** What list serves — everything but the snapshot payload. */
export interface SavedStateMeta {
  slug: string;
  name: string;
  savedAt: string;
}

export type StatesResult<T> = { ok: true; value: T } | { ok: false; error: string; status: number };

/* ----------------------------------- caps ------------------------------------- */

export const MAX_STATE_NAME = 64;
/** Serialized-snapshot ceiling — a theme + packs + chrome + baselines snapshot
 *  is a few KB; anything near this cap is carrying something it should not. */
export const MAX_SNAPSHOT_BYTES = 128 * 1024;
export const MAX_STATES_PER_USER = 64;

/* --------------------------------- plumbing ----------------------------------- */

/** Same username grammar the accounts store enforces at creation — the session
 *  is trusted for identity, this guard is for path hygiene only. */
const USER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,31}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** Display name → kv-name-safe slug: lowercase, runs of anything else fold to
 *  one `-`, trimmed, ≤ 48 chars. Empty means the name had no letter or digit. */
export function slugifyStateName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

/** The typed confirmation `factory-reset` demands in the request body. */
export function factoryResetConfirmation(username: string): string {
  return `factory-reset ${username}`;
}

function userStatesDir(username: string): string | null {
  if (!USER_RE.test(username)) return null;
  return path.join(statesDir(), username);
}

const fwd = (p: string): string => p.replace(/\\/g, "/");

/** Ledger path — repo-relative in dev; an env-rooted store logs its absolute
 *  path (still a truthful record of what was touched). */
function ledgerPath(abs: string): string {
  const rel = path.relative(process.cwd(), abs);
  return fwd(rel.startsWith("..") ? abs : rel);
}

/* -------------------------------- validation ---------------------------------- */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isIdOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";

/**
 * Validate + REBUILD a client-captured snapshot into exactly P0's shape.
 * Rebuilding key-by-key is the "never module data" guard in code: an extra
 * top-level field, a non-record baseline, or a non-primitive setting value is
 * refused or dropped rather than persisted. Null on any structural miss.
 */
export function parseSnapshot(v: unknown): AppearanceStateSnapshot | null {
  if (!isRecord(v) || v.version !== 1) return null;
  const { theme, packs, chrome, settings, data } = v;
  if (!isRecord(theme) || !isRecord(packs) || !isRecord(chrome) || !isRecord(settings) || !isRecord(data)) {
    return null;
  }
  if (!isIdOrNull(theme.seed) || !isRecord(theme.options) || !isRecord(theme.overrides)) return null;
  const branding = packs["branding-package"];
  const logo = packs["logo-package"];
  if (!isIdOrNull(branding) || !isIdOrNull(logo)) return null;
  const { bannerBar, navMenu, dashboard } = chrome;
  if (typeof bannerBar !== "string" || typeof navMenu !== "string" || typeof dashboard !== "string") {
    return null;
  }
  const settingsBaseline: Record<string, Record<string, string | number | boolean>> = {};
  for (const [ns, doc] of Object.entries(settings)) {
    if (!isRecord(doc)) return null;
    const clean: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(doc)) {
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
        return null;
      }
      clean[key] = value;
    }
    settingsBaseline[ns] = clean;
  }
  return {
    version: 1,
    theme: {
      seed: theme.seed,
      options: theme.options as ThemeStateSnapshot["options"],
      overrides: theme.overrides as ThemeStateSnapshot["overrides"],
    },
    packs: { "branding-package": branding, "logo-package": logo },
    chrome: { bannerBar, navMenu, dashboard },
    settings: settingsBaseline,
    data: { ...data },
  };
}

/* ---------------------------------- the API ----------------------------------- */

/** Every state the user has, newest first. Junk files are skipped, absent
 *  directory is an honest empty list. */
export async function listStates(username: string): Promise<SavedStateMeta[]> {
  const dir = userStatesDir(username);
  if (!dir) return [];
  let files: string[];
  try {
    files = await fsp.readdir(dir);
  } catch {
    return [];
  }
  const out: SavedStateMeta[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const parsed = readJsonFile<SavedState>(path.join(dir, file));
    if (
      !parsed ||
      typeof parsed.slug !== "string" ||
      typeof parsed.name !== "string" ||
      typeof parsed.savedAt !== "string" ||
      !parseSnapshot(parsed.snapshot)
    ) {
      continue;
    }
    out.push({ slug: parsed.slug, name: parsed.name, savedAt: parsed.savedAt });
  }
  out.sort((a, b) => (a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0));
  return out;
}

/**
 * Persist a CLIENT-captured snapshot under a display name. Same slug =
 * overwrite (a re-save of "Amber Night" updates it, never forks it).
 */
export async function saveState(
  username: string,
  name: string,
  rawSnapshot: unknown,
): Promise<StatesResult<SavedState>> {
  const dir = userStatesDir(username);
  if (!dir) return { ok: false, error: "invalid session user", status: 400 };
  const clean = typeof name === "string" ? name.trim() : "";
  if (!clean || clean.length > MAX_STATE_NAME) {
    return { ok: false, error: `state name must be 1–${MAX_STATE_NAME} characters`, status: 400 };
  }
  const slug = slugifyStateName(clean);
  if (!SLUG_RE.test(slug)) {
    return { ok: false, error: "state name must contain at least one letter or digit", status: 400 };
  }
  const snapshot = parseSnapshot(rawSnapshot);
  if (!snapshot) {
    return {
      ok: false,
      error: "body must carry a client-captured appearance snapshot (P0 version-1 shape)",
      status: 400,
    };
  }
  if (JSON.stringify(snapshot).length > MAX_SNAPSHOT_BYTES) {
    return { ok: false, error: "snapshot too large — that is not appearance state", status: 413 };
  }
  const file = path.join(dir, `${slug}.json`);
  const existed = readJsonFile<SavedState>(file) !== null;
  if (!existed && (await listStates(username)).length >= MAX_STATES_PER_USER) {
    return { ok: false, error: `at most ${MAX_STATES_PER_USER} saved states per user`, status: 409 };
  }
  const state: SavedState = { slug, name: clean, savedAt: new Date().toISOString(), snapshot };
  await writeJsonAtomic(file, state);
  await appendJournal(existed ? "edit" : "create", ledgerPath(file), {
    summary: `states: ${username} saved appearance state "${clean}"`,
  });
  return { ok: true, value: state };
}

/** The stored state for apply — the CLIENT applies the returned snapshot. */
export async function loadState(username: string, slug: string): Promise<StatesResult<SavedState>> {
  const dir = userStatesDir(username);
  if (!dir) return { ok: false, error: "invalid session user", status: 400 };
  if (typeof slug !== "string" || !SLUG_RE.test(slug)) {
    return { ok: false, error: "no such state", status: 404 };
  }
  const parsed = readJsonFile<SavedState>(path.join(dir, `${slug}.json`));
  const snapshot = parsed ? parseSnapshot(parsed.snapshot) : null;
  if (!parsed || !snapshot) return { ok: false, error: "no such state", status: 404 };
  return {
    ok: true,
    value: { slug, name: String(parsed.name), savedAt: String(parsed.savedAt), snapshot },
  };
}

export async function deleteState(username: string, slug: string): Promise<StatesResult<SavedStateMeta>> {
  const loaded = await loadState(username, slug);
  if (!loaded.ok) return loaded;
  const dir = userStatesDir(username)!;
  const file = path.join(dir, `${slug}.json`);
  await fsp.rm(file, { force: true });
  await appendJournal("delete", ledgerPath(file), {
    summary: `states: ${username} deleted appearance state "${loaded.value.name}"`,
  });
  const { name, savedAt } = loaded.value;
  return { ok: true, value: { slug, name, savedAt } };
}

/* -------------------------------- factory reset -------------------------------- */

/**
 * Per-module data subtrees a factory reset wipes ALONGSIDE the user's kv tree.
 *
 * COMPLETED by P2 (per-user isolation, 2026-08-14). The P2 audit walked every
 * module store and found the per-user footprint is the kv tree plus exactly
 * these subtrees:
 *
 *   - the expense vault, `data/axf/expenses/<user>/{reports,saves}`;
 *   - Claude workspace conversations, `data/claude/conversations/<user>/`;
 *   - Claude workspace projects, `data/claude/projects/<user>/`.
 *
 * Each resolver is the SAME function its owning store resolves paths through
 * (`@axs/server/expensesPaths`, `@axs/server/claudePaths`), so the reset and
 * the store cannot drift apart. A resolver answers `null` for a username its
 * grammar refuses and the loop skips it — {@link factoryReset} has already
 * validated the session user by then, so a null here is belt-and-braces, not a
 * silent hole. Everything else audited either persists through `/api/axf/kv`
 * (already inside the kv tree the reset wipes first) or lives in the browser
 * (taskman's localStorage, the assistant's sessionStorage) and is the client
 * apply's business, never this function's.
 */
export const FACTORY_RESET_SUBTREES: ReadonlyArray<(username: string) => string | null> = [
  expensesUserDir,
  claudeConversationsUserDir,
  claudeProjectsUserDir,
];

/**
 * Wipe the user's per-user storage and hand back the default snapshot for the
 * client to apply. Destructive and unjournalable-in-reverse — the route gates
 * it behind a typed confirmation ({@link factoryResetConfirmation}) and only
 * ever acts on the signed-in user. Saved appearance states survive.
 */
export async function factoryReset(username: string): Promise<StatesResult<AppearanceStateSnapshot>> {
  if (!USER_RE.test(username)) return { ok: false, error: "invalid session user", status: 400 };
  const kvDir = path.join(KV_ROOT, username);
  try {
    await fsp.rm(kvDir, { recursive: true, force: true });
    for (const subtree of FACTORY_RESET_SUBTREES) {
      const dir = subtree(username);
      if (dir) await fsp.rm(dir, { recursive: true, force: true });
    }
  } catch (err) {
    return {
      ok: false,
      error: `factory reset failed: ${err instanceof Error ? err.message : String(err)}`,
      status: 500,
    };
  }
  await appendJournal("delete", ledgerPath(kvDir), {
    summary: `states: factory reset wiped ${username}'s per-user kv tree and module data`,
  });
  return { ok: true, value: defaultStateSnapshot() };
}
