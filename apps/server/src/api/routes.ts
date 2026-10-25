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
} from '@cvb/shared/api';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Database } from '../data/database.ts';
import { problem, sendProblem } from '../http/errors.ts';
import { conditionDetail, geneDetail, submitterDetail } from './entities/queries.ts';
import { scvDetail, variantScvs } from './scvs/queries.ts';
import { variantDetail } from './variants/queries.ts';

const IdParams = z.object({ id: IntId });

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
};
