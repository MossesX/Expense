/**
 * @file The client's handle on per-user persistence — a two-method transport,
 * because from the browser's side the whole store is "my document in this
 * namespace" and nothing more.
 *
 * The USER is deliberately absent from this interface. Identity is resolved by
 * the host route from the request (session, header, or "local" until an auth
 * subsystem lands); a client that could name an arbitrary user would make
 * per-user scoping a suggestion. The namespace is still guarded here so a bad
 * key fails at the call site rather than as a 400 nobody reads.
 *
 * `httpKv` is the wired default — it speaks to whatever route the host mounts
 * over `KvStore` (studio: `/api/axf/kv/<ns>`). `memoryKv` is for tests and for
 * surfaces rendered where no host route exists; a store that cannot persist
 * should still function for the life of the page — the theme store's posture,
 * kept.
 */
import { isKvName } from "./kv";
import type { KvDoc } from "./kv";

export interface KvTransport {
  /** The current user's document in `ns`, or null when there is none. */
  read(ns: string): Promise<KvDoc | null>;
  /** Replace the current user's document in `ns`. */
  write(ns: string, doc: KvDoc): Promise<void>;
}

function checkedNs(ns: string): string {
  if (!isKvName(ns)) throw new Error(`"${ns}" is not a valid kv namespace`);
  return ns;
}

/** Talk to the host's kv route. 404 reads as "no document yet", not an error. */
export function httpKv(base = "/api/axf/kv"): KvTransport {
  return {
    async read(ns) {
      const res = await fetch(`${base}/${checkedNs(ns)}`, { cache: "no-store" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`kv read ${ns}: HTTP ${res.status}`);
      const body = (await res.json()) as { doc?: KvDoc | null };
      return body.doc ?? null;
    },
    async write(ns, doc) {
      const res = await fetch(`${base}/${checkedNs(ns)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ doc })
      });
      if (!res.ok) throw new Error(`kv write ${ns}: HTTP ${res.status}`);
    }
  };
}

/** In-memory transport: tests, storybooks, hostless surfaces. */
export function memoryKv(): KvTransport {
  const docs = new Map<string, KvDoc>();
  return {
    read: async (ns) => docs.get(checkedNs(ns)) ?? null,
    write: async (ns, doc) => void docs.set(checkedNs(ns), doc)
  };
}

let shared: KvTransport | null = null;

/**
 * The transport a component gets when its host passes none: HTTP in a browser,
 * memory anywhere else. Server renders never persist — they have no user and
 * no interaction — so the memory fallback is correctness there, not a stub.
 */
export function defaultKv(): KvTransport {
  shared ??= typeof window === "undefined" ? memoryKv() : httpKv();
  return shared;
}
