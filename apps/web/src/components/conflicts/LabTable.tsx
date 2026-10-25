import type { SummaryResponse } from '@cvb/shared/api';
import { useSuspenseQueries, useSuspenseQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import type { Params } from '../../lib/api/client.ts';
import { pairSummaryQuery } from '../../lib/api/queries.ts';
import { count } from '../../lib/text.ts';

export const LABS_PER_PAGE = 20;

/** The three requests behind the table, so a route loader can prefetch the first. */
export function labTableParams(base: Params, page: number, q: string | undefined): Params {
  return {
    ...base,
    group_by: 'b.submitter,conflict_level',
    measure: 'variants',
    min_conflict_level: '2',
    limit: LABS_PER_PAGE,
    offset: (page - 1) * LABS_PER_PAGE,
    match: q,
  };
}

/** Per-lab totals for the page's labs: conflicting variants, and all shared variants. */
export function labTotalsParams(base: Params, levels: SummaryResponse): [Params, Params] {
  const labs = [...new Set(levels.rows.map((r) => String(r['b.submitter'])))];
  const perLab = (min: string | undefined) => ({
    ...base,
    'b.submitter': labs.join(','),
    group_by: 'b.submitter',
    measure: 'variants',
    min_conflict_level: min,
    limit: 500,
  });
  return [perLab('2'), perLab(undefined)];
}

interface Props {
  /** Filters with a.submitter set: the lab whose table this is. */
  base: Params;
  submitterId: number;
  page: number;
  q: string | undefined;
}

/**
 * Every other lab with a conflict against this one, most conflicting variants first: per lab,
 * variants by conflict level, the variants they share, and the share in conflict. Each lab links
 * to a head-to-head comparison.
 */
export function LabTable({ base, submitterId, page, q }: Props) {
  const navigate = useNavigate();
  const [text, setText] = useState(q ?? '');
  const levels = useSuspenseQuery(pairSummaryQuery(labTableParams(base, page, q))).data;
  const labs = [...new Set(levels.rows.map((r) => String(r['b.submitter'])))];
  const [conflicting, shared] = useSuspenseQueries({
    queries: labTotalsParams(base, levels).map((p) => pairSummaryQuery(p)),
  }).map((q) => q.data);
  if (conflicting === undefined || shared === undefined) return null;
  const valueOf = (rows: typeof levels.rows, lab: string, level?: string) =>
    Number(
      rows.find(
        (r) =>
          String(r['b.submitter']) === lab &&
          (level === undefined || r['conflict_level'] === level),
      )?.['variants'] ?? 0,
    );
  const names = levels.dimensions[0]?.labels ?? {};
  const total = levels.page.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / LABS_PER_PAGE));
  return (
    <section aria-labelledby="labs" className="mb-10">
      <h2 id="labs" className="mb-1">
        Labs it conflicts with
      </h2>
      <p className="mb-3 text-sm text-muted-foreground">
        {count(total, 'lab')} with at least one conflict (confidence or worse), most conflicting
        variants first. Select a lab to compare the two.
      </p>
      <form
        role="search"
        className="mb-3"
        onSubmit={(e) => {
          e.preventDefault();
          void navigate({
            to: '.',
            search: (s) => ({ ...s, labs_q: text.trim() || undefined, labs_page: undefined }),
            replace: true,
          });
        }}
      >
        <label className="text-sm">
          Find a lab{' '}
          <input
            type="search"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
            }}
            className="ml-1 rounded border border-border bg-background px-2 py-1"
          />
        </label>
      </form>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Lab</th>
              <th className="py-2 pr-3 text-right font-medium">Shared variants</th>
              <th className="py-2 pr-3 text-right font-medium">In conflict</th>
              <th className="bg-level-2 px-2 py-2 text-right font-medium">Confidence</th>
              <th className="bg-level-3 px-2 py-2 text-right font-medium">B/LB vs VUS</th>
              <th className="bg-level-5 px-2 py-2 text-right font-medium">
                Clinically significant
              </th>
            </tr>
          </thead>
          <tbody>
            {labs.map((lab) => {
              const sharedN = valueOf(shared.rows, lab);
              const conflictN = valueOf(conflicting.rows, lab);
              return (
                <tr key={lab} className="border-b border-border">
                  <td className="py-2 pr-3">
                    <Link
                      to="/submitters/$id/vs/$otherId"
                      params={{ id: submitterId, otherId: Number(lab) }}
                    >
                      {names[lab] ?? `Submitter ${lab}`}
                    </Link>
                  </td>
                  <td className="py-2 pr-3 text-right">{sharedN.toLocaleString()}</td>
                  <td className="py-2 pr-3 text-right">
                    {conflictN.toLocaleString()}{' '}
                    <span className="text-muted-foreground">
                      ({sharedN === 0 ? '0' : ((100 * conflictN) / sharedN).toFixed(1)}%)
                    </span>
                  </td>
                  {['2', '3', '5'].map((level) => (
                    <td key={level} className="px-2 py-2 text-right">
                      {valueOf(levels.rows, lab, level).toLocaleString()}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pages > 1 ? (
        <nav aria-label="Lab pages" className="mt-3 flex items-center gap-4 text-sm">
          {page > 1 ? (
            <Link to="." search={(s) => ({ ...s, labs_page: page - 1 })} hash="labs">
              Previous
            </Link>
          ) : null}
          <span className="text-muted-foreground">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link to="." search={(s) => ({ ...s, labs_page: page + 1 })} hash="labs">
              Next
            </Link>
          ) : null}
        </nav>
      ) : null}
    </section>
  );
}
