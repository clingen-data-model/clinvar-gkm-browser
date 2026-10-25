import {
  ConditionDetail,
  GeneDetail,
  ProblemDetails,
  ReleaseList,
  ScvDetail,
  ScvRow,
  SubmitterDetail,
  VariantDetail,
  item,
} from '@cvb/shared/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FIXTURE_RELEASE, fixtureServer } from './helpers.ts';

let server: Awaited<ReturnType<typeof fixtureServer>>;

beforeAll(async () => {
  server = await fixtureServer();
});
afterAll(async () => {
  await server.close();
});

/** GETs a URL and parses the body with the response's shared schema, as the web app does. */
async function get<T extends z.ZodType>(url: string, schema: T, host = 'localhost') {
  const response = await server.app.inject({ method: 'GET', url, headers: { host } });
  return { status: response.statusCode, body: schema.parse(response.json()) };
}

const ScvList = z.object({ release: z.iso.date(), data: z.array(ScvRow) });

describe('releases', () => {
  it('lists the fixture release as current', async () => {
    const { status, body } = await get('/api/v1/releases', ReleaseList);
    expect(status).toBe(200);
    expect(body.current).toBe(FIXTURE_RELEASE);
    expect(body.data.map((r) => r.clinvarRelease)).toEqual([FIXTURE_RELEASE]);
  });

  it('refuses a release that is not on disk', async () => {
    const { status, body } = await get('/api/v1/variants/10?release=2020-01-01', ProblemDetails);
    expect(status).toBe(404);
    expect(body.detail).toBe('Release 2020-01-01 is not available.');
  });
});

describe('variants', () => {
  it('returns a variant with its VRS allele, MANE HGVS and aggregate tree', async () => {
    const { status, body } = await get('/api/v1/variants/10', item(VariantDetail));
    expect(status).toBe(200);
    expect(body.release).toBe(FIXTURE_RELEASE);
    const variant = body.data;
    expect(variant).toMatchObject({
      variationId: 10,
      vcvAccession: 'VCV000000010',
      name: 'NM_000410.4(HFE):c.187C>G (p.His63Asp)',
      vrs: { kind: 'allele', sequenceAccession: 'NC_000006.12' },
    });
    expect(variant.hgvs[0]).toMatchObject({ maneSelect: true, expression: 'NM_000410.4:c.187C>G' });
    expect(variant.genes.map((g) => g.symbol)).toContain('HFE');
    const roots = variant.aggregates.filter((a) => a.nodeKind === 'root');
    expect(roots.length).toBeGreaterThan(0);
    expect(roots.every((a) => a.parentKey === null)).toBe(true);
  });

  it("lists a variant's SCVs with normalized terms", async () => {
    const { status, body } = await get('/api/v1/variants/10/scvs', ScvList);
    expect(status).toBe(200);
    expect(body.data.length).toBeGreaterThan(50);
    expect(body.data.every((r) => r.variationId === 10)).toBe(true);
    expect(body.data.some((r) => r.term === 'p' && r.bucket === 'P')).toBe(true);
  });

  it('answers 404 for an unknown variant and 400 for a malformed id', async () => {
    expect((await get('/api/v1/variants/999999999', ProblemDetails)).status).toBe(404);
    const malformed = await get('/api/v1/variants/abc', ProblemDetails);
    expect(malformed.status).toBe(400);
    expect(malformed.body.errors?.[0]?.path).toBe('params/id');
  });
});

describe('entities', () => {
  it('returns an SCV with its aggregate statements', async () => {
    const { body: scvs } = await get('/api/v1/variants/10/scvs', ScvList);
    const scvId = scvs.data[0]?.scvId ?? 0;
    const { status, body } = await get(`/api/v1/scvs/${String(scvId)}`, item(ScvDetail));
    expect(status).toBe(200);
    expect(body.data.scvId).toBe(scvId);
    expect(body.data.variationId).toBe(10);
    expect(body.data.vcvStatementId).toMatch(/^VCV000000010\./);
    expect(body.data.rcvStatementId).toMatch(/^RCV/);
  });

  it('counts a gene, its submitters and conditions', async () => {
    const gene = await get('/api/v1/genes/3077', item(GeneDetail));
    expect(gene.status).toBe(200);
    // 339 variants are within HFE (254 alone, 85 with the overlapping HFE-AS1); 334 have SCVs.
    expect(gene.body.data).toMatchObject({ symbol: 'HFE', variantCount: 334 });

    const { body: scvs } = await get('/api/v1/variants/10/scvs', ScvList);
    const row = scvs.data[0];
    const submitter = await get(
      `/api/v1/submitters/${String(row?.submitter.submitterId)}`,
      item(SubmitterDetail),
    );
    expect(submitter.status).toBe(200);
    const condition = await get(
      `/api/v1/conditions/${String(row?.conditions[0]?.conditionId)}`,
      item(ConditionDetail),
    );
    expect(condition.status).toBe(200);
  });
});

describe('local access', () => {
  it('rejects a request for a host name this server does not answer to', async () => {
    const { status } = await get('/api/v1/releases', ProblemDetails, 'evil.example:8080');
    expect(status).toBe(403);
  });
});
