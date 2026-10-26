// WHERE clauses from applied filters, for one side of a comparison or all SCVs.

import {
  MissingColumn,
  scvColumns,
  type AppliedFilter,
  type FilterOptions,
  type Side,
} from './filters.ts';
import { SqlParams } from './sql.ts';

/** Filters that apply to `side`: unprefixed ones always, and that side's own. */
function forSide(filters: readonly AppliedFilter[], side: Side): AppliedFilter[] {
  return filters.filter((f) => f.side === 'both' || f.side === side);
}

/** The filters for `side` over the scv table (alias `t`). */
export function filterWhere(
  filters: readonly AppliedFilter[],
  options: FilterOptions,
  params: SqlParams,
  side: Side = 'both',
  t = 's',
): string {
  const ctx = { params, options, col: scvColumns(t) };
  const predicates = forSide(filters, side).map((f) => f.predicate(ctx));
  return predicates.length === 0 ? 'true' : predicates.join(' AND ');
}

/** SCV columns a stored pair holds for each side, as `<side>_<column>`. */
export const PAIR_SIDE_COLUMNS = [
  'scv_id',
  'submitter_id',
  'term',
  'review_status',
  'submission_level',
  'collection_methods',
  'date_last_evaluated',
  'date_submitted',
] as const;
const SIDE_COLUMNS = new Set<string>(PAIR_SIDE_COLUMNS);
/** SCV columns a pair shares between its sides. */
const SHARED_COLUMNS = new Set(['variation_id', 'classification_type']);

/**
 * The filters for one side of a comparison, over stored pairs (scv_classification_pair, alias
 * `p`). Each filter reads that side's columns directly; one that needs a column pairs don't carry
 * (the comment filters) selects the side's SCVs from scv instead: still a filter, not a join.
 */
export function pairFilterWhere(
  filters: readonly AppliedFilter[],
  options: FilterOptions,
  params: SqlParams,
  side: 'a' | 'b',
  p = 'p',
): string {
  const pairCol = (name: string): string => {
    if (SHARED_COLUMNS.has(name)) return `${p}.${name}`;
    if (SIDE_COLUMNS.has(name)) return `${p}.${side}_${name}`;
    throw new MissingColumn(name);
  };
  const predicates = forSide(filters, side).map((f) => {
    // Try the pair's own columns, with scratch parameters so a failed try adds none.
    try {
      f.predicate({ params: new SqlParams(), options, col: pairCol });
    } catch (error) {
      if (!(error instanceof MissingColumn)) throw error;
      const overScv = f.predicate({ params, options, col: scvColumns('s') });
      return `${p}.${side}_scv_id IN (SELECT s.scv_id FROM scv s WHERE ${overScv})`;
    }
    return f.predicate({ params, options, col: pairCol });
  });
  return predicates.length === 0 ? 'true' : predicates.join(' AND ');
}
