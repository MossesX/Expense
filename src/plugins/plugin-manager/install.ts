/**
 * @file The runtime half of "one plugin artifact, two hosts" — install an
 * imported plugin's entry-module exports into the live registries.
 *
 * The contract is STRUCTURAL, the same one the closure scanner already holds
 * (`scripts/lib/closure.mjs`, `isContribution`): an entry module exports
 * values, and what each value IS decides where it registers. Nothing new for
 * a plugin author to learn — the tab bar's `plugin.ts` + `tab-bar.decl.ts`
 * pair already satisfies it, which is the proof the contract describes what
 * plugins do rather than what an installer wishes they did.
 *
 *   - a function named `register…Commands` runs FIRST — the same ordering rule
 *     `studio.subsystem.ts` states: the menu map refuses an item naming an
 *     unregistered command, so commands must exist before menus register.
 *   - a `Contribution`-shaped export (`{ from, point, payload }`) goes to
 *     `registry.contribute`, where an undeclared point or a bad payload is
 *     recorded as a violation rather than dropped — loud, where it was made.
 *   - a decl-shaped export (`{ id, menus?, settings? }`) registers its menus
 *     and settings through the same seams every built-in decl uses.
 *
 * Called by `studio.subsystem.ts` with `INSTALLED_PLUGINS` from the generated
 * loader. Errors in ONE plugin's install are caught and reported per plugin:
 * an imported plugin that throws may not take the boot down with it — that is
 * the crash-isolation posture, applied at registration time.
 */
import {
  registerModuleMenus,
  registerModuleSettings,
  registry as globalRegistry
} from "@axf/core";
import type { Contribution, ModuleMenusDecl, ModuleSettingsDecl, Registry } from "@axf/core";

import type { InstalledPluginModule } from "../installed.generated";

function isContribution(v: unknown): v is Contribution {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { from?: unknown }).from === "string" &&
    typeof (v as { point?: unknown }).point === "string" &&
    "payload" in v
  );
}

interface DeclShape {
  readonly id: string;
  readonly menus?: ModuleMenusDecl;
  readonly settings?: ModuleSettingsDecl;
}

function isDecl(v: unknown): v is DeclShape {
  if (typeof v !== "object" || v === null) return false;
  const o = v as { id?: unknown; menus?: unknown; settings?: unknown };
  return typeof o.id === "string" && (o.menus !== undefined || o.settings !== undefined);
}

export interface InstallReport {
  readonly id: string;
  readonly commands: number;
  readonly contributions: number;
  readonly decls: number;
  readonly problems: readonly string[];
}

/**
 * `into` defaults to the process-wide registry every host boot uses; the
 * two-host gate passes a fresh `Registry` per host instead, which is what
 * lets ONE test process prove "identical registration" without two boots
 * fighting over one singleton.
 */
export function installPluginModules(
  plugins: readonly InstalledPluginModule[],
  into: Registry = globalRegistry
): InstallReport[] {
  const reports: InstallReport[] = [];
  for (const { id, mod } of plugins) {
    const problems: string[] = [];
    let commandCount = 0;
    let contributionCount = 0;
    let declCount = 0;

    const entries = Object.entries(mod);

    // Commands first — see the ordering rule in the header.
    for (const [name, value] of entries) {
      if (typeof value === "function" && /^register.*Commands$/.test(name)) {
        try {
          (value as () => void)();
          commandCount++;
        } catch (e) {
          problems.push(`${name} threw: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    for (const [name, value] of entries) {
      if (isContribution(value)) {
        try {
          into.contribute(value);
          contributionCount++;
          if (value.from !== id) {
            // The identity seam the closure report names: the resolver keys on
            // the directory, the registry on `from`, and nothing else ties
            // them. Said here, once, where the drift enters.
            problems.push(`${name} says from="${value.from}" but installed as "${id}"`);
          }
        } catch (e) {
          problems.push(`${name} refused: ${e instanceof Error ? e.message : String(e)}`);
        }
      } else if (isDecl(value)) {
        try {
          if (value.menus) registerModuleMenus({ id: value.id, menus: value.menus });
          // Settings register on the CLIENT only: `registerModuleSettings`
          // lives in a "use client" module, so under a server boot (a peeled
          // app's health route) the import is a client-reference proxy and
          // calling it throws. The server registry never reads settings; the
          // browser's own boot pass registers them for the dialog.
          if (value.settings && typeof window !== "undefined") {
            registerModuleSettings({ id: value.id, settings: value.settings });
          }
          declCount++;
        } catch (e) {
          problems.push(`${name} refused: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    if (problems.length && typeof console !== "undefined") {
      console.warn(`[axs] imported plugin "${id}" installed with problems:`, problems);
    }
    reports.push({ id, commands: commandCount, contributions: contributionCount, decls: declCount, problems });
  }
  return reports;
}
