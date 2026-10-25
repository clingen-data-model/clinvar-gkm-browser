import type { QueryClient } from '@tanstack/react-query';
import { useSuspenseQuery } from '@tanstack/react-query';
import type { Params } from '../../lib/api/client.ts';
import {
  pairListQuery,
  pairSummaryQuery,
  variantListQuery,
  variantSummaryQuery,
  vocabulariesQuery,
} from '../../lib/api/queries.ts';
import { comparisonParams, type ConflictSearch, termOf } from '../../lib/conflicts.ts';
import { ConflictOptions } from './ConflictOptions.tsx';
import { PairList, pairListParams } from './PairList.tsx';
import { Scorecard } from './Scorecard.tsx';
import { TermGrid } from './TermGrid.tsx';
import { VariantConflictList, variantConflictParams } from './VariantConflictList.tsx';

/**
 * The requests behind a gene's or condition's Conflicts tab. Its filters apply to every
 * submission alike, so pairs have no sides: each pair appears once, in either order.
 */
function requests(filters: Params, search: ConflictSearch) {
  const base = { ...filters, ...comparisonParams(search) };
  return {
    base,
    scorecard: { ...base, group_by: 'conflict_level' },
    grid: { ...base, group_by: 'a.term,b.term', measure: 'variants', limit: 500 },
    pairs: { ...base, terms: search.terms },
  };
}

export async function prefetchEntityConflicts(
  queryClient: QueryClient,
  filters: Params,
  search: ConflictSearch,
): Promise<void> {
  const r = requests(filters, search);
  await Promise.all([
    queryClient.query(vocabulariesQuery()),
    queryClient.query(variantSummaryQuery(r.scorecard)),
    queryClient.query(pairSummaryQuery(r.grid)),
    queryClient.query(variantListQuery(variantConflictParams(r.base, search.variants_page ?? 1))),
    queryClient.query(
      pairListQuery(pairListParams(r.pairs, search.pairs_page ?? 1, search.show !== 'all')),
    ),
  ]);
}

/** Conflicts among all submissions on a gene's or condition's variants. */
export function EntityConflicts({ filters, search }: { filters: Params; search: ConflictSearch }) {
  const vocab = useSuspenseQuery(vocabulariesQuery()).data.data;
  const r = requests(filters, search);
  const scorecard = useSuspenseQuery(variantSummaryQuery(r.scorecard)).data;
  const grid = useSuspenseQuery(pairSummaryQuery(r.grid)).data;
  const cell = search.terms?.split(',');
  const cellLabel = (code: string | undefined) =>
    code === undefined ? '' : (termOf(vocab, `PATH:${code}`)?.label ?? code);
  return (
    <>
      <ConflictOptions search={search} sides={null} />
      <Scorecard summary={scorecard} vocab={vocab} />
      <TermGrid
        summary={grid}
        vocab={vocab}
        sides={null}
        selected={cell?.length === 2 ? [cell[0] ?? '', cell[1] ?? ''] : null}
      />
      <VariantConflictList params={r.base} page={search.variants_page ?? 1} vocab={vocab} />
      <PairList
        params={r.pairs}
        page={search.pairs_page ?? 1}
        conflictsOnly={search.show !== 'all'}
        vocab={vocab}
        sides={['Submission', 'Submission']}
        showSubmitterA
        narrowedTo={
          cell?.length === 2
            ? {
                label: `${cellLabel(cell[0])} vs ${cellLabel(cell[1])}`,
                clear: { terms: undefined },
              }
            : undefined
        }
      />
    </>
  );
}
