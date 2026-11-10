import type { AggregateHistory, AggregateStatement, FieldPeriod } from '@cvb/shared/api';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { z } from 'zod';
import { count } from '../../lib/text.ts';
import { Stars } from '../classification/Stars.tsx';
import { FieldHistory, periodRelease } from '../history/FieldHistory.tsx';

type Node = z.infer<typeof AggregateStatement>;

const LEVEL_LABELS: Record<string, string> = {
  PG: 'Practice guideline',
  EP: 'Expert panel',
  CP: 'Criteria provided',
  NOCP: 'No assertion criteria',
  NOCL: 'No classification',
  FLAG: 'Flagged',
};

/**
 * ClinVar's aggregate (VCV) call for each classification type, and the submission levels under
 * it: the highest level present sets the call, and the levels below it don't contribute. The
 * call's classification and review status each offer the values they held, when they changed.
 */
export function AggregateCalls({
  variationId,
  nodes,
  history,
  shown,
  typeLabels,
}: {
  variationId: number;
  nodes: Node[];
  history: AggregateHistory[];
  /** The release the page shows. */
  shown: string;
  typeLabels: Map<string, string>;
}) {
  const roots = nodes.filter((n) => n.nodeKind === 'root');
  const children = (id: string) => nodes.filter((n) => n.parentStatementId === id);
  const historyOf = (type: string) => history.find((h) => h.classificationType === type);
  const link = (period: FieldPeriod, text: ReactNode, close: () => void) => (
    <Link
      to="/variants/$id"
      params={{ id: variationId }}
      search={(prev) => ({ ...prev, release: periodRelease(period) })}
      onClick={close}
    >
      {text}
    </Link>
  );
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {roots.map((root) => (
        <section key={root.statementId} className="rounded-lg border border-border p-4">
          <h3 className="text-sm text-muted-foreground">
            {typeLabels.get(root.classificationType) ?? root.classificationType}
          </h3>
          <p>
            <span className="text-lg font-semibold">{root.classification ?? '—'}</span>
            <FieldHistory
              label="Classification"
              periods={historyOf(root.classificationType)?.classification ?? []}
              shown={shown}
              link={link}
            />
          </p>
          <p className="text-sm">
            <Stars stars={root.stars} />{' '}
            <span className="text-muted-foreground">{root.reviewStatus}</span>
            <FieldHistory
              label="Review status"
              periods={historyOf(root.classificationType)?.reviewStatus ?? []}
              shown={shown}
              link={link}
            />
          </p>
          {root.conflictingExplanation === null ? null : (
            <p className="mt-1 text-sm">{root.conflictingExplanation}</p>
          )}
          <ul className="mt-3 space-y-1 text-sm">
            {children(root.statementId).map((level) => (
              <li
                key={level.statementId}
                className={level.contributes === false ? 'text-muted-foreground' : ''}
              >
                <span className="font-medium">
                  {LEVEL_LABELS[level.submissionLevel ?? ''] ?? level.submissionLevel}
                </span>
                {level.tier === null ? '' : ` ${level.tier}`}: {level.classification ?? '—'}
                {level.scvCount > 0 ? ` (${count(level.scvCount, 'SCV')})` : ''}
                {level.contributes === false ? ' — does not contribute' : ''}
                {children(level.statementId).length > 0 ? (
                  <ul className="ml-4">
                    {children(level.statementId).map((tier) => (
                      <li key={tier.statementId}>
                        {tier.tier}: {tier.classification} ({count(tier.scvCount, 'SCV')})
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
