import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext } from '@tanstack/react-router';
import { AppShell } from '../components/shell/AppShell.tsx';
import { ErrorPage } from '../components/shell/ErrorPage.tsx';
import { NotFoundPage } from '../components/shell/NotFoundPage.tsx';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: AppShell,
  notFoundComponent: NotFoundPage,
  // Only when the frame itself fails; a page's error shows inside it (main.tsx).
  errorComponent: ErrorPage,
});
