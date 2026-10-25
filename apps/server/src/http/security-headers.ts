import type { FastifyInstance } from 'fastify';

/**
 * Headers for every response. HSTS is left to a hosted deployment's TLS proxy; locally there is
 * no TLS.
 */
export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook('onRequest', (_request, reply, done) => {
    reply.headers({
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'x-frame-options': 'DENY',
      'cross-origin-opener-policy': 'same-origin',
    });
    done();
  });
}
