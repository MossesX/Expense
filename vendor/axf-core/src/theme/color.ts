/**
 * @file Colour maths for the generator and the clamps.
 *
 * Kept separate from both because the contrast clamp is the part most likely to
 * be wrong in a way nobody notices — a theme that is 4.4:1 instead of 4.5:1
 * looks fine to the person who rolled it and fails for someone else. Isolating
 * it makes it testable on its own.
 *
 * HSL rather than OKLCH deliberately, for now: HSL is exact in CSS, needs no
 * conversion table, and the engine's job here is *legible variety*, not
 * perceptual uniformity. When a designer needs perceptual ramps, that is the
 * requirement that justifies swapping this file's internals — and only this
 * file's, because everything else speaks hex.
 */

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export function hexToHsl(hex: string): Hsl {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return { h: h < 0 ? h + 360 : h, s, l };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const sc = Math.min(1, Math.max(0, s));
  const lc = Math.min(1, Math.max(0, l));
  const c = (1 - Math.abs(2 * lc - 1)) * sc;
  const hh = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const [r1, g1, b1] =
    hh < 1 ? [c, x, 0]
    : hh < 2 ? [x, c, 0]
    : hh < 3 ? [0, c, x]
    : hh < 4 ? [0, x, c]
    : hh < 5 ? [x, 0, c]
    : [c, 0, x];
  const m = lc - c / 2;
  const ch = (v: number) => Math.round(Math.min(1, Math.max(0, v + m)) * 255);
  return `#${((ch(r1) << 16) | (ch(g1) << 8) | ch(b1)).toString(16).padStart(6, "0")}`;
}

function channel(v: number): number {
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel(((n >> 16) & 0xff) / 255) +
    0.7152 * channel(((n >> 8) & 0xff) / 255) +
    0.0722 * channel((n & 0xff) / 255)
  );
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Move `colour` until it reaches `min` contrast against `against` — by
 * lightness only, keeping the hue and saturation the roll chose.
 *
 * Direction is decided by which side has more room: against a dark background
 * the colour goes lighter, against a light one it goes darker. Binary search on
 * lightness rather than stepping, because stepping either overshoots (visible
 * banding across rolled themes) or takes 100 iterations.
 *
 * Returns the colour unchanged when it already passes. Returns the best it
 * could reach when the target is impossible — pure white on white cannot make
 * 4.5:1, and returning white is more useful than returning the original or
 * throwing, because the caller's own legibility report will name it.
 */
export function clampContrast(colour: string, against: string, min: number): string {
  if (contrast(colour, against) >= min) return colour;

  const hsl = hexToHsl(colour);
  const goLighter = luminance(against) < 0.5;

  let lo = goLighter ? hsl.l : 0;
  let hi = goLighter ? 1 : hsl.l;
  let best = goLighter ? "#ffffff" : "#000000";

  // If even the extreme fails, nothing in between will — return it and let the
  // caller's legibility check report an honest failure.
  if (contrast(best, against) < min) return best;

  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const candidate = hslToHex({ ...hsl, l: mid });
    if (contrast(candidate, against) >= min) {
      best = candidate;
      // Keep the colour as close to its rolled lightness as possible: having
      // found a passing value, search back TOWARDS the original.
      if (goLighter) hi = mid;
      else lo = mid;
    } else if (goLighter) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return best;
}

/** Mix two hexes by `t` in 0..1. Used for elevation ramps. */
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => {
    const va = (pa >> shift) & 0xff;
    const vb = (pb >> shift) & 0xff;
    return Math.round(va + (vb - va) * t);
  };
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
}

/** Rotate a hue by degrees, keeping saturation and lightness. */
export function rotate(hex: string, deg: number): string {
  const hsl = hexToHsl(hex);
  return hslToHex({ ...hsl, h: hsl.h + deg });
}
