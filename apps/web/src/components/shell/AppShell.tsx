import { Outlet, useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import { SiteFooter } from './SiteFooter.tsx';
import { SiteHeader } from './SiteHeader.tsx';

/**
 * Moves focus to the new page's heading after client-side navigation, as a full page load
 * would reset it, so screen reader and keyboard users start at the new content. Changes to
 * the query string alone (filters, paging) leave focus where it is.
 */
function useFocusHeadingOnNavigate() {
  const router = useRouter();
  useEffect(
    () =>
      router.subscribe('onResolved', (event) => {
        // The first resolve is the initial page load, where focus starts at the top as usual.
        if (event.fromLocation === undefined || !event.pathChanged) return;
        const heading = document.querySelector<HTMLElement>('#main h1');
        if (heading === null) return;
        heading.tabIndex = -1;
        heading.focus();
      }),
    [router],
  );
}

export function AppShell() {
  useFocusHeadingOnNavigate();
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2"
      >
        Skip to main content
      </a>
      <SiteHeader />
      <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}
