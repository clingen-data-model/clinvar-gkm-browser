// Summaries for every resource (/scvs/summary, /scv-pairs/summary, /variants/summary): the
// compiled rows and totals, and labels for the dimension keys that appear.

import type { SummaryResponse } from '@cvb/shared/api';
import {
  compileLabels,
  compileSummaryRows,
  compileSummaryTotals,
  type ParsedQuery,
} from '@cvb/shared/query';
import { z } from 'zod';
import type { Database } from '../../data/database.ts';

const Key = z.string().nullable();

/** Counts of a resource's matching rows, grouped by up to two dimensions, with labels for their keys. */
export async function summarize(
  db: Database,
  release: string,
  query: ParsedQuery,
): Promise<Omit<SummaryResponse, 'release' | 'query'>> {
  const totalsSql = compileSummaryTotals(query);
  const totalsRow = z
    .record(z.string(), z.number().nullable())
    .parse((await db.query(release, totalsSql.sql, totalsSql.params))[0]);
  const { first_values: firstValues, ...totals } = totalsRow;
  const cleanTotals = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v ?? 0]));
  const page = { limit: query.limit, offset: query.offset, total: firstValues ?? null };
  if (query.groupBy.length === 0) {
    return { dimensions: [], rows: [], totals: cleanTotals, page };
  }

  const rowsSql = compileSummaryRows(query);
  const raw = await db.query(release, rowsSql.sql, rowsSql.params);
  const rows = raw.map((r) => {
    const out: Record<string, string | number | null> = {};
    query.groupBy.forEach((d, i) => {
      out[d.name] = Key.parse(r[`d${String(i)}`]);
    });
    for (const m of query.measures) out[m] = z.int().parse(r[m]);
    return out;
  });

  const dimensions = await Promise.all(
    query.groupBy.map(async (d) => {
      const keys = [...new Set(rows.map((r) => r[d.name]).filter((k) => typeof k === 'string'))];
      const labels: Record<string, string> = { ...(d.fixedLabels ?? {}) };
      const labelSql = compileLabels(d, keys);
      if (labelSql !== null) {
        const found = await db.query(release, labelSql.sql, labelSql.params);
        for (const row of z.array(z.object({ key: z.string(), label: z.string() })).parse(found)) {
          labels[row.key] = row.label;
        }
      }
      return { name: d.name, label: d.label, labels };
    }),
  );
  return { dimensions, rows, totals: cleanTotals, page };
}
