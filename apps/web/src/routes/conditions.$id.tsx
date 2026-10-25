import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';
import { Page } from '../components/shell/Page.tsx';
import { PageTabs, pageTabClassName } from '../components/shell/PageTabs.tsx';
import { Facts } from '../components/ui/Facts.tsx';
import { conditionQuery, vocabulariesQuery } from '../lib/api/queries.ts';
import { idParams, orNotFound } from '../lib/route-params.ts';

/** A condition's page: the band and its tabs, with the tab's content below. */
export const Route = createFileRoute('/conditions/$id')({
  params: idParams,
  loader: ({ context: { queryClient }, params }) =>
    orNotFound(
      Promise.all([
        queryClient.query(conditionQuery(params.id)),
        queryClient.query(vocabulariesQuery()),
      ]),
    ),
  component: ConditionLayout,
});

function ConditionLayout() {
  const { id } = Route.useParams();
  const condition = useSuspenseQuery(conditionQuery(id)).data.data;
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
        <>
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
          <PageTabs label="Condition sections">
            <li>
              <Link
                to="/conditions/$id"
                params={{ id }}
                activeOptions={{ exact: true }}
                className={pageTabClassName}
              >
                Overview
              </Link>
            </li>
            <li>
              <Link to="/conditions/$id/conflicts" params={{ id }} className={pageTabClassName}>
                Conflicts
              </Link>
            </li>
          </PageTabs>
        </>
      }
    >
      <Outlet />
    </Page>
  );
}
