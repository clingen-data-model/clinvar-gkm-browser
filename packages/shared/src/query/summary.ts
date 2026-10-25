// Summary SQL (docs/api.md#summaries): counts of the filtered SCVs, grouped by up to two
// dimensions. The filtered rows are a CTE with only the columns dimensions read; each dimension
// adds its join. With two dimensions, the first is ranked by the first measure and paged, and
// rows are returned for those values only.

import { MEASURES, type Dimension } from './dimensions.ts';
import type { FilterContext } from './filters.ts';
import { whereSql, type ParsedQuery } from './parse.ts';
import { SqlParams, type SqlValue } from './sql.ts';

export interface CompiledSql {
  sql: string;
  params: SqlValue[];
}

const BASE_COLUMNS = `s.scv_id, s.variation_id, s.submitter_id, s.classification_type, s.term,
  s.review_status, s.submission_level, s.collection_methods, s.date_last_evaluated, s.date_submitted`;

function base(query: ParsedQuery, params: SqlParams): string {
  return `base AS (SELECT ${BASE_COLUMNS} FROM scv s WHERE ${whereSql(query, params)})`;
}

function context(query: ParsedQuery, params: SqlParams): FilterContext {
  return { params, options: { geneRelationships: query.geneRelationships } };
}

function measures(query: ParsedQuery): string {
  return query.measures.map((m) => `${MEASURES[m]} AS ${m}`).join(', ');
}

/** Rows: one per combination of dimension values, with the requested measures. */
export function compileSummaryRows(query: ParsedQuery): CompiledSql {
  const params = new SqlParams();
  const ctx = context(query, params);
  const [first, second] = query.groupBy;
  if (first === undefined) throw new Error('compileSummaryRows needs a dimension');
  const order = query.measures[0] ?? 'scvs';
  const limit = params.add(query.limit);
  const offset = params.add(query.offset);
  const withBase = base(query, params);

  const join = (d: Dimension, alias: string) => d.join(alias, ctx);
  if (second === undefined) {
    return {
      sql: `WITH ${withBase}
        SELECT ${first.key('d0')} AS d0, ${measures(query)}
        FROM base s ${join(first, 'd0')}
        GROUP BY 1
        ORDER BY ${order} DESC, d0 NULLS LAST
        LIMIT ${limit} OFFSET ${offset}`,
      params: params.values,
    };
  }
  return {
    sql: `WITH ${withBase},
      top AS (
        SELECT ${first.key('d0')} AS d0, ${MEASURES[order]} AS rank_measure
        FROM base s ${join(first, 'd0')}
        GROUP BY 1
        ORDER BY rank_measure DESC, d0 NULLS LAST
        LIMIT ${limit} OFFSET ${offset}
      )
      SELECT ${first.key('d0')} AS d0, ${second.key('d1')} AS d1, ${measures(query)}
      FROM base s ${join(first, 'd0')} ${join(second, 'd1')}
      WHERE ${first.key('d0')} IN (SELECT d0 FROM top) OR (${first.key('d0')} IS NULL AND EXISTS (SELECT 1 FROM top WHERE d0 IS NULL))
      GROUP BY 1, 2
      ORDER BY (SELECT rank_measure FROM top WHERE top.d0 IS NOT DISTINCT FROM ${first.key('d0')}) DESC, d0 NULLS LAST, ${order} DESC, d1 NULLS LAST`,
    params: params.values,
  };
}

/** Totals over all filtered SCVs, and how many values the first dimension has (for paging). */
export function compileSummaryTotals(query: ParsedQuery): CompiledSql {
  const params = new SqlParams();
  const ctx = context(query, params);
  const withBase = base(query, params);
  const first = query.groupBy[0];
  const distinctFirst =
    first === undefined
      ? 'NULL::INTEGER AS first_values'
      : `(SELECT count(DISTINCT ${first.key('d0')})::INTEGER FROM base s ${first.join('d0', ctx)}) AS first_values`;
  return {
    sql: `WITH ${withBase} SELECT ${measures(query)}, ${distinctFirst} FROM base s`,
    params: params.values,
  };
}

/** Labels for a dimension's keys, or null if its keys are their own labels. */
export function compileLabels(dimension: Dimension, keys: string[]): CompiledSql | null {
  if (dimension.labels === null || keys.length === 0) return null;
  const params = new SqlParams();
  return { sql: dimension.labels(params.list(keys)), params: params.values };
}
