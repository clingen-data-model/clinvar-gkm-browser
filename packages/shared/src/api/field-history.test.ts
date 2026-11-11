import { describe, expect, it } from 'vitest';
import type { FieldPeriod } from './entities.ts';
import { fieldHistoryRows } from './field-history.ts';

const period = (value: string | null, from: string, to: string | null, fromStart = false) =>
  ({ value, from, to, fromStart }) satisfies FieldPeriod;
const summary = (periods: FieldPeriod[]) =>
  fieldHistoryRows(periods).map(
    (r) => `${r.absent ? 'none' : (r.value ?? 'null')} ${r.from}..${r.to ?? 'latest'}`,
  );

describe('fieldHistoryRows', () => {
  it('leaves consecutive periods as they are', () => {
    expect(
      summary([period('VUS', '2026-06-27', '2026-07-06', true), period('LP', '2026-07-06', null)]),
    ).toEqual(['VUS 2026-06-27..2026-07-06', 'LP 2026-07-06..latest']);
  });

  it('adds a row for releases the record was missing from, between periods of one value', () => {
    // As variant 3942's Affects call: it goes when OMIM's one Affects SCV says Pathogenic.
    expect(
      summary([
        period('Affects', '2026-06-27', '2026-07-06', true),
        period('Affects', '2026-07-20', null),
      ]),
    ).toEqual([
      'Affects 2026-06-27..2026-07-06',
      'none 2026-07-06..2026-07-20',
      'Affects 2026-07-20..latest',
    ]);
  });

  it('makes a return with another value two steps, not one', () => {
    expect(
      fieldHistoryRows([period('VUS', '2026-06-27', '2026-07-06'), period('P', '2026-07-20', null)])
        .length,
    ).toBe(3);
  });

  it('ends with a row when the record is gone by the latest release, and starts with none', () => {
    expect(
      summary([period('P', '2026-08-16', '2026-09-05'), period('LP', '2026-09-05', '2026-10-24')]),
    ).toEqual(['P 2026-08-16..2026-09-05', 'LP 2026-09-05..2026-10-24', 'none 2026-10-24..latest']);
  });

  it('gives one row for a value held throughout, and none for no periods', () => {
    expect(summary([period('B', '2026-06-27', null, true)])).toEqual(['B 2026-06-27..latest']);
    expect(fieldHistoryRows([])).toEqual([]);
  });

  it('keeps a null value apart from the record being absent', () => {
    const rows = fieldHistoryRows([
      period(null, '2026-06-27', '2026-07-06'),
      period('VUS', '2026-07-06', null),
    ]);
    expect(rows.map((r) => r.absent)).toEqual([false, false]);
  });
});
