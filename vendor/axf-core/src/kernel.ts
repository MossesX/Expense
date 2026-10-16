/**
 * @file The kernel — boots subsystems in dependency order and supervises them.
 *
 * "Subsystem" means something the core loads and SUPERVISES. If a subsystem
 * failing takes the core down with it, the word is decoration. So the kernel
 * owns three things the registry deliberately does not:
 *
 *   1. **Order.** Subsystems declare `requires`; the kernel topologically sorts
 *      them and refuses a cycle by name rather than hanging or overflowing.
 *   2. **Isolation.** A subsystem that throws in `start()` is marked `failed`
 *      with its error retained. The kernel continues. Everything that required
 *      it is marked `blocked` — never silently started against a dependency
 *      that is not there, which is the failure that produces a blank pane and
 *      no explanation.
 *   3. **Truth.** `statuses()` is what actually happened, not what was
 *      intended. Any diagnostic surface reads this rather than assuming a
 *      registered subsystem is a running one.
 *
 * Boot is idempotent: calling it twice is a no-op, because a React dev server
 * re-executes modules on refresh and a second boot would double-register
 * everything.
 */
import type { Subsystem } from "./subsystem";

export type SubsystemState = "pending" | "started" | "failed" | "blocked";

export interface SubsystemStatus {
  readonly id: string;
  readonly title: string;
  readonly layer: "core" | "sdk";
  readonly state: SubsystemState;
  /** Present when `state` is `failed`. */
  readonly error?: string;
  /** Present when `state` is `blocked` — the unmet dependency ids. */
  readonly blockedBy?: readonly string[];
  /** Milliseconds spent in `start()`. Present once it has run. */
  readonly startedInMs?: number;
}

export class KernelError extends Error {}

export class Kernel {
  readonly #subsystems = new Map<string, Subsystem>();
  readonly #status = new Map<string, SubsystemStatus>();
  #booted = false;

  register(subsystem: Subsystem): this {
    if (this.#booted) {
      throw new KernelError(
        `subsystem "${subsystem.id}" registered after boot; register before booting`
      );
    }
    if (this.#subsystems.has(subsystem.id)) {
      throw new KernelError(`subsystem "${subsystem.id}" is already registered`);
    }
    this.#subsystems.set(subsystem.id, subsystem);
    this.#status.set(subsystem.id, {
      id: subsystem.id,
      title: subsystem.title,
      layer: subsystem.layer,
      state: "pending"
    });
    return this;
  }

  subsystems(): Subsystem[] {
    return [...this.#subsystems.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  subsystem(id: string): Subsystem | undefined {
    return this.#subsystems.get(id);
  }

  statuses(): SubsystemStatus[] {
    return [...this.#status.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  get booted(): boolean {
    return this.#booted;
  }

  /**
   * Dependency order, or a named cycle. Kahn's algorithm — chosen over a
   * recursive walk because the failure mode of a cycle is then a clear error
   * listing the participants rather than a stack overflow.
   */
  #bootOrder(): string[] {
    const indegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();

    for (const id of this.#subsystems.keys()) {
      indegree.set(id, 0);
      dependents.set(id, []);
    }
    for (const sub of this.#subsystems.values()) {
      for (const need of sub.requires ?? []) {
        // A missing dependency is not a cycle — it is handled as `blocked`
        // during the boot walk, where the message can name what is absent.
        if (!this.#subsystems.has(need)) continue;
        indegree.set(sub.id, (indegree.get(sub.id) ?? 0) + 1);
        dependents.get(need)!.push(sub.id);
      }
    }

    const ready = [...indegree.entries()]
      .filter(([, n]) => n === 0)
      .map(([id]) => id)
      .sort();
    const order: string[] = [];
    while (ready.length) {
      const id = ready.shift()!;
      order.push(id);
      for (const next of dependents.get(id) ?? []) {
        const n = (indegree.get(next) ?? 0) - 1;
        indegree.set(next, n);
        if (n === 0) {
          ready.push(next);
          ready.sort();
        }
      }
    }

    if (order.length !== this.#subsystems.size) {
      const stuck = [...this.#subsystems.keys()].filter((id) => !order.includes(id)).sort();
      throw new KernelError(
        `subsystem dependency cycle among: ${stuck.join(", ")}`
      );
    }
    return order;
  }

  /**
   * Start everything. Never throws for a subsystem's own failure — that is
   * recorded and boot continues, which is the entire point of supervision.
   * It DOES throw for a cycle, because that is a defect in the declarations
   * rather than a runtime fault, and it must be fixed before anything runs.
   */
  async boot(): Promise<SubsystemStatus[]> {
    if (this.#booted) return this.statuses();
    const order = this.#bootOrder();
    const usable = new Set<string>();

    for (const id of order) {
      const sub = this.#subsystems.get(id)!;
      const unmet = (sub.requires ?? []).filter((need) => !usable.has(need));
      if (unmet.length) {
        this.#status.set(id, {
          id,
          title: sub.title,
          layer: sub.layer,
          state: "blocked",
          blockedBy: unmet
        });
        continue;
      }
      const began = performance.now();
      try {
        await sub.start?.();
        usable.add(id);
        this.#status.set(id, {
          id,
          title: sub.title,
          layer: sub.layer,
          state: "started",
          startedInMs: Math.round((performance.now() - began) * 100) / 100
        });
      } catch (err) {
        this.#status.set(id, {
          id,
          title: sub.title,
          layer: sub.layer,
          state: "failed",
          error: err instanceof Error ? err.message : String(err),
          startedInMs: Math.round((performance.now() - began) * 100) / 100
        });
      }
    }

    this.#booted = true;
    return this.statuses();
  }
}

/** The process-wide kernel. */
export const kernel = new Kernel();
