"use client";

/**
 * @file Capture and apply appearance-state snapshots — the CLIENT half of the
 * `default-state` engine (P3), feeding `/api/accounts/states`.
 *
 * **APPEARANCE ONLY — that is an invariant, not a habit.** This module reads
 * and writes the appearance stores exclusively: the theme store (seed, roll
 * options, dial edits, the three chrome dials), the pack registry's slot
 * selection, the chrome-assets kv document, and the dashboard's card
 * arrangement. It imports NO module data store — not expenses, not taskman,
 * not the Claude workspace, not the messenger — and it never will: a snapshot
 * that carried module data would turn "apply that look" into "roll my work
 * back", and the server's `parseSnapshot` (accounts/lib/states.ts) rebuilds
 * the snapshot key-by-key to refuse exactly that ride-along.
 *
 * Both halves speak P0's `AppearanceStateSnapshot`
 * (src/defaults/default-state.ts), which is what lets the factory-reset
 * default and every user-named save travel the SAME apply path.
 *
 * ## Where each field comes from / goes to
 *
 * | field       | capture reads                       | apply writes                     |
 * |-------------|-------------------------------------|----------------------------------|
 * | theme       | `theme.state()` seed/options/edits  | `theme.apply()` / `reset()` + `setValue()` |
 * | packs       | `packs.resolved()` slot ids         | `packs.activate()` per slot      |
 * | chrome      | the `bannerBar`/`navMenu`/`dashboard` dials, floored to `DEFAULT_CHROME` | the same dials (skipped at the shipped default — the dial's `""` already means "the app's default") |
 * | settings    | nothing today (see below)           | one kv PUT per namespace         |
 * | data        | chrome-assets doc + dashboard card layout | kv PUT / `localStorage`    |
 *
 * The settings baseline is captured EMPTY on purpose: P0 records that no
 * module today ships a per-user settings default that disagrees with its decl,
 * and the wrapper/look binding rides the `dashboard` chrome dial. The seam is
 * kept live on the apply side so a snapshot that DOES carry a baseline (the
 * default state, a future capture) lands correctly.
 */

import { packs, theme } from "@axf/core";
import type { RollOptions } from "@axf/core";
import {
  DEFAULT_CHROME,
  type AppearanceStateSnapshot,
  type ChromeState,
} from "@axs/defaults/default-state";
import {
  loadChromeAssets,
  parseChromeAssetsDoc,
  saveChromeAssets,
} from "@axs/chrome/assets";
import { DASHBOARD_KEY } from "@axs/appearance-reset";

/** `data` keys this module owns. Anything else in a snapshot's data record is
 *  preserved by the server but ignored by this client. */
const DATA_CHROME_ASSETS = "chrome-assets";
const DATA_DASHBOARD_LAYOUT = "dashboard-layout";

export interface ApplyReport {
  /** True when at least one applied surface only re-reads its store at boot. */
  readonly reloadRequired: boolean;
  /** WHY a reload is required — one line per kv/boot-backed surface, so the
   *  caller reloads knowingly instead of this module doing it silently. */
  readonly reasons: readonly string[];
  /** Writes that failed — surfaced, never swallowed. */
  readonly problems: readonly string[];
}

const CHROME_DIALS = ["bannerBar", "navMenu", "dashboard"] as const;

/** The dial's current id, or the recorded concrete default when the dial holds
 *  `""` ("whatever the registry has active") — a snapshot stores what the
 *  chrome RESOLVES to, so applying it later asserts a real asset id. */
function chromeFromDials(values: Readonly<Record<string, string | number>>): ChromeState {
  const dial = (id: (typeof CHROME_DIALS)[number]): string => {
    const v = values[id];
    return typeof v === "string" && v !== "" ? v : DEFAULT_CHROME[id];
  };
  return { bannerBar: dial("bannerBar"), navMenu: dial("navMenu"), dashboard: dial("dashboard") };
}

/**
 * Capture the live appearance, client-side, in P0's snapshot shape.
 *
 * Captures what is ON SCREEN: if the theme designer holds a preview, the
 * preview is what gets saved — a look being judged is exactly the look someone
 * reaches for "Save current state…" to keep.
 */
export async function captureStateSnapshot(): Promise<AppearanceStateSnapshot> {
  const t = theme.state();
  const style = packs.resolved();

  const data: Record<string, unknown> = {};

  // The chrome-assets kv doc rides along so a snapshot whose dials name a
  // CUSTOM bar/nav/wrapper stays self-contained — applying it re-seeds the
  // assets the dials point at. An empty library is omitted, not stored.
  const chromeDoc = await loadChromeAssets();
  if (chromeDoc.toolbars.length || chromeDoc.navs.length || chromeDoc.dashboards.length) {
    data[DATA_CHROME_ASSETS] = chromeDoc;
  }

  // The dashboard's card arrangement — appearance state the dashboard module
  // keeps in localStorage (see appearance-reset.ts's inventory). Absent key =
  // the default arrangement, and the snapshot records that by omission.
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(DASHBOARD_KEY);
      if (raw) data[DATA_DASHBOARD_LAYOUT] = JSON.parse(raw) as unknown;
    } catch {
      /* unreadable/corrupt layout — captured as "default arrangement" */
    }
  }

  return {
    version: 1,
    theme: { seed: t.seed, options: t.options, overrides: t.overrides },
    packs: {
      "branding-package": style.brandingId,
      "logo-package": style.logoId,
    },
    chrome: chromeFromDials(t.values as Record<string, string | number>),
    // Empty today — no module ships a per-user settings default that disagrees
    // with its decl (P0's DEFAULT_SETTINGS_BASELINE note). The apply side
    // still honours a non-empty baseline.
    settings: {},
    data,
  };
}

/**
 * Apply a snapshot — the ONE apply path, shared by "Apply" on a saved state
 * and by the factory reset's default snapshot.
 *
 * Theme and packs are hot: their stores repaint and persist immediately. The
 * kv-backed and boot-read surfaces are not, and this function does NOT reload
 * on their behalf — it reports `reloadRequired` with the reason per surface,
 * and the CALLER reloads, visibly.
 */
export async function applyStateSnapshot(
  snapshot: AppearanceStateSnapshot,
): Promise<ApplyReport> {
  const reasons: string[] = [];
  const problems: string[] = [];

  /* ── theme — through the store, so localStorage + the cookie mirror agree ── */

  // A designer preview refuses persistence (`#persist()` early-returns), so an
  // apply issued mid-preview would repaint and then vanish on the next reload.
  // End it first; the snapshot then applies over the restored applied theme.
  if (theme.previewing()) theme.endPreview();

  if (snapshot.theme.seed) {
    // `apply()` clears hand edits by design — overrides land AFTER it.
    theme.apply(snapshot.theme.seed, snapshot.theme.options as RollOptions);
  } else {
    theme.reset();
    if (Object.keys(snapshot.theme.options).length) {
      theme.setOptions(snapshot.theme.options as RollOptions);
    }
  }
  for (const [dialId, value] of Object.entries(snapshot.theme.overrides)) {
    if (typeof value === "string" || typeof value === "number") theme.setValue(dialId, value);
  }

  // Chrome dials. `apply()`/`reset()` above just cleared every override, and a
  // chrome dial's shipped value is `""` = "the app's default" — so a snapshot
  // id that IS the recorded default needs no write (the dial already resolves
  // to it), and writing it would pin "follow the default" to one concrete id.
  for (const id of CHROME_DIALS) {
    if (snapshot.chrome[id] !== DEFAULT_CHROME[id]) theme.setValue(id, snapshot.chrome[id]);
  }

  /* ── packs — activate() persists the selection (localStorage + cookie) ──── */

  for (const slot of ["branding-package", "logo-package"] as const) {
    const id = snapshot.packs[slot];
    // An id nothing registered is recorded by the registry as a problem and
    // the slot falls back — degrade, never crash, and never silently drop.
    if (id) packs.activate(id, slot);
    else packs.activate(null, slot);
  }

  /* ── settings baseline — per-ns kv docs, read by stores at boot ─────────── */

  for (const [ns, doc] of Object.entries(snapshot.settings)) {
    try {
      const r = await fetch(`/api/axf/kv/${encodeURIComponent(ns)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ doc }),
      });
      if (!r.ok) problems.push(`settings baseline "${ns}" refused (HTTP ${r.status})`);
      else {
        reasons.push(
          `settings baseline "${ns}" written — module settings stores read their kv doc at boot`,
        );
      }
    } catch (err) {
      problems.push(`settings baseline "${ns}" failed: ${String(err)}`);
    }
  }

  /* ── data baseline — the two appearance documents this module owns ──────── */

  const chromeRaw = snapshot.data[DATA_CHROME_ASSETS];
  if (chromeRaw !== undefined) {
    // Re-parsed through the same gate the editors use — a stored document is
    // not a licence to register an invalid asset.
    const ok = await saveChromeAssets(parseChromeAssetsDoc(chromeRaw));
    if (!ok) problems.push("chrome-assets document write failed");
    else {
      reasons.push(
        "chrome-assets document written — PacksSeed registers custom chrome at boot, " +
          "a kv write does not re-register it live",
      );
    }
  }
  // NOTE the asymmetry with the dashboard layout below: a snapshot WITHOUT a
  // chrome doc leaves the library alone. Custom chrome assets are authored
  // work (appearance-reset.ts makes the same call) — the dials above already
  // stopped selecting them, which is all "this look doesn't use them" means.

  if (typeof window !== "undefined") {
    try {
      const layout = snapshot.data[DATA_DASHBOARD_LAYOUT];
      const had = window.localStorage.getItem(DASHBOARD_KEY) !== null;
      if (layout !== undefined) {
        window.localStorage.setItem(DASHBOARD_KEY, JSON.stringify(layout));
        reasons.push("dashboard card layout written — the dashboard reads it at mount");
      } else if (had) {
        // Absence in the snapshot MEANS the default arrangement — the layout
        // is appearance in force, not a library, so it is put back.
        window.localStorage.removeItem(DASHBOARD_KEY);
        reasons.push("dashboard card layout cleared to default — the dashboard reads it at mount");
      }
    } catch {
      problems.push("dashboard layout storage write failed");
    }
  }

  return { reloadRequired: reasons.length > 0, reasons, problems };
}
