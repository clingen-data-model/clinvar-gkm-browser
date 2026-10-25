import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ClassificationCounts } from '../components/classification/ClassificationCounts.tsx';
import { ScvListSection, scvListParams } from '../components/scv/ScvListSection.tsx';
import { geneQuery, scvListQuery, vocabulariesQuery } from '../lib/api/queries.ts';
import { PageSearch } from '../lib/page-search.ts';
import { orNotFound } from '../lib/route-params.ts';
import { searchOf } from '../lib/route-search.ts';
import { useTypeLabels } from '../lib/vocabulary.ts';
import { GeneSearch, geneFilters, relationshipsOf } from '../lib/gene.ts';

export const Route = createFileRoute('/genes/$id/')({
  validateSearch: PageSearch,
  // URL state isn't in loaderDeps (lib/route-search.ts), so rerun on every change of it.
  shouldReload: true,
  loader: ({ context: { queryClient }, params, location }) => {
    const deps = {
      page: searchOf(PageSearch, location).page ?? 1,
      relationships: relationshipsOf(searchOf(GeneSearch, location).gene_relationship),
    };
    return orNotFound(
      Promise.all([
        queryClient.query(geneQuery(params.id, deps.relationships)),
        queryClient.query(
          scvListQuery(scvListParams(geneFilters(params.id, deps.relationships), deps.page)),
        ),
        queryClient.query(vocabulariesQuery()),
      ]),
    );
  },
  component: GeneOverview,
});

/** The Overview tab: classifications, and the gene's SCVs. */
function GeneOverview() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const page = search.page ?? 1;
  const relationships = relationshipsOf(search.gene_relationship);
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
