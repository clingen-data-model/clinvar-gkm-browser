// WHERE clauses from applied filters, for one side of a comparison or all SCVs.

import type { AppliedFilter, FilterOptions, Side } from './filters.ts';
import type { SqlParams } from './sql.ts';

/** Filters that apply to `side`: unprefixed ones always, and that side's own. */
export function filterWhere(
  filters: readonly AppliedFilter[],
  options: FilterOptions,
  params: SqlParams,
  side: Side = 'both',
  t = 's',
): string {
  const ctx = { params, options, t };
  const predicates = filters
    .filter((f) => f.side === 'both' || f.side === side)
    .map((f) => f.predicate(ctx));
  return predicates.length === 0 ? 'true' : predicates.join(' AND ');
}
