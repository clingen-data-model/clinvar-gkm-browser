// A field's history as a reader sees it: the values it held, and the releases in which the record
// wasn't there at all, in one sequence, so that every step from one row to the next is a change.

import type { FieldPeriod } from './entities.ts';

/** A row of a field's history: a value held over a span of releases, or the record's absence. */
export type FieldHistoryRow = FieldPeriod & { absent: boolean };

/**
 * A field's periods (oldest first, as the API gives them) with a row for each span of releases
 * the record was missing from: between two periods, and after the last if the record is gone by
 * the latest release. Not before the first: the record didn't exist yet, and the first period
 * says when it began (or that it was there by the earliest release served).
 */
export function fieldHistoryRows(periods: readonly FieldPeriod[]): FieldHistoryRow[] {
  const rows: FieldHistoryRow[] = [];
  periods.forEach((period, i) => {
    const previous = periods[i - 1];
    if (previous?.to != null && previous.to !== period.from) {
      rows.push({
        value: null,
        from: previous.to,
        to: period.from,
        fromStart: false,
        absent: true,
      });
    }
    rows.push({ ...period, absent: false });
  });
  const last = periods.at(-1);
  if (last?.to != null) {
    rows.push({ value: null, from: last.to, to: null, fromStart: false, absent: true });
  }
  return rows;
}
