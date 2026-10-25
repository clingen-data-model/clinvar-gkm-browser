// SCV reads. Column aliases are the response's field names, so rows parse straight into the
// shared schemas.

import { ScvDetail, ScvRow } from '@cvb/shared/api';
import { z } from 'zod';
import type { Database } from '../../data/database.ts';

/** The select list of an ScvRow, over `scv s`; needs ScvRowJoins. */
export const SCV_ROW_COLUMNS = `
  s.scv_id AS "scvId",
  'SCV' || lpad(s.scv_id::VARCHAR, 9, '0') AS accession,
  s.scv_version AS version,
  s.variation_id AS "variationId",
  {'submitterId': s.submitter_id, 'name': sub.name} AS submitter,
  s.classification_type AS "classificationType",
  s.classification,
  s.term,
  ct.label AS "termLabel",
  ct.bucket,
  s.submission_level AS "submissionLevel",
  s.review_status AS "reviewStatus",
  rs.stars,
  s.collection_methods AS "collectionMethods",
  s.date_last_evaluated::VARCHAR AS "dateLastEvaluated",
  s.date_submitted::VARCHAR AS "dateSubmitted",
  coalesce((
    SELECT list({'conditionId': c.condition_id, 'name': c.name} ORDER BY c.name)
    FROM scv_condition sc JOIN condition c ON c.condition_id = sc.condition_id
    WHERE sc.scv_id = s.scv_id
  ), []) AS conditions,
  s.description AS comment`;

export const SCV_ROW_JOINS = `
  LEFT JOIN submitter sub ON sub.submitter_id = s.submitter_id
  LEFT JOIN review_status rs ON rs.status = s.review_status
  LEFT JOIN classification_term ct ON ct.classification_type = s.classification_type AND ct.term = s.term`;

/** A variant's SCVs: by classification type, then most stars, then most recently evaluated. */
export async function variantScvs(
  db: Database,
  release: string,
  variationId: number,
): Promise<ScvRow[]> {
  const rows = await db.query(
    release,
    `SELECT ${SCV_ROW_COLUMNS}
     FROM scv s ${SCV_ROW_JOINS}
     LEFT JOIN classification_type t ON t.code = s.classification_type
     WHERE s.variation_id = $1
     ORDER BY t.display_order, rs.rank DESC, s.date_last_evaluated DESC NULLS LAST, s.scv_id`,
    [variationId],
  );
  return z.array(ScvRow).parse(rows);
}

/**
 * One SCV with every field. scv is sorted by variant, not SCV, so the SCV's variant is looked up
 * first; the main row then reads only that variant's rows, and the child lists (each sorted by
 * scv_id) are separate small queries. One combined query, with correlated subqueries, took
 * about 10x longer: DuckDB joined the child tables whole before filtering.
 */
export async function scvDetail(
  db: Database,
  release: string,
  scvId: number,
): Promise<ScvDetail | null> {
  const found = await db.query(release, 'SELECT variation_id FROM scv WHERE scv_id = $1', [scvId]);
  const variationId = z.object({ variation_id: z.int() }).optional().parse(found[0])?.variation_id;
  if (variationId === undefined) return null;
  const [rows, submittedConditions, citations] = await Promise.all([
    db.query(
      release,
      `SELECT ${SCV_ROW_COLUMNS},
         s.classification_code AS "classificationCode",
         s.submitted_classification AS "submittedClassification",
         s.direction,
         s.strength,
         s.assertion_criteria AS "assertionCriteria",
         s.date_created::VARCHAR AS "dateCreated",
         s.local_key AS "localKey",
         s.predicate,
         s.mode_of_inheritance AS "modeOfInheritance",
         s.penetrance,
         CASE WHEN s.gene_context_symbol IS NOT NULL OR s.gene_context_id IS NOT NULL THEN
           {'geneId': s.gene_context_id, 'symbol': s.gene_context_symbol, 'source': s.gene_context_source}
         END AS "geneContext",
         s.submitted_gene_symbols AS "submittedGeneSymbols",
         v.statement_id AS "vcvStatementId",
         r.statement_id AS "rcvStatementId"
       FROM scv s ${SCV_ROW_JOINS}
       LEFT JOIN vcv_statement v ON v.vcv_statement_key = s.vcv_statement_key AND v.variation_id = $2
       LEFT JOIN rcv_statement r ON r.rcv_statement_key = s.rcv_statement_key AND r.variation_id = $2
       WHERE s.variation_id = $2 AND s.scv_id = $1`,
      [scvId, variationId],
    ),
    db.query(
      release,
      `SELECT name, medgen_id AS "medgenId", condition_id AS "conditionId",
              normalized_resolution AS resolution
       FROM scv_submitted_condition WHERE scv_id = $1 ORDER BY ordinal`,
      [scvId],
    ),
    db.query(
      release,
      `SELECT pmid, doi, urls, name FROM scv_citation WHERE scv_id = $1 ORDER BY ordinal`,
      [scvId],
    ),
  ]);
  const row = rows[0];
  return row === undefined ? null : ScvDetail.parse({ ...row, submittedConditions, citations });
}
