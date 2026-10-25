// A server on localhost is still reachable by any web page the user opens (docs/local-app.md#security).
// Two checks keep other sites out:
//   - Host: only the names this server answers to, which blocks DNS rebinding (a site pointing
//     its own domain at 127.0.0.1 to read the API).
//   - Origin: requests that change state must come from this server's own pages: the same host
//     and port as the request, so pages on other localhost ports (other dev servers, notebooks)
//     are refused too.

import type { FastifyInstance } from 'fastify';
import { problem, sendProblem } from './errors.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The host name without its port; IPv6 literals keep their brackets. */
export function hostName(host: string): string {
  const value = host.trim().toLowerCase();
  if (value.startsWith('[')) return value.slice(0, value.indexOf(']') + 1);
  return value.split(':')[0] ?? '';
}

export function registerLocalAccess(app: FastifyInstance, allowedHosts: string[]): void {
  const allowed = new Set(allowedHosts);
  app.addHook('onRequest', (request, reply, done) => {
    const host = hostName(request.headers.host ?? '');
    if (!allowed.has(host)) {
      request.log.warn({ host: request.headers.host }, 'rejected request for an unknown host');
      void sendProblem(reply, problem(403, 'This server does not answer to that host name.'));
      return;
    }
    if (!SAFE_METHODS.has(request.method)) {
      const origin = request.headers.origin;
      const sameOrigin =
        origin === undefined
          ? request.headers['sec-fetch-site'] !== 'cross-site'
          : URL.canParse(origin) &&
            new URL(origin).host === (request.headers.host ?? '').trim().toLowerCase();
      if (!sameOrigin) {
        void sendProblem(
          reply,
          problem(403, 'Requests that change data must come from this site.'),
        );
        return;
      }
    }
    done();
  });
}
