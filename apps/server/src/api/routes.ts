// /api/v1: releases and entity reads (docs/api.md#resources). Every read takes an optional
// `release`; the response says which release answered.

import {
  ConditionDetail,
  GeneDetail,
  IntId,
  ReleaseList,
  ReleaseQuery,
  ScvDetail,
  ScvRow,
  SubmitterDetail,
  VariantDetail,
  item,
  list,
  SummaryResponse,
} from '@cvb/shared/api';
import { documentedQuery, parseQuery, type RawQuery } from '@cvb/shared/query';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Database } from '../data/database.ts';
import { problem, sendProblem } from '../http/errors.ts';
import { conditionDetail, geneDetail, submitterDetail } from './entities/queries.ts';
import { listScvs, scvDetail, scvOrder, summarizeScvs, variantScvs } from './scvs/queries.ts';
import { variantDetail } from './variants/queries.ts';

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

  app.get('/genes/:id', { schema: itemSchema('genes', GeneDetail) }, async (req, reply) => {
    const release = db.resolve(req.query.release);
    const data = await geneDetail(db, release, req.params.id);
    if (data === null) return sendProblem(reply, notFound('gene', req.params.id, release));
    return { release, data };
  });

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

  app.get(
    '/scvs/summary',
    {
      schema: {
        tags: ['scvs'],
        description: 'Counts of the SCVs matching the filters, grouped by up to two dimensions.',
        querystring: documentedQuery('summary'),
        response: { 200: SummaryResponse },
      },
    },
    async (request, reply) => {
      const parsed = parseQuery(raw(request.query));
      if (!parsed.ok) return sendProblem(reply, invalid(parsed.problems));
      const release = db.resolve(parsed.query.release);
      const summary = await summarizeScvs(db, release, parsed.query);
      return { release, query: parsed.query.canonical, ...summary };
    },
  );
};

function invalid(problems: { path: string; message: string }[]) {
  return { ...problem(400, 'The request has invalid parameters.'), errors: problems };
}
