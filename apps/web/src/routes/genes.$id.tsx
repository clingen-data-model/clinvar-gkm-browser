import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';
import { RelationshipSelector } from '../components/gene/RelationshipSelector.tsx';
import { Page } from '../components/shell/Page.tsx';
import { PageTabs, pageTabClassName } from '../components/shell/PageTabs.tsx';
import { Facts } from '../components/ui/Facts.tsx';
import { geneQuery, vocabulariesQuery } from '../lib/api/queries.ts';
import { GeneSearch, relationshipsOf } from '../lib/gene.ts';
import { idParams, orNotFound } from '../lib/route-params.ts';
import { searchOf } from '../lib/route-search.ts';

/** A gene's page: the band, its relationship selector and tabs, with the tab's content below. */
export const Route = createFileRoute('/genes/$id')({
  params: idParams,
  validateSearch: GeneSearch,
  // URL state isn't in loaderDeps (lib/route-search.ts), so rerun on every change of it.
  shouldReload: true,
  loader: ({ context: { queryClient }, params, location }) =>
    orNotFound(
      Promise.all([
        queryClient.query(
          geneQuery(params.id, relationshipsOf(searchOf(GeneSearch, location).gene_relationship)),
        ),
        queryClient.query(vocabulariesQuery()),
      ]),
    ),
  component: GeneLayout,
});

function GeneLayout() {
  const { id } = Route.useParams();
  const relationships = relationshipsOf(Route.useSearch().gene_relationship);
  const gene = useSuspenseQuery(geneQuery(id, relationships)).data.data;
  // Tabs keep the relationship selection and drop the other tab's state.
  const keep = (s: { gene_relationship?: string | undefined }) => ({
    gene_relationship: s.gene_relationship,
  });
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
          <PageTabs label="Gene sections">
            <li>
              <Link
                to="/genes/$id"
                params={{ id }}
                search={keep}
                activeOptions={{ exact: true, includeSearch: false }}
                className={pageTabClassName}
              >
                Overview
              </Link>
            </li>
            <li>
              <Link
                to="/genes/$id/conflicts"
                params={{ id }}
                search={keep}
                activeOptions={{ includeSearch: false }}
                className={pageTabClassName}
              >
                Conflicts
              </Link>
            </li>
          </PageTabs>
        </div>
      }
    >
      <Outlet />
    </Page>
  );
}
