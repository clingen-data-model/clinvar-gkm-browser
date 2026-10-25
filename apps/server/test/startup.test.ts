import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { Database } from '../src/data/database.ts';
import { DERIVED_SCHEMA, findReleases } from '../src/data/releases.ts';
import { FIXTURE_DIR, FIXTURE_RELEASE } from './helpers.ts';

describe('config', () => {
  it('treats empty variables as unset', () => {
    const config = loadConfig({ DUCKDB_THREADS: '', QUERY_TIMEOUT_MS: '', CLINVAR_RELEASE: '' });
    expect(config.duckdb.queryTimeoutMs).toBe(30_000);
    expect(config.duckdb.threads).toBeGreaterThan(0);
    expect(config.pinnedRelease).toBeNull();
  });
});

describe('releases on disk', () => {
  it('serves the good releases when another is truncated or missing a table', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cvb-releases-'));
    const derived = join(dataDir, 'derived', String(DERIVED_SCHEMA));
    const fixture = join(FIXTURE_DIR, 'derived', String(DERIVED_SCHEMA), FIXTURE_RELEASE);
    cpSync(fixture, join(derived, FIXTURE_RELEASE), { recursive: true });
    cpSync(fixture, join(derived, '2026-10-25'), { recursive: true });
    writeFileSync(join(derived, '2026-10-25', 'manifest.json'), '{"clinvar_release": "2026-');
    cpSync(fixture, join(derived, '2026-11-01'), { recursive: true });
    rmSync(join(derived, '2026-11-01', 'gene.parquet'));
    const manifest = join(derived, '2026-11-01', 'manifest.json');
    writeFileSync(
      manifest,
      readFileSync(manifest, 'utf8').replace(`"${FIXTURE_RELEASE}"`, '"2026-11-01"'),
    );

    const { releases, skipped } = findReleases(dataDir);
    expect(releases.map((r) => r.release.clinvarRelease)).toEqual([FIXTURE_RELEASE]);
    expect(skipped.map((s) => s.reason)).toEqual([
      expect.stringMatching(/unreadable manifest/),
      expect.stringMatching(/missing gene\.parquet/),
    ]);

    const db = await Database.open(
      { dataDir, memoryLimit: '1GB', threads: 1, queryTimeoutMs: 10_000, pinnedRelease: null },
      releases,
    );
    expect(db.available().current).toBe(FIXTURE_RELEASE);
    db.close();
    rmSync(dataDir, { recursive: true });
  });
});
