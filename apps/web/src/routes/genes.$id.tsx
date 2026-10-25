import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ClassificationCounts } from '../components/classification/ClassificationCounts.tsx';
import { ScvListSection, scvListParams } from '../components/scv/ScvListSection.tsx';
import { Page } from '../components/shell/Page.tsx';
import { Facts } from '../components/ui/Facts.tsx';
import { geneQuery, scvListQuery, vocabulariesQuery } from '../lib/api/queries.ts';
import { PageSearch } from '../lib/page-search.ts';
import { RelationshipSelector } from '../components/gene/RelationshipSelector.tsx';
import { parseGeneRelationships } from '@cvb/shared/query';
import { z } from 'zod';
import { idParams, orNotFound } from '../lib/route-params.ts';
import { useTypeLabels } from '../lib/vocabulary.ts';

export const Route = createFileRoute('/genes/$id')({
  params: idParams,
  validateSearch: PageSearch.extend({ gene_relationship: z.string().optional().catch(undefined) }),
  loaderDeps: ({ search }) => {
    const parsed = parseGeneRelationships(search.gene_relationship);
    return {
      page: search.page ?? 1,
      relationships: parsed.ok ? parsed.value : ['single', 'overlap'],
    };
  },
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
  component: GenePage,
});

function geneFilters(id: number, relationships: readonly string[]) {
  return { gene: id, gene_relationship: relationships.join(',') };
}

function GenePage() {
  const { id } = Route.useParams();
  const { page, relationships } = Route.useLoaderDeps();
  const gene = useSuspenseQuery(geneQuery(id, relationships)).data.data;
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
        <div className="space-y-3">
          <Facts
            items={[
              ['Variants', gene.variantCount.toLocaleString()],
              ['Submissions', gene.scvCount.toLocaleString()],
            ]}
          />
          <RelationshipSelector
            key={gene.relationships.join(',')}
            counts={gene.relationshipCounts}
            selected={gene.relationships}
          />
        </div>
      }
    >
      <section className="mb-10">
        <ClassificationCounts counts={gene.classifications} typeLabels={typeLabels} />
      </section>
      <ScvListSection filters={geneFilters(id, relationships)} page={page} />
    </Page>
  );
}
