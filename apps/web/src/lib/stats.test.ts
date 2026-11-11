import { describe, expect, it } from 'vitest';
import { formatShare, niceTicks, paints, roundedShares } from './stats.ts';

describe('roundedShares', () => {
  it('adds up to exactly 100.0', () => {
    for (const counts of [
      [1, 1, 1],
      [220113, 182782, 299, 31131, 2423161, 151098, 1227981, 198046, 145],
      [2, 3, 5, 7, 11, 13],
    ]) {
      const shares = roundedShares(counts);
      expect(Math.round(shares.reduce((a, b) => a + b, 0) * 10)).toBe(1000);
    }
    expect(roundedShares([1, 1, 1])).toEqual([33.4, 33.3, 33.3]);
  });

  it('keeps zeros, and an empty whole all zeros', () => {
    expect(roundedShares([0, 5, 0])).toEqual([0, 100, 0]);
    expect(roundedShares([0, 0])).toEqual([0, 0]);
  });
});

describe('formatShare', () => {
  it('shows a share that rounds to zero but is not as under 0.1%', () => {
    expect(formatShare(0, 145)).toBe('<0.1%');
    expect(formatShare(0, 0)).toBe('0.0%');
    expect(formatShare(55.4)).toBe('55.4%');
  });
});

describe('niceTicks', () => {
  it('covers the range with round steps', () => {
    expect(niceTicks(0, 7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(3_212_822, 3_384_722)).toEqual([
      3_200_000, 3_250_000, 3_300_000, 3_350_000, 3_400_000,
    ]);
    expect(niceTicks(0.7, 0.72)).toEqual([0.7, 0.705, 0.71, 0.715, 0.72]);
  });

  it('pads a flat series', () => {
    const ticks = niceTicks(5, 5);
    expect(ticks[0]).toBeLessThan(5);
    expect(ticks.at(-1)).toBeGreaterThan(5);
  });
});

describe('paints', () => {
  it('gives classification categories their colors, and other groups slots in order', () => {
    const classes = paints(['Pathogenic', 'VUS', 'No classification']);
    expect(classes.get('Pathogenic')?.light).toBe('#c62f2f');
    expect(classes.get('No classification')?.light).toBe('#898781');
    const groups = paints(['A', 'B', 'Unmapped']);
    expect(groups.get('A')?.light).toBe('#2a78d6');
    expect(groups.get('B')?.light).toBe('#eb6834');
    expect(groups.get('Unmapped')?.light).toBe('#898781');
  });
});
