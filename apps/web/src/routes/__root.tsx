import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  retainSearchParams,
  type ErrorComponentProps,
} from '@tanstack/react-router';
import { AppShell } from '../components/shell/AppShell.tsx';
import { ErrorPage } from '../components/shell/ErrorPage.tsx';
import { NotFoundPage } from '../components/shell/NotFoundPage.tsx';
import { UnknownReleasePage } from '../components/shell/UnknownReleasePage.tsx';
import { checkRelease, ReleaseSearch, UnknownReleaseError } from '../lib/release.ts';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  validateSearch: ReleaseSearch,
  // Every link keeps the release shown, so the whole browser stays on it (lib/release.ts).
  search: { middlewares: [retainSearchParams(['release'])] },
  // Loaders read the release from context, as of the location being loaded. One that isn't
  // served stops here, before any page's loader asks the API for it.
  beforeLoad: async ({ context, search }) => {
    await checkRelease(context.queryClient, search.release);
    return { release: search.release };
  },
  component: AppShell,
  notFoundComponent: NotFoundPage,
  errorComponent: RootError,
});

/**
 * A release that isn't served shows its page in the frame; otherwise this is the frame itself
 * failing, as a page's own error shows inside it (main.tsx).
 */
function RootError(props: ErrorComponentProps) {
  if (props.error instanceof UnknownReleaseError) {
    return (
      <AppShell>
        <UnknownReleasePage releases={props.error.releases} />
      </AppShell>
    );
  }
  return <ErrorPage {...props} />;
}
