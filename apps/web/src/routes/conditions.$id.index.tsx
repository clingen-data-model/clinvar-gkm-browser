import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ClassificationCounts } from '../components/classification/ClassificationCounts.tsx';
import { ScvListSection, scvListParams } from '../components/scv/ScvListSection.tsx';
import { conditionQuery, scvListQuery, vocabulariesQuery } from '../lib/api/queries.ts';
import { PageSearch } from '../lib/page-search.ts';
import { orNotFound } from '../lib/route-params.ts';
import { useTypeLabels } from '../lib/vocabulary.ts';

export const Route = createFileRoute('/conditions/$id/')({
  validateSearch: PageSearch,
  loaderDeps: ({ search }) => ({ page: search.page ?? 1 }),
  loader: ({ context: { queryClient }, params, deps }) =>
    orNotFound(
      Promise.all([
        queryClient.query(conditionQuery(params.id)),
        queryClient.query(scvListQuery(scvListParams({ condition: params.id }, deps.page))),
        queryClient.query(vocabulariesQuery()),
      ]),
    ),
  component: ConditionOverview,
});

/** The Overview tab: classifications, and the condition's SCVs. */
function ConditionOverview() {
  const { id } = Route.useParams();
  const { page } = Route.useLoaderDeps();
  const condition = useSuspenseQuery(conditionQuery(id)).data.data;
  const typeLabels = useTypeLabels();
  return (
    <>
      <section className="mb-10">
        <ClassificationCounts counts={condition.classifications} typeLabels={typeLabels} />
      </section>
      <ScvListSection filters={{ condition: id }} page={page} />
    </>
  );
}
