"use client";

/**
 * @file What the tab group shows when it holds nothing — the owner's
 * *"if last tab is removed, floated, or closed display animated amberx logo in
 * empty tab"*.
 *
 * ## The logo is the PACK's, not a drawing made here
 *
 * The mark and wordmark come from the active branding pack through `Glyph`, so
 * this state restyles with the identity like every other surface. Nothing is
 * hand-drawn — `.claude/rules/no-hand-rolled-ui.md` §1 exists because three
 * screens each hand-rolled a banner and the lockup ended up at three different
 * sizes. The *motion* is authored here (CSS keyframes over the pack's SVG),
 * which is the one part a pack cannot supply.
 *
 * The glyph id is resolved through a fallback chain rather than hardcoded:
 * a pack that has no `mark` still has a `lockup` or a `wordmark`, and this
 * screen must never be the dashed missing-glyph box — it is the empty state, so
 * looking broken here reads as the whole module being broken.
 *
 * ## Empty is not an error
 *
 * The three base views are one click away, and the two report actions are the
 * same commands the header runs. An empty state that only apologises leaves
 * the user to work out how to get back; this one carries the way back.
 *
 * `prefers-reduced-motion` stops every animation dead — the studio respects it
 * everywhere else and a full-surface animation is the last place to skip it.
 */

import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { Glyph, token, useResolvedStyle } from "@axf/core";

/** Preference order for the mark. First one the pack actually has wins. */
const MARK_CANDIDATES = ["mark", "mark-amberx", "watermark", "lockup"] as const;
const WORDMARK_CANDIDATES = ["wordmark", "lockup"] as const;

function usePackGlyph(candidates: readonly string[]): string | null {
  const identity = useResolvedStyle();
  return React.useMemo(
    () => candidates.find((id) => identity.glyphs.has(id)) ?? null,
    [identity.glyphs, candidates]
  );
}

export default function EmptyTabState({
  onRestoreViews,
  onNewReport,
  onOpenReport
}: {
  onRestoreViews: () => void;
  onNewReport: () => void;
  onOpenReport: () => void;
}) {
  const mark = usePackGlyph(MARK_CANDIDATES);
  const wordmark = usePackGlyph(WORDMARK_CANDIDATES);

  return (
    <Box
      // Still an expenses surface: a right-click on the empty state carries the
      // module's own rows rather than falling through to the shell's.
      data-axf-area="expenses.tabstrip"
      sx={{
        flex: 1,
        minHeight: 320,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        py: 6,
        userSelect: "none",
        "@keyframes axfEmptyBreathe": {
          "0%, 100%": { transform: "scale(1) translateY(0)" },
          "50%": { transform: "scale(1.05) translateY(-4px)" }
        },
        "@keyframes axfEmptyOrbit": {
          from: { transform: "rotate(0deg)" },
          to: { transform: "rotate(360deg)" }
        },
        "@keyframes axfEmptyHalo": {
          "0%, 100%": { opacity: 0.25, transform: "scale(0.94)" },
          "50%": { opacity: 0.6, transform: "scale(1.06)" }
        },
        "@keyframes axfEmptyRise": {
          from: { opacity: 0, transform: "translateY(8px)" },
          to: { opacity: 1, transform: "translateY(0)" }
        },
        "@media (prefers-reduced-motion: reduce)": {
          "& *": { animation: "none !important" }
        }
      }}
    >
      {/* ---------------------------------------------------- the animation */}
      <Box sx={{ position: "relative", width: 150, height: 150, display: "grid", placeItems: "center" }}>
        {/* Halo — a soft accent bloom breathing behind the mark. */}
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            inset: 18,
            borderRadius: "50%",
            background: `radial-gradient(circle, color-mix(in srgb, ${token("accent")} 38%, transparent) 0%, transparent 68%)`,
            animation: "axfEmptyHalo 3.6s ease-in-out infinite"
          }}
        />
        {/* Two counter-rotating dashed rings. Different periods and dash
            patterns on purpose: matched rings phase-lock and read as one
            stationary ring with a texture. */}
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            border: `1px dashed color-mix(in srgb, ${token("accent")} 55%, transparent)`,
            animation: "axfEmptyOrbit 14s linear infinite"
          }}
        />
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            inset: 22,
            borderRadius: "50%",
            borderTop: `2px solid ${token("accent")}`,
            borderRight: "2px solid transparent",
            borderBottom: `1px solid color-mix(in srgb, ${token("edge")} 90%, transparent)`,
            borderLeft: "2px solid transparent",
            animation: "axfEmptyOrbit 5.5s linear infinite reverse"
          }}
        />
        {mark ? (
          <Box
            sx={{
              position: "relative",
              display: "grid",
              placeItems: "center",
              animation: "axfEmptyBreathe 3.6s ease-in-out infinite"
            }}
          >
            <Glyph id={mark} size={62} title="AmberX" />
          </Box>
        ) : null}
      </Box>

      {wordmark ? (
        <Box sx={{ animation: "axfEmptyRise 700ms ease-out both", animationDelay: "120ms" }}>
          <Glyph id={wordmark} size={168} />
        </Box>
      ) : null}

      <Stack
        spacing={0.6}
        sx={{ alignItems: "center", animation: "axfEmptyRise 700ms ease-out both", animationDelay: "260ms" }}
      >
        <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>No open tabs</Typography>
        <Typography sx={{ fontSize: 12, color: token("dim"), textAlign: "center", maxWidth: 460 }}>
          Every view was closed or floated out. The ledger is untouched — reopen a view, generate a
          report, or open one you saved earlier.
        </Typography>
      </Stack>

      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{ flexWrap: "wrap", justifyContent: "center", animation: "axfEmptyRise 700ms ease-out both", animationDelay: "380ms" }}
      >
        <Button size="small" variant="contained" onClick={onRestoreViews}>
          Reopen views
        </Button>
        <Button size="small" variant="outlined" onClick={onNewReport}>
          New report
        </Button>
        <Button size="small" variant="outlined" onClick={onOpenReport}>
          Open report
        </Button>
      </Stack>
    </Box>
  );
}
