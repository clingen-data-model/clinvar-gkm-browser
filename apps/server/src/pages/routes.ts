// Page routes: the built web app's files, and index.html for every page path, after which the
// web app takes over. The page sets its own title once its data loads.

import { sep } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { WebApp } from './web-app.ts';

/** The web app's pages (apps/web/src/routes); any other path gets index.html with a 404. */
const PAGES = [
  '/',
  '/search',
  '/variants/:id',
  '/scvs/:id',
  '/genes/:id',
  '/genes/:id/conflicts',
  '/submitters/:id',
  '/submitters/:id/conflicts',
  '/submitters/:id/vs/:otherId',
  '/conditions/:id',
  '/conditions/:id/conflicts',
  '/schema',
];

/** Paths that are never pages, so a miss under them is a plain 404, not the app. */
const NOT_PAGES = ['/api/', '/-/', '/assets/'] as const;

export function isPagePath(url: string): boolean {
  return !NOT_PAGES.some((prefix) => url.startsWith(prefix));
}

export function sendPage(reply: FastifyReply, web: WebApp, found: boolean): FastifyReply {
  return reply
    .status(found ? 200 : 404)
    .type('text/html; charset=utf-8')
    .header('cache-control', 'no-cache')
    .header('content-security-policy', web.contentSecurityPolicy)
    .send(web.indexHtml);
}

export const pageRoutes: FastifyPluginAsync<{ web: WebApp }> = async (app, { web }) => {
  await app.register(fastifyStatic, {
    root: web.root,
    // A route per built file, found at startup; anything else falls through to not-found.
    wildcard: false,
    index: false,
    // index.html is only ever sent by sendPage, with its policy headers.
    allowedPath: (pathName) => pathName !== '/index.html',
    cacheControl: false,
    setHeaders: (reply, path) => {
      // Vite content-hashes everything under assets/, so those never change.
      const immutable = path.includes(`${sep}assets${sep}`);
      reply.header(
        'cache-control',
        immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
      );
    },
  });
  for (const path of PAGES) {
    app.get(path, { schema: { hide: true } }, (_request, reply) => sendPage(reply, web, true));
  }
};
