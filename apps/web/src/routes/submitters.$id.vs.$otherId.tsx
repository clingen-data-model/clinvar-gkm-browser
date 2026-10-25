import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, notFound } from '@tanstack/react-router';
import { ArrowLeftRight } from 'lucide-react';
import { ConflictOptions } from '../components/conflicts/ConflictOptions.tsx';
import { PairList, pairListParams } from '../components/conflicts/PairList.tsx';
import { Scorecard } from '../components/conflicts/Scorecard.tsx';
import { TermGrid } from '../components/conflicts/TermGrid.tsx';
import {
  pairListQuery,
  pairSummaryQuery,
  submitterQuery,
  variantSummaryQuery,
  vocabulariesQuery,
} from '../lib/api/queries.ts';
import { comparisonParams, ConflictSearch, keepComparison, termOf } from '../lib/conflicts.ts';
import { orNotFound } from '../lib/route-params.ts';

/** Two labs head to head: where they overlap, how their classifications compare, and the pairs. */
export const Route = createFileRoute('/submitters/$id/vs/$otherId')({
  params: {
    parse: ({ otherId }: { otherId: string }) => {
      const n = Number(otherId);
      if (!Number.isInteger(n) || n <= 0) throw notFound();
      return { otherId: n };
    },
    stringify: ({ otherId }: { otherId: number }) => ({ otherId: String(otherId) }),
  },
  validateSearch: ConflictSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ context: { queryClient }, params, deps }) => {
    const base = baseParams(params.id, params.otherId, deps);
    return orNotFound(
      Promise.all([
        queryClient.query(submitterQuery(params.otherId)),
        queryClient.query(variantSummaryQuery({ ...base, group_by: 'conflict_level' })),
        queryClient.query(pairSummaryQuery(gridParams(base))),
        queryClient.query(
          pairListQuery(
            pairListParams(
              pairParams(base, deps, params.id === params.otherId),
              deps.pairs_page ?? 1,
              deps.show !== 'all',
            ),
          ),
        ),
      ]),
    );
  },
  component: HeadToHead,
});

function baseParams(id: number, otherId: number, search: ConflictSearch) {
  // Comparing a lab with itself pairs its own submissions.
  return {
    'a.submitter': id,
    'b.submitter': otherId,
    distinct_submitters: id === otherId ? 'false' : undefined,
    ...comparisonParams(search),
  };
}

function gridParams(base: Record<string, string | number | undefined>) {
  return { ...base, group_by: 'a.term,b.term', measure: 'variants', limit: 500 };
}

/**
 * The pair list's filters: the grid cell selected, if any. A lab compared with itself has no
 * sides, so its grid's cells mean a pair of terms in either order (`terms`).
 */
function pairParams(
  base: Record<string, string | number | undefined>,
  search: ConflictSearch,
  self: boolean,
) {
  return self
    ? { ...base, terms: search.terms }
    : { ...base, 'a.term': search['a.term'], 'b.term': search['b.term'] };
}

function selectedCell(search: ConflictSearch, self: boolean): [string, string] | null {
  const [a, b] = self ? (search.terms?.split(',') ?? []) : [search['a.term'], search['b.term']];
  return a === undefined || b === undefined ? null : [a, b];
}

function HeadToHead() {
  const { id, otherId } = Route.useParams();
  const search = Route.useSearch();
  const name = useSuspenseQuery(submitterQuery(id)).data.data.name;
  const other = useSuspenseQuery(submitterQuery(otherId)).data.data.name;
  const vocab = useSuspenseQuery(vocabulariesQuery()).data.data;
  const base = baseParams(id, otherId, search);
  const scorecard = useSuspenseQuery(
    variantSummaryQuery({ ...base, group_by: 'conflict_level' }),
  ).data;
  const grid = useSuspenseQuery(pairSummaryQuery(gridParams(base))).data;
  const self = id === otherId;
  const cell = selectedCell(search, self);
  const cellLabel = (code: string) => termOf(vocab, `PATH:${code}`)?.label ?? code;
  return (
    <>
      <title>{`${name} vs ${other} | ClinVar GKM browser`}</title>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-4">
        <h2>
          {self ? (
            'Compared with itself'
          ) : (
            <>
              Compared with{' '}
              <Link to="/submitters/$id" params={{ id: otherId }}>
                {other}
              </Link>
            </>
          )}
        </h2>
        <div className="flex gap-4 text-sm">
          {self ? null : (
            <Link
              to="/submitters/$id/vs/$otherId"
              params={{ id: otherId, otherId: id }}
              search={(s) => ({
                ...s,
                'a.min_stars': s['b.min_stars'],
                'b.min_stars': s['a.min_stars'],
                'a.method': s['b.method'],
                'b.method': s['a.method'],
                'a.term': s['b.term'],
                'b.term': s['a.term'],
              })}
              className="inline-flex items-center gap-1"
            >
              <ArrowLeftRight aria-hidden="true" className="size-4" /> Swap sides
            </Link>
          )}
          <Link to="/submitters/$id/conflicts" params={{ id }} search={keepComparison}>
            All labs
          </Link>
        </div>
      </div>
      <ConflictOptions
        search={search}
        sides={[`Submissions from ${name}`, `Submissions from ${other}`]}
      />
      <Scorecard summary={scorecard} vocab={vocab} sharedOnly />
      <TermGrid summary={grid} vocab={vocab} sides={self ? null : [name, other]} selected={cell} />
      <PairList
        params={pairParams(base, search, self)}
        page={search.pairs_page ?? 1}
        conflictsOnly={search.show !== 'all'}
        vocab={vocab}
        sides={self ? ['One submission', 'The other'] : [name, other]}
        showSubmitterA={false}
        narrowedTo={
          cell === null
            ? undefined
            : {
                label: `${cellLabel(cell[0])} vs ${cellLabel(cell[1])}`,
                clear: self ? { terms: undefined } : { 'a.term': undefined, 'b.term': undefined },
              }
        }
      />
    </>
  );
}
