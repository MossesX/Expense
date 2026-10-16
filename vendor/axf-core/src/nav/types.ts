/**
 * @file The `nav-menu` asset kind — an app's navigation, declared as data.
 *
 * Same reasoning as the toolbar kind, applied to the other piece of chrome
 * every app hand-rolls: the asset owns WHAT is navigable (items, wiring,
 * icons); the rolled LAYOUT THEME owns how and where it presents — edge,
 * style, indicator, icon size, motion are all layout dials
 * (`navPlacement`, `navStyle`, `navSize`, `navGlyph`, `navIndicator`,
 * `navMotion` in the theme spec). A roll can move the whole menu to another
 * edge and redesign it, hot, without the asset — or any screen — changing.
 *
 * That split is the load-bearing decision. Put placement ON the asset and a
 * layout roll cannot move the menu without rewriting a registered asset; put
 * the items in the theme and a theme roll changes what the app can DO, which
 * a theme must never be able to.
 *
 * Icons are pack glyph ids, never inline drawings — so the menu recolours and
 * re-draws with the active brand pack like every other surface.
 */

/** Where a nav menu is mounted. One surface, one active menu, many candidates. */
export type NavSurface = "app.nav" | (string & {});

export type NavItem =
  /** A destination. `glyph` is a pack entry id; `route` is app-absolute. */
  | { kind: "link"; id: string; label: string; glyph: string; route: string }
  /** A section heading between groups of links. Hidden in rail style. */
  | { kind: "section"; id: string; label: string }
  /** A horizontal rule. */
  | { kind: "divider"; id: string };

export interface NavMenuAsset {
  readonly id: string;
  readonly title: string;
  /** Which surface this menu is a candidate for. */
  readonly surface: NavSurface;
  /** One line for a picker. */
  readonly description: string;
  readonly items: readonly NavItem[];
}

declare const NAV_BRAND: unique symbol;
export type NavMenu = NavMenuAsset & { readonly [NAV_BRAND]: true };

export class NavDefinitionError extends Error {}

/** The chokepoint. Every nav menu passes through here — a hand-written object
 *  literal does not typecheck where a `NavMenu` is wanted, and the registrar
 *  re-validates because a brand is erased at runtime. */
export function defineNavMenu(spec: NavMenuAsset): NavMenu {
  if (!/^[a-z][a-z0-9-]*$/.test(spec.id)) {
    throw new NavDefinitionError(`nav menu id "${spec.id}" must be lower-kebab`);
  }
  const seen = new Set<string>();
  let links = 0;
  for (const item of spec.items) {
    if (seen.has(item.id)) {
      throw new NavDefinitionError(`nav menu "${spec.id}" repeats item id "${item.id}"`);
    }
    seen.add(item.id);
    if (item.kind === "link") {
      links++;
      if (!item.route.startsWith("/")) {
        throw new NavDefinitionError(
          `nav menu "${spec.id}" link "${item.id}" route "${item.route}" must start with "/"`
        );
      }
      if (!item.glyph) {
        throw new NavDefinitionError(
          `nav menu "${spec.id}" link "${item.id}" names no glyph — nav icons come from the ` +
            `pack, and a link without one renders a placeholder in every style`
        );
      }
      if (!item.label) {
        throw new NavDefinitionError(
          `nav menu "${spec.id}" link "${item.id}" has no label — rail style hides labels, ` +
            `but the tooltip and the labeled styles still need one`
        );
      }
    }
  }
  if (links === 0) {
    throw new NavDefinitionError(
      `nav menu "${spec.id}" has no links — a menu that navigates nowhere is not a menu`
    );
  }
  return spec as NavMenu;
}
