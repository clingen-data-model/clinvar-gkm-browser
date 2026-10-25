// Builds the server over the committed fixture release (scripts/make-fixture.sh), for inject().

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { Database } from '../src/data/database.ts';
import { findReleases } from '../src/data/releases.ts';
import { buildServer } from '../src/server.ts';

export const FIXTURE_DIR = join(import.meta.dirname, 'fixture');
export const FIXTURE_RELEASE = '2026-10-18';

export async function fixtureServer() {
  const db = await Database.open(
    {
      // Releases are read from the fixture; DuckDB's spill directory goes somewhere disposable.
      dataDir: mkdtempSync(join(tmpdir(), 'cvb-test-')),
      memoryLimit: '1GB',
      threads: 2,
      queryTimeoutMs: 10_000,
      pinnedRelease: null,
    },
    findReleases(FIXTURE_DIR).releases,
  );
  const app = await buildServer({
    db,
    logger: pino({ level: 'silent' }),
    allowedHosts: ['localhost', '127.0.0.1'],
  });
  return {
    app,
    close: async () => {
      await app.close();
      db.close();
    },
  };
}
