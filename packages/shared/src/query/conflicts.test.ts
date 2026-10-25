import { describe, expect, it } from 'vitest';
import { parseQuery } from './parse.ts';
import { compileSummaryRows } from './summary.ts';

function parsed(raw: Record<string, string | string[]>, resource: 'pairs' | 'variants' | 'scvs') {
  const result = parseQuery(raw, resource);
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.query;
}

describe('side filters and pair options', () => {
  it('accepts a./b. filters on pairs and variants, not on SCVs', () => {
    expect(parseQuery({ 'a.submitter': '1' }, 'pairs').ok).toBe(true);
    expect(parseQuery({ 'not.b.submitter': '1' }, 'variants').ok).toBe(true);
    const scvs = parseQuery({ 'a.submitter': '1', condition_match: 'any' }, 'scvs');
    expect(scvs.ok).toBe(false);
    if (scvs.ok) return;
    expect(scvs.problems.map((p) => p.path)).toEqual([
      'querystring/a.submitter',
      'querystring/condition_match',
    ]);
  });

  it('defaults to strict conditions, flagged SCVs excluded, distinct submitters', () => {
    const query = parsed({}, 'pairs');
    expect(query.pair).toMatchObject({
      conditionMatch: 'strict',
      excludeFlagged: true,
      distinctSubmitters: true,
      directed: false,
    });
    expect(query.canonical).toMatchObject({ condition_match: ['strict'], flagged: ['exclude'] });
    expect(query.measures).toEqual(['pairs']);
  });

  it('is directed when the sides are filtered differently, not when they match', () => {
    expect(parsed({ 'a.submitter': '1' }, 'pairs').pair.directed).toBe(true);
    // A lab against itself: both sides alike, so each pair once.
    const self = parsed(
      { 'a.submitter': '1', 'b.submitter': '1', distinct_submitters: 'false' },
      'pairs',
    );
    expect(self.pair).toMatchObject({ directed: false, distinctSubmitters: false });
  });

  it('validates levels for each resource', () => {
    expect(parseQuery({ conflict_level: '5' }, 'pairs').ok).toBe(true);
    expect(parseQuery({ conflict_level: 'single' }, 'pairs').ok).toBe(false);
    expect(parseQuery({ conflict_level: 'single,5' }, 'variants').ok).toBe(true);
    expect(parseQuery({ condition_match: 'loose' }, 'pairs').ok).toBe(false);
  });

  it('groups pairs by either side', () => {
    const query = parsed({ group_by: 'a.term,b.submitter' }, 'pairs');
    expect(query.groupBy.map((d) => d.name)).toEqual(['a.term', 'b.submitter']);
    expect(parseQuery({ group_by: 'a.term' }, 'scvs').ok).toBe(false);
  });

  it('requires a dimension for match', () => {
    expect(parseQuery({ match: 'brca' }, 'scvs').ok).toBe(false);
    expect(parseQuery({ match: 'brca', group_by: 'gene' }, 'scvs').ok).toBe(true);
  });
});

describe('pair SQL', () => {
  it('matches conditions by the chosen rule', () => {
    const sql = (condition_match: string) =>
      compileSummaryRows(parsed({ group_by: 'conflict_level', condition_match }, 'pairs')).sql;
    expect(sql('strict')).toContain('list_has_any(a.condition_ids, b.condition_ids)');
    expect(sql('wildcard')).toContain('a.condition_unspecified OR b.condition_unspecified');
    expect(sql('any')).not.toContain('list_has_any');
  });

  it('pairs each SCV once without sides, and directs them with sides', () => {
    const undirected = compileSummaryRows(parsed({ group_by: 'conflict_level' }, 'pairs')).sql;
    expect(undirected).toContain('a.scv_id < b.scv_id');
    const directed = compileSummaryRows(
      parsed({ group_by: 'b.submitter', 'a.submitter': '1' }, 'pairs'),
    ).sql;
    expect(directed).toContain('a.scv_id <> b.scv_id');
    expect(directed).toContain('s.b_submitter_id::VARCHAR');
  });
});

describe('unordered term pairs', () => {
  it('takes two codes on pairs only', () => {
    expect(parseQuery({ terms: 'lp,vus' }, 'pairs').ok).toBe(true);
    expect(parseQuery({ terms: 'lp' }, 'pairs').ok).toBe(false);
    expect(parseQuery({ terms: 'lp,vus' }, 'variants').ok).toBe(false);
    const sql = compileSummaryRows(
      parsed({ terms: 'lp,vus', group_by: 'conflict_level' }, 'pairs'),
    );
    expect(sql.sql).toMatch(/a_term = \$\d+ AND b_term = \$\d+\) OR \(a_term/);
  });
});
