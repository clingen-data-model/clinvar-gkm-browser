// The release a page shows: the `release` URL parameter, which the root route keeps on every
// link, so the whole browser rewinds to it. Absent means the current release. Only a release
// served is shown; any other value gets a page saying so (UnknownReleasePage), never another
// release's data under its date.

import type { QueryClient } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { z } from 'zod';
import { ApiError } from './api/client.ts';
import { releasesQuery, type Release } from './api/queries.ts';

/**
 * The root route's search: the release asked for, as written. It isn't parsed as a date here, so
 * that a malformed one reaches the check below rather than being dropped for the current release.
 */
export const ReleaseSearch = z.object({ release: z.string().optional() });

/** The release asked for isn't served; `releases` are the ones that are, oldest first. */
export class UnknownReleaseError extends Error {
  readonly releases: string[];
  constructor(requested: string, releases: string[]) {
    super(`ClinVar release ${requested} isn't available.`);
    this.releases = releases;
  }
}

/**
 * The releases served, if `error` says the release asked for isn't one: from the root route's
 * check, or from the API's answer when its releases changed since they were listed here.
 */
export function servedReleasesOf(error: unknown): string[] | undefined {
  if (error instanceof UnknownReleaseError) return error.releases;
  if (error instanceof ApiError && error.status === 404) return error.releases;
  return undefined;
}

/** Throws UnknownReleaseError unless the release asked for, if any, is served. */
export async function checkRelease(queryClient: QueryClient, requested: Release): Promise<void> {
  if (requested === undefined) return;
  const { data } = await queryClient.query(releasesQuery());
  const releases = data.map((r) => r.clinvarRelease).sort();
  if (!releases.includes(requested)) throw new UnknownReleaseError(requested, releases);
}

/** The release the current page shows. */
export function useRelease(): Release {
  return useSearch({ strict: false, select: (search) => search.release });
}
