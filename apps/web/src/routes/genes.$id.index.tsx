import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ClassificationCounts } from '../components/classification/ClassificationCounts.tsx';
import { ScvListSection, scvListParams } from '../components/scv/ScvListSection.tsx';
import { geneQuery, scvListQuery, vocabulariesQuery } from '../lib/api/queries.ts';
import { PageSearch } from '../lib/page-search.ts';
import { orNotFound } from '../lib/route-params.ts';
import { useTypeLabels } from '../lib/vocabulary.ts';
import { geneFilters, relationshipsOf } from '../lib/gene.ts';

export const Route = createFileRoute('/genes/$id/')({
  validateSearch: PageSearch,
  loaderDeps: ({ search }) => ({
    page: search.page ?? 1,
    relationships: relationshipsOf(search.gene_relationship),
  }),
  loader: ({ context: { queryClient }, params, deps }) =>
    orNotFound(
      Promise.all([
        queryClient.query(geneQuery(params.id, deps.relationships)),
        queryClient.query(
          scvListQuery(scvListParams(geneFilters(params.id, deps.relationships), deps.page)),
        ),
        queryClient.query(vocabulariesQuery()),
      ]),
    ),
  component: GeneOverview,
});

/** The Overview tab: classifications, and the gene's SCVs. */
function GeneOverview() {
  const { id } = Route.useParams();
  const { page, relationships } = Route.useLoaderDeps();
  const gene = useSuspenseQuery(geneQuery(id, relationships)).data.data;
  const typeLabels = useTypeLabels();
  return (
    <>
      <section className="mb-10">
        <ClassificationCounts counts={gene.classifications} typeLabels={typeLabels} />
      </section>
      <ScvListSection filters={geneFilters(id, relationships)} page={page} />
    </>
  );
}
