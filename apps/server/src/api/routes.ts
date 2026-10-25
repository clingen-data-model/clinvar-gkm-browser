// /api/v1: releases and entity reads (docs/api.md#resources). Every read takes an optional
// `release`; the response says which release answered.

import {
  ConditionDetail,
  GeneDetail,
  GeneQuery,
  IntId,
  ReleaseList,
  ReleaseQuery,
  ScvDetail,
  ScvRow,
  SubmitterDetail,
  VariantDetail,
  item,
  list,
  PairRow,
  SearchQuery,
  SearchResponse,
  SummaryResponse,
  VariantRow,
  Vocabularies,
} from '@cvb/shared/api';
import {
  documentedQuery,
  parseGeneRelationships,
  parseQuery,
  type ParsedQuery,
  type RawQuery,
  type ResourceName,
} from '@cvb/shared/query';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Database } from '../data/database.ts';
import { problem, sendProblem } from '../http/errors.ts';
import { conditionDetail, geneDetail, submitterDetail } from './entities/queries.ts';
import { listPairs, pairOrder } from './pairs/queries.ts';
import { listScvs, scvDetail, scvOrder, variantScvs } from './scvs/queries.ts';
import { summarize } from './summaries/queries.ts';
import { search } from './search/queries.ts';
import { listVariants, variantDetail, variantOrder } from './variants/queries.ts';
import { vocabularies } from './vocabulary/queries.ts';

const IdParams = z.object({ id: IntId });

/** Fastify's parsed query string, as parseQuery takes it. */
function raw(query: Record<string, unknown>): RawQuery {
  return z.record(z.string(), z.union([z.string(), z.array(z.string())])).parse(query);
}

export const api: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  app.get('/releases', { schema: { tags: ['releases'], response: { 200: ReleaseList } } }, () => {
    const { current, releases } = db.available();
    return { current, data: releases.map((r) => r.release) };
  });

  app.get(
    '/vocabularies',
    {
      schema: {
        tags: ['vocabularies'],
        description:
          'Code lists (classification types and terms, review statuses, submission levels) and the filters and dimensions lists and summaries accept.',
        querystring: ReleaseQuery,
        response: { 200: item(Vocabularies) },
      },
    },
    async (request) => {
      const release = db.resolve(request.query.release);
      return { release, data: await vocabularies(db, release) };
    },
  );

  app.get(
    '/search',
    {
      schema: {
        tags: ['search'],
        description:
          'Find variants, SCVs, genes, conditions and submitters by identifier, HGVS or name.',
        querystring: SearchQuery,
        response: { 200: SearchResponse },
      },
    },
    async (request) => {
      const release = db.resolve(request.query.release);
      const found = await search(db, release, request.query.q, request.query.limit);
      return { release, q: request.query.q, ...found };
    },
  );

  const itemSchema = (tag: string, data: z.ZodType) => ({
    tags: [tag],
    params: IdParams,
    querystring: ReleaseQuery,
    response: { 200: item(data) },
  });
  const notFound = (noun: string, id: number, release: string) =>
    problem(404, `No ${noun} ${id} in ${release}.`);

  app.get(
    '/variants/:id',
    { schema: itemSchema('variants', VariantDetail) },
    async (req, reply) => {
      const release = db.resolve(req.query.release);
      const data = await variantDetail(db, release, req.params.id);
      if (data === null) return sendProblem(reply, notFound('variant', req.params.id, release));
      return { release, data };
    },
  );

  app.get('/scvs/:id', { schema: itemSchema('scvs', ScvDetail) }, async (req, reply) => {
    const release = db.resolve(req.query.release);
    const data = await scvDetail(db, release, req.params.id);
    if (data === null) return sendProblem(reply, notFound('SCV', req.params.id, release));
    return { release, data };
  });

  app.get(
    '/genes/:id',
    {
      schema: {
        tags: ['genes'],
        description:
          'A gene, with counts over the variants related to it as gene_relationship chooses.',
        params: IdParams,
        querystring: GeneQuery,
        response: { 200: item(GeneDetail) },
      },
    },
    async (req, reply) => {
      const relationships = parseGeneRelationships(req.query.gene_relationship);
      if (!relationships.ok) {
        return sendProblem(
          reply,
          invalid([{ path: 'querystring/gene_relationship', message: relationships.error }]),
        );
      }
      const release = db.resolve(req.query.release);
      const data = await geneDetail(db, release, req.params.id, relationships.value);
      if (data === null) return sendProblem(reply, notFound('gene', req.params.id, release));
      return { release, data };
    },
  );

  app.get(
    '/submitters/:id',
    { schema: itemSchema('submitters', SubmitterDetail) },
    async (req, reply) => {
      const release = db.resolve(req.query.release);
      const data = await submitterDetail(db, release, req.params.id);
      if (data === null) return sendProblem(reply, notFound('submitter', req.params.id, release));
      return { release, data };
    },
  );

  app.get(
    '/conditions/:id',
    { schema: itemSchema('conditions', ConditionDetail) },
    async (req, reply) => {
      const release = db.resolve(req.query.release);
      const data = await conditionDetail(db, release, req.params.id);
      if (data === null) return sendProblem(reply, notFound('condition', req.params.id, release));
      return { release, data };
    },
  );

  app.get(
    '/variants/:id/scvs',
    {
      schema: {
        tags: ['variants'],
        params: IdParams,
        querystring: ReleaseQuery,
        response: { 200: z.object({ release: z.iso.date(), data: z.array(ScvRow) }) },
      },
    },
    async (request) => {
      const release = db.resolve(request.query.release);
      return { release, data: await variantScvs(db, release, request.params.id) };
    },
  );

  app.get(
    '/scvs',
    {
      schema: {
        tags: ['scvs'],
        description: 'SCVs matching the filters, a page at a time.',
        querystring: documentedQuery('list'),
        response: { 200: list(ScvRow) },
      },
    },
    async (request, reply) => {
      const parsed = parseQuery(raw(request.query));
      if (!parsed.ok) return sendProblem(reply, invalid(parsed.problems));
      const order = scvOrder(parsed.query.sort);
      if (order.unknown.length > 0) {
        return sendProblem(
          reply,
          invalid([
            { path: 'querystring/sort', message: `Unknown sort '${order.unknown.join(', ')}'.` },
          ]),
        );
      }
      const release = db.resolve(parsed.query.release);
      const { rows, total } = await listScvs(db, release, parsed.query, order.sql);
      return {
        release,
        query: parsed.query.canonical,
        data: rows,
        page: { limit: parsed.query.limit, offset: parsed.query.offset, total },
      };
    },
  );

  /** A summary endpoint for a resource: parse, resolve the release, count. */
  function summaryRoute(path: string, resource: ResourceName, tag: string, description: string) {
    app.get(
      path,
      {
        schema: {
          tags: [tag],
          description,
          querystring: documentedQuery('summary', resource),
          response: { 200: SummaryResponse },
        },
      },
      async (request, reply) => {
        const parsed = parseQuery(raw(request.query), resource);
        if (!parsed.ok) return sendProblem(reply, invalid(parsed.problems));
        const release = db.resolve(parsed.query.release);
        const summary = await summarize(db, release, parsed.query);
        return { release, query: parsed.query.canonical, ...summary };
      },
    );
  }

  summaryRoute(
    '/scvs/summary',
    'scvs',
    'scvs',
    'Counts of the SCVs matching the filters, grouped by up to two dimensions.',
  );
  summaryRoute(
    '/scv-pairs/summary',
    'pairs',
    'conflicts',
    'Counts of SCV pairs (two SCVs on one variant), grouped by up to two dimensions, such as a.term by b.term, or b.submitter by conflict_level.',
  );
  summaryRoute(
    '/variants/summary',
    'variants',
    'conflicts',
    "Counts of variants, grouped by up to two dimensions, such as conflict_level: each variant's conflict status under the filters.",
  );

  /** Parses a list request for a resource and its sort, or answers 400. */
  function parseList(
    rawQuery: Record<string, unknown>,
    resource: ResourceName,
    order: (sort: string[]) => { sql: string; unknown: string[] },
  ):
    | { ok: true; query: ParsedQuery; order: string }
    | { ok: false; problem: ReturnType<typeof invalid> } {
    const parsed = parseQuery(raw(rawQuery), resource);
    if (!parsed.ok) return { ok: false, problem: invalid(parsed.problems) };
    const sort = order(parsed.query.sort);
    if (sort.unknown.length > 0) {
      return {
        ok: false,
        problem: invalid([
          { path: 'querystring/sort', message: `Unknown sort '${sort.unknown.join(', ')}'.` },
        ]),
      };
    }
    return { ok: true, query: parsed.query, order: sort.sql };
  }

  app.get(
    '/scv-pairs',
    {
      schema: {
        tags: ['conflicts'],
        description:
          'Pairs of SCVs on one variant and classification type, with their conflict level, a page at a time. Sort: level (default -level), variant, a_evaluated, b_evaluated.',
        querystring: documentedQuery('list', 'pairs'),
        response: { 200: list(PairRow) },
      },
    },
    async (request, reply) => {
      const parsed = parseList(request.query, 'pairs', pairOrder);
      if (!parsed.ok) return sendProblem(reply, parsed.problem);
      const release = db.resolve(parsed.query.release);
      const { rows, total } = await listPairs(db, release, parsed.query, parsed.order);
      return {
        release,
        query: parsed.query.canonical,
        data: rows,
        page: { limit: parsed.query.limit, offset: parsed.query.offset, total },
      };
    },
  );

  app.get(
    '/variants',
    {
      schema: {
        tags: ['variants'],
        description:
          'Variants with an SCV matching the filters (side a), each with its conflict status against side b, a page at a time. Sort: conflict (default -conflict,-pairs), pairs, variant.',
        querystring: documentedQuery('list', 'variants'),
        response: { 200: list(VariantRow) },
      },
    },
    async (request, reply) => {
      const parsed = parseList(request.query, 'variants', variantOrder);
      if (!parsed.ok) return sendProblem(reply, parsed.problem);
      const release = db.resolve(parsed.query.release);
      const { rows, total } = await listVariants(db, release, parsed.query, parsed.order);
      return {
        release,
        query: parsed.query.canonical,
        data: rows,
        page: { limit: parsed.query.limit, offset: parsed.query.offset, total },
      };
    },
  );
};

function invalid(problems: { path: string; message: string }[]) {
  return { ...problem(400, 'The request has invalid parameters.'), errors: problems };
}
