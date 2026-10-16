/**
 * @file User-authored CHROME ASSETS — toolbars and nav menus built in the
 * theme designer, as one persisted document.
 *
 * The shapes are core's own (`ToolbarAsset` / `NavMenuAsset`) and every entry
 * is revalidated through core's `defineToolbar` / `defineNavMenu` chokepoints
 * at parse time — an editor is not a licence to store an invalid asset, and a
 * document written by hand gets the same gate.
 *
 * Persistence is the studio's existing kv primitive (`/api/axf/kv/<ns>`,
 * `data/axf/kv/local/chrome-assets.json`) — the same channel the saved-theme
 * shelf mirrors through, chosen for the same reason: one store, one transport,
 * nothing new to operate.
 *
 * This module is deliberately plain (no `"use client"`, no node imports) so
 * BOTH module graphs can parse the document — the server layout reads it from
 * disk and hands it to `<PacksSeed>`, which registers the assets inside the
 * client graph before anything renders a bar. A custom banner therefore SSRs
 * exactly like a built-in one, which is what keeps the first paint honest.
 */
import { defineDashboardSpec, defineNavMenu, defineToolbar } from "@axf/core";
import type { DashboardSpec, NavMenuAsset, ToolbarAsset } from "@axf/core";

/** Namespace under `data/axf/kv/<user>/` — a real file on the server. */
export const CHROME_NS = "chrome-assets";

const ENDPOINT = `/api/axf/kv/${CHROME_NS}`;

export interface ChromeAssetsDoc {
  readonly toolbars: readonly ToolbarAsset[];
  readonly navs: readonly NavMenuAsset[];
  /**
   * Authored dashboard WRAPPERS (2026-08-12).
   *
   * They belong in this document rather than in one of their own for the
   * reason the file docblock gives for the other two: the server layout reads
   * ONE document from disk and hands it to `<PacksSeed>`, so a custom wrapper
   * registers inside the client graph before anything resolves one and the
   * chrome SSRs correctly. A second document would be a second read, a second
   * prop and a second chance to forget one of them.
   */
  readonly dashboards: readonly DashboardSpec[];
}

export const EMPTY_CHROME: ChromeAssetsDoc = { toolbars: [], navs: [], dashboards: [] };

/** Ids user-authored assets are minted under, so a custom asset can never
 *  collide with (or impersonate) a built-in registered by boot code. */
export const CUSTOM_PREFIX = "custom-";

export function chromeSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return CUSTOM_PREFIX + (slug || "asset");
}

/**
 * A document out of anything — the kv body, a hand-edited file, an older
 * shape. Entries that fail core's own validation are DROPPED and reported to
 * the console rather than crashing the shell: a broken saved bar must degrade
 * to "that bar is gone", never to "the app will not boot".
 */
export function parseChromeAssetsDoc(doc: unknown): ChromeAssetsDoc {
  if (!doc || typeof doc !== "object") return EMPTY_CHROME;
  const rawToolbars = (doc as { toolbars?: unknown }).toolbars;
  const rawNavs = (doc as { navs?: unknown }).navs;
  const rawDashboards = (doc as { dashboards?: unknown }).dashboards;

  const toolbars: ToolbarAsset[] = [];
  if (Array.isArray(rawToolbars)) {
    for (const entry of rawToolbars) {
      try {
        toolbars.push(defineToolbar(entry as ToolbarAsset));
      } catch (error) {
        if (typeof console !== "undefined") {
          console.error(`[axs] chrome-assets: dropped invalid toolbar —`, error);
        }
      }
    }
  }

  const navs: NavMenuAsset[] = [];
  if (Array.isArray(rawNavs)) {
    for (const entry of rawNavs) {
      try {
        navs.push(defineNavMenu(entry as NavMenuAsset));
      } catch (error) {
        if (typeof console !== "undefined") {
          console.error(`[axs] chrome-assets: dropped invalid nav menu —`, error);
        }
      }
    }
  }

  const dashboards: DashboardSpec[] = [];
  if (Array.isArray(rawDashboards)) {
    for (const entry of rawDashboards) {
      try {
        dashboards.push(defineDashboardSpec(entry as DashboardSpec));
      } catch (error) {
        if (typeof console !== "undefined") {
          console.error(`[axs] chrome-assets: dropped invalid dashboard —`, error);
        }
      }
    }
  }

  return { toolbars, navs, dashboards };
}

/** GET the stored document. A 404 means "nothing authored yet", not an error. */
export async function loadChromeAssets(): Promise<ChromeAssetsDoc> {
  try {
    const r = await fetch(ENDPOINT);
    if (!r.ok) return EMPTY_CHROME;
    const body = (await r.json()) as { doc?: unknown };
    return parseChromeAssetsDoc(body.doc);
  } catch {
    return EMPTY_CHROME;
  }
}

/**
 * PUT the whole document. Whole, not a delta — it is a handful of small
 * records, and the shelf mirror already proved the shape.
 */
export async function saveChromeAssets(doc: ChromeAssetsDoc): Promise<boolean> {
  try {
    const r = await fetch(ENDPOINT, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ doc })
    });
    return r.ok;
  } catch {
    return false;
  }
}
