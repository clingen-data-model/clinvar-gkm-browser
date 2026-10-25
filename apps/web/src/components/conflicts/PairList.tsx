import type { ScvRow, Vocabularies } from '@cvb/shared/api';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { Params } from '../../lib/api/client.ts';
import { pairListQuery } from '../../lib/api/queries.ts';
import { LEVEL_CLASS } from '../../lib/conflicts.ts';
import { Stars } from '../classification/Stars.tsx';
import { TermPill } from '../classification/TermPill.tsx';

export const PAIRS_PER_PAGE = 25;

export function pairListParams(filters: Params, page: number, conflictsOnly: boolean): Params {
  return {
    ...filters,
    min_conflict_level: conflictsOnly ? '2' : undefined,
    limit: PAIRS_PER_PAGE,
    offset: (page - 1) * PAIRS_PER_PAGE,
    count: 'true',
  };
}

function Side({ scv, showSubmitter }: { scv: ScvRow; showSubmitter: boolean }) {
  return (
    <div className="space-y-1">
      {showSubmitter ? (
        <Link to="/submitters/$id" params={{ id: scv.submitter.submitterId }} className="block">
          {scv.submitter.name}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <TermPill label={scv.termLabel} bucket={scv.bucket} submitted={scv.classification} />
        <Stars stars={scv.stars} />
        <Link to="/scvs/$id" params={{ id: scv.scvId }} className="text-xs">
          {scv.accession}
        </Link>
      </div>
      <div className="text-xs text-muted-foreground">
        {scv.conditions.map((c) => c.name).join('; ')}
        {scv.dateLastEvaluated === null ? '' : ` · evaluated ${scv.dateLastEvaluated}`}
      </div>
      {scv.comment === null ? null : (
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">Comment</summary>
          <p className="mt-1 max-w-prose text-xs whitespace-pre-line">{scv.comment}</p>
        </details>
      )}
    </div>
  );
}

interface Props {
  params: Params;
  page: number;
  conflictsOnly: boolean;
  vocab: Vocabularies;
  /** Column headings for the two sides. */
  sides: [string, string];
  /** Show the submitter on side A (off when side A is one lab). */
  showSubmitterA: boolean;
  /** What the list is limited to, e.g. "Likely pathogenic vs VUS", with a link to clear it. */
  narrowedTo?: { label: string; clear: Record<string, undefined> } | undefined;
}

/** Pairs of submissions, both side by side, worst conflicts first. */
export function PairList({
  params,
  page,
  conflictsOnly,
  vocab,
  sides,
  showSubmitterA,
  narrowedTo,
}: Props) {
  const { data } = useSuspenseQuery(pairListQuery(pairListParams(params, page, conflictsOnly)));
  const levels = new Map(vocab.conflictLevels.map((l) => [l.level, l.label]));
  const total = data.page.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAIRS_PER_PAGE));
  return (
    <section aria-labelledby="pairs" className="mb-10">
      <h2 id="pairs" className="mb-1">
        {conflictsOnly ? 'Conflicting submissions' : 'Submissions compared'}{' '}
        <span className="text-muted-foreground">({total.toLocaleString()})</span>
      </h2>
      <div className="mb-3 flex flex-wrap gap-x-4 text-sm">
        {narrowedTo === undefined ? null : (
          <span>
            Showing {narrowedTo.label} only.{' '}
            <Link
              to="."
              search={(s) => ({ ...s, ...narrowedTo.clear, pairs_page: undefined })}
              hash="pairs"
            >
              Show all
            </Link>
          </span>
        )}
        <Link
          to="."
          search={(s) => ({ ...s, show: conflictsOnly ? 'all' : undefined, pairs_page: undefined })}
          hash="pairs"
        >
          {conflictsOnly ? 'Include agreements' : 'Conflicts only'}
        </Link>
      </div>
      {data.data.length === 0 ? (
        <p className="text-muted-foreground">Nothing to show.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Variant</th>
                <th className="py-2 pr-3 font-medium">{sides[0]}</th>
                <th className="py-2 font-medium">{sides[1]}</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((p) => (
                <tr
                  key={`${String(p.a.scvId)}-${String(p.b.scvId)}`}
                  className="border-b border-border align-top"
                >
                  <td className="py-2 pr-3">
                    <Link to="/variants/$id" params={{ id: p.variationId }}>
                      {p.variantName}
                    </Link>
                    {p.level === null ? null : (
                      <span
                        className={`mt-1 block w-fit rounded px-1.5 text-xs ${LEVEL_CLASS[String(p.level)] ?? ''}`}
                      >
                        {levels.get(p.level)}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <Side scv={p.a} showSubmitter={showSubmitterA} />
                  </td>
                  <td className="py-2">
                    <Side scv={p.b} showSubmitter />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 ? (
        <nav aria-label="Pair pages" className="mt-3 flex items-center gap-4 text-sm">
          {page > 1 ? (
            <Link to="." search={(s) => ({ ...s, pairs_page: page - 1 })} hash="pairs">
              Previous
            </Link>
          ) : null}
          <span className="text-muted-foreground">
            Page {page.toLocaleString()} of {pages.toLocaleString()}
          </span>
          {page < pages ? (
            <Link to="." search={(s) => ({ ...s, pairs_page: page + 1 })} hash="pairs">
              Next
            </Link>
          ) : null}
        </nav>
      ) : null}
    </section>
  );
}
