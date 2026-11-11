import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { releasesQuery } from '../../lib/api/queries.ts';
import { useRelease } from '../../lib/release.ts';
import { Page } from './Page.tsx';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * In place of a page whose `release` isn't served: says so, and links this same page, with its
 * filters, as of each release that is. Nothing from another release is shown under the date asked.
 */
export function UnknownReleasePage({ releases }: { releases: string[] }) {
  const requested = useRelease() ?? '';
  const current = useQuery(releasesQuery()).data?.current ?? null;
  const isDate = ISO_DATE.test(requested);
  const before = isDate ? releases.filter((d) => d < requested).at(-1) : undefined;
  const after = isDate ? releases.find((d) => d > requested) : undefined;
  return (
    <Page title="Release not available">
      <p>
        {isDate ? (
          <>
            This page was asked for as of ClinVar release {requested}, which isn&rsquo;t stored
            here.
          </>
        ) : (
          <>&ldquo;{requested}&rdquo; isn&rsquo;t a ClinVar release date (YYYY-MM-DD).</>
        )}{' '}
        Each release below opens this same page as of that release.
      </p>
      {before === undefined && after === undefined ? null : (
        <section className="mt-6">
          <h2 className="mb-2 text-lg">Nearest</h2>
          <ul className="space-y-1">
            {before === undefined ? null : (
              <li>
                <ReleaseLink date={before} current={current} />{' '}
                <span className="text-sm text-muted-foreground">the release before</span>
              </li>
            )}
            {after === undefined ? null : (
              <li>
                <ReleaseLink date={after} current={current} />{' '}
                <span className="text-sm text-muted-foreground">the release after</span>
              </li>
            )}
          </ul>
        </section>
      )}
      <section className="mt-6">
        <h2 className="mb-2 text-lg">Releases stored</h2>
        {releases.length === 0 ? (
          <p>None yet.</p>
        ) : (
          <ul className="space-y-1">
            {[...releases].reverse().map((d) => (
              <li key={d}>
                <ReleaseLink date={d} current={current} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </Page>
  );
}

/** This page as of `date`; the current release is the default, so its link drops the parameter. */
function ReleaseLink({ date, current }: { date: string; current: string | null }) {
  return (
    <Link to="." search={(prev) => ({ ...prev, release: date === current ? undefined : date })}>
      {date}
      {date === current ? ' (latest)' : ''}
    </Link>
  );
}
