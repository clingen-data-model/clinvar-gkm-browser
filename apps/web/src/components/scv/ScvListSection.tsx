import { useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { Params } from '../../lib/api/client.ts';
import { scvListQuery } from '../../lib/api/queries.ts';
import { useTypeLabels } from '../../lib/vocabulary.ts';
import { ScvTable } from './ScvTable.tsx';

export const PAGE_SIZE = 50;

/**
 * A page of the SCVs matching `filters`, newest evaluation first, with links to the next and
 * previous pages through the `page` search parameter of the current route.
 */
export function ScvListSection({ filters, page }: { filters: Params; page: number }) {
  const typeLabels = useTypeLabels();
  const { data } = useSuspenseQuery(scvListQuery(scvListParams(filters, page)));
  const total = data.page.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <section aria-labelledby="scvs">
      <h2 id="scvs" className="mb-3">
        Submissions <span className="text-muted-foreground">({total.toLocaleString()})</span>
      </h2>
      <ScvTable rows={data.data} showVariant typeLabels={typeLabels} />
      <nav aria-label="Pages" className="mt-4 flex items-center gap-4 text-sm">
        {page > 1 ? (
          <Link to="." search={(s) => ({ ...s, page: String(page - 1) })}>
            Previous
          </Link>
        ) : null}
        <span className="text-muted-foreground">
          Page {page.toLocaleString()} of {pages.toLocaleString()}
        </span>
        {page < pages ? (
          <Link to="." search={(s) => ({ ...s, page: String(page + 1) })}>
            Next
          </Link>
        ) : null}
      </nav>
    </section>
  );
}

export function scvListParams(filters: Params, page: number): Params {
  return {
    ...filters,
    classification_type: 'any',
    sort: '-evaluated',
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    count: 'true',
  };
}
