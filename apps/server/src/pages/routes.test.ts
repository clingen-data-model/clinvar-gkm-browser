import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database } from '../data/database.ts';
import { buildServer } from '../server.ts';
import { PAGES } from './routes.ts';

const WEB_ROUTES = join(import.meta.dirname, '../../../web/src/routes');

/** A web route file's path: stats.$slug.tsx is /stats/:slug, genes.$id.index.tsx /genes/:id. */
function pathOf(file: string): string {
  const parts = file
    .replace(/\.tsx$/, '')
    .split('.')
    .filter((p) => p !== 'index')
    .map((p) => (p.startsWith('$') ? `:${p.slice(1)}` : p));
  return `/${parts.join('/')}`;
}

describe('page paths', () => {
  it('include every page of the web app, so none is served with a 404', () => {
    const routes = readdirSync(WEB_ROUTES).filter((f) => f.endsWith('.tsx') && f !== '__root.tsx');
    expect(new Set(routes.map(pathOf))).toEqual(new Set(PAGES));
  });
});

describe('page status', () => {
  let server: Awaited<ReturnType<typeof buildServer>>;
  let db: Database;

  beforeAll(async () => {
    db = await Database.open(
      {
        dataDir: mkdtempSync(join(tmpdir(), 'cvb-test-')),
        memoryLimit: '256MB',
        threads: 1,
        queryTimeoutMs: 1000,
        pinnedRelease: null,
      },
      [],
    );
    server = await buildServer({
      db,
      logger: pino({ level: 'silent' }),
      allowedHosts: ['localhost'],
      web: {
        root: mkdtempSync(join(tmpdir(), 'cvb-web-')),
        indexHtml: '<!doctype html><title>app</title>',
        contentSecurityPolicy: "default-src 'self'",
      },
    });
  });
  afterAll(async () => {
    await server.close();
    db.close();
  });

  const status = async (url: string) =>
    (await server.inject({ method: 'GET', url, headers: { host: 'localhost' } })).statusCode;

  it('serves the app with 200 for a page, and 404 for anything else', async () => {
    expect(await status('/stats')).toBe(200);
    expect(await status('/stats/aggregate-classification')).toBe(200);
    expect(await status('/stats/nothing')).toBe(404);
    expect(await status('/nothing')).toBe(404);
  });
});
