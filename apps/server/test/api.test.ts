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
  list,
  PairRow,
  SearchResponse,
  SummaryResponse,
  VariantRow,
  Vocabularies,
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
    // Within HFE by default: 250 variants with SCVs alone, 84 with the overlapping HFE-AS1.
    expect(gene.body.data).toMatchObject({
      symbol: 'HFE',
      relationships: ['single', 'overlap'],
      variantCount: 334,
    });
    const byRelationship = Object.fromEntries(
      gene.body.data.relationshipCounts.map((r) => [r.relationship, r.variants]),
    );
    expect(byRelationship).toMatchObject({ single: 250, overlap: 84, spanning: 18, near: 5 });
    const all = await get(
      '/api/v1/genes/3077?gene_relationship=single,overlap,spanning,near',
      item(GeneDetail),
    );
    expect(all.body.data.variantCount).toBe(357);

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

  it('refuses a change from a page on another port, with the usual headers', async () => {
    const post = (origin: string) =>
      server.app.inject({
        method: 'POST',
        url: '/api/v1/releases',
        headers: { host: 'localhost:8080', origin },
      });
    const other = await post('http://localhost:5173');
    expect(other.statusCode).toBe(403);
    expect(other.headers['x-content-type-options']).toBe('nosniff');
    // The same origin passes the check (and finds no such route).
    expect((await post('http://localhost:8080')).statusCode).toBe(404);
  });
});

const ScvPage = list(ScvRow);

describe('lists and summaries', () => {
  it('pages SCVs matching filters, with a count on request', async () => {
    const { status, body } = await get(
      '/api/v1/scvs?gene=3077&bucket=P&limit=5&count=true',
      ScvPage,
    );
    expect(status).toBe(200);
    expect(body.data).toHaveLength(5);
    expect(body.data.every((r) => r.bucket === 'P')).toBe(true);
    expect(body.page.total).toBeGreaterThan(5);
    expect(body.query).toMatchObject({
      gene: ['3077'],
      bucket: ['P'],
      gene_relationship: ['single', 'overlap'],
    });
  });

  it('sorts by date last evaluated, newest first', async () => {
    const { body } = await get('/api/v1/scvs?variant=10&sort=-evaluated', ScvPage);
    const dates = body.data.map((r) => r.dateLastEvaluated ?? '');
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it('counts by one dimension, with labels and totals', async () => {
    const { status, body } = await get(
      '/api/v1/scvs/summary?gene=3077&group_by=bucket',
      SummaryResponse,
    );
    expect(status).toBe(200);
    const sum = body.rows.reduce((n, r) => n + Number(r['scvs']), 0);
    expect(sum).toBe(body.totals['scvs']);
    expect(body.dimensions[0]?.labels['P']).toBe('Pathogenic/Likely pathogenic');
  });

  it('crosses two dimensions, paging the first', async () => {
    const { body } = await get(
      '/api/v1/scvs/summary?gene=3077&group_by=submitter,bucket&limit=2&measure=scvs,variants',
      SummaryResponse,
    );
    const submitters = new Set(body.rows.map((r) => r['submitter']));
    expect(submitters.size).toBe(2);
    expect(body.page.total).toBeGreaterThan(2);
    expect(Object.keys(body.dimensions[0]?.labels ?? {})).toHaveLength(2);
  });

  it("marks each row of a gene's list with its variant's relationship to the gene", async () => {
    const { body } = await get('/api/v1/scvs?gene=3077&variant=10&limit=1', ScvPage);
    expect(body.data[0]?.geneRelationship).toEqual({
      relationship: 'overlap',
      otherGenes: ['HFE-AS1'],
      otherGeneCount: 1,
    });
    const unfiltered = await get('/api/v1/scvs?variant=10&limit=1', ScvPage);
    expect(unfiltered.body.data[0]?.geneRelationship).toBeNull();
    const bad = await get('/api/v1/genes/3077?gene_relationship=within', ProblemDetails);
    expect(bad.status).toBe(400);
  });

  it('rejects unknown filters and sort keys with the parameter named', async () => {
    const bad = await get('/api/v1/scvs?bogus=1', ProblemDetails);
    expect(bad.status).toBe(400);
    expect(bad.body.errors?.[0]?.path).toBe('querystring/bogus');
    const sort = await get('/api/v1/scvs?sort=name', ProblemDetails);
    expect(sort.body.errors?.[0]?.path).toBe('querystring/sort');
  });
});

describe('search and vocabularies', () => {
  it.each([
    ['VCV000000010', 'variant', 10],
    ['10', 'variant', 10],
    ['NM_000410.4:c.187C>G', 'variant', 10],
    ['HFE', 'gene', 3077],
  ])('finds %s', async (q, kind, id) => {
    const { status, body } = await get(`/api/v1/search?q=${encodeURIComponent(q)}`, SearchResponse);
    expect(status).toBe(200);
    expect(body.results[0]).toMatchObject({ kind, id });
  });

  it('returns code lists and the query registry', async () => {
    const { body } = await get('/api/v1/vocabularies', item(Vocabularies));
    expect(
      body.data.terms.find((t) => t.classificationType === 'PATH' && t.term === 'vus-h'),
    ).toMatchObject({
      significance: 1,
      bucket: 'V',
    });
    expect(body.data.filters.map((f) => f.name)).toContain('gene');
    expect(body.data.dimensions.scvs.map((d) => d.name)).toContain('submitter');
    expect(body.data.dimensions.pairs.map((d) => d.name)).toEqual(
      expect.arrayContaining(['a.submitter', 'b.term', 'conflict_level']),
    );
    expect(body.data.placeholderConditions.length).toBeGreaterThan(0);
  });
});

const PairPage = list(PairRow);
const VariantPage = list(VariantRow);

describe('conflicts: pairs and variants', () => {
  it("counts a gene's variants by conflict status, adding up to the total", async () => {
    const { status, body } = await get(
      '/api/v1/variants/summary?gene=3077&group_by=conflict_level',
      SummaryResponse,
    );
    expect(status).toBe(200);
    const sum = body.rows.reduce((n, r) => n + Number(r['variants']), 0);
    expect(sum).toBe(body.totals['variants']);
    expect(body.rows.map((r) => r['conflict_level'])).toEqual(
      expect.arrayContaining(['single', 'none', '5']),
    );
    expect(body.query).toMatchObject({ condition_match: ['strict'], flagged: ['exclude'] });
  });

  it('lists conflicting variants with their status and SCV counts', async () => {
    const { body } = await get(
      '/api/v1/variants?gene=3077&min_conflict_level=5&count=true',
      VariantPage,
    );
    expect(body.data.map((v) => v.variationId)).toContain(10);
    expect(body.data.every((v) => v.conflictLevel === '5')).toBe(true);
    const h63d = body.data.find((v) => v.variationId === 10);
    expect(h63d?.buckets.P).toBeGreaterThan(0);
    expect(h63d?.aggregate?.classification).toMatch(/Conflicting/);
  });

  it('lists pairs with both SCVs, from two submitters', async () => {
    const { body } = await get(
      '/api/v1/scv-pairs?variant=10&min_conflict_level=5&limit=10',
      PairPage,
    );
    expect(body.data.length).toBeGreaterThan(0);
    for (const p of body.data) {
      expect(p.level).toBe(5);
      expect(p.a.variationId).toBe(10);
      expect(p.b.variationId).toBe(10);
      expect(p.a.submitter.submitterId).not.toBe(p.b.submitter.submitterId);
      // One side is pathogenic or likely pathogenic and the other isn't.
      expect([p.a.bucket, p.b.bucket].filter((b) => b === 'P')).toHaveLength(1);
    }
  });

  it('crosses the two sides in a term grid that adds up to the pairs', async () => {
    const grid = await get(
      '/api/v1/scv-pairs/summary?variant=10&group_by=a.term,b.term&limit=500',
      SummaryResponse,
    );
    const sum = grid.body.rows.reduce((n, r) => n + Number(r['pairs']), 0);
    expect(sum).toBe(grid.body.totals['pairs']);
  });

  it('finds more conflicts as the condition rule loosens, and with flagged SCVs', async () => {
    const pairs = async (extra: string) => {
      const { body } = await get(
        `/api/v1/scv-pairs/summary?gene=3077&min_conflict_level=2&group_by=conflict_level${extra}`,
        SummaryResponse,
      );
      return body.totals['pairs'] ?? 0;
    };
    const strict = await pairs('');
    const wildcard = await pairs('&condition_match=wildcard');
    const any = await pairs('&condition_match=any');
    expect(strict).toBeLessThanOrEqual(wildcard);
    expect(wildcard).toBeLessThanOrEqual(any);
    expect(strict).toBeLessThan(any);
    expect(await pairs('&condition_match=any&flagged=include')).toBeGreaterThanOrEqual(any);
  });

  it('compares a submitter with itself, and refuses side filters on SCVs', async () => {
    const { body: scvs } = await get('/api/v1/variants/10/scvs', ScvList);
    const lab = scvs.data[0]?.submitter.submitterId ?? 0;
    const self = await get(
      `/api/v1/scv-pairs?a.submitter=${String(lab)}&b.submitter=${String(lab)}&distinct_submitters=false`,
      PairPage,
    );
    expect(self.status).toBe(200);
    expect(self.body.query).toMatchObject({ distinct_submitters: ['false'] });
    const bad = await get('/api/v1/scvs?a.submitter=1', ProblemDetails);
    expect(bad.status).toBe(400);
  });
});
