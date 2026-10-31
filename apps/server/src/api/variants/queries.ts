// Variant reads. The detail is assembled from a few small queries, each reading only the rows
// of one variant (the tables are sorted by variation_id).

import type {
  VcvVersion} from '@cvb/shared/api';
import {
  AggregateStatement,
  VariantDetail,
  VariantGene,
  VariantHgvs,
  Xref,
  type VariantRow,
} from '@cvb/shared/api';
import { SqlParams, type ParsedQuery } from '@cvb/shared/query';
import { z } from 'zod';
import type { Database } from '../../data/database.ts';

const Core = VariantDetail.omit({
  vrs: true,
  genes: true,
  hgvs: true,
  xrefs: true,
  aggregates: true,
});

export async function variantDetail(
  db: Database,
  release: string,
  variationId: number,
): Promise<VariantDetail | null> {
  const [core, genes, hgvs, xrefs, aggregates] = await Promise.all([
    db.query(
      release,
      `SELECT
         v.variation_id AS "variationId",
         'VCV' || lpad(v.variation_id::VARCHAR, 9, '0') AS "vcvAccession",
         v.vcv_version AS "vcvVersion",
         v.name AS name,
         v.clinvar_variation_type AS "variationType",
         v.clinvar_subclass_type AS "subclassType",
         v.cytogenetic_location AS "cytogeneticLocation",
         coalesce(v.vrs_preprocessing_issue, v.vrs_processing_exception) AS "vrsIssue",
         v.allele_id AS allele_id,
         coalesce(v.copy_number_count_id, v.copy_number_change_id) AS copy_number_id,
         (SELECT count(*)::INTEGER FROM scv WHERE scv.variation_id = v.variation_id) AS "scvCount"
       FROM variant v WHERE v.variation_id = $1`,
      [variationId],
    ),
    db.query(
      release,
      `SELECT vg.gene_id AS "geneId", g.name AS symbol, vg.relationship_type AS "relationshipType", vg.source AS source
       FROM variant_gene vg LEFT JOIN gene g ON g.id = vg.gene_id
       WHERE vg.variation_id = $1 ORDER BY g.name`,
      [variationId],
    ),
    db.query(
      release,
      `SELECT expression, syntax, nucleotide_type AS "nucleotideType",
              protein_expression AS "proteinExpression", mane_select AS "maneSelect",
              mane_plus AS "manePlus", molecular_consequences AS "molecularConsequences"
       FROM variant_hgvs WHERE variation_id = $1
       ORDER BY mane_select DESC, mane_plus DESC, expression, protein_expression`,
      [variationId],
    ),
    db.query(
      release,
      `SELECT system, code, relation FROM variant_xref
       WHERE variation_id = $1 AND system NOT LIKE '%/clinvar/' ORDER BY system, code`,
      [variationId],
    ),
    db.query(
      release,
      `SELECT vs.statement_id AS "statementId",
              vs.parent_statement_id AS "parentStatementId", vs.classification_type AS "classificationType",
              vs.node_kind AS "nodeKind", vs.submission_level AS "submissionLevel", vs.tier AS tier,
              vs.contributes AS contributes, vs.classification AS classification,
              vs.conflicting_explanation AS "conflictingExplanation",
              vs.review_status AS "reviewStatus", rs.stars AS stars,
              coalesce(n.scvs, 0)::INTEGER AS "scvCount"
       FROM vcv_statement vs
       LEFT JOIN review_status rs ON rs.status = vs.review_status
       -- The variant's SCVs per level (or somatic tier) node, counted once rather than per node.
       -- An SCV's node is the one with its classification type, level and tier; roots match none.
       LEFT JOIN (SELECT classification_type, submission_level, tier, count(*) AS scvs FROM scv
                  WHERE variation_id = $1 GROUP BY ALL) n
         ON n.classification_type = vs.classification_type AND n.submission_level = vs.submission_level
        AND n.tier IS NOT DISTINCT FROM vs.tier
       LEFT JOIN classification_type t ON t.code = vs.classification_type
       LEFT JOIN submission_level sl ON sl.code = vs.submission_level
       WHERE vs.variation_id = $1
       ORDER BY t.display_order, vs.node_kind = 'root' DESC, sl.rank DESC, vs.tier`,
      [variationId],
    ),
  ]);
  const row = core[0];
  if (row === undefined) return null;
  const vrs = await vrsMember(db, release, row);
  return {
    ...Core.parse(row),
    vrs,
    genes: z.array(VariantGene).parse(genes),
    hgvs: z.array(VariantHgvs).parse(hgvs),
    xrefs: z.array(Xref).parse(xrefs),
    aggregates: z.array(AggregateStatement).parse(aggregates),
  };
}

const MemberIds = z.object({
  allele_id: z.string().nullable(),
  copy_number_id: z.string().nullable(),
});

/** The variant's VRS allele or copy-number variant, with its location. */
async function vrsMember(
  db: Database,
  release: string,
  row: Record<string, unknown>,
): Promise<VariantDetail['vrs']> {
  const ids = MemberIds.parse(row);
  if (ids.allele_id !== null) {
    const rows = await db.query(
      release,
      `SELECT a.id AS id, 'allele' AS kind, sr.name AS "sequenceAccession",
              l.loc_start::INTEGER AS start, l.loc_end::INTEGER AS "end",
              a.name AS "hgvsG", a.spdi AS spdi, a.vcf_key AS "vcfKey"
       FROM allele a
       LEFT JOIN location l ON l.id = a.location_id
       LEFT JOIN sequenceReference sr ON sr.id = l.sequence_reference_id
       WHERE a.id = $1`,
      [ids.allele_id],
    );
    return rows[0] === undefined ? null : VariantDetail.shape.vrs.parse(rows[0]);
  }
  if (ids.copy_number_id !== null) {
    const rows = await db.query(
      release,
      `SELECT cn.id AS id, 'copy_number' AS kind, sr.name AS "sequenceAccession",
              coalesce(l.loc_start, l.loc_start_max)::INTEGER AS start,
              coalesce(l.loc_end, l.loc_end_min)::INTEGER AS "end",
              NULL AS "hgvsG", NULL AS spdi, NULL AS "vcfKey"
       FROM (SELECT id, location_id FROM copyNumberCount WHERE id = $1
             UNION ALL SELECT id, location_id FROM copyNumberChange WHERE id = $1) cn
       LEFT JOIN location l ON l.id = cn.location_id
       LEFT JOIN sequenceReference sr ON sr.id = l.sequence_reference_id`,
      [ids.copy_number_id],
    );
    return rows[0] === undefined ? null : VariantDetail.shape.vrs.parse(rows[0]);
  }
  return null;
}

/** Sort keys a variant list accepts. Every sort ends with the variant, for stable pages. */
const VARIANT_SORTS: Record<string, string> = {
  conflict: 's.level_rank',
  pairs: 's.pair_count',
  variant: 's.variation_id',
};

export function variantOrder(sort: string[]): { sql: string; unknown: string[] } {
  const parts: string[] = [];
  const unknown: string[] = [];
  for (const key of sort.length === 0 ? ['-conflict', '-pairs'] : sort) {
    const desc = key.startsWith('-');
    const name = desc ? key.slice(1) : key;
    // Own keys only: `constructor` and the like aren't sorts.
    const column = Object.hasOwn(VARIANT_SORTS, name) ? VARIANT_SORTS[name] : undefined;
    if (column === undefined) unknown.push(key);
    else parts.push(`${column} ${desc ? 'DESC NULLS LAST' : 'ASC NULLS LAST'}`);
  }
  parts.push('s.variation_id', 's.classification_type');
  return { sql: parts.join(', '), unknown };
}

const StatusRow = z.object({
  variation_id: z.int(),
  classification_type: z.string(),
  conflict_level: z.string(),
  pair_count: z.int(),
});

/**
 * A page of variants with their conflict status, from the variant resource's base; then each
 * page variant's name, genes, aggregate call and SCV counts, in four small queries.
 */
export async function listVariants(
  db: Database,
  release: string,
  query: ParsedQuery,
  order: string,
): Promise<{ rows: VariantRow[]; total: number | null }> {
  const input = {
    filters: query.filters,
    filterOptions: { geneRelationships: query.geneRelationships },
    pair: query.pair,
  };
  const params = new SqlParams();
  const base = query.resource.base(input, params);
  const limit = params.add(query.limit);
  const offset = params.add(query.offset);
  let total: Promise<number | null> = Promise.resolve(null);
  if (query.count) {
    const countParams = new SqlParams();
    const countBase = query.resource.base(input, countParams);
    total = db
      .query(
        release,
        `WITH ${countBase} SELECT count(*)::INTEGER AS n FROM base`,
        countParams.values,
      )
      .then((rows) => z.object({ n: z.int() }).parse(rows[0]).n);
  }
  const [pageRows, n] = await Promise.all([
    db.query(
      release,
      `WITH ${base}
       SELECT s.variation_id AS variation_id, s.classification_type AS classification_type, s.conflict_level AS conflict_level, s.pair_count AS pair_count
       FROM base s ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`,
      params.values,
    ),
    total,
  ]);
  const page = z.array(StatusRow).parse(pageRows);
  if (page.length === 0) return { rows: [], total: n };

  const ids = [...new Set(page.map((p) => p.variation_id))];
  // Each query below takes the page's variant IDs as its parameters $1..$n.
  const inIds = new SqlParams().list(ids);
  const [names, genes, roots, counts] = await Promise.all([
    db.query(
      release,
      `SELECT variation_id, name FROM variant WHERE variation_id IN (${inIds})`,
      ids,
    ),
    db.query(
      release,
      `SELECT vg.variation_id AS variation_id, list(coalesce(g.name, 'Gene ' || vg.gene_id) ORDER BY g.name)[1:5] AS genes,
              count(*)::INTEGER AS gene_count
       FROM variant_gene vg LEFT JOIN gene g ON g.id = vg.gene_id
       WHERE vg.variation_id IN (${inIds}) GROUP BY 1`,
      ids,
    ),
    db.query(
      release,
      `SELECT vs.variation_id AS variation_id, vs.classification_type AS classification_type, vs.classification AS classification, vs.review_status AS review_status, rs.stars AS stars
       FROM vcv_statement vs LEFT JOIN review_status rs ON rs.status = vs.review_status
       WHERE vs.variation_id IN (${inIds}) AND vs.node_kind = 'root'`,
      ids,
    ),
    db.query(
      release,
      `SELECT s.variation_id AS variation_id, s.classification_type AS classification_type, coalesce(ct.bucket, 'N') AS bucket,
              count(*)::INTEGER AS scvs, count(DISTINCT s.submitter_id)::INTEGER AS submitters
       FROM scv s LEFT JOIN classification_term ct
         ON ct.classification_type = s.classification_type AND ct.term = s.term
       WHERE s.variation_id IN (${inIds}) GROUP BY GROUPING SETS ((1, 2, 3), (1, 2))`,
      ids,
    ),
  ]);
  const nameOf = new Map(
    z
      .array(z.object({ variation_id: z.int(), name: z.string() }))
      .parse(names)
      .map((r) => [r.variation_id, r.name]),
  );
  const genesOf = new Map(
    z
      .array(z.object({ variation_id: z.int(), genes: z.array(z.string()), gene_count: z.int() }))
      .parse(genes)
      .map((r) => [r.variation_id, r]),
  );
  const rootOf = new Map(
    z
      .array(
        z.object({
          variation_id: z.int(),
          classification_type: z.string(),
          classification: z.string().nullable(),
          review_status: z.string().nullable(),
          stars: z.int().nullable(),
        }),
      )
      .parse(roots)
      .map((r) => [`${String(r.variation_id)}:${r.classification_type}`, r]),
  );
  const countRows = z
    .array(
      z.object({
        variation_id: z.int(),
        classification_type: z.string(),
        bucket: z.string().nullable(),
        scvs: z.int(),
        submitters: z.int(),
      }),
    )
    .parse(counts);
  const rows: VariantRow[] = page.map((p) => {
    const key = `${String(p.variation_id)}:${p.classification_type}`;
    const mine = countRows.filter(
      (c) => c.variation_id === p.variation_id && c.classification_type === p.classification_type,
    );
    const totals = mine.find((c) => c.bucket === null);
    const bucket = (b: string) => mine.find((c) => c.bucket === b)?.scvs ?? 0;
    const root = rootOf.get(key);
    const g = genesOf.get(p.variation_id);
    return {
      variationId: p.variation_id,
      name: nameOf.get(p.variation_id) ?? '',
      classificationType: p.classification_type,
      conflictLevel: p.conflict_level,
      pairCount: p.pair_count,
      genes: g?.genes ?? [],
      geneCount: g?.gene_count ?? 0,
      aggregate:
        root === undefined
          ? null
          : {
              classification: root.classification,
              reviewStatus: root.review_status,
              stars: root.stars,
            },
      scvCount: totals?.scvs ?? 0,
      submitterCount: totals?.submitters ?? 0,
      buckets: { P: bucket('P'), V: bucket('V'), B: bucket('B'), O: bucket('O'), N: bucket('N') },
    };
  });
  return { rows, total: n };
}

const Span = z.object({ from: z.iso.date(), to: z.iso.date().nullable() });

/** SQL for the release span of grouped history rows, as `from` and `to`. */
export const SPAN_COLUMNS = `
  strftime(min(valid_from), '%Y-%m-%d') AS "from",
  CASE WHEN bool_or(valid_to IS NULL) THEN NULL ELSE strftime(max(valid_to), '%Y-%m-%d') END AS "to"`;

/** Marks the spans that start at the earliest release served (they may be older). */
export function fromStart<T extends z.infer<typeof Span>>(db: Database, rows: T[]) {
  const earliest = db.earliest();
  return rows.map((r) => ({ ...r, fromStart: r.from === earliest }));
}

/** A variant's VCV versions over every release served, oldest first. */
export async function vcvVersions(
  db: Database,
  release: string,
  variationId: number,
): Promise<VcvVersion[]> {
  const rows = await db.query(
    release,
    `SELECT vcv_version AS version, ${SPAN_COLUMNS}
     FROM ${db.rowsEver('variant')} v WHERE v.variation_id = $1
     GROUP BY vcv_version ORDER BY min(valid_from), vcv_version`,
    [variationId],
  );
  return fromStart(db, Span.extend({ version: z.int().nullable() }).array().parse(rows));
}
