// Gene, submitter and condition pages: the entity, and counts over the SCVs that belong to it.
// Which SCVs belong is a join or filter over `scv s`, given per entity below.

import { ClassificationCount, ConditionDetail, GeneDetail, SubmitterDetail } from '@cvb/shared/api';
import { z } from 'zod';
import type { Database } from '../../data/database.ts';

/**
 * Variants located within the gene: ClinVar's "within single gene" and "within multiple genes by
 * overlap". The second matters: HFE c.187C>G is "multiple genes" only because HFE overlaps its
 * antisense gene HFE-AS1 (ClinVar Miner merged antisense genes for this reason). Large CNVs that
 * span whole genes ("genes overlapped by variant") and variants near a gene don't count
 * (docs/api.md, open question 2).
 */
export const GENE_RELATIONSHIPS_WITHIN = `('within single gene', 'within multiple genes by overlap')`;
const GENE_SCVS = `
  FROM variant_gene vg JOIN scv s ON s.variation_id = vg.variation_id
  WHERE vg.gene_id = $1 AND vg.relationship_type IN ${GENE_RELATIONSHIPS_WITHIN}`;
const SUBMITTER_SCVS = `FROM scv s WHERE s.submitter_id = $1`;
const CONDITION_SCVS = `
  FROM scv_condition sc JOIN scv s ON s.scv_id = sc.scv_id WHERE sc.condition_id = $1`;

const Counts = z.object({ scvCount: z.int(), variantCount: z.int() });

async function counts(db: Database, release: string, scvs: string, id: number) {
  const [totals, classifications] = await Promise.all([
    db.query(
      release,
      `SELECT count(*)::INTEGER AS "scvCount", count(DISTINCT s.variation_id)::INTEGER AS "variantCount"
       ${scvs}`,
      [id],
    ),
    db.query(
      release,
      `WITH s AS (SELECT s.classification_type, s.term ${scvs})
       SELECT s.classification_type AS "classificationType", s.term, ct.label AS "termLabel",
              ct.bucket, count(*)::INTEGER AS scvs
       FROM s
       LEFT JOIN classification_term ct ON ct.classification_type = s.classification_type AND ct.term = s.term
       LEFT JOIN classification_type t ON t.code = s.classification_type
       GROUP BY ALL
       ORDER BY min(t.display_order), min(ct.display_order)`,
      [id],
    ),
  ]);
  return {
    ...Counts.parse(totals[0]),
    classifications: z.array(ClassificationCount).parse(classifications),
  };
}

export async function geneDetail(
  db: Database,
  release: string,
  geneId: number,
): Promise<GeneDetail | null> {
  const rows = await db.query(
    release,
    `SELECT gene_id AS "geneId", symbol FROM gene WHERE gene_id = $1`,
    [geneId],
  );
  if (rows[0] === undefined) return null;
  return GeneDetail.parse({ ...rows[0], ...(await counts(db, release, GENE_SCVS, geneId)) });
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
    ...(await counts(db, release, SUBMITTER_SCVS, submitterId)),
  });
}

export async function conditionDetail(
  db: Database,
  release: string,
  conditionId: number,
): Promise<ConditionDetail | null> {
  const rows = await db.query(
    release,
    `SELECT c.condition_id AS "conditionId", c.name, c.concept_type AS "conceptType",
            c.medgen_id AS "medgenId", c.aliases,
            coalesce((SELECT list({'system': x.system, 'code': x.code, 'name': x.name} ORDER BY x.system, x.code)
                      FROM condition_xref x WHERE x.condition_id = c.condition_id), []) AS xrefs
     FROM condition c WHERE c.condition_id = $1`,
    [conditionId],
  );
  if (rows[0] === undefined) return null;
  return ConditionDetail.parse({
    ...rows[0],
    ...(await counts(db, release, CONDITION_SCVS, conditionId)),
  });
}
