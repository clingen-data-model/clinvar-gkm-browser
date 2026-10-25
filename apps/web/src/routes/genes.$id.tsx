import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ClassificationCounts } from '../components/classification/ClassificationCounts.tsx';
import { ScvListSection, scvListParams } from '../components/scv/ScvListSection.tsx';
import { Page } from '../components/shell/Page.tsx';
import { Facts } from '../components/ui/Facts.tsx';
import { geneQuery, scvListQuery, vocabulariesQuery } from '../lib/api/queries.ts';
import { PageSearch } from '../lib/page-search.ts';
import { idParams, orNotFound } from '../lib/route-params.ts';
import { useTypeLabels } from '../lib/vocabulary.ts';

export const Route = createFileRoute('/genes/$id')({
  params: idParams,
  validateSearch: PageSearch,
  loaderDeps: ({ search }) => ({ page: search.page ?? 1 }),
  loader: ({ context: { queryClient }, params, deps }) =>
    orNotFound(
      Promise.all([
        queryClient.query(geneQuery(params.id)),
        queryClient.query(scvListQuery(scvListParams({ gene: params.id }, deps.page))),
        queryClient.query(vocabulariesQuery()),
      ]),
    ),
  component: GenePage,
});

function GenePage() {
  const { id } = Route.useParams();
  const { page } = Route.useLoaderDeps();
  const gene = useSuspenseQuery(geneQuery(id)).data.data;
  const typeLabels = useTypeLabels();
  return (
    <Page
      eyebrow="Gene"
      title={gene.symbol}
      subtitle={
        <a
          className="text-band-foreground"
          href={`https://www.ncbi.nlm.nih.gov/gene/${String(id)}`}
        >
          NCBI Gene {id}
        </a>
      }
      band={
        <Facts
          items={[
            ['Variants within the gene', gene.variantCount.toLocaleString()],
            ['Submissions', gene.scvCount.toLocaleString()],
          ]}
        />
      }
    >
      <section className="mb-10">
        <ClassificationCounts counts={gene.classifications} typeLabels={typeLabels} />
      </section>
      <ScvListSection filters={{ gene: id }} page={page} />
    </Page>
  );
}
