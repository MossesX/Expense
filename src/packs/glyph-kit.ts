/**
 * @file Drawing primitives shared by every pack.
 *
 * Four identities, one geometry library. A pack supplies a **voice** — stroke
 * weight, cap, corner radius, whether shapes are drawn as line or solid, and
 * which roles carry the accent — and the same icon paths come out looking like
 * they belong to different design systems.
 *
 * This is the alternative to hand-authoring four times the same six icons, and
 * it is better than that rather than merely cheaper: an icon added here appears
 * in all four packs immediately, correctly styled, so the packs cannot drift
 * into having different coverage. What differs between packs is what SHOULD
 * differ — the marks, which are each drawn per pack, because a logo is the one
 * thing a design system must not generate from a shared template.
 *
 * Every colour is emitted as `brandRoleRef(role, fallback)`, i.e.
 * `var(--axf-brand-<role>, var(--gxb-<role>, <hex>))`. That double fallback is
 * what makes these drawings render correctly under AmberX's publisher, under
 * GizmoX's, and standalone in a file viewer with no publisher at all.
 */
import { brandRoleRef } from "@axf/core";
import type { BrandPalette, BrandRole, GlyphEntry } from "@axf/core";

export interface Voice {
  /** Stroke width at a 24-unit viewBox. */
  readonly stroke: number;
  readonly cap: "round" | "square" | "butt";
  readonly join: "round" | "miter" | "bevel";
  /** Corner radius for rectangles, in viewBox units. */
  readonly corner: number;
  /** Line art, or filled shapes. */
  readonly fill: "line" | "solid";
  /** Role carrying the primary colour, and the secondary detail. */
  readonly primary: BrandRole;
  readonly secondary: BrandRole;
}

export function ref(palette: BrandPalette, role: BrandRole): string {
  return brandRoleRef(role, palette[role]);
}

function svg(body: string, box = 24): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}" ` +
    `width="${box}" height="${box}" role="img" fill="none">${body}</svg>`
  );
}

/** Stroke attributes for the voice, as an attribute string. */
function strokeAttrs(v: Voice, colour: string): string {
  return (
    `fill="none" stroke="${colour}" stroke-width="${v.stroke}" ` +
    `stroke-linecap="${v.cap}" stroke-linejoin="${v.join}"`
  );
}

/* ------------------------------------------------------------------ icons */

/**
 * The icon set, as geometry only. Each entry receives the voice and the
 * resolved colours and returns markup — so an icon knows how to draw itself in
 * line or solid, and a pack never has to.
 */
const ICONS: Record<string, (v: Voice, a: string, b: string) => string> = {
  gear: (v, a, b) => {
    const teeth = Array.from({ length: 8 }, (_, i) => {
      const angle = (i * 360) / 8;
      return `<rect x="11" y="1.6" width="2" height="4" rx="${Math.min(1, v.corner)}" fill="${a}" transform="rotate(${angle} 12 12)"/>`;
    }).join("");
    return v.fill === "solid"
      ? `${teeth}<circle cx="12" cy="12" r="7" fill="${a}"/><circle cx="12" cy="12" r="3" fill="${b}"/>`
      : `${teeth}<circle cx="12" cy="12" r="6.5" ${strokeAttrs(v, a)}/><circle cx="12" cy="12" r="2.4" ${strokeAttrs(v, b)}/>`;
  },
  search: (v, a, b) =>
    v.fill === "solid"
      ? `<circle cx="10.5" cy="10.5" r="6.5" fill="${a}"/><circle cx="10.5" cy="10.5" r="3.4" fill="${b}"/>` +
        `<rect x="14.6" y="15.4" width="6.4" height="${v.stroke + 0.8}" rx="${v.corner}" fill="${a}" transform="rotate(45 14.6 15.4)"/>`
      : `<circle cx="10.5" cy="10.5" r="6.2" ${strokeAttrs(v, a)}/><path d="M15.2 15.2 L20.5 20.5" ${strokeAttrs(v, b)}/>`,
  book: (v, a, b) =>
    v.fill === "solid"
      ? `<rect x="3.5" y="4" width="17" height="16" rx="${v.corner}" fill="${a}"/><rect x="11.2" y="4" width="1.6" height="16" fill="${b}"/>`
      : `<path d="M4 5.5 A2 2 0 0 1 6 4 H11 V20 H6 A2 2 0 0 0 4 21.5 Z" ${strokeAttrs(v, a)}/>` +
        `<path d="M20 5.5 A2 2 0 0 0 18 4 H13 V20 H18 A2 2 0 0 1 20 21.5 Z" ${strokeAttrs(v, b)}/>`,
  play: (v, a, b) =>
    v.fill === "solid"
      ? `<circle cx="12" cy="12" r="9" fill="${a}"/><path d="M10 8.4 L16.2 12 L10 15.6 Z" fill="${b}"/>`
      : `<circle cx="12" cy="12" r="8.4" ${strokeAttrs(v, a)}/><path d="M10.2 8.6 L16 12 L10.2 15.4 Z" ${strokeAttrs(v, b)}/>`,
  layers: (v, a, b) =>
    v.fill === "solid"
      ? `<path d="M12 3 L21 8 L12 13 L3 8 Z" fill="${a}"/><path d="M3 12.5 L12 17.5 L21 12.5 L21 15 L12 20 L3 15 Z" fill="${b}"/>`
      : `<path d="M12 3.4 L20.4 8 L12 12.6 L3.6 8 Z" ${strokeAttrs(v, a)}/>` +
        `<path d="M3.6 12.4 L12 17 L20.4 12.4" ${strokeAttrs(v, b)}/>`,
  terminal: (v, a, b) =>
    v.fill === "solid"
      ? `<rect x="2.5" y="4" width="19" height="16" rx="${v.corner}" fill="${a}"/>` +
        `<path d="M6.5 9.5 L9.5 12 L6.5 14.5" stroke="${b}" stroke-width="${v.stroke}" fill="none" stroke-linecap="${v.cap}"/>` +
        `<rect x="11.8" y="14" width="6" height="${v.stroke}" rx="${v.stroke / 2}" fill="${b}"/>`
      : `<rect x="2.8" y="4.3" width="18.4" height="15.4" rx="${v.corner}" ${strokeAttrs(v, a)}/>` +
        `<path d="M6.8 9.6 L9.6 12 L6.8 14.4" ${strokeAttrs(v, b)}/>` +
        `<path d="M12.2 14.6 H17.4" ${strokeAttrs(v, b)}/>`,
  plugin: (v, a, b) =>
    v.fill === "solid"
      ? `<rect x="4" y="8" width="12" height="12" rx="${v.corner}" fill="${a}"/>` +
        `<rect x="16" y="10.5" width="4.5" height="3" rx="1.5" fill="${b}"/>` +
        `<rect x="16" y="15" width="4.5" height="3" rx="1.5" fill="${b}"/>`
      : `<rect x="4.4" y="8.4" width="11.2" height="11.2" rx="${v.corner}" ${strokeAttrs(v, a)}/>` +
        `<path d="M15.6 11.8 H20.4 M15.6 16.2 H20.4" ${strokeAttrs(v, b)}/>`,
  palette: (v, a, b) =>
    v.fill === "solid"
      ? `<path d="M12 3 A9 9 0 1 0 12 21 A2.6 2.6 0 0 0 12 15.8 A2.2 2.2 0 0 1 12 11.4 H16 A5 5 0 0 0 12 3 Z" fill="${a}"/>` +
        `<circle cx="8" cy="8.6" r="1.7" fill="${b}"/><circle cx="7" cy="13.6" r="1.7" fill="${b}"/>`
      : `<path d="M12 3.4 A8.6 8.6 0 1 0 12 20.6 A2.4 2.4 0 0 0 12 15.9 A2.2 2.2 0 0 1 12 11.5 H15.8 A4.6 4.6 0 0 0 12 3.4 Z" ${strokeAttrs(v, a)}/>` +
        `<circle cx="8" cy="8.8" r="1.3" fill="${b}"/><circle cx="7.2" cy="13.6" r="1.3" fill="${b}"/>`,

  /* ---- difference-browser actions -------------------------------------- *
   * Added for the diff browser rather than reusing gear/search/plugin for
   * everything. A reused icon is a tooltip people have to read every time;
   * these are meant to be recognised without one.                          */

  /** Panel folding to the left edge. */
  collapse: (v, a, b) =>
    v.fill === "solid"
      ? `<rect x="3" y="4" width="4" height="16" rx="${v.corner}" fill="${a}"/>` +
        `<rect x="9" y="4" width="12" height="16" rx="${v.corner}" fill="${b}" opacity="0.45"/>` +
        `<path d="M17 9 L13 12 L17 15 Z" fill="${a}"/>`
      : `<rect x="3.4" y="4.4" width="17.2" height="15.2" rx="${v.corner}" ${strokeAttrs(v, b)}/>` +
        `<path d="M8.6 4.4 V19.6" ${strokeAttrs(v, a)}/>` +
        `<path d="M16.6 9.4 L13 12 L16.6 14.6" ${strokeAttrs(v, a)}/>`,

  /** Two panels pushing apart — the inverse of collapse. */
  expand: (v, a, b) =>
    v.fill === "solid"
      ? `<rect x="3" y="4" width="7" height="16" rx="${v.corner}" fill="${b}" opacity="0.45"/>` +
        `<rect x="14" y="4" width="7" height="16" rx="${v.corner}" fill="${b}" opacity="0.45"/>` +
        `<path d="M11 9 L11 15 M13 9 L13 15" stroke="${a}" stroke-width="${v.stroke}"/>`
      : `<rect x="3.4" y="4.4" width="6.4" height="15.2" rx="${v.corner}" ${strokeAttrs(v, b)}/>` +
        `<rect x="14.2" y="4.4" width="6.4" height="15.2" rx="${v.corner}" ${strokeAttrs(v, b)}/>` +
        `<path d="M11.4 12 H12.6" ${strokeAttrs(v, a)}/>`,

  /** Funnel — reduce to what matters. */
  filter: (v, a, b) =>
    v.fill === "solid"
      ? `<path d="M3.5 4.5 H20.5 L14 12.4 V19.5 L10 17.4 V12.4 Z" fill="${a}"/>`
      : `<path d="M3.9 4.9 H20.1 L13.8 12.5 V19.1 L10.2 17.1 V12.5 Z" ${strokeAttrs(v, a)}/>` +
        `<path d="M7 8.4 H17" ${strokeAttrs(v, b)}/>`,

  /** Funnel with a strike — clear what the funnel did. */
  "filter-off": (v, a, b) =>
    v.fill === "solid"
      ? `<path d="M3.5 4.5 H20.5 L14 12.4 V19.5 L10 17.4 V12.4 Z" fill="${a}" opacity="0.4"/>` +
        `<path d="M4 20 L20 4" stroke="${b}" stroke-width="${v.stroke + 0.6}" stroke-linecap="${v.cap}"/>`
      : `<path d="M3.9 4.9 H20.1 L13.8 12.5 V19.1 L10.2 17.1 V12.5 Z" ${strokeAttrs(v, a)} opacity="0.55"/>` +
        `<path d="M4.4 19.6 L19.6 4.4" ${strokeAttrs(v, b)}/>`,

  /** Two stacked bars against one — comparing against one thing or many. */
  compare: (v, a, b) =>
    v.fill === "solid"
      ? `<rect x="3" y="5" width="7" height="14" rx="${v.corner}" fill="${a}"/>` +
        `<rect x="14" y="5" width="7" height="6" rx="${v.corner}" fill="${b}"/>` +
        `<rect x="14" y="13" width="7" height="6" rx="${v.corner}" fill="${b}"/>`
      : `<rect x="3.4" y="5.4" width="6.4" height="13.2" rx="${v.corner}" ${strokeAttrs(v, a)}/>` +
        `<rect x="14.2" y="5.4" width="6.4" height="5.4" rx="${v.corner}" ${strokeAttrs(v, b)}/>` +
        `<rect x="14.2" y="13.2" width="6.4" height="5.4" rx="${v.corner}" ${strokeAttrs(v, b)}/>`,

  /** A line turning back on itself. */
  wrap: (v, a, b) =>
    `<path d="M3.5 7 H20.5" ${strokeAttrs(v, a)}/>` +
    `<path d="M3.5 12 H16.5 A3 3 0 0 1 16.5 18 H12" ${strokeAttrs(v, a)}/>` +
    `<path d="M14 15.8 L11.6 18 L14 20.2" ${strokeAttrs(v, b)}/>` +
    `<path d="M3.5 18 H8" ${strokeAttrs(v, b)}/>`,

  /** Two arrows locked in step. */
  sync: (v, a, b) =>
    `<path d="M6 8.5 V17 M18 7 V15.5" ${strokeAttrs(v, a)}/>` +
    `<path d="M3.6 14.6 L6 17 L8.4 14.6" ${strokeAttrs(v, a)}/>` +
    `<path d="M15.6 9.4 L18 7 L20.4 9.4" ${strokeAttrs(v, b)}/>`,

  /** Visibility. */
  eye: (v, a, b) =>
    v.fill === "solid"
      ? `<path d="M2.5 12 C6 6.5 18 6.5 21.5 12 C18 17.5 6 17.5 2.5 12 Z" fill="${a}"/>` +
        `<circle cx="12" cy="12" r="3" fill="${b}"/>`
      : `<path d="M2.9 12 C6.2 7 17.8 7 21.1 12 C17.8 17 6.2 17 2.9 12 Z" ${strokeAttrs(v, a)}/>` +
        `<circle cx="12" cy="12" r="2.7" ${strokeAttrs(v, b)}/>`,

  /**
   * The eye, struck through — HIDDEN, as a state.
   *
   * Deliberately the same almond and pupil as `eye` with a slash laid over it,
   * rather than a different drawing of a closed lid: the two ids appear beside
   * each other in the brand gallery's View menu (shown / hidden), and a reader
   * should see one shape with one difference, not two unrelated marks. The
   * slash runs corner to corner so it survives the 13px the icons are rendered
   * at in a menu row, where a drawn eyelash would collapse into a smudge.
   */
  "eye-off": (v, a, b) =>
    v.fill === "solid"
      ? `<path d="M2.5 12 C6 6.5 18 6.5 21.5 12 C18 17.5 6 17.5 2.5 12 Z" fill="${a}"/>` +
        `<circle cx="12" cy="12" r="3" fill="${b}"/>` +
        `<path d="M4.2 19.8 L19.8 4.2" stroke="${b}" stroke-width="${v.stroke + 1}" ` +
        `stroke-linecap="${v.cap}"/>`
      : `<path d="M2.9 12 C6.2 7 17.8 7 21.1 12 C17.8 17 6.2 17 2.9 12 Z" ${strokeAttrs(v, a)}/>` +
        `<circle cx="12" cy="12" r="2.7" ${strokeAttrs(v, b)}/>` +
        `<path d="M4.2 19.8 L19.8 4.2" ${strokeAttrs(v, b)}/>`,

  /** Circular arrow — re-read from source. */
  reload: (v, a, b) =>
    `<path d="M20 12 A8 8 0 1 1 17.2 6" ${strokeAttrs(v, a)}/>` +
    `<path d="M17.4 3.2 V6.6 H14" ${strokeAttrs(v, b)}/>`,

  /** Globe — the query leaves this column and searches them all. */
  globe: (v, a, b) =>
    `<circle cx="12" cy="12" r="8.4" ${strokeAttrs(v, a)}/>` +
    `<path d="M3.6 12 H20.4" ${strokeAttrs(v, b)}/>` +
    `<path d="M12 3.6 C15 6.6 15 17.4 12 20.4 C9 17.4 9 6.6 12 3.6 Z" ${strokeAttrs(v, b)}/>`,

  /** Previous / next match. */
  "chevron-up": (v, a) => `<path d="M6.5 15 L12 9.4 L17.5 15" ${strokeAttrs(v, a)}/>`,
  "chevron-down": (v, a) => `<path d="M6.5 9.4 L12 15 L17.5 9.4" ${strokeAttrs(v, a)}/>`,

  /* ---- template extension, 2026-08-08 ---------------------------------- *
   * Seven ids promoted into the REQUIRED_GLYPHS contract because surfaces
   * reference contract ids only, and 25 icons will not carry a framework plus
   * an SDK. Drawn here in the SAME step as the requirement landed, so every
   * pack built from this kit stayed complete the day the template grew.
   * Appended at the end — never reorder this map.                           */

  /** Four tiles — modules, a launcher. One tile in the secondary colour. */
  grid: (v, a, b) =>
    v.fill === "solid"
      ? `<rect x="3.5" y="3.5" width="7.5" height="7.5" rx="${v.corner}" fill="${a}"/>` +
        `<rect x="13" y="3.5" width="7.5" height="7.5" rx="${v.corner}" fill="${a}"/>` +
        `<rect x="3.5" y="13" width="7.5" height="7.5" rx="${v.corner}" fill="${a}"/>` +
        `<rect x="13" y="13" width="7.5" height="7.5" rx="${v.corner}" fill="${b}"/>`
      : `<rect x="3.8" y="3.8" width="7" height="7" rx="${v.corner}" ${strokeAttrs(v, a)}/>` +
        `<rect x="13.2" y="3.8" width="7" height="7" rx="${v.corner}" ${strokeAttrs(v, a)}/>` +
        `<rect x="3.8" y="13.2" width="7" height="7" rx="${v.corner}" ${strokeAttrs(v, a)}/>` +
        `<rect x="13.2" y="13.2" width="7" height="7" rx="${v.corner}" ${strokeAttrs(v, b)}/>`,

  /** Lightning — actions, power, quick commands. */
  bolt: (v, a, b) =>
    v.fill === "solid"
      ? `<path d="M13.2 2.5 L5.5 13.5 H10.8 L9.6 21.5 L18.5 9.8 H12.6 Z" fill="${a}"/>`
      : `<path d="M13 3.2 L6.2 13.2 H11 L10 20.8 L17.8 10 H12.4 Z" ${strokeAttrs(v, a)}/>` +
        `<path d="M11.6 8.2 L12.8 6.4" ${strokeAttrs(v, b)}/>`,

  /** Paintbrush — bristles in the secondary colour. */
  brush: (v, a, b) =>
    v.fill === "solid"
      ? `<path d="M20.5 3.5 C17 5 12.5 8.5 10.2 11.8 L12.8 14.4 C16 12 19.5 7.5 20.5 3.5 Z" fill="${a}"/>` +
        `<path d="M9 13 C6.5 13.5 5.8 16 5.5 18.5 C7.8 18.6 10.8 18.2 11.6 15.6 Z" fill="${b}"/>`
      : `<path d="M20 4 C16.8 5.6 12.8 9 10.6 12 L12.6 14 C15.6 11.8 19 7.8 20 4 Z" ${strokeAttrs(v, a)}/>` +
        `<path d="M9.2 13.4 C7 13.8 6.2 16 5.9 18.2 C8 18.3 10.6 17.9 11.3 15.5 Z" ${strokeAttrs(v, b)}/>`,

  /** Folder with a tab. */
  folder: (v, a, b) =>
    v.fill === "solid"
      ? `<path d="M3 6 A2 2 0 0 1 5 4 H9.5 L11.5 6.5 H19 A2 2 0 0 1 21 8.5 V18 A2 2 0 0 1 19 20 H5 A2 2 0 0 1 3 18 Z" fill="${a}"/>` +
        `<rect x="3" y="9.4" width="18" height="1.6" fill="${b}"/>`
      : `<path d="M3.4 6.2 A1.8 1.8 0 0 1 5.2 4.4 H9.3 L11.2 6.8 H18.8 A1.8 1.8 0 0 1 20.6 8.6 V17.8 A1.8 1.8 0 0 1 18.8 19.6 H5.2 A1.8 1.8 0 0 1 3.4 17.8 Z" ${strokeAttrs(v, a)}/>` +
        `<path d="M3.4 9.8 H20.6" ${strokeAttrs(v, b)}/>`,

  /** Clock with a counter-clockwise return arrow — what happened before. */
  history: (v, a, b) =>
    `<path d="M5 12 A7.4 7.4 0 1 1 7.2 17.2" ${strokeAttrs(v, a)}/>` +
    `<path d="M4.4 8.8 L5 12 L8.2 11.4" ${strokeAttrs(v, b)}/>` +
    `<path d="M12 8 V12.4 L15.2 14.2" ${strokeAttrs(v, b)}/>`,

  /** Keyboard — key row dots plus the space bar. */
  keyboard: (v, a, b) =>
    v.fill === "solid"
      ? `<rect x="2.5" y="6" width="19" height="12" rx="${v.corner}" fill="${a}"/>` +
        `<rect x="6" y="14" width="12" height="1.8" rx="0.9" fill="${b}"/>` +
        `<circle cx="6.5" cy="9.8" r="1" fill="${b}"/><circle cx="10.2" cy="9.8" r="1" fill="${b}"/>` +
        `<circle cx="13.8" cy="9.8" r="1" fill="${b}"/><circle cx="17.5" cy="9.8" r="1" fill="${b}"/>`
      : `<rect x="2.8" y="6.3" width="18.4" height="11.4" rx="${v.corner}" ${strokeAttrs(v, a)}/>` +
        `<path d="M6.6 14.4 H17.4" ${strokeAttrs(v, b)}/>` +
        `<path d="M6.4 10 H6.6 M10.1 10 H10.3 M13.7 10 H13.9 M17.4 10 H17.6" ${strokeAttrs(v, b)}/>`,

  /** Four-point star with a small companion — generation, the new thing. */
  sparkle: (v, a, b) =>
    v.fill === "solid"
      ? `<path d="M11 3 L12.8 9.2 L19 11 L12.8 12.8 L11 19 L9.2 12.8 L3 11 L9.2 9.2 Z" fill="${a}"/>` +
        `<path d="M17.8 15.4 L18.7 17.8 L21.1 18.7 L18.7 19.6 L17.8 22 L16.9 19.6 L14.5 18.7 L16.9 17.8 Z" fill="${b}"/>`
      : `<path d="M11 3.6 L12.6 9.4 L18.4 11 L12.6 12.6 L11 18.4 L9.4 12.6 L3.6 11 L9.4 9.4 Z" ${strokeAttrs(v, a)}/>` +
        `<path d="M17.9 15.8 L18.6 17.9 L20.7 18.6 L18.6 19.3 L17.9 21.4 L17.2 19.3 L15.1 18.6 L17.2 17.9 Z" ${strokeAttrs(v, b)}/>`,

  /* ---- template extension, 2026-08-08 (studio-shell-init P4) ------------ *
   * Two ids promoted into the contract because the command bar's dock chip
   * and account action name them. Same rule as the seven above: drawn in the
   * SAME edit as the requirement, so every kit-built pack stayed complete
   * the day the template grew. Appended at the end — never reorder.         */

  /** Speech bubble with a tail — conversation, the chat dock. */
  chat: (v, a, b) =>
    v.fill === "solid"
      ? `<path d="M3 6 A3 3 0 0 1 6 3 H18 A3 3 0 0 1 21 6 V13.5 A3 3 0 0 1 18 16.5 H10.5 L5 21 V16.5 A3 3 0 0 1 3 13.5 Z" fill="${a}"/>` +
        `<circle cx="8.2" cy="10" r="1.2" fill="${b}"/><circle cx="12" cy="10" r="1.2" fill="${b}"/>` +
        `<circle cx="15.8" cy="10" r="1.2" fill="${b}"/>`
      : `<path d="M3.6 6.2 A2.6 2.6 0 0 1 6.2 3.6 H17.8 A2.6 2.6 0 0 1 20.4 6.2 V13.2 A2.6 2.6 0 0 1 17.8 15.8 H10.4 L5.6 20 V15.8 A2.6 2.6 0 0 1 3.6 13.2 Z" ${strokeAttrs(v, a)}/>` +
        `<path d="M8.1 9.8 H8.3 M11.9 9.8 H12.1 M15.7 9.8 H15.9" ${strokeAttrs(v, b)}/>`,

  /** Head and shoulders — the person using the app. */
  account: (v, a, b) =>
    v.fill === "solid"
      ? `<circle cx="12" cy="8" r="4" fill="${a}"/>` +
        `<path d="M4.5 20.5 A7.5 6.5 0 0 1 19.5 20.5 Z" fill="${b}"/>`
      : `<circle cx="12" cy="8.2" r="3.6" ${strokeAttrs(v, a)}/>` +
        `<path d="M5 20 A7 7 0 0 1 19 20" ${strokeAttrs(v, b)}/>`,

  /* ---- AmberArt's tool rail --------------------------------------------- *
   * Added for AmberArt (2026-08-12) rather than drawing six near-identical
   * brushes or reusing `brush` for every tool. They live HERE, in the shared
   * kit, and not beside the module, for the reason the brand rules give: an
   * icon authored next to its consumer paints a fixed colour and stops
   * following the theme, and a second pack then has no drawing for it at all.
   * Every pack gets these the moment it calls `buildIcons`.
   *
   * Each is one silhouette with at most two features, so it still reads at
   * 16px without relying on internal contrast.                              */

  /** A wedge rubbing a line out — reads as "remove", not as "delete". */
  eraser: (v, a, b) =>
    v.fill === "solid"
      ? `<path d="M9.5 4.5 L19.5 14.5 L14.5 19.5 L4.5 9.5 Z" fill="${a}"/>` +
        `<path d="M4 21 H20" stroke="${b}" stroke-width="${v.stroke}" stroke-linecap="${v.cap}"/>`
      : `<path d="M9.6 4.9 L19.1 14.4 L14.4 19.1 L4.9 9.6 Z" ${strokeAttrs(v, a)}/>` +
        `<path d="M4 21 H20" ${strokeAttrs(v, b)}/>`,

  /** A straight segment with its two handles — the line tool. */
  line: (v, a, b) =>
    `<path d="M5.5 18.5 L18.5 5.5" ${strokeAttrs(v, a)}/>` +
    (v.fill === "solid"
      ? `<circle cx="5.5" cy="18.5" r="2.4" fill="${b}"/><circle cx="18.5" cy="5.5" r="2.4" fill="${b}"/>`
      : `<circle cx="5.5" cy="18.5" r="2" ${strokeAttrs(v, b)}/>` +
        `<circle cx="18.5" cy="5.5" r="2" ${strokeAttrs(v, b)}/>`),

  /** The rectangle tool. */
  rect: (v, a) =>
    v.fill === "solid"
      ? `<rect x="4" y="6" width="16" height="12" rx="${v.corner}" fill="${a}"/>`
      : `<rect x="4.5" y="6.5" width="15" height="11" rx="${v.corner}" ${strokeAttrs(v, a)}/>`,

  /** The ellipse tool. */
  ellipse: (v, a) =>
    v.fill === "solid"
      ? `<ellipse cx="12" cy="12" rx="8.5" ry="6.5" fill="${a}"/>`
      : `<ellipse cx="12" cy="12" rx="8" ry="6" ${strokeAttrs(v, a)}/>`,

  /** A tipped bucket with a drop — flood fill. */
  fill: (v, a, b) =>
    v.fill === "solid"
      ? `<path d="M4.5 12.5 L11 6 L18 13 L11.5 19.5 Z" fill="${a}"/>` +
        `<path d="M20 15 C21.6 17.2 21.6 19.4 20 20.2 C18.4 19.4 18.4 17.2 20 15 Z" fill="${b}"/>`
      : `<path d="M4.9 12.5 L11 6.4 L17.6 13 L11.5 19.1 Z" ${strokeAttrs(v, a)}/>` +
        `<path d="M20 15.2 C21.4 17.2 21.4 19.2 20 19.9 C18.6 19.2 18.6 17.2 20 15.2 Z" ${strokeAttrs(v, b)}/>`,

  /** An eyedropper — the colour picker. */
  picker: (v, a, b) =>
    v.fill === "solid"
      ? `<path d="M4 20 L5 16.5 L14 7.5 L16.5 10 L7.5 19 Z" fill="${a}"/>` +
        `<path d="M15.2 6.8 L17.2 4.8" stroke="${b}" stroke-width="${v.stroke}" stroke-linecap="${v.cap}"/>`
      : `<path d="M4.4 19.6 L5.3 16.6 L14 7.9 L16.1 10 L7.4 18.7 Z" ${strokeAttrs(v, a)}/>` +
        `<path d="M15.2 6.8 L17.2 4.8" ${strokeAttrs(v, b)}/>`,

  /* ---- the Task Manager's lists bar, 2026-08-13 -------------------------- *
   * Two ids promoted into the contract because that bar names them, and a
   * surface may name contract ids only. Drawn HERE in the same edit as the
   * requirement, per the rule the extensions above each restate. Appended at
   * the end — never reorder this map.                                       */

  /** A bin with a lid and a hinge line — permanent deletion, not `eraser`. */
  trash: (v, a, b) =>
    v.fill === "solid"
      ? `<path d="M6 8 H18 L17 20.5 A1.5 1.5 0 0 1 15.5 21.5 H8.5 A1.5 1.5 0 0 1 7 20.5 Z" fill="${a}"/>` +
        `<rect x="4" y="5" width="16" height="2.2" rx="1.1" fill="${b}"/>` +
        `<rect x="9.5" y="2.5" width="5" height="2" rx="1" fill="${b}"/>`
      : `<path d="M6.4 8.2 H17.6 L16.7 20.2 A1.4 1.4 0 0 1 15.3 21.5 H8.7 A1.4 1.4 0 0 1 7.3 20.2 Z" ${strokeAttrs(v, a)}/>` +
        `<path d="M4.4 6 H19.6" ${strokeAttrs(v, b)}/>` +
        `<path d="M9.8 3.4 H14.2" ${strokeAttrs(v, b)}/>`,

  /** A plus — create. The one shape that cannot be mistaken for anything. */
  plus: (v, a, b) =>
    v.fill === "solid"
      ? `<rect x="10.6" y="4" width="2.8" height="16" rx="${Math.min(1.4, v.corner)}" fill="${a}"/>` +
        `<rect x="4" y="10.6" width="16" height="2.8" rx="${Math.min(1.4, v.corner)}" fill="${b}"/>`
      : `<path d="M12 4.6 V19.4" ${strokeAttrs(v, a)}/>` +
        `<path d="M4.6 12 H19.4" ${strokeAttrs(v, b)}/>`,

  /* ---- AmberArt Pro's tool rail, 2026-08-15 ------------------------------ *
   * Eleven ids promoted into the contract because AmberArt's rail grew from
   * seven tools to eighteen, and a surface may name contract ids only. Drawn
   * HERE rather than beside the module for the reason the AmberArt block above
   * gives — an icon authored next to its consumer paints a fixed colour and
   * stops following the theme — and in the SAME edit as the requirement,
   * because `axs-studio.ts` refuses an overlay entry outside the contract.
   *
   * These share the rail with the six above at **size 14**, which is below the
   * 16px the first six were drawn for and only one px above the contract's 13px
   * floor. So the discipline is tighter here: one silhouette, at most three
   * features, nothing thinner than the voice's own stroke, and no feature that
   * depends on reading a gap narrower than the stroke beside it. Where a fade
   * is the whole idea (`gradient`, `smudge`) it is stepped opacity on full-
   * weight strokes, never a thinner line — a hairline is the first thing to
   * disappear. Appended at the end — never reorder this map.                 */

  /** A serif T. The foot bar is what makes it read as TYPE and not as a plus. */
  text: (v, a, b) =>
    v.fill === "solid"
      ? `<rect x="4" y="4.6" width="16" height="2.9" rx="${Math.min(1.4, v.corner)}" fill="${a}"/>` +
        `<rect x="10.6" y="6" width="2.9" height="12" rx="${Math.min(1.4, v.corner)}" fill="${a}"/>` +
        `<rect x="7.4" y="17.5" width="9.2" height="2.5" rx="${Math.min(1.25, v.corner)}" fill="${b}"/>`
      : `<path d="M4.6 5.8 H19.4" ${strokeAttrs(v, a)}/>` +
        `<path d="M12 5.8 V18.2" ${strokeAttrs(v, a)}/>` +
        `<path d="M7.8 18.2 H16.2" ${strokeAttrs(v, b)}/>`,

  /**
   * The marching ants, as a shape rather than an animation.
   *
   * Deliberately square-cornered (`Math.min(1, v.corner)`) even in a pack whose
   * voice rounds everything: `rect` is already in this set, and the ONLY things
   * separating the two at 14px are the dash and the corner. Round both and a
   * marquee is a rectangle tool wearing a costume.
   */
  marquee: (v, a) =>
    `<rect x="4.2" y="5.4" width="15.6" height="13.2" rx="${Math.min(1, v.corner)}" ` +
    `${strokeAttrs(v, a)} stroke-dasharray="3.4 2.6"/>`,

  /**
   * A tilted loop with the rope falling away beneath it.
   *
   * The tilt is load-bearing, not styling: an upright loop on its own IS
   * `icon-ellipse`, which sits four places along the same rail, and the tail is
   * the only other thing telling them apart. Tilting the loop means the two
   * differ in silhouette before a reader gets as far as the tail.
   *
   * A cinch knot was drawn here first and removed: at the voice's own stroke
   * width the ring's counter is under a unit across, so it filled in and read
   * as a blob hanging off the loop — mud at 64px, worse at 14.
   */
  lasso: (v, a, b) =>
    `<ellipse cx="12.6" cy="9.2" rx="7" ry="5" transform="rotate(-14 12.6 9.2)" ${strokeAttrs(v, a)}/>` +
    `<path d="M7.3 13.1 C5.2 15.8 5.8 18.8 8.6 20.6" ${strokeAttrs(v, b)}/>`,

  /** A wand throwing a four-point sparkle off its tip. */
  wand: (v, a, b) =>
    v.fill === "solid"
      ? `<path d="M3.1 19.1 L12.5 9.7 L14.3 11.5 L4.9 20.9 Z" fill="${a}"/>` +
        `<path d="M18.2 2.6 L19.2 5.1 L21.7 6.1 L19.2 7.1 L18.2 9.6 L17.2 7.1 L14.7 6.1 L17.2 5.1 Z" fill="${b}"/>`
      : `<path d="M4.6 19.4 L14 10" ${strokeAttrs(v, a)}/>` +
        `<path d="M11.5 9.7 L14.3 12.5" ${strokeAttrs(v, b)}/>` +
        `<path d="M18.2 3.2 L19.1 5.2 L21.1 6.1 L19.1 7 L18.2 9 L17.3 7 L15.3 6.1 L17.3 5.2 Z" ${strokeAttrs(v, b)}/>`,

  /** Four-way arrows — the one drawing nobody has ever had to be told. */
  move: (v, a, b) =>
    v.fill === "solid"
      ? `<rect x="10.7" y="6" width="2.6" height="12" rx="${Math.min(1.3, v.corner)}" fill="${a}"/>` +
        `<rect x="6" y="10.7" width="12" height="2.6" rx="${Math.min(1.3, v.corner)}" fill="${a}"/>` +
        `<path d="M12 2.6 L15.4 7 H8.6 Z" fill="${b}"/><path d="M12 21.4 L15.4 17 H8.6 Z" fill="${b}"/>` +
        `<path d="M2.6 12 L7 8.6 V15.4 Z" fill="${b}"/><path d="M21.4 12 L17 8.6 V15.4 Z" fill="${b}"/>`
      : `<path d="M12 3.8 V20.2" ${strokeAttrs(v, a)}/>` +
        `<path d="M3.8 12 H20.2" ${strokeAttrs(v, a)}/>` +
        `<path d="M9.4 6.4 L12 3.8 L14.6 6.4" ${strokeAttrs(v, b)}/>` +
        `<path d="M9.4 17.6 L12 20.2 L14.6 17.6" ${strokeAttrs(v, b)}/>` +
        `<path d="M6.4 9.4 L3.8 12 L6.4 14.6" ${strokeAttrs(v, b)}/>` +
        `<path d="M17.6 9.4 L20.2 12 L17.6 14.6" ${strokeAttrs(v, b)}/>`,

  /**
   * A frame with the fade drawn as STEPS.
   *
   * The kit's vocabulary has no gradients on purpose — a `<linearGradient>`
   * needs a `<defs>` id, and two copies of one icon on a page then both point
   * at whichever defs the browser saw first (the `account-glow` bug, recorded
   * in `packs/axs-studio.ts`). Four diagonals at descending opacity say the
   * same thing, survive being inlined twice, and still read at 14px.
   */
  gradient: (v, a, b) =>
    `<rect x="3.6" y="5.6" width="16.8" height="12.8" rx="${v.corner}" ${strokeAttrs(v, a)}/>` +
    `<path d="M6.2 17 L10.4 7.2" ${strokeAttrs(v, b)} opacity="0.9"/>` +
    `<path d="M9.8 17 L14 7.2" ${strokeAttrs(v, b)} opacity="0.62"/>` +
    `<path d="M13.4 17 L17.6 7.2" ${strokeAttrs(v, b)} opacity="0.34"/>` +
    `<path d="M17 17 L19.2 11.9" ${strokeAttrs(v, b)} opacity="0.18"/>`,

  /** A frame woven with a warp and a weft — pattern, not flat colour. */
  texture: (v, a, b) =>
    v.fill === "solid"
      ? `<rect x="3.5" y="5.5" width="17" height="13" rx="${v.corner}" fill="${a}"/>` +
        `<path d="M9.2 5.5 V18.5 M14.8 5.5 V18.5 M3.5 9.8 H20.5 M3.5 14.2 H20.5" ` +
        `fill="none" stroke="${b}" stroke-width="${v.stroke}"/>`
      : `<rect x="3.6" y="5.6" width="16.8" height="12.8" rx="${v.corner}" ${strokeAttrs(v, a)}/>` +
        `<path d="M9.2 5.9 V18.1" ${strokeAttrs(v, b)}/>` +
        `<path d="M14.8 5.9 V18.1" ${strokeAttrs(v, b)}/>` +
        `<path d="M3.9 9.9 H20.1" ${strokeAttrs(v, b)}/>` +
        `<path d="M3.9 14.1 H20.1" ${strokeAttrs(v, b)}/>`,

  /**
   * Knob, neck and pad over an ink base — a rubber stamp in silhouette.
   *
   * The knob is drawn WIDER than the neck it sits on. Drawn the other way it
   * fused with the pad into one cone and the whole icon read as a bell; the
   * waist between a wide grip and a narrow neck is the entire recognition cue,
   * and it has to survive the voice's stroke closing gaps at 14px.
   */
  stamp: (v, a, b) =>
    v.fill === "solid"
      ? `<rect x="8.2" y="2.6" width="7.6" height="3.7" rx="${Math.min(1.85, v.corner)}" fill="${a}"/>` +
        `<path d="M5.2 15.8 L10.2 6.1 H13.8 L18.8 15.8 Z" fill="${a}"/>` +
        `<rect x="3.6" y="17.6" width="16.8" height="2.7" rx="${Math.min(1.35, v.corner)}" fill="${b}"/>`
      : `<rect x="8.4" y="2.9" width="7.2" height="3.4" rx="${Math.min(1.7, v.corner)}" ${strokeAttrs(v, a)}/>` +
        `<path d="M5.6 15.4 L10.3 6.2 H13.7 L18.4 15.4 Z" ${strokeAttrs(v, a)}/>` +
        `<path d="M4.2 18.8 H19.8" ${strokeAttrs(v, b)}/>`,

  /**
   * A fingertip with the paint FANNING out behind it.
   *
   * Two decisions, both taken after looking at the render rather than at the
   * code. The pad is filled in both voices, because a smear drawn entirely from
   * strokes has no leading end and the direction of the drag is the whole
   * information content here. And the trails DIVERGE: drawn parallel they read
   * as one thick stick with a bead on the end — a pin, not a smear. Three
   * strokes leaving one point at three angles cannot be read as one stroke.
   */
  smudge: (v, a, b) =>
    `<circle cx="17" cy="15.4" r="${v.fill === "solid" ? 3.1 : 2.7}" fill="${a}"/>` +
    `<path d="M14.9 13.6 C11.6 11.4 8.4 9.2 5 7.2" ${strokeAttrs(v, a)}/>` +
    `<path d="M14.1 16 C10.6 16.1 7 15.4 3.7 13.7" ${strokeAttrs(v, b)} opacity="0.7"/>` +
    `<path d="M15.9 12.8 C13.9 10.1 11.6 7.2 9.5 4.7" ${strokeAttrs(v, b)} opacity="0.42"/>`,

  /**
   * A magnifier with a plus in it — SCALE, where `search` is FIND.
   *
   * The two are the same silhouette on purpose and the plus is the whole
   * difference, so it is drawn at full stroke weight and given the secondary
   * colour: at 14px a lighter or thinner plus reads as dirt inside the lens.
   */
  zoom: (v, a, b) =>
    v.fill === "solid"
      ? `<circle cx="10.6" cy="10.6" r="6.6" fill="${a}"/>` +
        `<rect x="9.6" y="7.2" width="2" height="6.8" rx="1" fill="${b}"/>` +
        `<rect x="7.2" y="9.6" width="6.8" height="2" rx="1" fill="${b}"/>` +
        `<rect x="14.7" y="15.5" width="6.4" height="${v.stroke + 0.8}" rx="${v.corner}" fill="${a}" transform="rotate(45 14.7 15.5)"/>`
      : `<circle cx="10.6" cy="10.6" r="6.2" ${strokeAttrs(v, a)}/>` +
        `<path d="M15.2 15.2 L20.4 20.4" ${strokeAttrs(v, a)}/>` +
        `<path d="M10.6 7.9 V13.3" ${strokeAttrs(v, b)}/>` +
        `<path d="M7.9 10.6 H13.3" ${strokeAttrs(v, b)}/>`,

  /**
   * A square with its corner peeled up — a decal waiting to be placed.
   *
   * The notch takes a third of the width. A daintier fold is the tasteful
   * drawing and it disappears at 14px, where the peel is the only thing
   * standing between this and a plain rounded square.
   */
  sticker: (v, a, b) =>
    v.fill === "solid"
      ? `<path d="M5 4.4 H19 V12.6 L12.6 19.6 H5 Z" fill="${a}"/>` +
        `<path d="M12.6 19.6 V14.1 A1.5 1.5 0 0 1 14.1 12.6 H19 Z" fill="${b}"/>`
      : `<path d="M5.2 4.8 H18.8 V12.5 L12.5 19.2 H5.2 Z" ${strokeAttrs(v, a)}/>` +
        `<path d="M18.8 12.5 H14 A1.5 1.5 0 0 0 12.5 14 V19.2" ${strokeAttrs(v, b)}/>`
};

export const ICON_IDS = Object.keys(ICONS);

/** Build every icon in the set, in a pack's voice. */
export function buildIcons(voice: Voice, palette: BrandPalette): GlyphEntry[] {
  const a = ref(palette, voice.primary);
  const b = ref(palette, voice.secondary);
  return ICON_IDS.map((id) => ({
    id: `icon-${id}`,
    label: `${id[0].toUpperCase()}${id.slice(1)} icon`,
    category: "icon" as const,
    size: 24,
    shape: "square" as const,
    style: voice.fill,
    animated: false,
    motion: "none" as const,
    tags: ["icon", voice.fill],
    svg: svg(ICONS[id](voice, a, b))
  }));
}

/* --------------------------------------------------------------- wordmark */

/**
 * A wordmark drawn as text rather than outlined paths. Deliberate: it inherits
 * the pack's own typeface through `--axf-sans`, so the wordmark and the
 * interface never disagree about what the brand's letterforms are.
 */
export function buildWordmark(
  voice: Voice,
  palette: BrandPalette,
  text: string,
  accentFrom = 0
): GlyphEntry {
  const a = ref(palette, voice.primary);
  const ink = ref(palette, "ink");
  const head = text.slice(0, accentFrom || text.length);
  const tail = accentFrom ? text.slice(accentFrom) : "";
  return {
    id: "wordmark",
    label: `${text} wordmark`,
    category: "wordmark",
    size: 160,
    shape: "wide",
    style: voice.fill,
    tags: ["wordmark"],
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 32" width="160" height="32" role="img">` +
      `<text x="0" y="23" font-family="var(--axf-sans, Inter, system-ui, sans-serif)" ` +
      `font-size="21" font-weight="${voice.fill === "solid" ? 800 : 600}" ` +
      `letter-spacing="var(--axf-tracking, 0.01em)" fill="${ink}">${head}` +
      (tail ? `<tspan fill="${a}">${tail}</tspan>` : "") +
      `</text></svg>`
  };
}

/* ---------------------------------------------------------------- spinner */

/** A spinner in the pack's voice. SMIL, so it animates without CSS or JS. */
export function buildSpinner(voice: Voice, palette: BrandPalette): GlyphEntry {
  const a = ref(palette, voice.primary);
  const track = ref(palette, "edge");
  return {
    id: "spinner",
    label: "Loading spinner",
    category: "spinner",
    size: 24,
    animated: true,
    motion: "spin",
    tags: ["spinner", "animated"],
    svg: svg(
      `<circle cx="12" cy="12" r="9" fill="none" stroke="${track}" stroke-width="${voice.stroke}"/>` +
        `<path d="M12 3 A9 9 0 0 1 21 12" fill="none" stroke="${a}" stroke-width="${voice.stroke}" stroke-linecap="${voice.cap}">` +
        `<animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite"/>` +
        `</path>`
    )
  };
}

/** A large, faint backdrop drawing built from the pack's own mark markup. */
export function buildWatermark(markBody: string, box = 24): GlyphEntry {
  return {
    id: "watermark",
    label: "Page watermark",
    category: "watermark",
    size: 320,
    tags: ["watermark"],
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}" width="320" height="320" ` +
      `role="img" fill="none" opacity="0.06">${markBody}</svg>`
  };
}

export { svg as svgDoc, strokeAttrs };
