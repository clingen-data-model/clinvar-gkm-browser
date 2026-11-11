// Query options for every API read, shared by route loaders (which prefetch) and components
// (which read with useSuspenseQuery). A release's data never changes, so it never goes stale.

import {
  AggregateHistory,
  ConditionDetail,
  GeneDetail,
  PairRow,
  ReleaseList,
  ScvDetail,
  ScvHistory,
  ScvRow,
  ScvVersion,
  SearchResponse,
  StatsResponse,
  type StatsSlug,
  SubmitterDetail,
  SummaryResponse,
  VariantDetail,
  VariantRow,
  VcvVersion,
  Vocabularies,
  item,
  list,
} from '@cvb/shared/api';
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import type { StatsSearch } from '../stats.ts';
import { getJson, type Params } from './client.ts';

const forever = { staleTime: Infinity, gcTime: 30 * 60_000 } as const;

/** The release a read asks for (the `release` URL parameter); undefined for the current one. */
export type Release = string | undefined;

export const releasesQuery = () =>
  queryOptions({
    queryKey: ['releases'],
    queryFn: () => getJson('/releases', ReleaseList),
    staleTime: 60_000,
  });

export const vocabulariesQuery = (release: Release) =>
  queryOptions({
    queryKey: [release, 'vocabularies'],
    queryFn: () => getJson('/vocabularies', item(Vocabularies), { release }),
    ...forever,
  });

export const variantQuery = (release: Release, id: number) =>
  queryOptions({
    queryKey: [release, 'variant', id],
    queryFn: () => getJson(`/variants/${String(id)}`, item(VariantDetail), { release }),
    ...forever,
  });

export const variantScvsQuery = (release: Release, id: number) =>
  queryOptions({
    queryKey: [release, 'variant', id, 'scvs'],
    queryFn: () =>
      getJson(
        `/variants/${String(id)}/scvs`,
        z.object({ release: z.iso.date(), data: z.array(ScvRow) }),
        { release },
      ),
    ...forever,
  });

export const scvQuery = (release: Release, id: number) =>
  queryOptions({
    queryKey: [release, 'scv', id],
    queryFn: () => getJson(`/scvs/${String(id)}`, item(ScvDetail), { release }),
    ...forever,
  });

export const geneQuery = (release: Release, id: number, relationships: readonly string[]) =>
  queryOptions({
    queryKey: [release, 'gene', id, relationships],
    queryFn: () =>
      getJson(`/genes/${String(id)}`, item(GeneDetail), {
        gene_relationship: relationships.join(','),
        release,
      }),
    ...forever,
  });

export const submitterQuery = (release: Release, id: number) =>
  queryOptions({
    queryKey: [release, 'submitter', id],
    queryFn: () => getJson(`/submitters/${String(id)}`, item(SubmitterDetail), { release }),
    ...forever,
  });

export const conditionQuery = (release: Release, id: number) =>
  queryOptions({
    queryKey: [release, 'condition', id],
    queryFn: () => getJson(`/conditions/${String(id)}`, item(ConditionDetail), { release }),
    ...forever,
  });

export const searchQuery = (release: Release, q: string) =>
  queryOptions({
    queryKey: [release, 'search', q],
    queryFn: () => getJson('/search', SearchResponse, { q, limit: 20, release }),
    ...forever,
  });

export const scvListQuery = (release: Release, params: Params) =>
  queryOptions({
    queryKey: [release, 'scvs', params],
    queryFn: () => getJson('/scvs', list(ScvRow), { ...params, release }),
    ...forever,
  });

export const scvSummaryQuery = (release: Release, params: Params) =>
  queryOptions({
    queryKey: [release, 'scvs', 'summary', params],
    queryFn: () => getJson('/scvs/summary', SummaryResponse, { ...params, release }),
    ...forever,
  });

export const pairSummaryQuery = (release: Release, params: Params) =>
  queryOptions({
    queryKey: [release, 'scv-pairs', 'summary', params],
    queryFn: () => getJson('/scv-pairs/summary', SummaryResponse, { ...params, release }),
    ...forever,
  });

export const variantSummaryQuery = (release: Release, params: Params) =>
  queryOptions({
    queryKey: [release, 'variants', 'summary', params],
    queryFn: () => getJson('/variants/summary', SummaryResponse, { ...params, release }),
    ...forever,
  });

export const pairListQuery = (release: Release, params: Params) =>
  queryOptions({
    queryKey: [release, 'scv-pairs', params],
    queryFn: () => getJson('/scv-pairs', list(PairRow), { ...params, release }),
    ...forever,
  });

export const variantListQuery = (release: Release, params: Params) =>
  queryOptions({
    queryKey: [release, 'variants', params],
    queryFn: () => getJson('/variants', list(VariantRow), { ...params, release }),
    ...forever,
  });

// Versions span every release served, whichever one the page shows, and grow when one is added.
export const variantVersionsQuery = (id: number) =>
  queryOptions({
    queryKey: ['variant', id, 'versions'],
    queryFn: () =>
      getJson(
        `/variants/${String(id)}/versions`,
        z.object({ release: z.iso.date(), data: z.array(VcvVersion) }),
      ),
    staleTime: 60_000,
  });

export const scvVersionsQuery = (id: number) =>
  queryOptions({
    queryKey: ['scv', id, 'versions'],
    queryFn: () =>
      getJson(
        `/scvs/${String(id)}/versions`,
        z.object({ release: z.iso.date(), data: z.array(ScvVersion) }),
      ),
    staleTime: 60_000,
  });

// Field history spans every release served too: the periods each value held in.
export const variantHistoryQuery = (id: number) =>
  queryOptions({
    queryKey: ['variant', id, 'history'],
    queryFn: () =>
      getJson(
        `/variants/${String(id)}/history`,
        z.object({ release: z.iso.date(), data: z.array(AggregateHistory) }),
      ),
    staleTime: 60_000,
  });

/** The classification history of the SCVs named: at most 500, one page of a list. */
export const scvHistoryQuery = (ids: readonly number[]) =>
  queryOptions({
    queryKey: ['scvs', 'history', ids],
    queryFn: () =>
      getJson('/scvs/history', z.object({ release: z.iso.date(), data: z.array(ScvHistory) }), {
        ids: ids.join(','),
      }),
    staleTime: 60_000,
  });

/** A statistics figure's counts; options left out take the figure's defaults. */
export const statsQuery = (release: Release, slug: StatsSlug, options: StatsSearch) => {
  const asked = Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined));
  return queryOptions({
    queryKey: [release, 'stats', slug, asked],
    queryFn: () => getJson(`/stats/${slug}`, StatsResponse, { release, ...asked }),
    ...forever,
  });
};
