import { useQuery } from '@tanstack/react-query';
import { releasesQuery } from '../../lib/api/queries.ts';

interface Span {
  from: string;
  to: string | null;
  fromStart: boolean;
}

/**
 * The releases a version held in: its first, and its last (the release before the one that
 * replaced it), or "latest". "By" marks a version already held in the earliest release served.
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
      {span.fromStart ? 'by ' : ''}
      {span.from} – {to === null ? 'latest' : (last ?? `before ${to}`)}
    </span>
  );
}

/** Whether a span holds in a release. */
export function holdsIn(span: Span, release: string): boolean {
  return span.from <= release && (span.to === null || release < span.to);
}
