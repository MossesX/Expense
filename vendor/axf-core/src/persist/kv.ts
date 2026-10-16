/**
 * @file The KV persistence primitive — per-user, per-namespace JSON documents
 * that live SERVER-SIDE, because "survives a restart" and "belongs to a user"
 * are requirements localStorage cannot meet and has already failed twice: the
 * theme store persists per-browser-profile, and the claude subsystem had to
 * hand-roll its own file store to get conversations through a dev-server
 * restart. The workspace module (axf-claude P3) needs the same durability for
 * its pane latches, library preferences and drafts — a THIRD hand-rolled store
 * is the signal this primitive exists to answer. Recorded in AXF_CAPABILITIES
 * (`kv-persistence`).
 *
 * **Why the file IO is injected rather than imported.** The `@axf/core` barrel
 * is the ONLY export, it is loaded by client bundles, and `node:fs` must never
 * cross it — `check:imports` and the exports map both hold that line, and a
 * second package entry would widen the boundary every guard in two packages is
 * built around. So this module owns everything that can be WRONG about a store
 * — scoping, name guards, the envelope format, the atomic write protocol, the
 * write chains — written against a five-operation {@link KvIo} driver the host
 * supplies in ten dumb lines of `node:fs`. The same posture as the theme
 * store's injectable `ThemeStorage`, kept deliberately: the smart half lives
 * here once, the runtime-specific half stays where the runtime is.
 *
 * Layout (driver-relative): `<user>/<namespace>.json`, one document per file,
 * so a busy namespace rewrites itself and nothing else. Both path components
 * pass {@link isKvName} or the call throws — names become file names, so the
 * guard is a traversal fence, not a nicety.
 *
 * Writes are atomic (write a sibling tmp file, rename over the target — no
 * reader ever sees half-written JSON) and serialised per user+namespace
 * through a promise chain kept on `globalThis`: Next's dev server re-evaluates
 * modules on edit, and a second copy of this module racing the first over the
 * same file is the per-runtime registry bug wearing a filesystem costume —
 * the same trap the conversation store already documents.
 */

/** A persisted document: any JSON-serialisable object. Arrays and scalars are
 *  refused at the door — a namespace holds ONE document, and a document you
 *  can add a field to later is the shape that survives requirements. */
export type KvDoc = Record<string, unknown>;

export const KV_FORMAT = "axf-kv/1";

/**
 * What actually lands on disk. The envelope names its format and owner so a
 * file found loose in a backup identifies itself, and so a read can refuse a
 * file that is not ours rather than serving it as state.
 */
export interface KvEnvelope {
  format: typeof KV_FORMAT;
  user: string;
  ns: string;
  updatedAt: string;
  doc: KvDoc;
}

/**
 * The five operations a host lends the store. Dumb by design — no scoping, no
 * validation, no format knowledge; everything above raw bytes stays in
 * {@link KvStore} so it exists exactly once.
 */
export interface KvIo {
  /** File text, or null when the file does not exist. */
  read(file: string): Promise<string | null>;
  /** Write text, creating parent directories as needed. */
  write(file: string, text: string): Promise<void>;
  /** Atomically replace `to` with `from` (POSIX rename semantics). */
  rename(from: string, to: string): Promise<void>;
  /** File names in a directory, [] when the directory does not exist. */
  list(dir: string): Promise<string[]>;
  /** Delete a file; missing is fine. */
  remove(file: string): Promise<void>;
}

/**
 * Valid user ids and namespaces: they become path components, so the alphabet
 * IS the traversal guard. Starts alphanumeric (which alone refuses `.` and
 * `..`), then word/dot/dash, 64 max. No separators of any platform.
 */
export function isKvName(v: unknown): v is string {
  return typeof v === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(v);
}

function checkedName(v: string, what: "user" | "namespace"): string {
  if (!isKvName(v)) throw new Error(`"${v}" is not a valid kv ${what}`);
  return v;
}

interface ChainState {
  chains: Map<string, Promise<unknown>>;
}

/** HMR-safe per-process write chains, keyed by store id + user + namespace. */
function chainState(): ChainState {
  const g = globalThis as { __axfKvChains?: ChainState };
  g.__axfKvChains ??= { chains: new Map() };
  return g.__axfKvChains;
}

let storeCounter = 0;

export class KvStore {
  readonly #io: KvIo;
  /** Distinguishes two stores over different roots in one process; two stores
   *  over the SAME root are the host's mistake this key cannot repair. */
  readonly #id: string;

  constructor(io: KvIo, id?: string) {
    this.#io = io;
    this.#id = id ?? `kv#${storeCounter++}`;
  }

  #file(user: string, ns: string): string {
    return `${checkedName(user, "user")}/${checkedName(ns, "namespace")}.json`;
  }

  /** Serialise `fn` behind every earlier write to the same user+namespace. */
  #chained<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const { chains } = chainState();
    const scoped = `${this.#id}::${key}`;
    const run = (chains.get(scoped) ?? Promise.resolve()).then(fn, fn);
    // The chain link swallows the failure so one failed write cannot wedge
    // every later one; the caller still gets the rejection through `run`.
    chains.set(scoped, run.catch(() => undefined));
    return run;
  }

  async #write(file: string, envelope: KvEnvelope): Promise<void> {
    // Two driver calls, one protocol: no reader may ever see half-written
    // JSON, so the bytes land beside the target and arrive by rename.
    const tmp = `${file}.tmp`;
    await this.#io.write(tmp, JSON.stringify(envelope, null, 2));
    await this.#io.rename(tmp, file);
  }

  /**
   * The user's document in `ns`, or null when there is none.
   *
   * An unparseable or foreign-format file also reads as null — the theme
   * store's recovery posture, kept deliberately: a corrupt preference file is
   * not worth refusing to boot over, and the file itself is left in place
   * untouched, so nothing is destroyed until the next legitimate write.
   */
  async read(user: string, ns: string): Promise<KvDoc | null> {
    // Outside the try on purpose: a bad NAME is refused loudly, never read as
    // "no document" — absence below means a missing or unreadable file only.
    const file = this.#file(user, ns);
    const raw = await this.#io.read(file);
    if (raw === null) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<KvEnvelope>;
      if (parsed.format !== KV_FORMAT || typeof parsed.doc !== "object" || parsed.doc === null) {
        return null;
      }
      return parsed.doc as KvDoc;
    } catch {
      return null;
    }
  }

  /** Replace the user's document in `ns`. Atomic, chained. */
  write(user: string, ns: string, doc: KvDoc): Promise<void> {
    const file = this.#file(user, ns);
    if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
      return Promise.reject(new Error("a kv document must be a plain JSON object"));
    }
    return this.#chained(file, () =>
      this.#write(file, { format: KV_FORMAT, user, ns, updatedAt: new Date().toISOString(), doc })
    );
  }

  /**
   * Read-modify-write, the WHOLE of it inside the chain — locking only the
   * save still loses updates; the registry taught this once and the
   * conversation store repeats it for the same reason. `fn` receives null when
   * no document exists yet and returns the full replacement.
   */
  mutate(user: string, ns: string, fn: (doc: KvDoc | null) => KvDoc): Promise<KvDoc> {
    const file = this.#file(user, ns);
    return this.#chained(file, async () => {
      const current = await this.read(user, ns);
      const next = fn(current);
      if (typeof next !== "object" || next === null || Array.isArray(next)) {
        throw new Error("a kv mutation must return a plain JSON object");
      }
      await this.#write(file, { format: KV_FORMAT, user, ns, updatedAt: new Date().toISOString(), doc: next });
      return next;
    });
  }

  /** Delete the user's document in `ns`. Chained, so it cannot overtake a
   *  write that was accepted before it. */
  remove(user: string, ns: string): Promise<void> {
    const file = this.#file(user, ns);
    return this.#chained(file, () => this.#io.remove(file));
  }

  /** Every namespace the user has a document in. */
  async list(user: string): Promise<string[]> {
    const names = await this.#io.list(checkedName(user, "user"));
    return names
      .filter((n) => n.endsWith(".json"))
      .map((n) => n.slice(0, -".json".length))
      .filter(isKvName)
      .sort();
  }
}
