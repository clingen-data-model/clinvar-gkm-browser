import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';
import { Page } from '../components/shell/Page.tsx';
import { PageTabs, pageTabClassName } from '../components/shell/PageTabs.tsx';
import { Facts } from '../components/ui/Facts.tsx';
import { submitterQuery, vocabulariesQuery } from '../lib/api/queries.ts';
import { idParams, orNotFound } from '../lib/route-params.ts';

/** A submitter's page: the band and its tabs, with the tab's content below. */
export const Route = createFileRoute('/submitters/$id')({
  params: idParams,
  loader: ({ context: { queryClient }, params }) =>
    orNotFound(
      Promise.all([
        queryClient.query(submitterQuery(params.id)),
        queryClient.query(vocabulariesQuery()),
      ]),
    ),
  component: SubmitterLayout,
});

function SubmitterLayout() {
  const { id } = Route.useParams();
  const submitter = useSuspenseQuery(submitterQuery(id)).data.data;
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
        <>
          <Facts
            items={[
              ['Variants', submitter.variantCount.toLocaleString()],
              ['Submissions', submitter.scvCount.toLocaleString()],
            ]}
          />
          <PageTabs label="Submitter sections">
            <li>
              <Link
                to="/submitters/$id"
                params={{ id }}
                activeOptions={{ exact: true }}
                className={pageTabClassName}
              >
                Overview
              </Link>
            </li>
            <li>
              <Link to="/submitters/$id/conflicts" params={{ id }} className={pageTabClassName}>
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
