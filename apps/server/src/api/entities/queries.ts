// Gene, submitter and condition pages: the entity, and counts over the SCVs that belong to it.
// Which SCVs belong is a join or filter over `scv s`, given per entity below.

import {
  ClassificationCount,
  ConditionDetail,
  GeneDetail,
  GeneRelationshipCount,
  SubmitterDetail,
} from '@cvb/shared/api';
import {
  clinvarRelationshipTypes,
  GENE_RELATIONSHIPS,
  RELATIONSHIP_CODE_SQL,
  SqlParams,
  type GeneRelationship,
} from '@cvb/shared/query';
import { z } from 'zod';
import type { Database } from '../../data/database.ts';

const SUBMITTER_SCVS = `FROM scv s WHERE s.submitter_id = $1`;
const CONDITION_SCVS = `
  FROM scv_condition sc JOIN scv s ON s.scv_id = sc.scv_id WHERE sc.condition_id = $1`;

const Counts = z.object({ scvCount: z.int(), variantCount: z.int() });

/** Counts over the SCVs `scvs` selects; `params` are its parameters ($1 is the entity's id). */
async function counts(db: Database, release: string, scvs: string, params: (string | number)[]) {
  const [totals, classifications] = await Promise.all([
    db.query(
      release,
      `SELECT count(*)::INTEGER AS "scvCount", count(DISTINCT s.variation_id)::INTEGER AS "variantCount"
       ${scvs}`,
      params,
    ),
    db.query(
      release,
      `WITH s AS (SELECT s.classification_type AS classification_type, s.term AS term ${scvs})
       SELECT s.classification_type AS "classificationType", s.term AS term, ct.label AS "termLabel",
              ct.bucket AS bucket, count(*)::INTEGER AS scvs
       FROM s
       LEFT JOIN classification_term ct ON ct.classification_type = s.classification_type AND ct.term = s.term
       LEFT JOIN classification_type t ON t.code = s.classification_type
       GROUP BY ALL
       ORDER BY min(t.display_order), min(ct.display_order)`,
      params,
    ),
  ]);
  return {
    ...Counts.parse(totals[0]),
    classifications: z.array(ClassificationCount).parse(classifications),
  };
}

/** A gene's SCVs: those whose variant's gene list relates it to the gene as chosen. */
function geneScvs(geneId: number, relationships: readonly GeneRelationship[]) {
  const params = new SqlParams();
  params.add(geneId);
  const types = clinvarRelationshipTypes(relationships);
  const where = types === null ? '' : ` AND vg.relationship_type IN (${params.list(types)})`;
  return {
    sql: `FROM variant_gene vg JOIN scv s ON s.variation_id = vg.variation_id
          WHERE vg.gene_id = $1${where}`,
    params: params.values.flatMap((v) => (v === null || typeof v === 'boolean' ? [] : [v])),
  };
}

export async function geneDetail(
  db: Database,
  release: string,
  geneId: number,
  relationships: GeneRelationship[],
): Promise<GeneDetail | null> {
  const rows = await db.query(
    release,
    `SELECT gene_id AS "geneId", symbol FROM gene WHERE gene_id = $1`,
    [geneId],
  );
  if (rows[0] === undefined) return null;
  const selected = geneScvs(geneId, relationships);
  const [selectedCounts, byRelationship] = await Promise.all([
    counts(db, release, selected.sql, selected.params),
    db.query(
      release,
      `SELECT ${RELATIONSHIP_CODE_SQL} AS relationship,
              count(DISTINCT s.variation_id)::INTEGER AS variants,
              count(s.scv_id)::INTEGER AS scvs
       FROM variant_gene vg LEFT JOIN scv s ON s.variation_id = vg.variation_id
       WHERE vg.gene_id = $1 GROUP BY 1`,
      [geneId],
    ),
  ]);
  const found = new Map(
    byRelationship.map((r) => {
      const row = GeneRelationshipCount.omit({ label: true }).parse(r);
      return [row.relationship, row];
    }),
  );
  return GeneDetail.parse({
    ...rows[0],
    relationships,
    ...selectedCounts,
    relationshipCounts: Object.entries(GENE_RELATIONSHIPS).map(([code, r]) => ({
      relationship: code,
      label: r.label,
      variants: found.get(GeneRelationshipCount.shape.relationship.parse(code))?.variants ?? 0,
      scvs: found.get(GeneRelationshipCount.shape.relationship.parse(code))?.scvs ?? 0,
    })),
  });
}

export async function submitterDetail(
  db: Database,
  release: string,
  submitterId: number,
): Promise<SubmitterDetail | null> {
  const rows = await db.query(
    release,
    `SELECT submitter_id AS "submitterId", name FROM submitter WHERE submitter_id = $1`,
    [submitterId],
  );
  if (rows[0] === undefined) return null;
  return SubmitterDetail.parse({
    ...rows[0],
    ...(await counts(db, release, SUBMITTER_SCVS, [submitterId])),
  });
}

export async function conditionDetail(
  db: Database,
  release: string,
  conditionId: number,
): Promise<ConditionDetail | null> {
  const rows = await db.query(
    release,
    `SELECT c.condition_id AS "conditionId", c.name AS name, c.concept_type AS "conceptType",
            c.medgen_id AS "medgenId", c.aliases AS aliases,
            coalesce((SELECT list({'system': x.system, 'code': x.code, 'name': x.name} ORDER BY x.system, x.code)
                      FROM condition_xref x WHERE x.condition_id = c.condition_id), []) AS xrefs
     FROM condition c WHERE c.condition_id = $1`,
    [conditionId],
  );
  if (rows[0] === undefined) return null;
  return ConditionDetail.parse({
    ...rows[0],
    ...(await counts(db, release, CONDITION_SCVS, [conditionId])),
  });
}
