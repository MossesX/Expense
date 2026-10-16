/**
 * @file The subsystem contract — framework-level infrastructure that extends
 * the CORE, not an app that sits on top of it.
 *
 * The distinction matters and is easy to blur (asset taxonomy, `.claude/rules/
 * asset-types.md`):
 *
 *   - A **module** is a standalone application/screen. It has a route, it is
 *     the thing a user opens, and it is what gets peeled into a standalone app.
 *   - A **subsystem** is a service the core loads and supervises. It may carry
 *     a full UI (Studio does), but its job is providing capability to everything
 *     else — a registry, a packaging service, a build host, an API. It is not
 *     hosted by any module and it is not optional to the framework's operation
 *     once installed.
 *
 * Studio is a subsystem. That is not a formality: if Studio were a module it
 * would be peelable, and "peel the workshop into a standalone app" is a
 * category error. Subsystems are explicitly NOT part of a peel closure — a
 * peeled app inherits the core's subsystems it needs and carries none of the
 * SDK's.
 *
 * A subsystem boots. `start()` is where it registers what it provides, and the
 * core calls it once, in dependency order.
 */
import type { ComponentType } from "react";
import type { ExtensionPoint } from "./points";

export interface SubsystemSpec {
  /** Stable id. Contributions target the core it extends, not the subsystem. */
  readonly id: string;
  readonly title: string;
  /** One line: what capability this provides to everything else. */
  readonly summary: string;
  /**
   * Which layer this belongs to. `core` subsystems ship into a peeled app;
   * `sdk` subsystems never do. Declared here so the split is data a test can
   * check, not a convention (INITIATION-PROMPT.md §5.1 tier 2).
   */
  readonly layer: "core" | "sdk";
  /** Other subsystem ids that must have started first. */
  readonly requires?: readonly string[];
  /** Points this subsystem publishes for others to plug into. */
  readonly points?: readonly ExtensionPoint[];
  /**
   * Optional surface. A subsystem with a UI still has no route of its own — the
   * shell decides where to put it, because a subsystem is not a destination.
   */
  readonly surface?: ComponentType;
  /** Called once, by the core, at boot. Registers what this provides. */
  readonly start?: () => void | Promise<void>;
}

declare const SUBSYSTEM_BRAND: unique symbol;
export type Subsystem = SubsystemSpec & { readonly [SUBSYSTEM_BRAND]: true };

export class SubsystemDefinitionError extends Error {}

/** The chokepoint every subsystem passes through. */
export function defineSubsystem(spec: SubsystemSpec): Subsystem {
  if (!/^[a-z][a-z0-9-]*$/.test(spec.id)) {
    throw new SubsystemDefinitionError(
      `subsystem id "${spec.id}" must be lower-kebab and start with a letter`
    );
  }
  const seen = new Set<string>();
  for (const point of spec.points ?? []) {
    if (seen.has(point.id)) {
      throw new SubsystemDefinitionError(
        `subsystem "${spec.id}" declares extension point "${point.id}" twice`
      );
    }
    seen.add(point.id);
    if (!point.id.startsWith(`${spec.id}.`)) {
      throw new SubsystemDefinitionError(
        `extension point "${point.id}" must be namespaced as "${spec.id}.<name>"`
      );
    }
  }
  if (spec.requires?.includes(spec.id)) {
    throw new SubsystemDefinitionError(`subsystem "${spec.id}" cannot require itself`);
  }
  return spec as Subsystem;
}
