// Query options for every API read, shared by route loaders (which prefetch) and components
// (which read with useSuspenseQuery). A release's data never changes, so it never goes stale.

import {
  ConditionDetail,
  GeneDetail,
  ReleaseList,
  ScvDetail,
  ScvRow,
  SearchResponse,
  SubmitterDetail,
  SummaryResponse,
  VariantDetail,
  Vocabularies,
  item,
  list,
} from '@cvb/shared/api';
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { getJson, type Params } from './client.ts';

const forever = { staleTime: Infinity, gcTime: 30 * 60_000 } as const;

export const releasesQuery = () =>
  queryOptions({
    queryKey: ['releases'],
    queryFn: () => getJson('/releases', ReleaseList),
    staleTime: 60_000,
  });

export const vocabulariesQuery = () =>
  queryOptions({
    queryKey: ['vocabularies'],
    queryFn: () => getJson('/vocabularies', item(Vocabularies)),
    ...forever,
  });

export const variantQuery = (id: number) =>
  queryOptions({
    queryKey: ['variant', id],
    queryFn: () => getJson(`/variants/${String(id)}`, item(VariantDetail)),
    ...forever,
  });

export const variantScvsQuery = (id: number) =>
  queryOptions({
    queryKey: ['variant', id, 'scvs'],
    queryFn: () =>
      getJson(
        `/variants/${String(id)}/scvs`,
        z.object({ release: z.iso.date(), data: z.array(ScvRow) }),
      ),
    ...forever,
  });

export const scvQuery = (id: number) =>
  queryOptions({
    queryKey: ['scv', id],
    queryFn: () => getJson(`/scvs/${String(id)}`, item(ScvDetail)),
    ...forever,
  });

export const geneQuery = (id: number, relationships: readonly string[]) =>
  queryOptions({
    queryKey: ['gene', id, relationships],
    queryFn: () =>
      getJson(`/genes/${String(id)}`, item(GeneDetail), {
        gene_relationship: relationships.join(','),
      }),
    ...forever,
  });

export const submitterQuery = (id: number) =>
  queryOptions({
    queryKey: ['submitter', id],
    queryFn: () => getJson(`/submitters/${String(id)}`, item(SubmitterDetail)),
    ...forever,
  });

export const conditionQuery = (id: number) =>
  queryOptions({
    queryKey: ['condition', id],
    queryFn: () => getJson(`/conditions/${String(id)}`, item(ConditionDetail)),
    ...forever,
  });

export const searchQuery = (q: string) =>
  queryOptions({
    queryKey: ['search', q],
    queryFn: () => getJson('/search', SearchResponse, { q, limit: 20 }),
    ...forever,
  });

export const scvListQuery = (params: Params) =>
  queryOptions({
    queryKey: ['scvs', params],
    queryFn: () => getJson('/scvs', list(ScvRow), params),
    ...forever,
  });

export const scvSummaryQuery = (params: Params) =>
  queryOptions({
    queryKey: ['scvs', 'summary', params],
    queryFn: () => getJson('/scvs/summary', SummaryResponse, params),
    ...forever,
  });
