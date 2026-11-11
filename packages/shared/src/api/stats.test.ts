import { describe, expect, it } from 'vitest';
import { aggregateCategory, PATH_TERM_QUALITIES, trendReleases, type PathTerm } from './stats.ts';

// classification_term's germline pathogenicity rows (packages/derive/sql/schema.sql).
const TERMS: [string, string, number][] = [
  ['p', 'Pathogenic', 2],
  ['lp', 'Likely pathogenic', 2],
  ['p/lp', 'Pathogenic/Likely pathogenic', 2],
  ['p-lp', 'Pathogenic, low penetrance', 2],
  ['lp-lp', 'Likely pathogenic, low penetrance', 2],
  ['era', 'Established risk allele', 2],
  ['lra', 'Likely risk allele', 2],
  ['vus', 'Uncertain significance', 1],
  ['vus-h', 'VUS-high', 1],
  ['vus-m', 'VUS-mid', 1],
  ['vus-l', 'VUS-low', 1],
  ['ura', 'Uncertain risk allele', 1],
  ['b', 'Benign', 0],
  ['lb', 'Likely benign', 0],
  ['b/lb', 'Benign/Likely benign', 0],
];
const terms = new Map<string, PathTerm>(
  TERMS.map(([term, label, significance]) => [
    label.toLowerCase(),
    { term, sourceCode: label.toLowerCase(), label, significance },
  ]),
);
const category = (label: string) => aggregateCategory(label, null, terms);

describe('aggregateCategory', () => {
  it('has strength and penetrance for every germline term', () => {
    expect(Object.keys(PATH_TERM_QUALITIES).sort()).toEqual(TERMS.map(([t]) => t).sort());
  });

  it('folds P/LP into Likely pathogenic and B/LB into Likely benign, as the slide does', () => {
    expect(category('Pathogenic')).toBe('Pathogenic');
    expect(category('Likely pathogenic')).toBe('Likely pathogenic');
    expect(category('Pathogenic/Likely pathogenic')).toBe('Likely pathogenic');
    expect(category('Benign')).toBe('Benign');
    expect(category('Likely benign')).toBe('Likely benign');
    expect(category('Benign/Likely benign')).toBe('Likely benign');
  });

  it('puts any low penetrance or risk allele term in its own category', () => {
    for (const label of [
      'Pathogenic, low penetrance',
      'Established risk allele',
      'Likely risk allele',
      'Pathogenic/Pathogenic, low penetrance',
      'Pathogenic/Likely pathogenic/Pathogenic, low penetrance/Established risk allele',
    ]) {
      expect(category(label)).toBe('Low penetrance / risk allele');
    }
  });

  it('counts every uncertain term, combined or not, as VUS', () => {
    for (const label of [
      'Uncertain significance',
      'VUS-high',
      'Uncertain significance/VUS-low',
      'Uncertain risk allele',
      'Uncertain significance/Uncertain risk allele',
    ]) {
      expect(category(label)).toBe('VUS');
    }
  });

  it('splits conflicts by whether a contributing SCV is on the pathogenic side', () => {
    const label = 'Conflicting classifications of pathogenicity';
    expect(aggregateCategory(label, 'clinsig', terms)).toBe('Conflict: P/LP vs VUS/LB/B');
    expect(aggregateCategory(label, 'other', terms)).toBe('Conflict: VUS vs LB/B');
    expect(aggregateCategory(label, 'unknown', terms)).toBe('Unmapped');
  });

  it('shows what no rule covers as Unmapped', () => {
    expect(category('no classifications from unflagged records')).toBe('No classification');
    expect(category('Pathogenic/Something new')).toBe('Unmapped');
    expect(category('Pathogenic/Benign')).toBe('Unmapped');
  });
});

describe('trendReleases', () => {
  const served = ['2026-06-27', '2026-07-06', '2026-07-27', '2026-08-04', '2026-08-29'];

  it('takes every release up to the last', () => {
    expect(trendReleases(served, '2026-07-27', 'release')).toEqual(served.slice(0, 3));
  });

  it("takes each month's last release, the current month's being the last asked for", () => {
    expect(trendReleases(served, '2026-08-29', 'month')).toEqual([
      '2026-06-27',
      '2026-07-27',
      '2026-08-29',
    ]);
    expect(trendReleases(served, '2026-08-04', 'month')).toEqual([
      '2026-06-27',
      '2026-07-27',
      '2026-08-04',
    ]);
  });
});
