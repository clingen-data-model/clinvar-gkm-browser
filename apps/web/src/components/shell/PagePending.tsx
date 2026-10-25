/**
 * A page's place while its first data loads (a direct visit, or a new page): the site's frame
 * shows, with BusyIndicator saying what's happening, instead of a blank window. Space only, so
 * the footer doesn't jump up and back.
 */
export function PagePending() {
  return <div aria-hidden="true" className="min-h-[60vh]" />;
}
