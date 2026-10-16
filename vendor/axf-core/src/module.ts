/**
 * @file The module contract — what it means to be a module in AmberX.
 *
 * A module declares itself as data (id, title, route, its extension points) and
 * supplies one component. Everything else the framework knows about it, it
 * knows from the declaration — which is what lets the registry, the peel and
 * the UI answer questions about a module without importing it.
 *
 * Deliberately small. Per the "module drives the core" rule
 * (PLANNING-STATE.md), this grows only when a real module needs it to. What is
 * NOT here yet, and the requirement that would justify each: a slot registry
 * (a module needs its panes rearranged by a rolled layout), a manifest on disk
 * (a module needs to be packaged and installed rather than compiled in).
 * Persisted settings landed in 0.0.20 (`settings/decl.ts`), justified by four
 * modules having hand-rolled the same store four times.
 */
import type { ComponentType } from "react";
import { validateMenusDecl } from "./ctx/menus";
import type { ModuleMenusDecl } from "./ctx/menus";
import { defineNavMenu } from "./nav/types";
import type { NavMenuAsset } from "./nav/types";
import type { ExtensionPoint } from "./points";
import { validateSettingsDecl } from "./settings/decl";
import type { ModuleSettingsDecl } from "./settings/decl";

export interface ModuleSpec {
  /** Stable id. Contributions target it as `module:<id>`. */
  readonly id: string;
  readonly title: string;
  /** One line: what this screen is for. */
  readonly summary: string;
  /** Route path this module renders at, leading slash. */
  readonly route: string;
  /**
   * Contract glyph id (`icon-*`) for menus and launchers that list modules —
   * the command bar's Modules menu draws it beside the title. Optional: a
   * module that declares none gets the generic tile icon, not a hole.
   */
  readonly glyph?: string;
  /** The points this module publishes for others to plug into. */
  readonly points: readonly ExtensionPoint[];
  /**
   * The module's navigation menu, declared as data. Optional — a single-screen
   * module needs none, and `NavShell` renders nothing for an empty surface.
   * Lives on the DECL half so the peel can carry it: a peeled app's generated
   * boot registers it on its surface (normally `app.nav`), which is how a
   * module ships with navigation instead of inheriting the SDK's. Hosts other
   * than the peel may register it too; declaring it here registers nothing by
   * itself.
   */
  readonly nav?: NavMenuAsset;
  /**
   * The module's context menus, declared as data: groups + areas + items in
   * the map's own shapes. Optional. Like `nav`, declaring registers nothing —
   * a host calls `registerModuleMenus(module)` (the peeled app's boot and
   * Studio's subsystem both do), and the screen marks the declared area ids
   * in the DOM with `data-axf-area`. Structural validation happens here at
   * definition; command/predicate NAME existence is the map's gate at
   * registration, after `registerCtxCommands()`.
   */
  readonly menus?: ModuleMenusDecl;
  /**
   * The module's persisted settings, declared as data: kv namespace + rows.
   * Optional, and the minimal-sui ceiling stands — a row earns its place only
   * when the surface cannot work properly without it. Like `nav` and `menus`,
   * declaring registers nothing: a host calls `registerModuleSettings(module)`
   * and the shell supplies the surface (the gear on `ModuleHost`, the
   * "Module settings" universal row, the one `SettingsDialog`). This closes
   * the "persisted settings" gap this file's header carried since 0.0.1.
   */
  readonly settings?: ModuleSettingsDecl;
  /** The screen. */
  readonly component: ComponentType;
}

/**
 * The declaration HALF of a module — everything except the component. This is
 * what a module's `<id>.decl.ts` exports, and it exists for one reason: the
 * peel (and any other tooling) must be able to import a module's declaration
 * under plain Node, with no JSX transform and no React, to compute its closure.
 * A decl file may therefore import nothing but types. The module file composes
 * it back: `defineModule({ ...DECL, component })`.
 */
export type ModuleDecl = Omit<ModuleSpec, "component">;

/**
 * Brand on a validated spec. Only `defineModule` can produce one, so a
 * hand-written object literal does not typecheck where a `Module` is wanted —
 * the compile-time layer of the three-layer enforcement doctrine
 * (INITIATION-PROMPT.md §5).
 */
declare const MODULE_BRAND: unique symbol;
export type Module = ModuleSpec & { readonly [MODULE_BRAND]: true };

export class ModuleDefinitionError extends Error {}

/**
 * The chokepoint. Every module passes through here, so every invariant about
 * modules can live here rather than in a convention someone remembers.
 */
export function defineModule(spec: ModuleSpec): Module {
  if (!/^[a-z][a-z0-9-]*$/.test(spec.id)) {
    throw new ModuleDefinitionError(
      `module id "${spec.id}" must be lower-kebab and start with a letter`
    );
  }
  if (!spec.route.startsWith("/")) {
    throw new ModuleDefinitionError(
      `module "${spec.id}" route "${spec.route}" must start with "/"`
    );
  }
  const seen = new Set<string>();
  for (const point of spec.points) {
    if (seen.has(point.id)) {
      throw new ModuleDefinitionError(
        `module "${spec.id}" declares extension point "${point.id}" twice`
      );
    }
    seen.add(point.id);
    // A point whose id is not namespaced to its host collides the moment a
    // second module declares something with the same plain name.
    if (!point.id.startsWith(`${spec.id}.`)) {
      throw new ModuleDefinitionError(
        `extension point "${point.id}" must be namespaced as "${spec.id}.<name>"`
      );
    }
  }
  // The nav chokepoint validates the menu itself; this one only adds WHOSE it
  // is, so a bad declared nav fails naming the module rather than surfacing
  // later as a peel whose generated boot throws.
  if (spec.nav) {
    try {
      defineNavMenu(spec.nav);
    } catch (err) {
      throw new ModuleDefinitionError(
        `module "${spec.id}" declares an invalid nav menu: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  if (spec.menus) {
    const problems = validateMenusDecl(spec.id, spec.menus);
    if (problems.length) {
      throw new ModuleDefinitionError(
        `module "${spec.id}" declares invalid context menus:\n  - ${problems.join("\n  - ")}`
      );
    }
  }
  if (spec.settings) {
    const problems = validateSettingsDecl(spec.id, spec.settings);
    if (problems.length) {
      throw new ModuleDefinitionError(
        `module "${spec.id}" declares invalid settings:\n  - ${problems.join("\n  - ")}`
      );
    }
  }
  return spec as Module;
}
