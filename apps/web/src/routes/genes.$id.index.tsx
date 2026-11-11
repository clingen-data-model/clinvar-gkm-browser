import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { ClassificationCounts } from '../components/classification/ClassificationCounts.tsx';
import { SubmitterCounts, submitterCountsParams } from '../components/gene/SubmitterCounts.tsx';
import { ScvListSection, scvListParams } from '../components/scv/ScvListSection.tsx';
import { geneQuery, scvListQuery, scvSummaryQuery, vocabulariesQuery } from '../lib/api/queries.ts';
import { PageSearch } from '../lib/page-search.ts';
import { orNotFound } from '../lib/route-params.ts';
import { searchOf } from '../lib/route-search.ts';
import { useTypeLabels } from '../lib/vocabulary.ts';
import { GeneSearch, geneFilters, relationshipsOf } from '../lib/gene.ts';
import { useRelease } from '../lib/release.ts';

/** The Overview tab's own state: the SCV list's page, and the submitter table's search and page. */
const OverviewSearch = PageSearch.extend({
  submitters_q: z.string().min(1).optional().catch(undefined),
  submitters_page: z.coerce.number().int().min(1).optional().catch(undefined),
});

export const Route = createFileRoute('/genes/$id/')({
  validateSearch: OverviewSearch,
  // URL state isn't in loaderDeps (lib/route-search.ts), so rerun on every change of it.
  shouldReload: true,
  loader: ({ context: { queryClient, release }, params, location }) => {
    const search = searchOf(OverviewSearch, location);
    const relationships = relationshipsOf(searchOf(GeneSearch, location).gene_relationship);
    const filters = geneFilters(params.id, relationships);
    return orNotFound(
      Promise.all([
        queryClient.query(geneQuery(release, params.id, relationships)),
        queryClient.query(
          scvSummaryQuery(
            release,
            submitterCountsParams(filters, search.submitters_page ?? 1, search.submitters_q),
          ),
        ),
        queryClient.query(scvListQuery(release, scvListParams(filters, search.page ?? 1))),
        queryClient.query(vocabulariesQuery(release)),
      ]),
    );
  },
  component: GeneOverview,
});

/** The Overview tab: submitters and their classifications, classification totals, and the SCVs. */
function GeneOverview() {
  const release = useRelease();
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const page = search.page ?? 1;
  const relationships = relationshipsOf(search.gene_relationship);
  const gene = useSuspenseQuery(geneQuery(release, id, relationships)).data.data;
  const vocab = useSuspenseQuery(vocabulariesQuery(release)).data.data;
  const typeLabels = useTypeLabels();
  const filters = geneFilters(id, relationships);
  return (
    <>
      <SubmitterCounts
        filters={filters}
        vocab={vocab}
        page={search.submitters_page ?? 1}
        q={search.submitters_q}
      />
      <section className="mb-10">
        <ClassificationCounts counts={gene.classifications} typeLabels={typeLabels} />
      </section>
      <ScvListSection filters={filters} page={page} />
    </>
  );
}
