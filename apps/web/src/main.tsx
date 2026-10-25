import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider, stringifySearchWith } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorPage } from './components/shell/ErrorPage.tsx';
import { paramsOf, readableQuery } from './lib/url/params.ts';
import { routeTree } from './routeTree.gen.ts';
import './styles/app.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } });
const stringifyPlain = stringifySearchWith(String);

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  scrollRestoration: true,
  // Query values stay plain strings, as the API takes them and the routes' schemas expect. The
  // router's own decoding turns numeric-looking values into numbers (?q=17661, ?b.min_stars=2)
  // before any parser sees them, and a string schema then drops them.
  parseSearch: paramsOf,
  stringifySearch: (search) => readableQuery(stringifyPlain(search)),
  // Route loaders fill the query cache; TanStack Query decides when data is stale.
  defaultPreloadStaleTime: 0,
  // A page's error shows inside the site's header and footer; the root route's own is only
  // for the frame itself failing.
  defaultErrorComponent: ErrorPage,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const root = document.getElementById('root');
if (root === null) throw new Error('index.html has no #root element');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
