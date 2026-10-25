import type { ClassificationCount } from '@cvb/shared/api';
import type { z } from 'zod';
import { count } from '../../lib/text.ts';
import { TermPill } from './TermPill.tsx';

type Count = z.infer<typeof ClassificationCount>;

const FILL = {
  P: 'fill-bucket-p',
  V: 'fill-bucket-v',
  B: 'fill-bucket-b',
  O: 'fill-bucket-o',
  N: 'fill-bucket-n',
} as const;

/** Shares of each term, as an SVG: its widths are attributes, which the CSP allows (no inline styles). */
function SignificanceBar({ rows, total }: { rows: Count[]; total: number }) {
  const widths = rows.map((r) => (100 * r.scvs) / total);
  const offsets = widths.map((_, i) => widths.slice(0, i).reduce((a, b) => a + b, 0));
  return (
    <svg
      aria-hidden="true"
      className="mb-2 h-2 w-full overflow-hidden rounded-full bg-muted"
      preserveAspectRatio="none"
      viewBox="0 0 100 1"
    >
      {rows.map((r, i) => (
        <rect
          key={r.term ?? 'none'}
          x={offsets[i]}
          y={0}
          width={widths[i]}
          height={1}
          className={FILL[r.bucket ?? 'N']}
        />
      ))}
    </svg>
  );
}

/** Counts by classification term, grouped by classification type, with a significance bar. */
export function ClassificationCounts({
  counts,
  typeLabels,
}: {
  counts: Count[];
  typeLabels: Map<string, string>;
}) {
  const byType = new Map<string, Count[]>();
  for (const c of counts)
    byType.set(c.classificationType, [...(byType.get(c.classificationType) ?? []), c]);
  return (
    <div className="space-y-6">
      {[...byType].map(([type, rows]) => {
        const total = rows.reduce((n, r) => n + r.scvs, 0);
        return (
          <section key={type} aria-labelledby={`counts-${type}`}>
            <h3 id={`counts-${type}`} className="mb-2 font-semibold">
              {typeLabels.get(type) ?? type}{' '}
              <span className="font-normal text-muted-foreground">({count(total, 'SCV')})</span>
            </h3>
            <SignificanceBar rows={rows} total={total} />
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {rows.map((r) => (
                <li key={r.term ?? 'none'} className="flex items-center gap-1.5 text-sm">
                  <TermPill label={r.termLabel} bucket={r.bucket} />
                  <span>{r.scvs.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
