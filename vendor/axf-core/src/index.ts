/**
 * @file `@axf/core` — the public barrel, and the ONLY way in.
 *
 * `package.json` exports this path and nothing else: no wildcard, no deep
 * paths. That is what keeps core's internals refactorable
 * (INITIATION-PROMPT.md §5.1 tier 1) — a consumer reaching for
 * `@axf/core/registry` does not resolve, so internals can move without
 * breaking anyone.
 */

export { defineModule, ModuleDefinitionError } from "./module";
export type { Module, ModuleDecl, ModuleSpec } from "./module";

export { defineSubsystem, SubsystemDefinitionError } from "./subsystem";
export type { Subsystem, SubsystemSpec } from "./subsystem";

export { Kernel, KernelError, kernel } from "./kernel";
export type { SubsystemState, SubsystemStatus } from "./kernel";

export { Registry, registry } from "./registry";
export type { ClosureSource, RegistryReport } from "./registry";

export { CommandRegistry, CommandDefinitionError, commands, normaliseHotkey } from "./commands";
export type { Command, CommandHandler } from "./commands";

export { SessionStore, session } from "./auth/session";
export type { SessionState } from "./auth/session";

export {
  ContextMenuRoot,
  defaultMenu,
  registerCtxCommands,
  isEditable,
  labelFor,
  readClipboard,
  resolveTarget,
  valueFor,
  activeTarget,
  setActiveTarget,
  activeContext,
  setActiveContext,
  PredicateRegistry,
  PredicateDefinitionError,
  predicates,
  MenuMap,
  MenuMapError,
  menu,
  MAX_CONTRIBUTING_AREAS,
  GROUP_DEFAULT,
  GROUP_UNIVERSAL,
  AREA_ATTR,
  resolveAreaPath,
  clearUndeclaredAreaWarnings,
  inDevelopment,
  composeArea,
  composeMenu,
  menuContextFor,
  resolveMenu,
  validateMenusDecl,
  registerModuleMenus,
  // P3 — plugin contributions through the point registry core already has, and
  // D2's universal group as a declared area rather than a hard-coded block.
  CTX_ITEM_POINT,
  clearInstalledCtxContributions,
  contributedItemId,
  ctxContributorsFor,
  ctxItem,
  ctxItems,
  declareCtxItemPoint,
  installCtxContributions,
  AREA_UNIVERSAL,
  UNIVERSAL_AREA,
  UNIVERSAL_ITEMS,
  declareUniversalArea,
  universalMenu,
  universalSuppressedBy,
  // P4 — the edits-only overlay. The map stays derived from declarations and is
  // never persisted; only what a person changed is, and a stale entry in it is
  // reported by name rather than pruned.
  CTX_OVERLAY_KEY,
  EMPTY_OVERLAY,
  ITEM_PATH_SEP,
  OVERLAY_VERSION,
  OverlayStore,
  applyAreaEdit,
  applyItemEdits,
  ctxOverlay,
  indexItemPaths,
  installCtxOverlay,
  isEmptyAreaEdit,
  isEmptyItemEdit,
  isEmptyOverlay,
  normaliseItemEdit,
  overlayDrift,
  parseOverlay,
  reportOverlayDrift
} from "./ctx";
export type {
  Area,
  AreaEdit,
  AreaElement,
  AreaHit,
  AreaPath,
  ComposeInput,
  ComposeOptions,
  CtxClipboard,
  CtxContributionProblem,
  CtxItem,
  CtxItemPayload,
  CtxRole,
  CtxTarget,
  InstallCtxOptions,
  Group,
  ItemEdit,
  ItemRole,
  ToggleMarks,
  MenuContext,
  MenuItem,
  MenuMapSnapshot,
  MenuMapViolation,
  MenuOverlay,
  ModuleMenusDecl,
  OverlayDrift,
  OverlayParseProblem,
  OverlayStorage,
  OverlayStoreOptions,
  Predicate,
  PredicateVerdict,
  ResolveAreaOptions
} from "./ctx";

/**
 * The swappable-asset primitive. Exported so the NEXT asset kind that lives on
 * a surface is a type argument rather than a fourth copy of the same ~95 lines
 * — which is what toolbars and navs each were until 2026-08-11.
 * `registries/surface.ts` records which registries deliberately do NOT use it,
 * and why (the point graph, packs, and the name→behaviour registries).
 */
export { SurfaceRegistry } from "./registries/surface";
export type { SurfaceAsset, SurfaceRegistryOptions, SurfaceSnapshot } from "./registries/surface";

export { validateContribution, orderContributions } from "./points";
export type {
  Cardinality,
  Contribution,
  ExtensionPoint,
  PointKind,
  PointViolation
} from "./points";

export {
  DIALS,
  DIALS_BY_ID,
  dialsBySubsystem,
  defaultValues,
  rollTheme,
  auditTheme,
  seedFrom,
  rng,
  // The harmony rules as DATA. `Harmony` is a type and types do not survive to
  // runtime, so a roller offering a harmony picker either reads this or keeps
  // its own copy of the four names — and a copy is what goes stale when a fifth
  // rule is added to `generate.ts`.
  HARMONIES,
  themeVariables,
  resolveVariables,
  themeStyleBlock,
  variablesStyleBlock,
  themeBootScript,
  themeSignature,
  // The cookie mirror of the applied theme — the ONE thing the server can read,
  // and therefore the only way an SSR'd MUI palette can be right before
  // hydration. `theme/boot.ts` states why the boot script cannot cover it.
  parseThemeCookie,
  themeCookieValue,
  valuesFrom,
  THEME_KEY,
  THEME_VARS_KEY,
  THEME_COOKIE,
  token,
  ThemeStore,
  theme,
  ThemeBridge,
  AxfStyleRoot,
  AxfHydrationTheme,
  useTheme,
  useHydrationValues,
  useAppliedThemeValues,
  contrast,
  clampContrast,
  hexToHsl,
  hslToHex,
  mix,
  rotate,
  shadowFor,
  // The authoring half's seams. Core owns the ENGINE and deliberately ships no
  // designer (theme/index.ts states the split), but a designer that cannot
  // reach these is a designer that reimplements them — a second publisher and a
  // second derivation, which is precisely the bug `resolve.ts` and `derived.ts`
  // exist to have ended. So the seams are exported and the SURFACE stays out:
  //   · ThemeScope — a second theme on screen without a second :root writer;
  //   · applyVariables/clearVariables/changeCount — the ONE diffing publisher,
  //     and the measurement publish.ts says is "for a designer surface, and for
  //     proving the diff works rather than assuming it";
  //   · DERIVED/derivedVariables/dependentsOf — what a dial propagates into, so
  //     a designer can show the cascade instead of hiding it.
  ThemeScope,
  applyVariables,
  clearVariables,
  changeCount,
  DERIVED,
  derivedVariables,
  dependentsOf,
  // The MUI half of the engine — one provider, one pure mapping, and the
  // record of which dials MUI has no counterpart for.
  AxfMuiRoot,
  muiThemeFrom,
  MUI_DIAL_MAP,
  MUI_UNDRIVEN,
  mappingFor,
  unmappedDials,
  unmappedSpecDials
} from "./theme";
export type {
  Dial,
  ColorDial,
  NumberDial,
  EnumDial,
  TextDial,
  DialSubsystem,
  ThemeValues,
  Harmony,
  Mode,
  RollOptions,
  RolledTheme,
  ThemeState,
  ThemeStorage,
  CachedVariables,
  ThemeRecord,
  DialMapping,
  DerivedToken,
  PublishHandle,
  StyleInput
} from "./theme";

export { KV_FORMAT, KvStore, isKvName, defaultKv, httpKv, memoryKv } from "./persist";
export type { KvDoc, KvEnvelope, KvIo, KvTransport } from "./persist";

// Module settings (0.0.20) — settings as data on the module contract, one
// generic kv-backed store, one shell-owned dialog. `decl.ts` is a Node leaf
// the closure resolver reads; registration mirrors `registerModuleMenus`.
export {
  validateSettingsDecl,
  settingsDefaults,
  ModuleSettingsStore,
  SettingsRegistry,
  SettingsRegistryError,
  settings,
  registerModuleSettings,
  getModuleSettings,
  useModuleSettings,
  settingsUi,
  setHostedModule,
  hostedModule,
  SettingsDialog,
  // Named gates (0.0.23) — "is this row this person's?", answered by a NAME the
  // host resolves. Core has no idea what an administrator is; `accounts`
  // registers the gate and core never learns what it means. Fail-open by
  // design: hiding a row is not a security boundary.
  SettingsGateRegistry,
  settingsGates,
  registerSettingsGate,
  useSettingsGates
} from "./settings";
export type {
  ModuleSettingsDecl,
  SettingKind,
  SettingOption,
  SettingRow,
  SettingValue,
  SettingsValues,
  SettingsGate
} from "./settings";

/**
 * The dock/float engine (0.0.23) — one geometry for chrome, panes and cards.
 *
 * Core owns the geometry and the interaction; WHAT is floatable, WHO may
 * rearrange it and WHERE the arrangement is kept are the caller's, which is why
 * `DockPersistence` is an argument and `dockMode` is a pair of booleans a host
 * pushes in.
 */
export {
  DOCK_DEFAULT_FLOAT_SIZE,
  DOCK_GHOST_PX,
  DOCK_MIN_FLOAT,
  DOCK_SNAP_RANGE_PX,
  DockLayoutStore,
  DockModeStore,
  DockOrientationContext,
  DockZones,
  Floatable,
  clampDockPosition,
  decide,
  dockLayouts,
  dockMode,
  dockTo,
  floatAt,
  isInFlow,
  memoryDockPersistence,
  nudged,
  orientationFor,
  parseDockState,
  resolveDockDefault,
  useDockMode,
  useDockOrientation,
  useDockState
} from "./dock";
export type {
  DockDecision,
  DockMode,
  DockModeState,
  DockOrientation,
  DockPersistence,
  DockPoint,
  DockRect,
  DockSize,
  DockSnapshot,
  DockState,
  DockZone,
  FloatableProps
} from "./dock";

export {
  DEFAULT_MIN_PANE_PX,
  PANES_FORMAT,
  PaneDefinitionError,
  PaneLayout,
  applyDrag,
  definePanes,
  minExtentAlong,
  normalFractions,
  parsePaneDoc,
  treeSignature,
  validatePaneTree
} from "./panes";
export type {
  FractionMap,
  PaneDirection,
  PaneDoc,
  PaneLayoutProps,
  PaneLeafSpec,
  PaneNodeSpec,
  PaneSplitSpec,
  PaneTree
} from "./panes";

export { ModuleHost, Slot, useHost } from "./shell/ModuleHost";
export { AppShell } from "./shell/AppShell";

// The shell's own extension point (0.0.22): a full-width band above the banner,
// on every route. Core-owned like `ctx.item` — it belongs to no module, and the
// first plugin that needed it (the tab bar) belongs to no screen either.
export { ShellStrips } from "./shell/ShellStrips";
export {
  SHELL_STRIP_POINT,
  SHELL_STRIP_POINT_DEF,
  declareShellStripPoint
} from "./shell/strips";
export type { ShellStripPayload } from "./shell/strips";

export {
  Boundary,
  ContributionView,
  CrashLog,
  crashes,
  useCrashes,
  installGlobalCrashHandlers
} from "./shell/Boundary";
export type { CrashRecord, CrashTier } from "./shell/Boundary";

export {
  defineNavMenu,
  NavDefinitionError,
  NavRegistry,
  navs,
  // The menu itself, drawable by id (0.0.25) — see `nav-menu-by-id` below.
  NavMenuSurface,
  NavShell,
  useNavMenus
} from "./nav";
export type { NavItem, NavMenu, NavMenuAsset, NavSurface, NavSnapshot } from "./nav";

export {
  defineToolbar,
  ToolbarDefinitionError,
  SURFACE_ROLES,
  ToolbarRegistry,
  toolbars,
  Toolbar,
  useToolbars,
  // Inline placement (2026-08-13): put a toolbar asset's id in the markup and
  // the renderer draws the bar there. See `toolbar/inline.tsx`.
  InlineToolbars,
  INLINE_TOOLBAR_ATTR,
  INLINE_TOOLBAR_TAG,
  findInlineToolbars,
  inlineToolbarId,
  // Per-user presentation (2026-08-13): the right-click settings dialog and the
  // preference layer behind it. See `toolbar/prefs.ts`.
  TOOLBAR_ICON_DEFAULT,
  TOOLBAR_ICON_MAX,
  TOOLBAR_ICON_MIN,
  TOOLBAR_PREFS_NS,
  TOOLBAR_THICKNESS_MAX,
  ToolbarPrefsStore,
  ToolbarSettingsDialog,
  declaredToolbarPrefs,
  resolveToolbarPrefs,
  toolbarPrefs,
  toolbarPrefsTouched,
  toolbarPrefsUi,
  useToolbarPrefs
} from "./toolbar";
export type {
  ToolbarAsset,
  ToolbarItem,
  ToolbarSurface,
  ToolbarRole,
  ToolbarFill,
  ToolbarSnapshot,
  ToolbarOrientation,
  ToolbarPrefs,
  ToolbarPrefsDoc,
  ToolbarPrefsPatch
} from "./toolbar";

export {
  defineDashboard,
  DashboardDefinitionError,
  DashboardRegistry,
  dashboards,
  DashboardChrome,
  useDashboards,
  // The authorable half — a wrapper as a record, its dial spec, its seeded
  // generator and the one interpreter that renders it.
  DASH_DIALS,
  DASH_DIALS_BY_ID,
  DashboardSpecError,
  dashDialsBySubsystem,
  dashName,
  dashboardFromSpec,
  defaultDashValues,
  defineDashboardSpec,
  emptyDashboardSpec,
  inheritedTheme,
  resolveDash,
  rollDash
} from "./dashboard";
export type {
  Dashboard,
  DashboardAsset,
  DashboardCtx,
  DashboardResolution,
  DashboardSnapshot,
  DashDial,
  DashEnumDial,
  DashNumberDial,
  DashSubsystem,
  DashValues,
  DashboardSpec
} from "./dashboard";

export {
  BRAND_ROLES,
  ALL_BRAND_VARS,
  brandVar,
  legacyBrandVar,
  brandRoleRef,
  paletteVariables,
  validatePalette,
  paletteLegibility,
  contrastRatio,
  luminance,
  PackRegistry,
  packs,
  PACKS_KEY,
  PACKS_COOKIE,
  Glyph,
  // The same drawing, rendered from an entry the caller holds rather than
  // through the identity in force — what a pack PICKER has to use, since a
  // candidate pack's drawings are by definition not in the active map.
  PackGlyph,
  StylePublisher,
  useResolvedStyle,
  assertPackSvg,
  REQUIRED_GLYPHS,
  REQUIRED_GLYPH_IDS,
  checkCoverage,
  // Live drag-and-drop editing of the chrome's drawings. The store and the drop
  // zone are core's (the renderers consult them); DERIVING a saved asset from
  // the pending edits is the studio's, because the chrome document and the
  // theme dials are.
  BRAND_DRAG_MIME,
  BrandEditStore,
  brandEdits,
  brandEditKey,
  editedGlyph,
  GlyphDropZone,
  isGlyphDrag,
  setGlyphDrag,
  useBrandEdits
} from "./brand";
export type {
  BrandRole,
  BrandPalette,
  BrandEdit,
  BrandEditKind,
  BrandEditState,
  BrandEditTarget,
  PackProblem,
  PackStorage,
  ResolvedStyle,
  AnyPackage,
  BrandingPackage,
  GlyphCategory,
  GlyphEntry,
  LogoPackage,
  PackageKind,
  // The coverage types were missing from this barrel while `checkCoverage`
  // itself was exported — which is what a function nobody had ever called
  // looks like from the outside. A consumer could invoke it and not name
  // what it returned.
  CoverageReport,
  GlyphRequirement,
  GlyphRequirementCategory
} from "./brand";

/** Bumped when core gains a capability. The demo module displays it. */
export { AXF_CORE_VERSION } from "./version";

/**
 * What core can do today, as data. The demo module renders this, so "what does
 * the core actually have" is answered by the core rather than by a document
 * that drifts. Each entry names the requirement that justified building it —
 * the "module drives the core" rule made checkable.
 */
export const AXF_CAPABILITIES: readonly { id: string; since: string; because: string }[] = [
  {
    id: "module-contract",
    since: "0.0.1",
    because: "the demo module needed to be registered and rendered by something"
  },
  {
    id: "extension-points-as-data",
    since: "0.0.1",
    because: "a peel closure cannot be computed from hand-rolled hooks"
  },
  {
    id: "registry",
    since: "0.0.1",
    because: "contributions had to be refused at the point they were made, not silently dropped"
  },
  {
    id: "theme-tokens",
    since: "0.0.1",
    because: "surfaces had to read a variable rather than a literal, or a theme swap is a rewrite"
  },
  {
    id: "subsystem-contract",
    since: "0.0.2",
    because: "Studio is infrastructure extending the core, not an app sitting on it"
  },
  {
    id: "toolbar-asset-kind",
    since: "0.0.3",
    because: "three UIs had each hand-rolled a banner with the brand lockup at three different sizes"
  },
  {
    id: "kernel-supervision",
    since: "0.0.2",
    because: "a subsystem the core does not supervise is not a subsystem"
  },
  {
    id: "render-crash-isolation",
    since: "0.0.4",
    because:
      "large modules will be built almost entirely from plugins, so a plugin must not be able to " +
      "crash its module, nor a module the app — three boundary tiers on the Slot/ModuleHost " +
      "chokepoints, plus window handlers for the async errors no boundary can catch"
  },
  {
    id: "app-shell",
    since: "0.0.6",
    because:
      "every route of the dev server is a testing surface (owner, 2026-08-08) — the banner, nav " +
      "and style root mount once at the app root instead of per module host, so plain routes " +
      "and module routes get identical chrome by construction"
  },
  {
    id: "brand-coverage-uncheckable",
    since: "0.0.7",
    because:
      "the coverage aspect test read entry.svg, so a file:-based entry was skipped in silence " +
      "and an unmeasured pack reported complete — a required id supplied without measurable SVG " +
      "is now a named fault (uncheckable), counted against complete; the template also grew to " +
      "32 required ids because surfaces reference contract ids only, and an id a surface needs " +
      "is an id the template must guarantee"
  },
  {
    id: "toolbar-command-items",
    since: "0.0.8",
    because:
      "the command bar could not be expressed as data — no labelled action, no menu affordance, " +
      "no field-shaped control — and every role rendered as one horizontal header, so a rail or " +
      "status bar was wrong the day the console needed one; the one renderer now honours " +
      "orientation per role, and menu/field require a non-empty command at the chokepoint"
  },
  {
    id: "dashboard-wrapper-kind",
    since: "0.0.9",
    because:
      "the shell chrome had to be an asset — registered, swappable, presentation only (owner: " +
      "'the dashboard is simply a wrapper ui') — with the resolver falling back to the default " +
      "AND reporting when a stored id stops resolving, because a stale preference must never " +
      "leave the app with no chrome and must never be swallowed silently either"
  },
  {
    id: "command-registry",
    since: "0.0.10",
    because:
      "the command bar, hotkeys, the palette and the context-menu project all need name → " +
      "behaviour resolution — a surface fires a NAME and stays serialisable data, handlers " +
      "register at subsystem start, and an unknown name logs and degrades instead of crashing " +
      "the chrome"
  },
  {
    id: "peel-contract",
    since: "0.0.11",
    because:
      "a module had to compile into a standalone app (INITIATION §3) — `npm run peel <id>` " +
      "vendors this whole package into the peeled app, computes the closure from declared " +
      "points + scanned plugin contributions, and records the version it vendored; the " +
      "ModuleDecl split exists so tooling reads a module's points without loading React"
  },
  {
    id: "default-context-menu",
    since: "0.0.12",
    because:
      "a right-click had to produce a menu ANYWHERE, always (owner, 2026-08-09) — so the " +
      "listener is on the document and mounted by AppShell rather than opted into per surface, " +
      "because GizmoX's failure was never bad menus but inconsistent coverage: forty modules " +
      "each hand-writing a handler made coverage a habit, and habits have holes"
  },
  {
    id: "module-declared-menus",
    since: "0.0.14",
    because:
      "context menus had to be attachable to a module the way its nav is (owner, 2026-08-09) — " +
      "`ModuleDecl.menus` carries groups + areas + items in the map's own shapes, structurally " +
      "validated at defineModule and in the closure resolver, registered through ONE seam " +
      "(`registerModuleMenus`) by Studio's subsystem and the peeled app's generated boot alike; " +
      "name existence stays with the map's registration gate, after registerCtxCommands()"
  },
  {
    id: "module-declared-nav",
    since: "0.0.13",
    because:
      "a peeled app had no channel for navigation — the closure carried modules and plugin " +
      "contributions and generated a banner, but a nav-menu asset registers on a surface, not a " +
      "point, so it stayed behind at the SDK layer; `ModuleDecl.nav` puts the menu on the data " +
      "half of the module contract, validated by defineModule, carried by the closure resolver " +
      "and registered by the peeled app's generated boot"
  },
  {
    id: "kv-persistence",
    since: "0.0.15",
    because:
      "the claude workspace's per-user state (pane latches, library preferences, drafts) needed " +
      "a server-side home — the theme store persists per browser profile and the claude " +
      "subsystem had to hand-roll a file store to get conversations through a restart, and a " +
      "third hand-rolled store was the signal to promote the semantics into ONE primitive: " +
      "per-user scoping, name guards that double as traversal fences, an atomic tmp+rename " +
      "protocol and HMR-safe write chains, all over a five-operation io driver the host injects " +
      "because node:fs must never cross the one-entry barrel"
  },
  {
    id: "pane-layout",
    since: "0.0.16",
    because:
      "the claude workspace is multi-pane and core had no split renderer — built fraction-first " +
      "because GizmoX's LayoutRenderer draws before it measures, prorating weights against a " +
      "zero extent and latching every split at its minimum (a chat pane latched at minimum is " +
      "unusable, not merely ugly); here first paint is proportional CSS with nothing latched, " +
      "pixels enter only at an interaction that measures itself, only interactions persist, and " +
      "studio's scripts/geometry-probe.mjs holds the gate rather than an eyeball"
  },
  {
    id: "mui-theme-bridge",
    since: "0.0.17",
    because:
      "everything built from here on is MUI (owner, 2026-08-09), so the MUI theme is a " +
      "framework CONTRACT rather than one app's detail — `muiThemeFrom` derives it from the " +
      "live dial values and `AxfMuiRoot` mounts the one provider inside AppShell, so no " +
      "surface opts in and none can forget; resolved colours rather than v9's cssVariables " +
      "because `var()` throws in BOTH modes (measured, not assumed) and cssVariables would " +
      "have published the same truth a second time as `--mui-*`, which is the two-writers " +
      "bug resolve.ts exists to have ended; every dial is accounted for in MUI_DIAL_MAP, " +
      "mapped or recorded as having no counterpart, because a dial silently dropped is a " +
      "dial that looks broken to whoever turns it later"
  },
  {
    id: "dashboard-authoring",
    since: "0.0.19",
    because:
      "the dashboard was the one asset kind with no designer, because a wrapper was a " +
      "`render` FUNCTION and a function cannot be saved to a document, sent across the " +
      "server/client graph boundary or rolled from a seed (owner, 2026-08-12: 'make " +
      "dashboard an asset… a dashboard designer that saves, loads, and applies " +
      "dashboards') — so a wrapper is now a serialisable `DashboardSpec` with its own " +
      "declared dial spec, its own deterministic generator and ONE interpreter, " +
      "selected by the theme's `dashboard` chrome dial beside bannerBar/navMenu; every " +
      "dial carries an ACTIVE switch (off resolves to the dial default, which is what " +
      "makes 'the default matches the theme default' true rather than aspirational) and " +
      "an INHERIT switch that decides which of a roll's theme dials the theme actually " +
      "takes — the wrapper publishes --axd-* on its own element and never --axf-* on " +
      ":root, so the one-publisher rule stands"
  },
  {
    id: "module-settings",
    since: "0.0.20",
    because:
      "four modules (taskman, expenses, claude-workspace, amberart) had each hand-rolled the " +
      "same localStorage settings store, rows array and dialog — the promotion signal " +
      "persist/kv.ts names — so settings are now DATA on the module contract " +
      "(`ModuleDecl.settings`, validated at defineModule and readable by the closure resolver), " +
      "persisted per-user through the kv transport, registered through ONE seam " +
      "(`registerModuleSettings`), and surfaced by the shell alone: the gear on ModuleHost, the " +
      "'Module settings' universal menu row, and the one SettingsDialog mounted by AppShell — " +
      "the shell-owned sui affordance TaskmanSui.tsx predicted, with the minimal-sui ceiling " +
      "standing (a row earns its place only when the surface cannot work without it)"
  },
  {
    id: "toolbar-presentation-prefs",
    since: "0.0.21",
    because:
      "three things about a bar are the READER's and not the author's — whether its words " +
      "render, how big its icons are, and which way it runs (owner, 2026-08-13: 'a settings " +
      "dialog opened by right clicking the toolbar and selecting settings… text or not, icon " +
      "size, vertical or horizontal') — and neither home on offer fitted: writing them into the " +
      "asset changes them for everybody and has to be saved as a new asset to persist at all, " +
      "while a theme dial makes them part of a LOOK that gets rolled and shared, when bannerBar " +
      "already decides the one thing a theme legitimately decides about bars (which bar). So " +
      "they are a third layer: a per-user kv document of PARTIALS keyed by asset id, merged " +
      "over what the asset declares (`iconSize`/`labels` are now asset fields, so an author " +
      "still sets the default), read once per bar in the one renderer; the dialog reaches every " +
      "asset — including ones not written yet — through the universal menu band gated on the " +
      "`data-axf-toolbar` marker every bar has always carried, rather than a `toolbar` area " +
      "each bar would have to remember to mark"
  },
  {
    id: "shell-strip-point",
    since: "0.0.22",
    because:
      "the tab bar imported from GizmoX (owner, 2026-08-13) is the first plugin that extends the " +
      "FRAMEWORK rather than a module — no route, no host screen, and it has to be on every route " +
      "including the ones no module hosts — and core's three existing homes were each wrong for " +
      "it: a module point disappears with the module, a SurfaceRegistry holds ONE active per " +
      "surface when two plugins may each want a band, and an import in AppShell would make " +
      "'disable the plugin' mean editing the shell; so `shell.strip` is a core-owned point " +
      "declared the way `ctx.item` is, and the Registry grew subscribe()/version() with it " +
      "because the registry fills during an ASYNC boot and a shell component that reads it once " +
      "renders empty forever (AssistantHost had worked around exactly that by awaiting the " +
      "HOST's boot, which core cannot import)"
  },
  {
    id: "dock-float-engine",
    since: "0.0.23",
    because:
      "three surfaces needed the same arrangement behaviour and there were already TWO bespoke " +
      "geometries in the tree (`panes/PaneLayout` and the dashboard's free-placement grid) — a " +
      "third would have made 'drag it where you want it' mean something slightly different in " +
      "every one of them; so the snap decision is ONE pure function (`decide()`) answering while " +
      "the drag is still in flight, which is what makes the horizontal/vertical FLIP a total " +
      "function of the zone rather than a second rule a component could get wrong, and the ghost " +
      "previews the flipped shape before anything is released; persistence is an ADAPTER the " +
      "caller supplies because core has no transport and must not pick a host, and the two mode " +
      "switches are booleans a host pushes in because core has no idea what an administrator is; " +
      "both default false, so `<Floatable>` renders its children and NO wrapper element until " +
      "somebody opts in — which is what makes 'off is the static app, exactly' a claim about " +
      "markup rather than about intent; and the unification it was built for is now REAL rather " +
      "than intended (0.0.24): `toolbar/Toolbar` wraps every bar and `panes/PaneLayout` wraps " +
      "every leaf, each in ONE place, so no module opts in and none can forget — a pane fills " +
      "its slot rather than sitting at intrinsic size (the `fill` prop, since a bar must keep " +
      "doing the opposite), a departed pane's slot collapses to `flex: 0 0 0%` so flex reflows " +
      "its siblings without the fraction model learning that floating exists, and both the " +
      "renderer and the host asking 'is it still here' go through the SAME `isInFlow`, because " +
      "two answers to that question is a hole in a layout nothing would report"
  },
  {
    id: "settings-row-gates",
    since: "0.0.23",
    because:
      "the admin `Edit UI` switch is the first row that is genuinely not everybody's, and core " +
      "could not express that: `SettingRow` is data on the module contract, `SettingsDialog` is " +
      "core's, and core's own session carries `signedIn` and a display name because roles " +
      "arrived later and in a MODULE — so a row names a GATE and core resolves it the way it " +
      "resolves every other behaviour that belongs to somebody else, by name through a registry; " +
      "an unregistered gate FAILS OPEN, because hiding a row is not a security boundary here any " +
      "more than a hidden nav row was, and a peel that took a module and left the module that " +
      "registers its gate must not silently lose settings"
  },
  {
    id: "nav-menu-by-id",
    since: "0.0.25",
    because:
      "every surface that wanted to SHOW a nav menu without being the shell had to redraw one — " +
      "the theme designer's Nav menu tab lists items in a form and the asset browser was about " +
      "to draw a second menu of its own, which is two more nav implementations to keep in step " +
      "with five layout dials; `Toolbar` had carried the answer since it was written (an `asset` " +
      "prop meaning 'draw that specific bar', for a picker previewing a candidate) and the menu " +
      "simply never grew the twin, so `NavMenuSurface` is exported with the same prop and the " +
      "same fallthrough — a named id that nothing registered degrades to the live menu rather " +
      "than to an empty strip; naming an id also switches the glyph DROP TARGETS off, because a " +
      "preview of a candidate is not the asset the `navMenu` dial points at and a drop would " +
      "otherwise commit a swap into something the reader is only looking at"
  },
  {
    id: "nav-menu-asset-kind",
    since: "0.0.5",
    because:
      "the nav menu had to be movable and redesignable by a rolled layout theme — so the asset " +
      "owns the items and the layout dials (navPlacement/navStyle/navIndicator/navGlyph/" +
      "navMotion) own the presentation, hot-rendered like every other dial"
  }
];
