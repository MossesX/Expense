/**
 * @file The admin suite's wire layer — one typed client for the four routes P1,
 * P2 and P3 left behind (`/api/accounts/admin/users`, `…/admin/policy`,
 * `…/storage`, `…/permissions`), plus the profile read the detail pane needs.
 *
 * ## Why the shapes are declared HERE and not imported from `lib/`
 *
 * Every one of those shapes has a server-side original — `AdminUserRow` in the
 * admin users route, `PolicyRow`/`PolicyTier` in `lib/policy.ts`,
 * `UserStorageIndex` in `lib/storage.ts`. All three files reach for `node:fs`
 * one import down, and this file is loaded by a `"use client"` surface. An
 * `import type` is erased and would compile, which is exactly what makes it
 * dangerous: the day somebody widens it to a value import, tsc says nothing and
 * the bundle drags the filesystem in (the trap is on record — see the GizmoX
 * `unarchived tab` note). So the client declares what the WIRE carries, which is
 * a smaller and more honest thing than what the server holds: JSON, already
 * serialised, with the fields the route chose to send.
 *
 * The pin is `test/…` on the route side plus these comments; if a route changes
 * its payload, the compiler here cannot know — which is true of every fetch in
 * the studio and is why each function below reads its answer defensively rather
 * than casting the whole body and hoping.
 *
 * ## One refusal shape
 *
 * Every call answers `Answer<T>` — `{ ok: true, data }` or `{ ok: false, error }`
 * — and the error text is the SERVER'S, verbatim. The accounts module's rule
 * since P3 is that the server is the guard and a surface never re-implements a
 * refusal, only relays it. A transport failure is worded as one so the two are
 * never confused on screen.
 */
"use client";

import type { SettingKind, SettingOption, SettingValue } from "@axf/core";

import type { AccountPublic, AccountRole, EffectivePermissions, Profile } from "./lib/types";

/* ================================ plumbing ================================== */

export type Answer<T> = { ok: true; data: T } | { ok: false; error: string };

interface Envelope {
  ok?: boolean;
  error?: string;
}

/** One fetch, one refusal shape. `pick` maps a successful body onto `T` so the
 *  cast lives in one expression per call instead of at every use site. */
async function call<T>(
  input: string,
  init: RequestInit | undefined,
  pick: (body: Record<string, unknown>) => T,
): Promise<Answer<T>> {
  try {
    const res = await fetch(input, init);
    const body = (await res.json()) as Envelope & Record<string, unknown>;
    if (!res.ok || body.ok !== true) {
      return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    }
    return { ok: true, data: pick(body) };
  } catch (err) {
    // A thrown fetch is the network, not a decision — say so, because "failed
    // to fetch" beside a refusal sentence reads as a refusal.
    return { ok: false, error: `could not reach the server: ${String(err)}` };
  }
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/* ============================== the users page ============================== */

export type UserSortKey =
  | "username"
  | "screenname"
  | "role"
  | "createdAt"
  | "lastLoginAt"
  | "updatedAt"
  | "storage";

export type UserStateFilter = "all" | "enabled" | "disabled" | "pending" | "online";

/** One row of the administrator's table, as `/api/accounts/admin/users` sends
 *  it. `storage` and `policy` are OPTIONAL because the route only joins them
 *  when asked — and `storage: null` means "measured, never scanned", which is a
 *  different fact from "not joined". The table renders the two differently. */
export interface AdminUserRow {
  username: string;
  role: AccountRole;
  screenname: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  disabled: boolean;
  mustChangePassword: boolean;
  awaitingFirstPassword: boolean;
  lastLoginAt: string | null;
  online: boolean;
  storage?: { totalBytes: number; sharedBytes: number; scannedAt: string } | null;
  policy?: {
    suspended: boolean;
    suspendedReason: string;
    suspendedUntil: string | null;
    lapsed: boolean;
    loginDisabled: boolean;
    storageQuotaMB: number;
  };
}

export interface AdminUserPage {
  total: number;
  offset: number;
  limit: number;
  sort: UserSortKey;
  dir: "asc" | "desc";
  rows: AdminUserRow[];
}

export interface UserPageQuery {
  q?: string;
  role?: "" | AccountRole;
  state?: UserStateFilter;
  sort?: UserSortKey;
  dir?: "asc" | "desc";
  offset?: number;
  limit?: number;
  withStorage?: boolean;
  withPolicy?: boolean;
}

/**
 * ONE PAGE of the roster. The table never holds the population — the whole
 * reason the route pages is that a studio with thousands of members must not
 * ship thousands of rows to render fifty.
 */
export function fetchUserPage(query: UserPageQuery): Promise<Answer<AdminUserPage>> {
  const p = new URLSearchParams();
  if (query.q) p.set("q", query.q);
  if (query.role) p.set("role", query.role);
  if (query.state && query.state !== "all") p.set("state", query.state);
  if (query.sort) p.set("sort", query.sort);
  if (query.dir) p.set("dir", query.dir);
  if (query.offset) p.set("offset", String(query.offset));
  if (query.limit) p.set("limit", String(query.limit));
  if (query.withStorage) p.set("withStorage", "1");
  if (query.withPolicy) p.set("withPolicy", "1");

  return call(`/api/accounts/admin/users?${p.toString()}`, undefined, (body) => ({
    total: Number(body["total"] ?? 0),
    offset: Number(body["offset"] ?? 0),
    limit: Number(body["limit"] ?? 0),
    sort: (body["sort"] as UserSortKey) ?? "username",
    dir: (body["dir"] as "asc" | "desc") ?? "asc",
    rows: (body["rows"] as AdminUserRow[]) ?? [],
  }));
}

/** Create an account. The temp password is handed to the member out of band;
 *  their next sign-in is forced through change-password by the store. */
export function createUser(
  username: string,
  tempPassword: string,
  role: AccountRole,
): Promise<Answer<AccountPublic>> {
  return call("/api/accounts/admin/users", json({ action: "create", username, tempPassword, role }), (b) =>
    b["user"] as AccountPublic,
  );
}

export function setUserRole(username: string, role: AccountRole): Promise<Answer<AccountPublic>> {
  return call("/api/accounts/admin/users", json({ action: "role", username, role }), (b) =>
    b["user"] as AccountPublic,
  );
}

export function issueTempPassword(
  username: string,
  tempPassword: string,
): Promise<Answer<AccountPublic>> {
  return call(
    "/api/accounts/admin/users",
    json({ action: "reset-password", username, tempPassword }),
    (b) => b["user"] as AccountPublic,
  );
}

export interface ProfilePatchWire {
  bio?: string;
  customFields?: { label: string; value: string }[];
}

export function saveProfile(username: string, patch: ProfilePatchWire): Promise<Answer<Profile>> {
  return call("/api/accounts/admin/users", json({ action: "profile", username, ...patch }), (b) =>
    b["profile"] as Profile,
  );
}

/**
 * A member's profile. 404s for a DISABLED account by design (`getProfile`
 * returns null for one, administrators included), so a caller must be able to
 * tell "no profile" from "failed" — which the `Answer` shape already does, and
 * the detail pane words accordingly rather than showing an error box.
 */
export function fetchProfile(username: string): Promise<Answer<Profile>> {
  return call(
    `/api/accounts/profiles?user=${encodeURIComponent(username)}`,
    undefined,
    (b) => b["profile"] as Profile,
  );
}

/* ================================= policy =================================== */

/** The site tier's pseudo-subject. Spelled `SITE_POLICY_SUBJECT` server-side in
 *  `lib/paths.ts`; repeated here because that file is a Node leaf. It is an
 *  impossible username by construction, so the two can never collide. */
export const SITE_SUBJECT = "_site";

export type PolicyTier = "default" | "site" | "user";

/** One catalog row as the route sends it — core's `SettingRow` vocabulary plus
 *  the two fields the policy catalog adds. The editor is generic over exactly
 *  this, which is what keeps a new policy row from needing editor code. */
export interface PolicyRowWire {
  key: string;
  group: string;
  label: string;
  hint: string;
  kind: SettingKind;
  defaultValue: SettingValue;
  min?: number;
  max?: number;
  step?: number;
  options?: readonly SettingOption[];
  /** Pinnable on the SITE subject only — a per-user pin is refused by the
   *  store, so the editor must not offer one. */
  siteOnly?: boolean;
}

export interface PolicySuspension {
  on: boolean;
  reason: string;
  until: string | null;
  lapsed: boolean;
}

/**
 * Everything one subject's editor needs, in one request: the catalog, the
 * resolved values, WHICH TIER supplied each, and the subject's own sparse pin
 * document.
 *
 * `values` + `tiers` + `overrides` are three views of the same cascade and all
 * three are needed: a value alone cannot distinguish "pinned to 500" from
 * "following a site that currently says 500", and those two diverge the moment
 * the site tier moves. The editor renders the DISTINCTION, never infers it.
 */
export interface PolicyView {
  subject: string;
  isSite: boolean;
  rows: PolicyRowWire[];
  groups: string[];
  values: Record<string, SettingValue>;
  tiers: Record<string, PolicyTier>;
  /** Sparse — only what this subject has pinned. */
  overrides: Record<string, SettingValue>;
  /** What the site tier holds, for "the default is X" beside a pin. */
  site: Record<string, SettingValue>;
  /** Every row's shipped default — the tier under the site. */
  defaults: Record<string, SettingValue>;
  suspension: PolicySuspension;
  /** The permission matrix's verdict, read THROUGH the policy route. Never
   *  merged into the policy values; module access stays one store. */
  access: EffectivePermissions;
}

export function fetchPolicy(subject: string): Promise<Answer<PolicyView>> {
  return call(`/api/accounts/admin/policy?user=${encodeURIComponent(subject)}`, undefined, (b) => ({
    subject: String(b["subject"] ?? subject),
    isSite: b["isSite"] === true,
    rows: (b["rows"] as PolicyRowWire[]) ?? [],
    groups: (b["groups"] as string[]) ?? [],
    values: (b["values"] as Record<string, SettingValue>) ?? {},
    tiers: (b["tiers"] as Record<string, PolicyTier>) ?? {},
    overrides: (b["overrides"] as Record<string, SettingValue>) ?? {},
    site: (b["site"] as Record<string, SettingValue>) ?? {},
    defaults: (b["defaults"] as Record<string, SettingValue>) ?? {},
    suspension: (b["suspension"] as PolicySuspension) ?? {
      on: false,
      reason: "",
      until: null,
      lapsed: false,
    },
    access: b["access"] as EffectivePermissions,
  }));
}

/** Per-key outcome of a multi-key pin. A card carrying one bad number must not
 *  discard the four good ones beside it, so the route reports each. */
export interface PolicyKeyResult {
  key: string;
  ok: boolean;
  error?: string;
}

export interface PolicyWriteReport {
  /** True only when EVERY key landed. */
  all: boolean;
  results: PolicyKeyResult[];
}

/**
 * The per-key writes do NOT go through {@link call}, and that is deliberate.
 *
 * A multi-key PUT/DELETE answers **200 with `ok: false`** and a `results` array
 * when some keys landed and others did not — there is no `error` field, because
 * a single sentence cannot describe four outcomes. Pushed through the generic
 * helper that shape becomes the useless string "HTTP 200"; read properly it is
 * the most useful thing the route says. So this reader keeps the array, and
 * composes the summary sentence from the keys that actually failed.
 */
async function writePolicy(init: RequestInit): Promise<Answer<PolicyWriteReport>> {
  try {
    const res = await fetch("/api/accounts/admin/policy", init);
    const body = (await res.json()) as Envelope & { results?: PolicyKeyResult[] };
    const results = body.results ?? [];
    const failed = results.filter((r) => !r.ok);

    // A whole-request refusal (not signed in, not an administrator, no such
    // account) carries `error` and no results — relayed verbatim, as ever.
    if (!res.ok && failed.length === 0) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    if (body.ok === true) return { ok: true, data: { all: true, results } };
    if (failed.length === 0) return { ok: false, error: body.error ?? `HTTP ${res.status}` };

    return {
      ok: false,
      error: failed.map((r) => `${r.key}: ${r.error ?? "refused"}`).join(" · "),
    };
  } catch (err) {
    return { ok: false, error: `could not reach the server: ${String(err)}` };
  }
}

/**
 * **Pin** — make this subject's value its own, so it stops following the tier
 * above. Always the explicit gesture: nothing in the editor writes a pin as a
 * side effect of rendering or of a value changing under it.
 */
export function pinPolicy(
  subject: string,
  values: Record<string, SettingValue>,
): Promise<Answer<PolicyWriteReport>> {
  return writePolicy({
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subject, values }),
  });
}

/**
 * **Un-pin** — back to FOLLOWING the tier above, including as that tier moves.
 * A DELETE and not a set-to-the-current-default: those are indistinguishable on
 * the day they are done and different forever after.
 */
export function unpinPolicy(subject: string, keys: string[]): Promise<Answer<PolicyWriteReport>> {
  return writePolicy({
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subject, keys }),
  });
}

/* ================================= storage ================================== */

export interface RootUsageWire {
  rootId: string;
  bytes: number;
  files: number;
}

export interface StorageIndexWire {
  user: string;
  totalBytes: number;
  sharedBytes: number;
  roots: RootUsageWire[];
  updatedAt: string;
  /** Last AUTHORITATIVE rebuild. Its distance from `updatedAt` is exactly how
   *  much unreconciled advisory drift the number could be carrying — which is
   *  why the gauge shows both. */
  scannedAt: string;
}

export interface RootLabel {
  id: string;
  title: string;
  shared: boolean;
}

/** `usage: null` is an honest answer — this member has never been scanned — and
 *  is NOT turned into a walk by a page load. A rescan is admin-only and
 *  explicit for exactly that reason. */
export interface StorageAnswer {
  user: string;
  usage: StorageIndexWire | null;
  roots: RootLabel[];
}

export function fetchStorage(username: string): Promise<Answer<StorageAnswer>> {
  return call(
    `/api/accounts/storage?user=${encodeURIComponent(username)}`,
    undefined,
    (b) => ({
      user: String(b["user"] ?? username),
      usage: (b["usage"] as StorageIndexWire | null) ?? null,
      roots: (b["roots"] as RootLabel[]) ?? [],
    }),
  );
}

export function rescanStorage(username: string): Promise<Answer<StorageAnswer>> {
  return call("/api/accounts/storage", json({ action: "rescan", username }), (b) => ({
    user: String(b["user"] ?? username),
    usage: (b["usage"] as StorageIndexWire | null) ?? null,
    roots: (b["roots"] as RootLabel[]) ?? [],
  }));
}

export interface RescanAllResult {
  scanned: number;
  /** Names the ledger refused — a username that cannot be a path segment. */
  skipped: string[];
  usages: StorageIndexWire[];
  roots: RootLabel[];
}

/**
 * The server's own whole-roster reconcile: one request, sequential inside.
 *
 * The Storage tab does NOT use it for its button, and the reason is worth
 * stating where the function lives: one POST that walks forty filesystems can
 * report nothing until it is finished, and a reconcile with no progress is one
 * an administrator abandons and re-presses. The tab loops per member instead.
 * This stays because it is the right call from a script or a cron, where there
 * is nobody to show a bar to.
 */
export function rescanAllStorage(): Promise<Answer<RescanAllResult>> {
  return call("/api/accounts/storage", json({ action: "rescan-all" }), (b) => ({
    scanned: Number(b["scanned"] ?? 0),
    skipped: (b["skipped"] as string[]) ?? [],
    usages: (b["usages"] as StorageIndexWire[]) ?? [],
    roots: (b["roots"] as RootLabel[]) ?? [],
  }));
}

/* ============================== browsing files ============================== */

/** One registered root as the browser's rail renders it — `lib/browse.ts`'s
 *  `RootInfo`, over the wire. */
export interface RootInfoWire {
  id: string;
  title: string;
  /** These bytes belong to other members too. */
  shared: boolean;
  /** False when this member has nothing in the root — never written to, or a
   *  username the root refuses to make a path segment of. */
  present: boolean;
  /** Flat-and-filtered: one shared directory, no subdirectories to open. */
  flat: boolean;
}

export interface BrowseEntryWire {
  name: string;
  kind: "dir" | "file";
  /** Files only — a directory's size is a rescan's job, not a listing's. */
  bytes: number;
  modifiedAt: string;
}

export interface DirListingWire {
  rootId: string;
  /** The path INSIDE the root, forward-slashed. `""` is the root itself. */
  path: string;
  entries: BrowseEntryWire[];
}

export interface FilePreviewWire {
  rootId: string;
  path: string;
  bytes: number;
  modifiedAt: string;
  /** Null when the file is binary — see `lib/browse.ts`: rendering the bytes as
   *  UTF-8 would look like corruption rather than like a PNG. */
  text: string | null;
  binary: boolean;
  /** True when only the head of the file was read. */
  truncated: boolean;
}

const fileParams = (user: string, rootId?: string, path?: string): URLSearchParams => {
  const p = new URLSearchParams({ user });
  if (rootId) p.set("root", rootId);
  if (path) p.set("path", path);
  return p;
};

/**
 * **Every call below is a RECORDED ACT.** The route writes an audit entry —
 * actor, subject, root, path, verb — before it answers, and refuses with a 500
 * if that write fails. Nothing on this side can opt out, and nothing on this
 * side should try to soften it: the banner on the Files tab says so in words
 * because the guarantee is the server's and the interface's job is to stop an
 * administrator forgetting it.
 */
export function fetchFileRoots(user: string): Promise<Answer<RootInfoWire[]>> {
  return call(
    `/api/accounts/admin/files?${fileParams(user).toString()}`,
    undefined,
    (b) => (b["roots"] as RootInfoWire[]) ?? [],
  );
}

export function fetchDirListing(
  user: string,
  rootId: string,
  path: string,
): Promise<Answer<DirListingWire>> {
  return call(
    `/api/accounts/admin/files?${fileParams(user, rootId, path).toString()}`,
    undefined,
    (b) => (b["listing"] as DirListingWire) ?? { rootId, path, entries: [] },
  );
}

export function fetchFilePreview(
  user: string,
  rootId: string,
  path: string,
): Promise<Answer<FilePreviewWire>> {
  const p = fileParams(user, rootId, path);
  p.set("view", "preview");
  return call(
    `/api/accounts/admin/files?${p.toString()}`,
    undefined,
    (b) => b["preview"] as FilePreviewWire,
  );
}

/**
 * The download URL — a URL and not a fetch, because the route answers with
 * `content-disposition: attachment` and the browser's own download is what
 * should handle it. Used as an `<a href>` for a download and as an `<img src>`
 * for an inline image; both move bytes and both are recorded as a download,
 * which is exactly what happened.
 */
export function fileDownloadUrl(user: string, rootId: string, path: string): string {
  const p = fileParams(user, rootId, path);
  p.set("view", "download");
  return `/api/accounts/admin/files?${p.toString()}`;
}

/* ================================== audit =================================== */

/** One record, as `/api/accounts/admin/audit` sends it. The verb is a STRING
 *  here rather than the server's closed union: the route sends its declared set
 *  in every answer (`verbs`), so the filter offers what the server says exists
 *  instead of a copy of the union that could fall behind it. */
export interface AuditEntryWire {
  id: string;
  /** ISO 8601 — what a surface renders. */
  at: string;
  /** Epoch ms — what a range compares. */
  ts: number;
  actor: string;
  subject: string;
  verb: string;
  root?: string;
  path?: string;
  field?: string;
  from?: string;
  to?: string;
  bytes?: number;
  detail?: string;
}

export interface AuditFacets {
  actors: string[];
  subjects: string[];
}

export interface AuditPageWire {
  /** Newest first. */
  entries: AuditEntryWire[];
  /** Matches BEFORE paging — what "1–50 of 312" reads from. */
  total: number;
  offset: number;
  limit: number;
  /** A previous generation exists, so the trail may reach further back than
   *  this window — the route errs toward saying so. */
  truncated: boolean;
  /** The declared verb set, so a filter never hard-codes it. */
  verbs: string[];
  maxLimit: number;
  /** Only when asked for: the names that actually appear in the trail. */
  facets?: AuditFacets;
}

export interface AuditQueryWire {
  actor?: string;
  subject?: string;
  verbs?: readonly string[];
  /** Epoch ms or ISO — the route takes either. */
  since?: string;
  until?: string;
  q?: string;
  offset?: number;
  limit?: number;
  /** Reads the whole trail; ask on the first load, not on every page. */
  facets?: boolean;
}

export function fetchAudit(query: AuditQueryWire): Promise<Answer<AuditPageWire>> {
  const p = new URLSearchParams();
  if (query.actor) p.set("actor", query.actor);
  if (query.subject) p.set("subject", query.subject);
  if (query.verbs && query.verbs.length > 0) p.set("verb", query.verbs.join(","));
  if (query.since) p.set("since", query.since);
  if (query.until) p.set("until", query.until);
  if (query.q) p.set("q", query.q);
  if (query.offset) p.set("offset", String(query.offset));
  if (query.limit) p.set("limit", String(query.limit));
  if (query.facets) p.set("facets", "1");

  return call(`/api/accounts/admin/audit?${p.toString()}`, undefined, (b) => ({
    entries: (b["entries"] as AuditEntryWire[]) ?? [],
    total: Number(b["total"] ?? 0),
    offset: Number(b["offset"] ?? 0),
    limit: Number(b["limit"] ?? 0),
    truncated: b["truncated"] === true,
    verbs: (b["verbs"] as string[]) ?? [],
    maxLimit: Number(b["maxLimit"] ?? 1000),
    ...(b["facets"] ? { facets: b["facets"] as AuditFacets } : {}),
  }));
}

/* =============================== permissions ================================ */

export function fetchPermissions(username: string): Promise<Answer<EffectivePermissions>> {
  return call(
    `/api/accounts/permissions?user=${encodeURIComponent(username)}`,
    undefined,
    (b) => b["permissions"] as EffectivePermissions,
  );
}

/** Every write answers with the FRESH verdict, which replaces the row — no
 *  optimistic flip, so a refusal leaves the switch where it truly is. */
export function setModuleAccess(
  username: string,
  moduleId: string,
  allowed: boolean,
): Promise<Answer<EffectivePermissions>> {
  return call(
    "/api/accounts/permissions",
    json({ username, action: "set-module", moduleId, allowed }),
    (b) => b["permissions"] as EffectivePermissions,
  );
}

export function setCapability(
  username: string,
  capability: "canMessage" | "canEditProfile",
  allowed: boolean,
): Promise<Answer<EffectivePermissions>> {
  return call(
    "/api/accounts/permissions",
    json({ username, action: "set-capability", capability, allowed }),
    (b) => b["permissions"] as EffectivePermissions,
  );
}

/* ================================ formatting ================================ */

/** Bytes as a person reads them. The suite's one spelling — the old admin pane
 *  carried its own and the gauge, the table and the breakdown must agree. */
export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** A timestamp, or an honest word for its absence. */
export function fmtWhen(iso: string | null | undefined, absent = "never"): string {
  if (!iso) return absent;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleString() : iso;
}
