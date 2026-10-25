import { describe, expect, it } from 'vitest';
import { parseQuery, whereSql } from './parse.ts';
import { compileSummaryRows } from './summary.ts';
import { SqlParams } from './sql.ts';

function parsed(raw: Record<string, string | string[]>) {
  const result = parseQuery(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.query;
}

describe('parseQuery', () => {
  it('defaults to pathogenicity and echoes the canonical query', () => {
    const query = parsed({ submitter: ['500031', '26957'] });
    expect(query.canonical).toEqual({
      classification_type: ['PATH'],
      submitter: ['500031', '26957'],
    });
    expect(query.limit).toBe(50);
  });

  it('splits comma-separated values and negates with not.', () => {
    const query = parsed({ 'not.submitter': '500031,26957', classification_type: 'any' });
    expect(query.canonical['not.submitter']).toEqual(['500031', '26957']);
    expect(query.canonical['classification_type']).toEqual(['ANY']);
  });

  it('reports unknown filters, bad values and dimensions by parameter', () => {
    const result = parseQuery({ bogus: '1', gene: 'BRCA1', group_by: 'a,b,c' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((p) => p.path)).toEqual([
      'querystring/bogus',
      'querystring/gene',
      'querystring/group_by',
      'querystring/group_by',
      'querystring/group_by',
    ]);
  });

  it('refuses two values for a single-valued filter', () => {
    expect(parseQuery({ min_stars: ['1', '2'] }).ok).toBe(false);
  });
});

describe('whereSql', () => {
  it('binds every value as a parameter', () => {
    const params = new SqlParams();
    const sql = whereSql(parsed({ gene: '672', comment: "o'brien" }), params);
    expect(sql).not.toContain("o'brien");
    expect(params.values).toEqual([
      672,
      'within single gene',
      'within multiple genes by overlap',
      "o'brien",
      'PATH',
    ]);
    expect(sql).toContain('relationship_type IN ($2, $3)');
  });

  it('wraps a negated filter so rows with NULLs are kept', () => {
    const sql = whereSql(parsed({ 'not.method': 'research' }), new SqlParams());
    expect(sql).toContain('NOT coalesce((list_has_any(s.collection_methods, [$1])), false)');
  });
});

describe('compileSummaryRows', () => {
  it('ranks and pages the first dimension when grouping by two', () => {
    const { sql, params } = compileSummaryRows(
      parsed({ group_by: 'submitter,bucket', limit: '5' }),
    );
    expect(sql).toContain('top AS');
    expect(params.slice(0, 2)).toEqual([5, 0]);
  });
});
