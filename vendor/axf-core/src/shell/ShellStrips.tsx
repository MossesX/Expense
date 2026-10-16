/**
 * @file `<ShellStrips>` — the shell's mount for everything contributed to
 * `shell.strip`.
 *
 * Mounted once by `AppShell`, as the FIRST child of the viewport column, so a
 * band renders above the banner on every route without any surface opting in —
 * the same argument the banner, the nav and `ContextMenuRoot` are mounted there
 * for: chrome each route has to remember is chrome that is missing somewhere.
 *
 * ── two gates, and they are not the same gate ─────────────────────────────────
 *
 * 1. **The registry fills during an async boot.** A host registers its
 *    subsystems and the kernel starts them; contributions land inside `start()`.
 *    A component that reads the registry once during its first render sees an
 *    empty list and, with nothing to re-render it, stays empty forever. So this
 *    subscribes — `Registry.subscribe`/`version`, added with this point for
 *    exactly this reason. `AssistantHost` solved the same problem by awaiting
 *    the host's `boot()`, which core cannot do without importing the app.
 *
 * 2. **The server has no strips and must not pretend otherwise.** The bar's
 *    content is per-user state read after mount; rendering it during SSR would
 *    either tear at hydration or force the server to guess. `mounted` keeps the
 *    server frame and the first client frame identical (both empty) and lets the
 *    band appear on the pass after — the same posture `RouteContext` and every
 *    other after-mount reader in the shell takes.
 *
 * Each strip gets its own contribution-tier `Boundary`: a plugin that throws
 * while drawing a band must not take the app's chrome with it, and its
 * neighbours must survive it too.
 */
"use client";

import * as React from "react";
import Box from "@mui/material/Box";

import { registry } from "../registry";
import { Boundary, ContributionView } from "./Boundary";
import { SHELL_STRIP_POINT } from "./strips";
import type { ShellStripPayload } from "./strips";

export function ShellStrips() {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const version = React.useSyncExternalStore(
    registry.subscribe,
    registry.version,
    // The server's registry may or may not have booted; either way this
    // component renders nothing there, so a constant is the honest snapshot.
    () => 0
  );

  // Recomputed only when the registry actually changed — `version` is the
  // dependency and is not otherwise read. `contributionsTo` allocates a fresh
  // array per call, so handing it straight to `useSyncExternalStore` would be a
  // new identity on every comparison, i.e. an infinite render loop.
  const strips = React.useMemo(
    () => registry.contributionsTo<ShellStripPayload>(SHELL_STRIP_POINT),
    [version]
  );

  if (!mounted || !strips.length) return null;

  return (
    // `flexShrink: 0` and nothing else: the strips own their height, and the
    // shell's column must not compress them when a module below asks for room.
    <Box data-axf-strips sx={{ flexShrink: 0 }}>
      {strips.map((c) => (
        <Boundary
          key={`${c.from}:${(c.payload as ShellStripPayload).id}`}
          tier="contribution"
          source={`${c.from} → ${SHELL_STRIP_POINT}`}
          compact
        >
          <React.Suspense fallback={null}>
            <ContributionView
              render={(payload: ShellStripPayload) => payload.render()}
              payload={c.payload}
              from={c.from}
              point={SHELL_STRIP_POINT}
            />
          </React.Suspense>
        </Boundary>
      ))}
    </Box>
  );
}
