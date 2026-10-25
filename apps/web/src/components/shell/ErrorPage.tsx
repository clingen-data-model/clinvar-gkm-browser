import { useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { ApiError } from '../../lib/api/client.ts';
import { Page } from './Page.tsx';

/** Shown when a page's data can't be loaded or rendering fails. */
export function ErrorPage({ error }: ErrorComponentProps) {
  const router = useRouter();
  if (error instanceof ApiError && error.status === 503) {
    // Expected before the first download, or when a query runs too long.
    return (
      <Page title="No data to show yet">
        <p>{error.detail}</p>
        <p className="mt-4 text-muted-foreground">
          To load data, run <code>scripts/fetch-source.sh</code> and then{' '}
          <code>scripts/derive.sh</code>, and restart the server. Downloading from within the app is
          coming.
        </p>
      </Page>
    );
  }
  return (
    <Page title="Something went wrong">
      <p>This page couldn&rsquo;t be loaded. Please try again in a moment.</p>
      {error instanceof ApiError && error.detail !== null ? (
        <p className="mt-2 text-muted-foreground">{error.detail}</p>
      ) : null}
      <p className="mt-4">
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1.5 hover:bg-muted"
          onClick={() => {
            void router.invalidate();
          }}
        >
          Try again
        </button>
      </p>
    </Page>
  );
}
