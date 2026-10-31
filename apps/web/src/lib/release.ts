// The release a page shows: the `release` URL parameter, which the root route keeps on every
// link, so the whole browser rewinds to it. Absent means the current release.

import { useSearch } from '@tanstack/react-router';
import { z } from 'zod';
import type { Release } from './api/queries.ts';

/** The root route's search: a release date, or nothing (an unparseable one is dropped). */
export const ReleaseSearch = z.object({ release: z.iso.date().optional().catch(undefined) });

/** The release the current page shows. */
export function useRelease(): Release {
  return useSearch({ strict: false, select: (search) => search.release });
}
