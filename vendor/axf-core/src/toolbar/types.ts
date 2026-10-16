/**
 * @file The `toolbar` asset kind — a surface's bar, declared as data.
 *
 * Three UIs had each hand-rolled their own banner, with the brand lockup at
 * three different sizes. That is the drift the asset model exists to prevent,
 * and the fix is not "agree on a number" — it is to make the bar a THING that
 * is registered, swapped and versioned like everything else.
 *
 * The split that makes this work:
 *
 *   - **The asset owns the ARRANGEMENT** — what appears, in what order, how
 *     big, with what separators. Pure data, serialisable, swappable at runtime.
 *   - **The host owns the CONTENT** — the project id, the live status, the
 *     record count. It supplies those by name through `slots`.
 *
 * Without that split you get one of two failures: a toolbar asset that cannot
 * show anything dynamic (so every surface bypasses it), or one that carries
 * host-specific fields (so it cannot be shared). Named slots are the seam.
 */
import type { ReactNode } from "react";

/** Where a bar is mounted. One surface, one active toolbar, many candidates. */
export type ToolbarSurface = "app.banner" | (string & {});

/**
 * What KIND of bar this is — the compatibility field.
 *
 * A toolbar asset is not universally substitutable: a bar drawn to sit at the
 * top of a full-page ui carries the brand and spans the window, and dropping it
 * into a pane header or a vertical rail is not a style choice, it is broken.
 * So the asset states what it is, the surface states what it needs, and the
 * registry refuses the mismatch instead of rendering it badly.
 *
 * - `banner` — the top bar of a **full-page ui**. Carries the brand, spans the
 *   window. Every full-page ui has exactly one. This is the common case and the
 *   reason the field exists.
 * - `pane-toolbar` — a bar inside one pane of a ui. No brand.
 * - `status-bar` — a readout strip, typically at the bottom.
 * - `rail` — a vertical strip of actions down an edge.
 */
export type ToolbarRole = "banner" | "pane-toolbar" | "status-bar" | "rail";

/**
 * What each surface requires. A surface not listed accepts any role, because
 * refusing an unknown surface would make adding one a two-file change and
 * that is how a registry ends up bypassed.
 */
export const SURFACE_ROLES: Readonly<Record<string, ToolbarRole>> = {
  "app.banner": "banner",
  "app.rail": "rail",
  "app.status": "status-bar"
};

/** Roles that must carry a brand item. */
const BRAND_REQUIRED: ReadonlySet<ToolbarRole> = new Set<ToolbarRole>(["banner"]);

export type ToolbarItem =
  /** The brand lockup. `width` is in pixels and is the whole point of the asset.
   *  With `command`, the brand is clickable and fires it (a command bar's logo
   *  goes home); without, it is the passive mark it always was. */
  | { kind: "brand"; id: string; glyph?: string; width?: number; command?: string }
  /** Static text — the surface's own name. */
  | { kind: "label"; id: string; text: string; tone?: "ink" | "dim" | "accent"; caps?: boolean }
  /** A vertical rule. */
  | { kind: "divider"; id: string }
  /** Flexible gap. Everything after the first spacer is right-aligned. */
  | { kind: "spacer"; id: string }
  /** A named region the HOST fills. Absent content renders nothing, not a hole. */
  | { kind: "slot"; id: string }
  /** A pack glyph plus tooltip, invoking a named command. With `label`, the
   *  word renders beside the glyph — a command bar's "Modules" is an action
   *  people read, not only an icon people recognise. */
  | { kind: "action"; id: string; glyph: string; title: string; command: string; label?: string }
  /**
   * A labelled button that opens a menu. The asset does NOT carry the menu's
   * contents — it fires `command` and the HOST opens the menu in response, so
   * the asset stays data and the menu stays live (a module registered tomorrow
   * appears in it with no edit to the bar).
   */
  | { kind: "menu"; id: string; glyph: string; label: string; command: string }
  /**
   * A field-SHAPED control — placeholder text, an optional hotkey hint, a
   * declared width. It renders as a **button**, never an input: a read-only
   * input with an `onFocus` handler re-opens whatever it summons forever,
   * because focus is restored to it when the dialog closes and `onFocus` fires
   * again (paid for once in GizmoX's command bar). Fires `command` on click.
   */
  | { kind: "field"; id: string; glyph: string; placeholder: string; hint?: string; width?: number; command: string }
  /** A short read-only readout the host supplies as text. */
  | { kind: "status"; id: string; tone?: "ink" | "dim" | "accent" | "ok" | "warn" | "err" };

export interface ToolbarAsset {
  readonly id: string;
  readonly title: string;
  /**
   * What kind of bar this is. Checked against the surface's requirement at
   * registration — see {@link ToolbarRole}.
   */
  readonly role: ToolbarRole;
  /** Which surface this bar is a candidate for. */
  readonly surface: ToolbarSurface;
  /** One line on the look, so a picker can describe it without rendering it. */
  readonly description: string;
  readonly items: readonly ToolbarItem[];
  /** Bar height in pixels. */
  readonly height?: number;
  /**
   * Icon size in pixels for `action` / `menu` / `field` glyphs. Defaults to 13
   * — what every bar drew at before this field existed, so nothing moved when
   * it arrived.
   *
   * It is the ASSET's, not the theme's: a tab strip drawn as big branded icons
   * and a 40px command bar are different bars, not the same bar under different
   * dials. A reader can then override it for themselves — see `prefs.ts`, which
   * treats this as the default it merges over. A `brand` item is deliberately
   * unaffected; it carries its own `width`, because a logo is not an icon.
   */
  readonly iconSize?: number;
  /**
   * Whether the bar's own WORDS render: action labels, menu labels, `label`
   * items and a field's placeholder. Defaults to true; `false` ships an
   * icon-only bar whose tooltips and aria-labels are untouched. Host content
   * (`slot`, `status`) is never suppressed by this — the asset can only speak
   * for the text it declares.
   */
  readonly labels?: boolean;
  /** Background/border roles, so a bar can be flat or raised. */
  readonly background?: "panel" | "panel2" | "page";
  readonly border?: boolean;
}

declare const TOOLBAR_BRAND: unique symbol;
export type Toolbar = ToolbarAsset & { readonly [TOOLBAR_BRAND]: true };

export class ToolbarDefinitionError extends Error {}

/** The chokepoint. Every toolbar passes through here. */
export function defineToolbar(spec: ToolbarAsset): Toolbar {
  if (!/^[a-z][a-z0-9-]*$/.test(spec.id)) {
    throw new ToolbarDefinitionError(`toolbar id "${spec.id}" must be lower-kebab`);
  }
  // A declared icon size is a NUMBER OF PIXELS, and the two ways it goes wrong
  // are both silent: `0` draws an invisible bar, and a stray `"22"` from a
  // JSON-authored asset lands in `calc()` as garbage. Refused where it is
  // written rather than discovered as an empty strip.
  if (spec.iconSize !== undefined && (!Number.isFinite(spec.iconSize) || spec.iconSize <= 0)) {
    throw new ToolbarDefinitionError(
      `toolbar "${spec.id}" declares iconSize ${JSON.stringify(spec.iconSize)} — it must be a positive number of pixels`
    );
  }
  const seen = new Set<string>();
  for (const item of spec.items) {
    if (seen.has(item.id)) {
      throw new ToolbarDefinitionError(`toolbar "${spec.id}" repeats item id "${item.id}"`);
    }
    seen.add(item.id);
    // A menu or field with no command is a dead control drawn as a live one —
    // it LOOKS like the palette/menu affordance and does nothing when clicked.
    if ((item.kind === "menu" || item.kind === "field") && !item.command.trim()) {
      throw new ToolbarDefinitionError(
        `toolbar "${spec.id}" ${item.kind} "${item.id}" requires a non-empty command`
      );
    }
    // A brand's command is optional — but supplied blank it draws a clickable
    // logo that does nothing, which is the same dead control in brand clothing.
    if (item.kind === "brand" && item.command !== undefined && !item.command.trim()) {
      throw new ToolbarDefinitionError(
        `toolbar "${spec.id}" brand "${item.id}" has an empty command — omit the field or name one`
      );
    }
  }
  // A banner with no brand is a banner that will drift back to being
  // hand-rolled, which is the failure this asset kind exists to fix. Other
  // roles are not brand-bearing and must NOT be forced to carry one.
  if (BRAND_REQUIRED.has(spec.role) && !spec.items.some((i) => i.kind === "brand")) {
    throw new ToolbarDefinitionError(
      `toolbar "${spec.id}" has role "${spec.role}", which must carry a brand item`
    );
  }
  if (!BRAND_REQUIRED.has(spec.role) && spec.items.some((i) => i.kind === "brand")) {
    throw new ToolbarDefinitionError(
      `toolbar "${spec.id}" has role "${spec.role}" and must not carry a brand item — ` +
        `the brand belongs to the banner, and repeating it inside a pane is how an app ` +
        `ends up with three logos on one screen`
    );
  }

  // Compatibility: the asset says what it is, the surface says what it needs.
  const required = SURFACE_ROLES[spec.surface];
  if (required && required !== spec.role) {
    throw new ToolbarDefinitionError(
      `toolbar "${spec.id}" has role "${spec.role}" but surface "${spec.surface}" requires ` +
        `"${required}"`
    );
  }
  return spec as Toolbar;
}

/** Content the host supplies for `slot` and `status` items, by item id. */
export type ToolbarFill = Record<string, ReactNode>;
