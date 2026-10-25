// Variant reads. The detail is assembled from a few small queries, each reading only the rows
// of one variant (the tables are sorted by variation_id).

import { AggregateStatement, VariantDetail, VariantGene, VariantHgvs, Xref } from '@cvb/shared/api';
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
         v.name,
         v.clinvar_variation_type AS "variationType",
         v.clinvar_subclass_type AS "subclassType",
         v.cytogenetic_location AS "cytogeneticLocation",
         coalesce(v.vrs_preprocessing_issue, v.vrs_processing_exception) AS "vrsIssue",
         v.allele_id, v.copy_number_id,
         (SELECT count(*)::INTEGER FROM scv WHERE scv.variation_id = v.variation_id) AS "scvCount"
       FROM variant v WHERE v.variation_id = $1`,
      [variationId],
    ),
    db.query(
      release,
      `SELECT vg.gene_id AS "geneId", g.symbol, vg.relationship_type AS "relationshipType", vg.source
       FROM variant_gene vg LEFT JOIN gene g ON g.gene_id = vg.gene_id
       WHERE vg.variation_id = $1 ORDER BY g.symbol`,
      [variationId],
    ),
    db.query(
      release,
      `SELECT expression, syntax, nucleotide_type AS "nucleotideType",
              protein_expression AS "proteinExpression", mane_select AS "maneSelect",
              mane_plus AS "manePlus", molecular_consequences AS "molecularConsequences"
       FROM variant_hgvs WHERE variation_id = $1
       ORDER BY mane_select DESC, mane_plus DESC, ordinal`,
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
      `SELECT vs.vcv_statement_key AS key, vs.statement_id AS "statementId",
              vs.parent_key AS "parentKey", vs.classification_type AS "classificationType",
              vs.node_kind AS "nodeKind", vs.submission_level AS "submissionLevel", vs.tier,
              vs.contributes, vs.classification,
              vs.conflicting_explanation AS "conflictingExplanation",
              vs.review_status AS "reviewStatus", rs.stars,
              (SELECT count(*)::INTEGER FROM scv
               WHERE scv.variation_id = vs.variation_id
                 AND scv.vcv_statement_key = vs.vcv_statement_key) AS "scvCount"
       FROM vcv_statement vs
       LEFT JOIN review_status rs ON rs.status = vs.review_status
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
      `SELECT a.allele_id AS id, 'allele' AS kind, sr.accession AS "sequenceAccession",
              l.loc_start::INTEGER AS start, l.loc_end::INTEGER AS "end",
              a.hgvs_g AS "hgvsG", a.spdi, a.vcf_key AS "vcfKey"
       FROM allele a
       LEFT JOIN location l ON l.location_id = a.location_id
       LEFT JOIN sequence_reference sr ON sr.sequence_reference_id = l.sequence_reference_id
       WHERE a.allele_id = $1`,
      [ids.allele_id],
    );
    return rows[0] === undefined ? null : VariantDetail.shape.vrs.parse(rows[0]);
  }
  if (ids.copy_number_id !== null) {
    const rows = await db.query(
      release,
      `SELECT cn.copy_number_id AS id, 'copy_number' AS kind, sr.accession AS "sequenceAccession",
              coalesce(l.loc_start, l.loc_start_max)::INTEGER AS start,
              coalesce(l.loc_end, l.loc_end_min)::INTEGER AS "end",
              NULL AS "hgvsG", NULL AS spdi, NULL AS "vcfKey"
       FROM copy_number cn
       LEFT JOIN location l ON l.location_id = cn.location_id
       LEFT JOIN sequence_reference sr ON sr.sequence_reference_id = l.sequence_reference_id
       WHERE cn.copy_number_id = $1`,
      [ids.copy_number_id],
    );
    return rows[0] === undefined ? null : VariantDetail.shape.vrs.parse(rows[0]);
  }
  return null;
}
