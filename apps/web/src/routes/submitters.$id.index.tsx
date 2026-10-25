import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ClassificationCounts } from '../components/classification/ClassificationCounts.tsx';
import { ScvListSection, scvListParams } from '../components/scv/ScvListSection.tsx';
import { submitterQuery, scvListQuery, vocabulariesQuery } from '../lib/api/queries.ts';
import { PageSearch } from '../lib/page-search.ts';
import { orNotFound } from '../lib/route-params.ts';
import { useTypeLabels } from '../lib/vocabulary.ts';

export const Route = createFileRoute('/submitters/$id/')({
  validateSearch: PageSearch,
  loaderDeps: ({ search }) => ({ page: search.page ?? 1 }),
  loader: ({ context: { queryClient }, params, deps }) =>
    orNotFound(
      Promise.all([
        queryClient.query(submitterQuery(params.id)),
        queryClient.query(scvListQuery(scvListParams({ submitter: params.id }, deps.page))),
        queryClient.query(vocabulariesQuery()),
      ]),
    ),
  component: SubmitterOverview,
});

/** The Overview tab: classifications, and the submitter's SCVs. */
function SubmitterOverview() {
  const { id } = Route.useParams();
  const { page } = Route.useLoaderDeps();
  const submitter = useSuspenseQuery(submitterQuery(id)).data.data;
  const typeLabels = useTypeLabels();
  return (
    <>
      <section className="mb-10">
        <ClassificationCounts counts={submitter.classifications} typeLabels={typeLabels} />
      </section>
      <ScvListSection filters={{ submitter: id }} page={page} />
    </>
  );
}
