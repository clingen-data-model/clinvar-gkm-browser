import type { Vocabularies } from '@cvb/shared/api';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import type { Params } from '../../lib/api/client.ts';
import { scvSummaryQuery } from '../../lib/api/queries.ts';
import { termOf } from '../../lib/conflicts.ts';
import { TermPill } from '../classification/TermPill.tsx';

export const SUBMITTERS_PER_PAGE = 20;

/** The request behind the table, so a route loader can prefetch it. */
export function submitterCountsParams(
  filters: Params,
  page: number,
  q: string | undefined,
): Params {
  return {
    ...filters,
    classification_type: 'any',
    group_by: 'submitter,term',
    limit: SUBMITTERS_PER_PAGE,
    offset: (page - 1) * SUBMITTERS_PER_PAGE,
    match: q,
  };
}

/**
 * The columns: germline pathogenicity terms by significance, and every other classification type
 * (oncogenicity, somatic impact, drug response, not provided, ...) together.
 */
const COLUMNS = [
  { key: 'P', label: 'P/LP', title: 'Pathogenic or likely pathogenic', bucket: 'P' },
  { key: 'V', label: 'VUS', title: 'Uncertain significance', bucket: 'V' },
  { key: 'B', label: 'B/LB', title: 'Benign or likely benign', bucket: 'B' },
  { key: 'other', label: 'Other', title: 'Other classification types', bucket: 'O' },
] as const;

type Column = (typeof COLUMNS)[number]['key'];

function columnOf(vocab: Vocabularies, termKey: string | null): Column {
  const term = termKey === null ? undefined : termOf(vocab, termKey);
  if (term?.classificationType !== 'PATH') return 'other';
  return term.bucket === 'P' || term.bucket === 'V' || term.bucket === 'B' ? term.bucket : 'other';
}

interface Props {
  /** The gene's filters (gene and gene_relationship). */
  filters: Params;
  vocab: Vocabularies;
  page: number;
  q: string | undefined;
}

/**
 * The gene's submitters, most submissions first: per submitter, its SCVs on the gene's variants
 * by germline significance, with P and LP (and B and LB) counted together.
 */
export function SubmitterCounts({ filters, vocab, page, q }: Props) {
  const navigate = useNavigate();
  const [text, setText] = useState(q ?? '');
  const summary = useSuspenseQuery(scvSummaryQuery(submitterCountsParams(filters, page, q))).data;
  const names = summary.dimensions[0]?.labels ?? {};
  // Rows come ranked by the submitter's total, so insertion order is the table's order.
  const bySubmitter = new Map<string, Record<Column, number>>();
  for (const row of summary.rows) {
    const id = String(row['submitter']);
    const cells = bySubmitter.get(id) ?? { P: 0, V: 0, B: 0, other: 0 };
    const term = row['term'];
    cells[columnOf(vocab, typeof term === 'string' ? term : null)] += Number(row['scvs'] ?? 0);
    bySubmitter.set(id, cells);
  }
  const total = summary.page.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / SUBMITTERS_PER_PAGE));
  return (
    <section aria-labelledby="submitters" className="mb-10">
      <h2 id="submitters" className="mb-1">
        Submitters <span className="text-muted-foreground">({total.toLocaleString()})</span>
      </h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Submissions on the gene&rsquo;s variants by submitter, most submissions first. Pathogenicity
        terms are counted by significance; Other is every other classification type.
      </p>
      <form
        role="search"
        aria-label="Submitters"
        className="mb-3"
        onSubmit={(e) => {
          e.preventDefault();
          void navigate({
            to: '.',
            search: (s) => ({
              ...s,
              submitters_q: text.trim() || undefined,
              submitters_page: undefined,
            }),
            replace: true,
          });
        }}
      >
        <label className="text-sm">
          Find a submitter{' '}
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
              <th className="py-2 pr-3 font-medium">Submitter</th>
              <th className="py-2 pr-3 text-right font-medium">Submissions</th>
              {COLUMNS.map((c) => (
                <th key={c.key} className="px-2 py-2 text-right font-medium" title={c.title}>
                  <TermPill label={c.label} bucket={c.bucket} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...bySubmitter].map(([id, cells]) => (
              <tr key={id} className="border-b border-border">
                <td className="py-2 pr-3">
                  <Link to="/submitters/$id" params={{ id: Number(id) }}>
                    {names[id] ?? `Submitter ${id}`}
                  </Link>
                </td>
                <td className="py-2 pr-3 text-right">
                  {(cells.P + cells.V + cells.B + cells.other).toLocaleString()}
                </td>
                {COLUMNS.map((c) => (
                  <td
                    key={c.key}
                    className={`px-2 py-2 text-right ${cells[c.key] === 0 ? 'text-muted-foreground' : ''}`}
                  >
                    {cells[c.key].toLocaleString()}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {bySubmitter.size === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No submitters match.</p>
      ) : null}
      {pages > 1 ? (
        <nav aria-label="Submitter pages" className="mt-3 flex items-center gap-4 text-sm">
          {page > 1 ? (
            <Link to="." search={(s) => ({ ...s, submitters_page: page - 1 })} hash="submitters">
              Previous
            </Link>
          ) : null}
          <span className="text-muted-foreground">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link to="." search={(s) => ({ ...s, submitters_page: page + 1 })} hash="submitters">
              Next
            </Link>
          ) : null}
        </nav>
      ) : null}
    </section>
  );
}
