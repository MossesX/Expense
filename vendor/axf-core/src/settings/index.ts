/**
 * @file Module settings — the barrel. `decl.ts` is the Node leaf (types +
 * pure validation), `store.ts` the runtime (one generic store, the registry,
 * the dialog's UI store), `SettingsDialog.tsx` the one shell-owned surface.
 */
export { validateSettingsDecl, settingsDefaults } from "./decl";
export type {
  ModuleSettingsDecl,
  SettingKind,
  SettingOption,
  SettingRow,
  SettingValue
} from "./decl";

export {
  ModuleSettingsStore,
  SettingsRegistry,
  SettingsRegistryError,
  settings,
  registerModuleSettings,
  getModuleSettings,
  useModuleSettings,
  settingsUi,
  setHostedModule,
  hostedModule
} from "./store";
export type { SettingsValues } from "./store";

export {
  SettingsGateRegistry,
  settingsGates,
  registerSettingsGate,
  useSettingsGates
} from "./gates";
export type { SettingsGate } from "./gates";

export { SettingsDialog } from "./SettingsDialog";
