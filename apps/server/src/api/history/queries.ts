// Reads over every release served (docs/history.md#in-the-app): the rows of a table ever held,
// each with valid_from and valid_to, grouped into versions or into the periods of a field.

import { FieldPeriod, type AggregateHistory, type ScvHistory } from '@cvb/shared/api';
import { SqlParams } from '@cvb/shared/query';
import { z } from 'zod';
import type { Database } from '../../data/database.ts';

const Span = z.object({ from: z.iso.date(), to: z.iso.date().nullable() });

/** SQL for the release span of grouped history rows, as `from` and `to`. */
export const SPAN_COLUMNS = `
  strftime(min(valid_from), '%Y-%m-%d') AS "from",
  CASE WHEN bool_or(valid_to IS NULL) THEN NULL ELSE strftime(max(valid_to), '%Y-%m-%d') END AS "to"`;

/** Marks the spans that start at the earliest release served (they may be older). */
export function fromStart<T extends z.infer<typeof Span>>(db: Database, rows: T[]) {
  const earliest = db.earliest();
  return rows.map((r) => ({ ...r, fromStart: r.from === earliest }));
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

interface PeriodsOf {
  table: string;
  /** Columns naming one record, which holds at most one row in any release. */
  key: string[];
  /** Columns whose periods to read. */
  fields: string[];
  /** A condition on the table's rows (alias `t`), its values bound through `params`. */
  where: (params: SqlParams) => string;
}

const PeriodRow = Span.extend({ field: z.string(), value: z.string().nullable() });

/**
 * The periods of each field of each record matched: runs of consecutive rows with the same
 * value, oldest first. A release without the record ends a period, so a span never covers a
 * release the record wasn't in. Every row counts, including one whose only change is in a
 * column not asked for (it continues the period).
 */
async function periods(
  db: Database,
  release: string,
  { table, key, fields, where }: PeriodsOf,
): Promise<(z.infer<typeof PeriodRow> & Record<string, unknown>)[]> {
  for (const c of [...key, ...fields]) {
    if (!IDENTIFIER.test(c)) throw new Error(`not a column name: ${c}`);
  }
  const keys = key.map((k) => `t.${k} AS ${k}`).join(', ');
  const by = key.join(', ');
  const params = new SqlParams();
  const condition = where(params);
  // One row per record, field and release span, with the field's value as text.
  const unpivoted = fields
    .map(
      (f) =>
        `SELECT ${keys}, '${f}' AS field, t.${f}::VARCHAR AS value, t.valid_from AS valid_from, t.valid_to AS valid_to
         FROM ${db.rowsEver(table)} t WHERE ${condition}`,
    )
    .join(' UNION ALL ');
  const rows = await db.query(
    release,
    `WITH r AS (${unpivoted}),
     marked AS (
       SELECT *,
              CASE WHEN lag(valid_to) OVER w IS DISTINCT FROM valid_from
                     OR lag(value) OVER w IS DISTINCT FROM value THEN 1 ELSE 0 END AS starts
       FROM r WINDOW w AS (PARTITION BY ${by}, field ORDER BY valid_from)
     ),
     numbered AS (
       SELECT *, sum(starts) OVER (PARTITION BY ${by}, field ORDER BY valid_from) AS period FROM marked
     )
     SELECT ${key.map((k) => `${k} AS ${k}`).join(', ')}, field AS field, any_value(value) AS value, ${SPAN_COLUMNS}
     FROM numbered GROUP BY ${by}, field, period
     ORDER BY ${by}, field, min(valid_from)`,
    params.values,
  );
  return rows.map((row) => ({ ...row, ...PeriodRow.parse(row) }));
}

/**
 * The periods of a variant's aggregate classification and review status, per classification
 * type. A new VCV version names its statements anew, so a root is found by its columns.
 */
export async function aggregateHistory(
  db: Database,
  release: string,
  variationId: number,
): Promise<AggregateHistory[]> {
  const rows = await periods(db, release, {
    table: 'vcv_statement',
    key: ['variation_id', 'classification_type'],
    fields: ['classification', 'review_status'],
    where: (params) => `t.variation_id = ${params.add(variationId)} AND t.node_kind = 'root'`,
  });
  const marked = fromStart(db, rows);
  const types = new Map<string, AggregateHistory>();
  for (const row of marked) {
    const type = z.string().parse(row['classification_type']);
    const entry = types.get(type) ?? {
      classificationType: type,
      classification: [],
      reviewStatus: [],
    };
    types.set(type, entry);
    const period = FieldPeriod.parse(row);
    if (row.field === 'classification') entry.classification.push(period);
    else entry.reviewStatus.push(period);
  }
  return [...types.values()].sort((a, b) =>
    a.classificationType.localeCompare(b.classificationType),
  );
}

/** The periods of each SCV's classification, for the SCVs named that any release served has. */
export async function scvHistory(
  db: Database,
  release: string,
  scvIds: number[],
): Promise<ScvHistory[]> {
  const rows = await periods(db, release, {
    table: 'scv',
    key: ['scv_id'],
    fields: ['classification'],
    where: (params) => `t.scv_id IN (${params.list(scvIds)})`,
  });
  const scvs = new Map<number, ScvHistory>();
  for (const row of fromStart(db, rows)) {
    const scvId = z.int().parse(row['scv_id']);
    const entry = scvs.get(scvId) ?? { scvId, classification: [] };
    scvs.set(scvId, entry);
    entry.classification.push(FieldPeriod.parse(row));
  }
  return [...scvs.values()];
}
