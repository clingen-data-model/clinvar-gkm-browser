// Loaders read their URL state (filters, paging) here rather than through loaderDeps. Deps that
// change make a new route match, which the router shows as a pending page; leaving them out
// keeps the page on screen, dimmed by the busy indicator, while its loader fetches the new
// state's data. Such a route sets `shouldReload: true`, as the router otherwise reruns a loader
// only when its deps change, and main.tsx sets staleReloadMode 'blocking', so the navigation
// waits for the data. Components read the same state with Route.useSearch().

import type { ParsedLocation } from '@tanstack/react-router';
import type { z } from 'zod';

/** A route's search state, parsed from the location being loaded with the route's schema. */
export function searchOf<T>(schema: z.ZodType<T>, location: ParsedLocation): T {
  return schema.parse(location.search);
}
