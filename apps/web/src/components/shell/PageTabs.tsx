import type { ReactNode } from 'react';

/**
 * Tabs in the band, one per URL, so they are links in a navigation list rather than a tab
 * widget. Each tab is a router Link with `pageTabClassName`; the router marks the current
 * one with aria-current and data-status, which the class styles.
 */
export function PageTabs({ label, children }: { label: string; children: ReactNode }) {
  return (
    <nav aria-label={label} className="mt-4 -mb-3">
      <ul className="flex flex-wrap gap-1">{children}</ul>
    </nav>
  );
}

export const pageTabClassName =
  'block rounded-t-md border-t-4 border-transparent px-4 py-2 font-semibold ' +
  'text-band-foreground no-underline hover:bg-band-foreground/10 ' +
  'data-[status=active]:border-tab-indicator data-[status=active]:bg-background ' +
  'data-[status=active]:text-link data-[status=active]:hover:bg-background';
