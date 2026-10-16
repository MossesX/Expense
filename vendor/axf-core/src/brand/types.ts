/**
 * @file The two pack manifests, shaped to stay loadable alongside GizmoX's.
 *
 * GizmoX has both of these kinds already and they are the template:
 *
 *   - `branding-package` — the full visual vocabulary. Its manifest is
 *     `{ id, name, version, type, description, author, tags, payload }` and its
 *     payload carries `{ schemaVersion, catalog, generator, seed, palette,
 *     placements, entries[] }`. Entries are
 *     `{ id, label, category, size, shape, style, animated, motion, tags }`.
 *   - `logo-package` — an exported logo set: `payload.{source, document,
 *     variants[], files[]}`.
 *
 * Both shapes are preserved field-for-field so a GizmoX pack loads here
 * unmodified. AmberX adds exactly one thing, and it is additive: an entry may
 * carry an inline `svg` string instead of pointing at a `file`. A pack then
 * needs no filesystem, which is what lets one ship compiled into a peeled app.
 *
 * **There is no `style-package` kind any more (removed 2026-08-12, owner:
 * "get rid of style packs entirely and just use branding packs").** A pack
 * supplies DRAWINGS — logos, icons, marks — and nothing else. Colours,
 * typography and shape belong to the THEME's dials, always: a pack that could
 * outrank the dials is exactly what made a rolled theme "change nothing", and
 * the kind is deleted rather than deprecated so it cannot grow back.
 */
import type { BrandPalette } from "./roles";

/** Categories GizmoX's generator emits. Open-ended by design — a pack may add
 *  its own, and the renderer treats an unknown category as "just a drawing". */
export type GlyphCategory =
  | "icon"
  | "logo"
  | "mark"
  | "wordmark"
  | "lockup"
  | "watermark"
  | "badge"
  | "pattern"
  | "spinner"
  | (string & {});

export interface GlyphEntry {
  readonly id: string;
  readonly label: string;
  readonly category: GlyphCategory;
  /** Nominal square size in px. The drawing itself is viewBox-scaled. */
  readonly size?: number;
  readonly shape?: "square" | "wide" | "tall";
  readonly style?: "line" | "solid" | "duotone" | (string & {});
  readonly animated?: boolean;
  readonly motion?: "none" | "spin" | "pulse" | "draw" | "float" | (string & {});
  readonly tags?: readonly string[];
  /** Path relative to the pack directory — GizmoX's shape. */
  readonly file?: string;
  /** Inline SVG markup — AmberX's addition, so a pack needs no filesystem. */
  readonly svg?: string;
}

interface PackBase {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author: string;
  readonly tags?: readonly string[];
}

export interface BrandingPackage extends PackBase {
  readonly type: "branding-package";
  readonly payload: {
    readonly schemaVersion: 1;
    readonly generator?: string;
    readonly seed?: string;
    readonly palette: BrandPalette;
    readonly placements?: readonly string[];
    readonly entries: readonly GlyphEntry[];
  };
}

export interface LogoPackage extends PackBase {
  readonly type: "logo-package";
  readonly payload: {
    readonly source: string;
    readonly document: string;
    readonly variants: readonly string[];
    /** GizmoX's file list — kept for compatibility with exported packs. */
    readonly files?: readonly string[];
    /** Inline drawings, so a logo pack can ship without a filesystem. */
    readonly entries?: readonly GlyphEntry[];
  };
}

export type AnyPackage = BrandingPackage | LogoPackage;
export type PackageKind = AnyPackage["type"];
