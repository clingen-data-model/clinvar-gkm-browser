// /-/healthz: the process is up (liveness).
// /-/readyz: a release is loaded and answers a query (readiness). Not ready is normal before the
// first download; the web app shows its data page instead.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Database } from '../../data/database.ts';
import { problem, sendProblem } from '../errors.ts';

export const healthRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  app.get('/-/healthz', { schema: { hide: true } }, (_request, reply) =>
    reply.type('text/plain').send('ok'),
  );

  app.get('/-/readyz', { schema: { hide: true } }, async (request, reply) => {
    const { current } = db.available();
    if (current === null) return sendProblem(reply, problem(503, 'No release is loaded.'));
    try {
      await db.query(current, 'SELECT count(*) FROM release');
    } catch (error) {
      request.log.warn({ err: error }, 'readiness: release query failed');
      return sendProblem(reply, problem(503, `Release ${current} does not answer.`));
    }
    return { status: 'ready', release: current };
  });
};
