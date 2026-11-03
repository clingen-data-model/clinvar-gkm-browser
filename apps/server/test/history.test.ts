// The server over a release history (docs/history.md): a two-release history built from the
// fixture release in history.sh's layout, read as of each release.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import {
  item,
  ProblemDetails,
  ReleaseList,
  ScvDetail,
  ScvVersion,
  VcvVersion,
} from '@cvb/shared/api';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Database } from '../src/data/database.ts';
import { DERIVED_SCHEMA, findHistory, findReleases } from '../src/data/releases.ts';
import { buildServer } from '../src/server.ts';
import { FIXTURE_DIR, FIXTURE_RELEASE } from './helpers.ts';

const NEXT = '2026-10-25';
const VARIANT = 10;
const CHANGED = 198337; // on VARIANT, a new version reclassifying it in NEXT
const DELETED = 20169; // on VARIANT, gone in NEXT
// What NEXT changes: rows replaced (with the new values) and rows closed.
const NEXT_CHANGES: Partial<Record<string, { where: string; replace: string; closes: string }>> = {
  scv: {
    where: `scv_id = ${String(CHANGED)}`,
    replace: `scv_version + 1 AS scv_version, 'Benign' AS classification`,
    closes: `scv_id IN (${String(CHANGED)}, ${String(DELETED)})`,
  },
  variant: {
    where: `variation_id = ${String(VARIANT)}`,
    replace: 'vcv_version + 1 AS vcv_version',
    closes: `variation_id = ${String(VARIANT)}`,
  },
};
// Each history table's natural key, as scripts/history.sh names closed rows.
const TABLES: Record<string, string[]> = {
  variant: ['variation_id'],
  variant_gene: ['variation_id', 'gene_id'],
  variant_hgvs: ['variation_id', 'expression', 'protein_expression'],
  variant_xref: ['variation_id', 'system', 'code'],
  vcv_statement: ['statement_id'],
  rcv_statement: ['statement_id'],
  scv: ['scv_id'],
  scv_condition: ['scv_id', 'condition_id'],
  scv_classification_pair: ['a_scv_id', 'b_scv_id'],
  sequenceReference: ['id'],
  location: ['id'],
  allele: ['id'],
  copyNumberCount: ['id'],
  copyNumberChange: ['id'],
  gene: ['id'],
  condition: ['id'],
  conditionSet: ['id'],
  submitter: ['id'],
};
const PLAIN = ['classification_type', 'classification_term', 'submission_level', 'review_status'];

/** Writes both releases' files; releases.parquet lists only `listed`, as if the rest weren't applied. */
async function writeHistory(dataDir: string, listed = [FIXTURE_RELEASE, NEXT]): Promise<void> {
  const source = join(FIXTURE_DIR, 'derived', String(DERIVED_SCHEMA), FIXTURE_RELEASE);
  const dir = join(dataDir, 'history', String(DERIVED_SCHEMA));
  const part = (kind: string, table: string, release: string) =>
    `'${join(dir, kind, table, `release=${release}`, 'data.parquet')}'`;
  const statements = [];
  for (const [table, key] of Object.entries(TABLES)) {
    const from = `read_parquet('${join(source, `${table}.parquet`)}')`;
    statements.push(
      `COPY (FROM ${from}) TO ${part('added', table, FIXTURE_RELEASE)} (FORMAT parquet)`,
      `COPY (SELECT ${key.join(', ')}, DATE '${FIXTURE_RELEASE}' AS valid_from FROM ${from} LIMIT 0)
         TO ${part('closed', table, FIXTURE_RELEASE)} (FORMAT parquet)`,
    );
    // The next release changes only the rows NEXT_CHANGES names.
    const change = NEXT_CHANGES[table];
    statements.push(
      `COPY (${change ? `SELECT * REPLACE (${change.replace}) FROM ${from} WHERE ${change.where}` : `FROM ${from} LIMIT 0`})
         TO ${part('added', table, NEXT)} (FORMAT parquet)`,
      `COPY (SELECT ${key.join(', ')}, DATE '${FIXTURE_RELEASE}' AS valid_from FROM ${from}
             WHERE ${change ? change.closes : 'false'})
         TO ${part('closed', table, NEXT)} (FORMAT parquet)`,
    );
  }
  for (const table of PLAIN) {
    statements.push(
      `COPY (FROM read_parquet('${join(source, `${table}.parquet`)}')) TO '${join(dir, 'plain', `${table}.parquet`)}' (FORMAT parquet)`,
    );
  }
  statements.push(
    `COPY (SELECT * FROM (VALUES (DATE '${FIXTURE_RELEASE}', 'bundle', 'base.json.gz', '2026-10-22', '1.1.0', TIMESTAMP '2026-10-30 00:00:00'),
                                 (DATE '${NEXT}', 'delta', 'delta.json.gz', '2026-10-27', '1.1.0', TIMESTAMP '2026-10-30 00:01:00'))
            t(release, origin, dataset, build_date, schema_version, applied_at)
          WHERE strftime(release, '%Y-%m-%d') IN (${listed.map((r) => `'${r}'`).join(', ')}))
       TO '${join(dir, 'releases.parquet')}' (FORMAT parquet)`,
  );
  for (const table of Object.keys(TABLES)) {
    for (const kind of ['added', 'closed']) {
      for (const release of [FIXTURE_RELEASE, NEXT]) {
        mkdirSync(join(dir, kind, table, `release=${release}`), { recursive: true });
      }
    }
  }
  mkdirSync(join(dir, 'plain'), { recursive: true });
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  try {
    for (const sql of statements) await connection.run(sql);
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

let server: Awaited<ReturnType<typeof buildServer>>;
let db: Database;

beforeAll(async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'cvb-history-'));
  await writeHistory(dataDir);
  db = await Database.open(
    { dataDir, memoryLimit: '1GB', threads: 2, queryTimeoutMs: 10_000, pinnedRelease: null },
    [],
  );
  const history = findHistory(dataDir);
  if (history === null) throw new Error('no history written');
  await db.addHistory(history);
  server = await buildServer({
    db,
    logger: pino({ level: 'silent' }),
    allowedHosts: ['localhost'],
  });
});

afterAll(async () => {
  await server.close();
  db.close();
});

async function get<T extends z.ZodType>(url: string, schema: T) {
  const response = await server.inject({ method: 'GET', url, headers: { host: 'localhost' } });
  return { status: response.statusCode, body: schema.parse(response.json()) };
}

describe('a release history', () => {
  it('lists every release in it, the newest current, with row counts as of each', async () => {
    const { body } = await get('/api/v1/releases', ReleaseList);
    expect(body.current).toBe(NEXT);
    expect(body.data.map((r) => r.clinvarRelease)).toEqual([FIXTURE_RELEASE, NEXT]);
    const scvRows = body.data.map((r) => r.tables.find((t) => t.name === 'scv')?.rows);
    expect(scvRows[1]).toBe((scvRows[0] ?? 0) - 1);
  });

  it('reads a record as of each release', async () => {
    const before = await get(
      `/api/v1/scvs/${String(CHANGED)}?release=${FIXTURE_RELEASE}`,
      item(ScvDetail),
    );
    expect(before.body.data.classification).toBe('Uncertain significance');
    const after = await get(`/api/v1/scvs/${String(CHANGED)}`, item(ScvDetail));
    expect(after.body.release).toBe(NEXT);
    expect(after.body.data.classification).toBe('Benign');
  });

  it('drops a deleted record from later releases only', async () => {
    const before = await server.inject({
      url: `/api/v1/scvs/${String(DELETED)}?release=${FIXTURE_RELEASE}`,
      headers: { host: 'localhost' },
    });
    expect(before.statusCode).toBe(200);
    const after = await server.inject({
      url: `/api/v1/scvs/${String(DELETED)}`,
      headers: { host: 'localhost' },
    });
    expect(after.statusCode).toBe(404);
  });

  it('refuses a date between releases, naming the releases served', async () => {
    const { status, body } = await get(
      `/api/v1/scvs/${String(CHANGED)}?release=2026-10-21`,
      ProblemDetails,
    );
    expect(status).toBe(404);
    expect(body.releases).toEqual([FIXTURE_RELEASE, NEXT]);
  });

  it("lists a variant's VCV versions with the releases each held in", async () => {
    const { body } = await get(
      `/api/v1/variants/${String(VARIANT)}/versions`,
      z.object({ data: z.array(VcvVersion) }),
    );
    const [first, second] = body.data;
    expect(body.data).toHaveLength(2);
    expect(first).toMatchObject({ from: FIXTURE_RELEASE, to: NEXT, fromStart: true });
    expect(second).toMatchObject({
      version: (first?.version ?? 0) + 1,
      from: NEXT,
      to: null,
      fromStart: false,
    });
  });

  it("lists an SCV's versions with the VCV versions they overlapped", async () => {
    const { body } = await get(
      `/api/v1/scvs/${String(CHANGED)}/versions`,
      z.object({ data: z.array(ScvVersion) }),
    );
    expect(body.data.map((v) => [v.classification, v.from, v.to])).toEqual([
      ['Uncertain significance', FIXTURE_RELEASE, NEXT],
      ['Benign', NEXT, null],
    ]);
    expect(body.data.map((v) => v.vcvVersions.map((x) => x.from))).toEqual([
      [FIXTURE_RELEASE],
      [NEXT],
    ]);
    const deleted = await get(
      `/api/v1/scvs/${String(DELETED)}/versions`,
      z.object({ data: z.array(ScvVersion) }),
    );
    expect(deleted.body.data.map((v) => v.to)).toEqual([NEXT]);
  });
});

describe('a release still being applied', () => {
  let partial: Awaited<ReturnType<typeof buildServer>>;
  let partialDb: Database;

  beforeAll(async () => {
    // NEXT's files are in, but it isn't listed yet: scripts/history.sh lists a release last.
    const dataDir = mkdtempSync(join(tmpdir(), 'cvb-history-'));
    await writeHistory(dataDir, [FIXTURE_RELEASE]);
    partialDb = await Database.open(
      { dataDir, memoryLimit: '1GB', threads: 2, queryTimeoutMs: 10_000, pinnedRelease: null },
      [],
    );
    const history = findHistory(dataDir);
    if (history === null) throw new Error('no history written');
    await partialDb.addHistory(history);
    partial = await buildServer({
      db: partialDb,
      logger: pino({ level: 'silent' }),
      allowedHosts: ['localhost'],
    });
  });

  afterAll(async () => {
    await partial.close();
    partialDb.close();
  });

  it('counts for nothing until it is listed', async () => {
    const response = await partial.inject({
      url: `/api/v1/variants/${String(VARIANT)}/versions`,
      headers: { host: 'localhost' },
    });
    const versions = z.object({ data: z.array(VcvVersion) }).parse(response.json()).data;
    expect(versions.map((v) => [v.from, v.to])).toEqual([[FIXTURE_RELEASE, null]]);
  });
});

describe('a release history that fails to load', () => {
  it('leaves the derived releases served as they were', async () => {
    // The history's first release is the fixture's date, so it would replace the derived one.
    const dataDir = mkdtempSync(join(tmpdir(), 'cvb-history-'));
    await writeHistory(dataDir);
    const history = findHistory(dataDir);
    if (history === null) throw new Error('no history written');
    writeFileSync(join(history, 'added', 'scv', `release=${NEXT}`, 'data.parquet'), 'not parquet');
    const derived = findReleases(FIXTURE_DIR).releases;
    const broken = await Database.open(
      { dataDir, memoryLimit: '1GB', threads: 2, queryTimeoutMs: 10_000, pinnedRelease: null },
      derived,
    );
    try {
      await expect(broken.addHistory(history)).rejects.toThrow();
      expect(broken.hasHistory).toBe(false);
      const { current, releases } = broken.available();
      expect(current).toBe(FIXTURE_RELEASE);
      expect(releases.map((r) => r.dir)).toEqual(derived.map((r) => r.dir));
      const [row] = await broken.query(FIXTURE_RELEASE, 'SELECT count(*) AS n FROM scv');
      expect(Number(row?.['n'])).toBeGreaterThan(0);
    } finally {
      broken.close();
    }
  });
});
