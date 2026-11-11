// The statistics pages' shared state and arithmetic (docs/stats.md): the figure options in the
// URL (named as the API's parameters), the chart colors, and shares that add up.

import { z } from 'zod';

/** A figure page's options. Names are the API's, so they pass straight through. */
export const StatsSearch = z.object({
  every: z.enum(['release', 'month']).optional().catch(undefined),
  conflict: z.enum(['aggregate', 'pairs']).optional().catch(undefined),
  condition_match: z.enum(['strict', 'wildcard', 'any']).optional().catch(undefined),
});
export type StatsSearch = z.infer<typeof StatsSearch>;

/** A chart color for light and dark mode, and the ink of a label set inside it. */
export interface Paint {
  light: string;
  dark: string;
  /** Label ink inside the fill, by APCA: near-black or white. */
  inkLight: string;
  inkDark: string;
}

const BLACK = '#0b0b0b';
const WHITE = '#ffffff';

/**
 * Categories in stack order, top first: pathogenic reds, the conflicts, uncertain amber, benign
 * greens, as the app's significance pills. Each mode validated with the dataviz palette checks
 * (lightness band, chroma, adjacent-pair color-blind and normal-vision separation) against the
 * app's backgrounds, white and oklch(16% 0.01 260). Three light fills are under 3:1 against
 * white, so every chart has its table.
 */
const CATEGORY_PAINT: Record<string, Paint> = {
  Pathogenic: { light: '#c62f2f', dark: '#e66767', inkLight: WHITE, inkDark: WHITE },
  'Likely pathogenic': { light: '#ef8c89', dark: '#ab3c3a', inkLight: BLACK, inkDark: WHITE },
  'Low penetrance / risk allele': {
    light: '#6250d6',
    dark: '#9085e9',
    inkLight: WHITE,
    inkDark: WHITE,
  },
  'Conflict: P/LP vs VUS/LB/B': {
    light: '#c0418a',
    dark: '#d55181',
    inkLight: WHITE,
    inkDark: WHITE,
  },
  VUS: { light: '#eda100', dark: '#c98500', inkLight: BLACK, inkDark: WHITE },
  'Conflict: VUS vs LB/B': { light: '#2a78d6', dark: '#3987e5', inkLight: WHITE, inkDark: WHITE },
  'Likely benign': { light: '#6cc58a', dark: '#0b7a4e', inkLight: BLACK, inkDark: WHITE },
  Benign: { light: '#008300', dark: '#4aaa3c', inkLight: WHITE, inkDark: WHITE },
};

/** Categorical slots in fixed order (the dataviz reference palette), for groups with no meaning in color. */
const SLOTS: Paint[] = [
  { light: '#2a78d6', dark: '#3987e5', inkLight: WHITE, inkDark: WHITE },
  { light: '#eb6834', dark: '#d95926', inkLight: WHITE, inkDark: WHITE },
  { light: '#1baf7a', dark: '#199e70', inkLight: WHITE, inkDark: WHITE },
  { light: '#eda100', dark: '#c98500', inkLight: BLACK, inkDark: WHITE },
];

/** Everything outside the listed categories: No classification, Unmapped. */
const NEUTRAL: Paint = { light: '#898781', dark: '#898781', inkLight: WHITE, inkDark: WHITE };

/**
 * The paint of each category, in order: the classification colors where they apply, otherwise
 * the categorical slots in order, never cycled (the figures have four groups at most).
 */
export function paints(categories: readonly string[]): Map<string, Paint> {
  const out = new Map<string, Paint>();
  const classification = categories.some((c) => c in CATEGORY_PAINT);
  let slot = 0;
  for (const name of categories) {
    if (classification || name === 'Unmapped') out.set(name, CATEGORY_PAINT[name] ?? NEUTRAL);
    else out.set(name, SLOTS[slot++] ?? NEUTRAL);
  }
  return out;
}

/** The one series of a line chart. */
export const LINE_PAINT: Paint = SLOTS[0] ?? NEUTRAL;

/**
 * Shares in percent to `decimals` places that add up to exactly 100 (largest remainder), so a
 * bar's labels never sum to 99.9 or 100.1. All zeros stay zeros.
 */
export function roundedShares(counts: readonly number[], decimals = 1): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return counts.map(() => 0);
  const unit = 10 ** decimals;
  const exact = counts.map((c) => (c / total) * 100 * unit);
  const floors = exact.map(Math.floor);
  let left = 100 * unit - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((e, i) => ({ i, rest: e - Math.floor(e) }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] = (floors[i] ?? 0) + 1;
    left--;
  }
  return floors.map((f) => f / unit);
}

const counts = new Intl.NumberFormat('en-US');

export function formatCount(n: number): string {
  return counts.format(n);
}

/** A share as text, to `decimals` places, or "<0.1%" for one that rounds to zero but isn't. */
export function formatShare(share: number, count = share, decimals = 1): string {
  if (share === 0 && count > 0) return `<${(10 ** -decimals).toFixed(decimals)}%`;
  return `${share.toFixed(decimals)}%`;
}

/** An exact share in percent, for tooltips and line charts. */
export function percent(part: number, whole: number): number {
  return whole === 0 ? 0 : (part / whole) * 100;
}

/** Axis numbers: in full under 10,000, compact (12K, 4.2M) from there. */
export function formatTick(n: number, max: number): string {
  if (max < 10_000) return formatCount(n);
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(
    n,
  );
}

/**
 * Round axis ticks covering [min, max]: about `count` steps of 1, 2 or 5 times a power of ten.
 * The axis runs from the first tick to the last.
 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    const pad = Math.abs(min) * 0.05 || 1;
    return niceTicks(min - pad, max + pad, count);
  }
  const raw = (max - min) / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find((m) => m * power >= raw) ?? 10) * power;
  const first = Math.floor(min / step);
  const last = Math.ceil(max / step);
  // Rounded so float steps (0.1 + 0.2) don't print as 0.30000000000000004.
  return Array.from({ length: last - first + 1 }, (_, i) =>
    Number(((first + i) * step).toPrecision(12)),
  );
}
