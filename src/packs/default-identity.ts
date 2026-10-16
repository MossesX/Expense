/**
 * @file The app's default identity, stated SYNCHRONOUSLY, for both module graphs.
 *
 * ## The bug this exists for
 *
 * MUI resolves its palette in JS and emotion serialises it into the SSR'd CSS as
 * literal hex, and a `<Glyph>` writes its pack's SVG markup straight into the
 * document — so whatever identity is in force during the server render is baked
 * into the document and painted before React exists. The cause of the original
 * failure was timing, not wiring: registration used to live only in
 * `studio.subsystem.ts`, whose `start()` runs through the ASYNC `boot()`, while
 * a server render is synchronous — it finished against an empty registry and
 * fell back to core's built-in pack.
 *
 * ## Why this is a module of its own
 *
 * It has to be called from two places that cannot share a singleton:
 *
 * - `PacksSeed` (client graph) — covers the SSR render of client components and
 *   the hydrating render, which is what the glyph markup is built from;
 * - `app/layout.tsx` (server graph) — covers the `<head>` variable block, which
 *   is a string this file's graph builds.
 *
 * `PacksSeed`'s docblock is the authority on why that is two calls and not one:
 * Next compiles server and client components into separate module graphs, so
 * there are two `packs` singletons and **a module singleton is not a channel
 * between them**. This file is deliberately plain (no `"use client"`) so both
 * graphs may import it.
 *
 * ## The posture, since 2026-08-12
 *
 * The branding pack is a FIXED APP SETTING (owner: *"branding is just that,
 * its not negotiable, its global"*). It is selected on the `/settings` page,
 * persisted by `PackRegistry.activate()` (localStorage + the cookie mirror),
 * and is NEVER part of a theme — the theme's `brandingPack`/`logoPack` dials
 * are gone. What this file states is the FLOOR under that setting:
 *
 * - `register()` is guarded on `packs.pack(id)` — a second call files a
 *   `problem`, and /brand's coverage card reads that list.
 * - `activateDefault()` is the app STATING its default, which a stored
 *   selection outranks. There is exactly ONE default statement in the studio
 *   and it is here — a second caller means the boot order silently decides.
 */
import { packs } from "@axf/core";

import { AXS_STUDIO_BRAND, AXS_STUDIO_LOGOS } from "./axs-studio";

/** Register the house packs and state the app default. Safe to call repeatedly. */
export function seedDefaultIdentity(): void {
  for (const pack of [AXS_STUDIO_BRAND, AXS_STUDIO_LOGOS]) {
    if (!packs.pack(pack.id)) packs.register(pack);
  }
  packs.activateDefault(AXS_STUDIO_BRAND.id);
  packs.activateDefault(AXS_STUDIO_LOGOS.id);
}
