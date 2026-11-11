import { useQuery } from '@tanstack/react-query';
import { releasesQuery } from '../../lib/api/queries.ts';

interface Span {
  from: string;
  to: string | null;
  fromStart: boolean;
}

/**
 * The releases a span held in: its first, and its last (the release before the one that replaced
 * it), or "latest". A span already held in the earliest release served may go back further, so
 * its first release gets an asterisk, which EarliestReleaseNote explains under the list.
 */
export function ReleaseSpan({ span }: { span: Span }) {
  const { data } = useQuery(releasesQuery());
  const to = span.to;
  const last =
    to === null
      ? null
      : (data?.data
          .map((r) => r.clinvarRelease)
          .filter((d) => d < to)
          .sort()
          .at(-1) ?? null);
  return (
    <span className="whitespace-nowrap">
      {span.from}
      {span.fromStart ? (
        <>
          <sup aria-hidden="true">*</sup>
          <span className="sr-only"> (the earliest release stored)</span>
        </>
      ) : null}
      {' – '}
      {to === null ? 'latest' : (last ?? `before ${to}`)}
    </span>
  );
}

/**
 * The footnote to a list of spans whose first release is the earliest stored: shown, under the
 * list, only when one is. Always visible, not a tooltip, so it reads the same on a touch screen.
 */
export function EarliestReleaseNote({ spans }: { spans: readonly Span[] }) {
  if (!spans.some((s) => s.fromStart)) return null;
  return (
    <p className="mt-2 max-w-xs text-xs text-muted-foreground">
      <span aria-hidden="true">* </span>The earliest release stored; this may go back further.
    </p>
  );
}

/** Whether a span holds in a release. */
export function holdsIn(span: Span, release: string): boolean {
  return span.from <= release && (span.to === null || release < span.to);
}
