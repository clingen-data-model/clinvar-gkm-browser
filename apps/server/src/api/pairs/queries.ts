// /scv-pairs: a page of pairs from the pair base, then both sides' SCV rows, read together for
// the page's variants (scv is sorted by variant, so that's a narrow read).

import type { PairRow } from '@cvb/shared/api';
import { ScvRow } from '@cvb/shared/api';
import { SqlParams, type ParsedQuery } from '@cvb/shared/query';
import { z } from 'zod';
import type { Database } from '../../data/database.ts';
import { SCV_ROW_COLUMNS, SCV_ROW_JOINS } from '../scvs/queries.ts';

/** Sort keys a pair list accepts. Every sort ends with the pair's identity, for stable pages. */
const PAIR_SORTS: Record<string, string> = {
  level: 's.level',
  variant: 's.variation_id',
  a_evaluated: 's.a_date_last_evaluated',
  b_evaluated: 's.b_date_last_evaluated',
};

export function pairOrder(sort: string[]): { sql: string; unknown: string[] } {
  const parts: string[] = [];
  const unknown: string[] = [];
  for (const key of sort.length === 0 ? ['-level'] : sort) {
    const desc = key.startsWith('-');
    const name = desc ? key.slice(1) : key;
    // Own keys only: `constructor` and the like aren't sorts.
    const column = Object.hasOwn(PAIR_SORTS, name) ? PAIR_SORTS[name] : undefined;
    if (column === undefined) unknown.push(key);
    else parts.push(`${column} ${desc ? 'DESC NULLS LAST' : 'ASC NULLS LAST'}`);
  }
  parts.push('s.variation_id', 's.a_scv_id', 's.b_scv_id');
  return { sql: parts.join(', '), unknown };
}

const PageRow = z.object({
  variation_id: z.int(),
  classification_type: z.string(),
  level: z.int().nullable(),
  a_scv_id: z.int(),
  b_scv_id: z.int(),
});

function baseInput(query: ParsedQuery) {
  return {
    filters: query.filters,
    filterOptions: { geneRelationships: query.geneRelationships },
    pair: query.pair,
  };
}

export async function listPairs(
  db: Database,
  release: string,
  query: ParsedQuery,
  order: string,
): Promise<{ rows: PairRow[]; total: number | null }> {
  const params = new SqlParams();
  const base = query.resource.base(baseInput(query), params);
  const limit = params.add(query.limit);
  const offset = params.add(query.offset);
  const pageSql = `WITH ${base}
    SELECT s.variation_id, s.classification_type, s.level, s.a_scv_id, s.b_scv_id
    FROM base s ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`;
  let total: Promise<number | null> = Promise.resolve(null);
  if (query.count) {
    const countParams = new SqlParams();
    const countBase = query.resource.base(baseInput(query), countParams);
    total = db
      .query(
        release,
        `WITH ${countBase} SELECT count(*)::INTEGER AS n FROM base`,
        countParams.values,
      )
      .then((rows) => z.object({ n: z.int() }).parse(rows[0]).n);
  }
  const [pageRows, n] = await Promise.all([db.query(release, pageSql, params.values), total]);
  const page = z.array(PageRow).parse(pageRows);
  if (page.length === 0) return { rows: [], total: n };

  const variants = [...new Set(page.map((p) => p.variation_id))];
  const scvIds = [...new Set(page.flatMap((p) => [p.a_scv_id, p.b_scv_id]))];
  const rowParams = new SqlParams();
  const [scvRows, names] = await Promise.all([
    db.query(
      release,
      `SELECT ${SCV_ROW_COLUMNS} FROM scv s ${SCV_ROW_JOINS}
       WHERE s.variation_id IN (${rowParams.list(variants)}) AND s.scv_id IN (${rowParams.list(scvIds)})`,
      rowParams.values,
    ),
    // The page's variant IDs are this query's parameters $1..$n.
    db.query(
      release,
      `SELECT variation_id, name FROM variant WHERE variation_id IN (${new SqlParams().list(variants)})`,
      variants,
    ),
  ]);
  const scvs = new Map(
    z
      .array(ScvRow)
      .parse(scvRows)
      .map((r) => [r.scvId, r]),
  );
  const nameOf = new Map(
    z
      .array(z.object({ variation_id: z.int(), name: z.string() }))
      .parse(names)
      .map((r) => [r.variation_id, r.name]),
  );
  const rows = page.flatMap((p) => {
    const a = scvs.get(p.a_scv_id);
    const b = scvs.get(p.b_scv_id);
    if (a === undefined || b === undefined) return [];
    return [
      {
        variationId: p.variation_id,
        variantName: nameOf.get(p.variation_id) ?? '',
        classificationType: p.classification_type,
        level: p.level,
        a,
        b,
      },
    ];
  });
  return { rows, total: n };
}
