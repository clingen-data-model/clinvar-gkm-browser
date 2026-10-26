// Summary SQL (docs/api.md#summaries): counts of a resource's rows, grouped by up to two
// dimensions. The resource's base CTE holds the filtered rows; each dimension adds its join. With
// two dimensions, the first is ranked by the first measure and paged, and rows are returned for
// those values only. `match` keeps first-dimension values whose label contains the text.

import type { Dimension } from './dimensions.ts';
import { scvColumns, type FilterContext } from './filters.ts';
import type { ParsedQuery } from './parse.ts';
import { SqlParams, type SqlValue } from './sql.ts';

export interface CompiledSql {
  sql: string;
  params: SqlValue[];
}

function base(query: ParsedQuery, params: SqlParams): string {
  return query.resource.base(
    {
      filters: query.filters,
      filterOptions: { geneRelationships: query.geneRelationships },
      pair: query.pair,
    },
    params,
  );
}

function context(query: ParsedQuery, params: SqlParams): FilterContext {
  return { params, options: { geneRelationships: query.geneRelationships }, col: scvColumns('s') };
}

function measureSql(query: ParsedQuery, measure: string): string {
  return query.resource.measures[measure] ?? 'NULL';
}

function measures(query: ParsedQuery): string {
  return query.measures.map((m) => `${measureSql(query, m)} AS ${m}`).join(', ');
}

/**
 * A condition keeping the first dimension's values whose label (or key, for dimensions that
 * label themselves) contains `match`.
 */
function matchWhere(
  first: Dimension,
  query: ParsedQuery,
  params: SqlParams,
  ctx: FilterContext,
): string {
  if (query.match === null) return 'true';
  const text = params.add(query.match);
  const key = first.key('d0');
  if (first.labels === null) {
    const needle = query.match.toLowerCase();
    const fixed = Object.entries(first.fixedLabels ?? {})
      .filter(([, label]) => label.toLowerCase().includes(needle))
      .map(([k]) => k);
    const fixedSql = fixed.length === 0 ? '' : ` OR ${key} IN (${params.list(fixed)})`;
    return `(${key} ILIKE '%' || ${text} || '%'${fixedSql})`;
  }
  // The dimension's labels for the keys present, filtered by the text.
  const present = `SELECT DISTINCT ${first.key('m0')} FROM base s ${first.join('m0', ctx)}`;
  return `${key} IN (SELECT key FROM (${first.labels(present)}) WHERE label ILIKE '%' || ${text} || '%')`;
}

/** Rows: one per combination of dimension values, with the requested measures. */
export function compileSummaryRows(query: ParsedQuery): CompiledSql {
  const params = new SqlParams();
  const ctx = context(query, params);
  const [first, second] = query.groupBy;
  if (first === undefined) throw new Error('compileSummaryRows needs a dimension');
  const order = query.measures[0] ?? query.resource.defaultMeasure;
  const withBase = base(query, params);
  const join = (d: Dimension, alias: string) => d.join(alias, ctx);
  const firstJoin = join(first, 'd0');
  const match = matchWhere(first, query, params, ctx);
  const limit = params.add(query.limit);
  const offset = params.add(query.offset);

  if (second === undefined) {
    return {
      sql: `WITH ${withBase}
        SELECT ${first.key('d0')} AS d0, ${measures(query)}
        FROM base s ${firstJoin}
        WHERE ${match}
        GROUP BY 1
        ORDER BY ${order} DESC, d0 NULLS LAST
        LIMIT ${limit} OFFSET ${offset}`,
      params: params.values,
    };
  }
  return {
    sql: `WITH ${withBase},
      top AS (
        SELECT ${first.key('d0')} AS d0, ${measureSql(query, order)} AS rank_measure
        FROM base s ${firstJoin}
        WHERE ${match}
        GROUP BY 1
        ORDER BY rank_measure DESC, d0 NULLS LAST
        LIMIT ${limit} OFFSET ${offset}
      ),
      grouped AS (
        SELECT ${first.key('d0')} AS d0, ${second.key('d1')} AS d1, ${measures(query)}
        FROM base s ${firstJoin} ${join(second, 'd1')}
        WHERE ${first.key('d0')} IN (SELECT d0 FROM top) OR (${first.key('d0')} IS NULL AND EXISTS (SELECT 1 FROM top WHERE d0 IS NULL))
        GROUP BY 1, 2
      )
      SELECT g.* FROM grouped g LEFT JOIN top t ON t.d0 IS NOT DISTINCT FROM g.d0
      ORDER BY t.rank_measure DESC, g.d0 NULLS LAST, g.${order} DESC, g.d1 NULLS LAST`,
    params: params.values,
  };
}

/** Totals over all filtered rows, and how many values the first dimension has (for paging). */
export function compileSummaryTotals(query: ParsedQuery): CompiledSql {
  const params = new SqlParams();
  const ctx = context(query, params);
  const withBase = base(query, params);
  const first = query.groupBy[0];
  const distinctFirst =
    first === undefined
      ? 'NULL::INTEGER AS first_values'
      : // count(DISTINCT) skips NULL, which the rows have as a group of its own.
        `(SELECT (count(DISTINCT k) + CASE WHEN bool_or(k IS NULL) THEN 1 ELSE 0 END)::INTEGER
          FROM (SELECT ${first.key('d0')} AS k FROM base s ${first.join('d0', ctx)}
                WHERE ${matchWhere(first, query, params, ctx)})) AS first_values`;
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
