import type { ScvRow } from '@cvb/shared/api';
import { Link } from '@tanstack/react-router';
import { Fragment } from 'react';
import { Stars } from '../classification/Stars.tsx';
import { TermPill } from '../classification/TermPill.tsx';

interface Props {
  rows: ScvRow[];
  /** Hide the variant column on a variant's own page. */
  showVariant?: boolean;
  typeLabels: Map<string, string>;
}

/** Submissions, grouped by classification type, with comments expandable under each row. */
export function ScvTable({ rows, showVariant = false, typeLabels }: Props) {
  const groups = new Map<string, ScvRow[]>();
  for (const r of rows)
    groups.set(r.classificationType, [...(groups.get(r.classificationType) ?? []), r]);
  const columns = showVariant ? 7 : 6;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            {showVariant ? <th className="py-2 pr-3 font-medium">Variant</th> : null}
            <th className="py-2 pr-3 font-medium">Submitter</th>
            <th className="py-2 pr-3 font-medium">Classification</th>
            <th className="py-2 pr-3 font-medium">Review status</th>
            <th className="py-2 pr-3 font-medium">Condition</th>
            <th className="py-2 pr-3 font-medium whitespace-nowrap">Last evaluated</th>
            <th className="py-2 font-medium">Submission</th>
          </tr>
        </thead>
        <tbody>
          {[...groups].map(([type, group]) => (
            <Fragment key={type}>
              {groups.size > 1 || type !== 'PATH' ? (
                <tr>
                  <th
                    colSpan={columns}
                    scope="colgroup"
                    className="bg-muted px-2 py-1.5 text-left font-semibold"
                  >
                    {typeLabels.get(type) ?? type} ({group.length})
                  </th>
                </tr>
              ) : null}
              {group.map((r) => (
                <Fragment key={r.scvId}>
                  <tr className="border-b border-border align-top">
                    {showVariant ? (
                      <td className="py-2 pr-3">
                        <Link to="/variants/$id" params={{ id: r.variationId }}>
                          {r.variationId}
                        </Link>
                      </td>
                    ) : null}
                    <td className="py-2 pr-3">
                      <Link to="/submitters/$id" params={{ id: r.submitter.submitterId }}>
                        {r.submitter.name ?? `Submitter ${String(r.submitter.submitterId)}`}
                      </Link>
                      {r.collectionMethods === null ? null : (
                        <div className="text-xs text-muted-foreground">
                          {r.collectionMethods.join(', ')}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <TermPill
                        label={r.termLabel}
                        bucket={r.bucket}
                        submitted={r.classification}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <Stars stars={r.stars} />
                      <div className="text-xs text-muted-foreground">{r.reviewStatus}</div>
                    </td>
                    <td className="py-2 pr-3">
                      <ul>
                        {r.conditions.map((c) => (
                          <li key={c.conditionId}>
                            <Link to="/conditions/$id" params={{ id: c.conditionId }}>
                              {c.name}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">{r.dateLastEvaluated ?? '—'}</td>
                    <td className="py-2 whitespace-nowrap">
                      <Link to="/scvs/$id" params={{ id: r.scvId }}>
                        {r.accession}.{r.version}
                      </Link>
                    </td>
                  </tr>
                  {r.comment === null ? null : (
                    <tr className="border-b border-border">
                      <td colSpan={columns} className="pb-2 pl-2">
                        <details>
                          <summary className="cursor-pointer text-xs text-muted-foreground">
                            Comment
                          </summary>
                          <p className="mt-1 max-w-prose text-sm whitespace-pre-line">
                            {r.comment}
                          </p>
                        </details>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
