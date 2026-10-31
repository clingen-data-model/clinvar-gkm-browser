import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ConflictOptions } from '../components/conflicts/ConflictOptions.tsx';
import { LabTable, labTableParams, labTotalsParams } from '../components/conflicts/LabTable.tsx';
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
import { searchOf } from '../lib/route-search.ts';
import { comparisonParams, ConflictSearch, termOf } from '../lib/conflicts.ts';
import { useRelease } from '../lib/release.ts';

/** One lab against every other: its conflicts, its classifications against theirs, and the labs. */
export const Route = createFileRoute('/submitters/$id/conflicts')({
  validateSearch: ConflictSearch,
  // URL state isn't in loaderDeps (lib/route-search.ts), so rerun on every change of it.
  shouldReload: true,
  loader: async ({ context: { queryClient, release }, params, location }) => {
    const deps = searchOf(ConflictSearch, location);
    const base = { 'a.submitter': params.id, ...comparisonParams(deps) };
    await Promise.all([
      queryClient.query(variantSummaryQuery(release, { ...base, group_by: 'conflict_level' })),
      queryClient.query(pairSummaryQuery(release, gridParams(base))),
      queryClient
        .query(pairSummaryQuery(release, labTableParams(base, deps.labs_page ?? 1, deps.labs_q)))
        .then((levels) =>
          Promise.all(
            labTotalsParams(base, levels).map((p) =>
              queryClient.query(pairSummaryQuery(release, p)),
            ),
          ),
        ),
      queryClient.query(
        pairListQuery(
          release,
          pairListParams(pairParams(base, deps), deps.pairs_page ?? 1, deps.show !== 'all'),
        ),
      ),
    ]);
  },
  component: SubmitterConflicts,
});

function gridParams(base: Record<string, string | number | undefined>) {
  return { ...base, group_by: 'a.term,b.term', measure: 'variants', limit: 500 };
}

function pairParams(base: Record<string, string | number | undefined>, search: ConflictSearch) {
  return { ...base, 'a.term': search['a.term'], 'b.term': search['b.term'] };
}

function SubmitterConflicts() {
  const release = useRelease();
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const name = useSuspenseQuery(submitterQuery(release, id)).data.data.name;
  const vocab = useSuspenseQuery(vocabulariesQuery(release)).data.data;
  const base = { 'a.submitter': id, ...comparisonParams(search) };
  const scorecard = useSuspenseQuery(
    variantSummaryQuery(release, { ...base, group_by: 'conflict_level' }),
  ).data;
  const grid = useSuspenseQuery(pairSummaryQuery(release, gridParams(base))).data;
  const cell =
    search['a.term'] !== undefined && search['b.term'] !== undefined
      ? ([search['a.term'], search['b.term']] as const)
      : null;
  const cellLabel = (code: string) => termOf(vocab, `PATH:${code}`)?.label ?? code;
  return (
    <>
      <title>{`${name}: conflicts | ClinVar GKM browser`}</title>
      <ConflictOptions sides={[`Submissions from ${name}`, 'Other submissions']} />
      <Scorecard summary={scorecard} vocab={vocab} singleLabel="Only this lab" />
      <TermGrid
        summary={grid}
        vocab={vocab}
        sides={[name, 'other labs']}
        selected={cell === null ? null : [cell[0], cell[1]]}
      />
      <LabTable base={base} submitterId={id} page={search.labs_page ?? 1} q={search.labs_q} />
      <PairList
        params={pairParams(base, search)}
        page={search.pairs_page ?? 1}
        conflictsOnly={search.show !== 'all'}
        vocab={vocab}
        sides={[name, 'Other lab']}
        showSubmitterA={false}
        narrowedTo={
          cell === null
            ? undefined
            : {
                label: `${cellLabel(cell[0])} vs ${cellLabel(cell[1])}`,
                clear: { 'a.term': undefined, 'b.term': undefined },
              }
        }
      />
    </>
  );
}
