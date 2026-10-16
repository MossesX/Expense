/**
 * @file The host's half of core's kv primitive: the ten dumb `node:fs` lines
 * core's `KvIo` driver contract asks for, and the singleton store over them.
 *
 * Everything that can be WRONG about a store — scoping, name guards, the
 * envelope, atomicity, write chains — lives in core (`persist/kv.ts`), behind
 * the one-entry barrel `check:imports` defends. This file supplies only what
 * core structurally cannot: the runtime. Keep it dumb; a clever driver is a
 * second store.
 *
 * Root: `<studio cwd>/data/axf/kv/<user>/<ns>.json` — beside
 * `data/claude/conversations/`, so "what this install knows" stays one
 * directory. **Node-only**; never import from a client component.
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { KvStore } from "@axf/core";
import type { KvIo } from "@axf/core";

import { dataPath } from "./dataRoot";

import { axsUserFromCookieHeader } from "@axs/modules/accounts/lib/session";

/**
 * The ten dumb lines, over one root. **Exported** (2026-08-13, `axf-claude`
 * P1) because a second store over a second root needs the same ten and must
 * not get its own copy of them — the conversation store keeps its documents in
 * `data/claude/conversations/`, away from the shared kv namespace, and that is
 * a different ROOT rather than a different driver.
 */
export function nodeKvIo(root: string): KvIo {
  const abs = (rel: string) => path.join(root, rel);
  return {
    async read(file) {
      try {
        return await readFile(abs(file), "utf8");
      } catch {
        return null;
      }
    },
    async write(file, text) {
      await mkdir(path.dirname(abs(file)), { recursive: true });
      await writeFile(abs(file), text, "utf8");
    },
    rename: (from, to) => rename(abs(from), abs(to)),
    async list(dir) {
      try {
        return await readdir(abs(dir));
      } catch {
        return [];
      }
    },
    remove: (file) => rm(abs(file), { force: true })
  };
}

export const KV_ROOT = dataPath("axf", "kv");

/** The store id names the root, so two stores over different roots chain
 *  separately while HMR copies of THIS module chain together. */
export const axfKv = new KvStore(nodeKvIo(KV_ROOT), `file:${KV_ROOT}`);

/**
 * The user every kv request acts as. AmberX has no auth subsystem yet — the
 * session store is a real store over a stub backend — so every request is the
 * local owner. When auth lands this resolves from the request, and the
 * signature takes the Request precisely so that lands here and not in every
 * route. Auth landed 2026-08-13 (accounts P3): the user is now the verified
 * `axs_session` cookie's username, and "local" remains the signed-out owner.
 */
export function kvUser(request: Request): string {
  return axsUserFromCookieHeader(request.headers.get("cookie")) ?? "local";
}
