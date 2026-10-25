import type { Vocabularies } from '@cvb/shared/api';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { Params } from '../../lib/api/client.ts';
import { variantListQuery } from '../../lib/api/queries.ts';
import { LEVEL_CLASS } from '../../lib/conflicts.ts';
import { Stars } from '../classification/Stars.tsx';

export const VARIANTS_PER_PAGE = 25;

export function variantConflictParams(filters: Params, page: number): Params {
  return {
    ...filters,
    min_conflict_level: '2',
    limit: VARIANTS_PER_PAGE,
    offset: (page - 1) * VARIANTS_PER_PAGE,
    count: 'true',
  };
}

/** Variants in conflict, worst first, with ClinVar's call and their submissions by significance. */
export function VariantConflictList({
  params,
  page,
  vocab,
}: {
  params: Params;
  page: number;
  vocab: Vocabularies;
}) {
  const { data } = useSuspenseQuery(variantListQuery(variantConflictParams(params, page)));
  const statuses = new Map(vocab.conflictStatuses.map((s) => [s.status, s.label]));
  const total = data.page.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / VARIANTS_PER_PAGE));
  return (
    <section aria-labelledby="conflicting-variants" className="mb-10">
      <h2 id="conflicting-variants" className="mb-3">
        Variants in conflict{' '}
        <span className="text-muted-foreground">({total.toLocaleString()})</span>
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Variant</th>
              <th className="py-2 pr-3 font-medium">Conflict</th>
              <th className="py-2 pr-3 font-medium">ClinVar&rsquo;s call</th>
              <th className="py-2 pr-3 text-right font-medium">P/LP</th>
              <th className="py-2 pr-3 text-right font-medium">VUS</th>
              <th className="py-2 pr-3 text-right font-medium">B/LB</th>
              <th className="py-2 text-right font-medium">Submitters</th>
            </tr>
          </thead>
          <tbody>
            {data.data.map((v) => (
              <tr
                key={`${String(v.variationId)}-${v.classificationType}`}
                className="border-b border-border align-top"
              >
                <td className="py-2 pr-3">
                  <Link to="/variants/$id" params={{ id: v.variationId }}>
                    {v.name}
                  </Link>
                </td>
                <td className="py-2 pr-3">
                  <span
                    className={`rounded px-1.5 text-xs whitespace-nowrap ${LEVEL_CLASS[v.conflictLevel] ?? ''}`}
                  >
                    {statuses.get(v.conflictLevel) ?? v.conflictLevel}
                  </span>
                </td>
                <td className="py-2 pr-3">
                  {v.aggregate?.classification ?? '—'} <Stars stars={v.aggregate?.stars ?? null} />
                </td>
                <td className="py-2 pr-3 text-right">{v.buckets.P}</td>
                <td className="py-2 pr-3 text-right">{v.buckets.V}</td>
                <td className="py-2 pr-3 text-right">{v.buckets.B}</td>
                <td className="py-2 text-right">{v.submitterCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 ? (
        <nav aria-label="Variant pages" className="mt-3 flex items-center gap-4 text-sm">
          {page > 1 ? (
            <Link
              to="."
              search={(s) => ({ ...s, variants_page: page - 1 })}
              hash="conflicting-variants"
            >
              Previous
            </Link>
          ) : null}
          <span className="text-muted-foreground">
            Page {page.toLocaleString()} of {pages.toLocaleString()}
          </span>
          {page < pages ? (
            <Link
              to="."
              search={(s) => ({ ...s, variants_page: page + 1 })}
              hash="conflicting-variants"
            >
              Next
            </Link>
          ) : null}
        </nav>
      ) : null}
    </section>
  );
}
