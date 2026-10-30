import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, retainSearchParams } from '@tanstack/react-router';
import { AppShell } from '../components/shell/AppShell.tsx';
import { ErrorPage } from '../components/shell/ErrorPage.tsx';
import { NotFoundPage } from '../components/shell/NotFoundPage.tsx';
import { ReleaseSearch } from '../lib/release.ts';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  validateSearch: ReleaseSearch,
  // Every link keeps the release shown, so the whole browser stays on it (lib/release.ts).
  search: { middlewares: [retainSearchParams(['release'])] },
  // Loaders read the release from context, as of the location being loaded.
  beforeLoad: ({ search }) => ({ release: search.release }),
  component: AppShell,
  notFoundComponent: NotFoundPage,
  // Only when the frame itself fails; a page's error shows inside it (main.tsx).
  errorComponent: ErrorPage,
});
