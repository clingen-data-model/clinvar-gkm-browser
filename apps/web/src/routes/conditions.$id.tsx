import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ClassificationCounts } from '../components/classification/ClassificationCounts.tsx';
import { ScvListSection, scvListParams } from '../components/scv/ScvListSection.tsx';
import { Page } from '../components/shell/Page.tsx';
import { Facts } from '../components/ui/Facts.tsx';
import { conditionQuery, scvListQuery, vocabulariesQuery } from '../lib/api/queries.ts';
import { PageSearch } from '../lib/page-search.ts';
import { idParams, orNotFound } from '../lib/route-params.ts';
import { useTypeLabels } from '../lib/vocabulary.ts';

export const Route = createFileRoute('/conditions/$id')({
  params: idParams,
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
  component: ConditionPage,
});

function ConditionPage() {
  const { id } = Route.useParams();
  const { page } = Route.useLoaderDeps();
  const condition = useSuspenseQuery(conditionQuery(id)).data.data;
  const typeLabels = useTypeLabels();
  return (
    <Page
      eyebrow="Condition"
      title={condition.name}
      subtitle={
        condition.medgenId === null ? undefined : (
          <a
            className="text-band-foreground"
            href={`https://www.ncbi.nlm.nih.gov/medgen/${condition.medgenId}`}
          >
            MedGen {condition.medgenId}
          </a>
        )
      }
      band={
        <Facts
          items={[
            ['Variants', condition.variantCount.toLocaleString()],
            ['Submissions', condition.scvCount.toLocaleString()],
            ...condition.xrefs
              .filter(
                (x) =>
                  x.system.includes('mondo') ||
                  x.system.includes('omim.org/') ||
                  x.system.includes('orpha'),
              )
              .slice(0, 4)
              .map((x): [string, string] => [
                x.system.includes('mondo')
                  ? 'MONDO'
                  : x.system.includes('orpha')
                    ? 'Orphanet'
                    : 'OMIM',
                x.code,
              ]),
          ]}
        />
      }
    >
      <section className="mb-10">
        <ClassificationCounts counts={condition.classifications} typeLabels={typeLabels} />
      </section>
      <ScvListSection filters={{ condition: id }} page={page} />
    </Page>
  );
}
