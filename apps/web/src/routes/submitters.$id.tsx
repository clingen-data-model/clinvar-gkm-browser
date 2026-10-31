import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, Outlet, useMatchRoute } from '@tanstack/react-router';
import { Page } from '../components/shell/Page.tsx';
import {
  PageTabs,
  pageTabActiveClassName,
  pageTabClassName,
} from '../components/shell/PageTabs.tsx';
import { Facts } from '../components/ui/Facts.tsx';
import { submitterQuery, vocabulariesQuery } from '../lib/api/queries.ts';
import { idParams, orNotFound } from '../lib/route-params.ts';
import { useRelease } from '../lib/release.ts';

/** A submitter's page: the band and its tabs, with the tab's content below. */
export const Route = createFileRoute('/submitters/$id')({
  params: idParams,
  loader: ({ context: { queryClient, release }, params }) =>
    orNotFound(
      Promise.all([
        queryClient.query(submitterQuery(release, params.id)),
        queryClient.query(vocabulariesQuery(release)),
      ]),
    ),
  component: SubmitterLayout,
});

function SubmitterLayout() {
  const release = useRelease();
  const { id } = Route.useParams();
  const submitter = useSuspenseQuery(submitterQuery(release, id)).data.data;
  // A head-to-head is part of the Conflicts tab, though not its route.
  const headToHead = useMatchRoute()({ to: '/submitters/$id/vs/$otherId', fuzzy: true }) !== false;
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
                activeOptions={{ exact: true, includeSearch: false }}
                className={pageTabClassName}
              >
                Overview
              </Link>
            </li>
            <li>
              <Link
                to="/submitters/$id/conflicts"
                params={{ id }}
                className={`${pageTabClassName} ${headToHead ? pageTabActiveClassName : ''}`}
                aria-current={headToHead ? 'page' : undefined}
              >
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
