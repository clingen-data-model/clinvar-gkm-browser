import type { SummaryResponse, Vocabularies } from '@cvb/shared/api';
import { LEVEL_CLASS } from '../../lib/conflicts.ts';
import { count } from '../../lib/text.ts';

const ALL = ['single', 'none', '2', '3', '5'];
const SHARED = ['none', '2', '3', '5'];

interface Props {
  summary: SummaryResponse;
  vocab: Vocabularies;
  /** What "single" means here, e.g. "Only this lab". */
  singleLabel?: string;
  /**
   * Count only variants both sides submitted (two labs head to head), rather than all of side
   * A's, with those it alone submitted in a card of their own.
   */
  sharedOnly?: boolean;
}

/**
 * Variants by conflict status: each variant counts once, under its worst conflict. Shares are
 * of the variants with something to compare (all but "single").
 */
export function Scorecard({ summary, vocab, singleLabel, sharedOnly = false }: Props) {
  const byStatus = new Map(
    summary.rows.map((r) => [String(r['conflict_level']), Number(r['variants'])]),
  );
  const total = summary.totals['variants'] ?? 0;
  const compared = total - (byStatus.get('single') ?? 0) - (byStatus.get('na') ?? 0);
  const conflicting = ['1', '2', '3', '4', '5'].reduce((n, l) => n + (byStatus.get(l) ?? 0), 0);
  const labels = new Map(vocab.conflictStatuses.map((s) => [s.status, s.label]));
  const examples = new Map(vocab.conflictLevels.map((l) => [String(l.level), l.example]));
  const share = (n: number) =>
    compared === 0 ? '' : `${((100 * n) / compared).toFixed(n * 1000 < compared ? 2 : 1)}%`;
  return (
    <section aria-labelledby="scorecard" className="mb-10">
      <h2 id="scorecard" className="mb-1">
        Conflicts
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        {sharedOnly
          ? `${count(compared, 'variant')} submitted by both, each counted once under its most serious conflict. ${conflicting.toLocaleString()} (${share(conflicting) || '0%'}) have a conflict.`
          : `${count(total, 'variant')}, each counted once under its most serious conflict. ${conflicting.toLocaleString()} of ${count(compared, 'compared variant')} (${share(conflicting) || '0%'}) have a conflict.`}
        {summary.flaggedExcluded === null
          ? null
          : ` ${count(summary.flaggedExcluded, 'flagged submission')} left out.`}
      </p>
      <dl
        className={`grid grid-cols-2 gap-2 sm:grid-cols-3 ${sharedOnly ? 'lg:grid-cols-4' : 'lg:grid-cols-5'}`}
      >
        {(sharedOnly ? SHARED : ALL).map((status) => {
          const n = byStatus.get(status) ?? 0;
          return (
            <div
              key={status}
              className={`rounded-md p-3 ${LEVEL_CLASS[status] ?? ''}`}
              title={
                examples.get(status) === undefined
                  ? undefined
                  : `e.g. ${examples.get(status) ?? ''}`
              }
            >
              <dt className="text-sm">
                {status === 'single' ? (singleLabel ?? labels.get(status)) : labels.get(status)}
              </dt>
              <dd className="text-2xl font-semibold">
                {n.toLocaleString()}
                {status === 'single' ? null : (
                  <span className="ml-2 text-sm font-normal">{share(n)}</span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
