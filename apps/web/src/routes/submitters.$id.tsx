import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ClassificationCounts } from '../components/classification/ClassificationCounts.tsx';
import { ScvListSection, scvListParams } from '../components/scv/ScvListSection.tsx';
import { Page } from '../components/shell/Page.tsx';
import { Facts } from '../components/ui/Facts.tsx';
import { submitterQuery, scvListQuery, vocabulariesQuery } from '../lib/api/queries.ts';
import { PageSearch } from '../lib/page-search.ts';
import { idParams, orNotFound } from '../lib/route-params.ts';
import { useTypeLabels } from '../lib/vocabulary.ts';

export const Route = createFileRoute('/submitters/$id')({
  params: idParams,
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
  component: SubmitterPage,
});

function SubmitterPage() {
  const { id } = Route.useParams();
  const { page } = Route.useLoaderDeps();
  const submitter = useSuspenseQuery(submitterQuery(id)).data.data;
  const typeLabels = useTypeLabels();
  return (
    <Page
      eyebrow="Submitter"
      title={submitter.name}
      subtitle={
        <a
          className="text-band-foreground"
          href={`https://www.ncbi.nlm.nih.gov/clinvar/submitters/${String(id)}/`}
        >
          ClinVar submitter {id}
        </a>
      }
      band={
        <Facts
          items={[
            ['Variants', submitter.variantCount.toLocaleString()],
            ['Submissions', submitter.scvCount.toLocaleString()],
          ]}
        />
      }
    >
      <section className="mb-10">
        <ClassificationCounts counts={submitter.classifications} typeLabels={typeLabels} />
      </section>
      <ScvListSection filters={{ submitter: id }} page={page} />
    </Page>
  );
}
