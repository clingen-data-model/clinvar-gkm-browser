// SCV reads. Column aliases are the response's field names, so rows parse straight into the
// shared schemas.

import { ScvDetail, ScvRow } from '@cvb/shared/api';
import { RELATIONSHIP_CODE_SQL, SqlParams, whereSql, type ParsedQuery } from '@cvb/shared/query';
import { z } from 'zod';
import type { Database } from '../../data/database.ts';

/** The select list of an ScvRow, over `scv s`; needs SCV_ROW_JOINS. */
export const SCV_ROW_COLUMNS = scvRowColumns('NULL');

/**
 * An ScvRow's select list, with `geneRelationship` from the given SQL: NULL, or
 * geneRelationshipSql for a list filtered by one gene.
 */
function scvRowColumns(geneRelationship: string): string {
  return `
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
  s.description AS comment,
  ${geneRelationship} AS "geneRelationship"`;
}

/**
 * How the row's variant relates to one gene (the placeholder holds its id), and the variant's
 * other genes: the first five by symbol, and how many there are.
 */
function geneRelationshipSql(gene: string): string {
  return `(
    SELECT {'relationship': max(CASE WHEN vg.gene_id = ${gene} THEN ${RELATIONSHIP_CODE_SQL} END),
            'otherGenes': coalesce(list(coalesce(g.symbol, 'Gene ' || vg.gene_id) ORDER BY g.symbol)
                                     FILTER (WHERE vg.gene_id <> ${gene}), [])[1:5],
            'otherGeneCount': (count(*) FILTER (WHERE vg.gene_id <> ${gene}))::INTEGER}
    FROM variant_gene vg LEFT JOIN gene g ON g.gene_id = vg.gene_id
    WHERE vg.variation_id = s.variation_id
  )`;
}

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

/** Sort keys an SCV list accepts, and their columns. Every sort ends with the key, for stable pages. */
const SCV_SORTS: Record<string, string> = {
  variant: 's.variation_id',
  scv: 's.scv_id',
  submitter: 's.submitter_id',
  evaluated: 's.date_last_evaluated',
  submitted: 's.date_submitted',
};

export function scvOrder(sort: string[]): { sql: string; unknown: string[] } {
  const parts: string[] = [];
  const unknown: string[] = [];
  for (const key of sort) {
    const desc = key.startsWith('-');
    const name = desc ? key.slice(1) : key;
    // Own keys only: `constructor` and the like aren't sorts.
    const column = Object.hasOwn(SCV_SORTS, name) ? SCV_SORTS[name] : undefined;
    if (column === undefined) unknown.push(key);
    else parts.push(`${column} ${desc ? 'DESC NULLS LAST' : 'ASC NULLS LAST'}`);
  }
  parts.push('s.variation_id', 's.scv_id');
  return { sql: parts.join(', '), unknown };
}

/** A page of SCVs matching a query: the page's keys first, then their rows. */
export async function listScvs(
  db: Database,
  release: string,
  query: ParsedQuery,
  order: string,
): Promise<{ rows: ScvRow[]; total: number | null }> {
  const params = new SqlParams();
  const where = whereSql(query, params);
  const limit = params.add(query.limit);
  const offset = params.add(query.offset);
  // Filtered by one gene: say how each row's variant relates to it.
  const genes = query.filters.filter((f) => f.name === 'gene' && !f.negate);
  const oneGene =
    genes.length === 1 && genes[0]?.values.length === 1 ? genes[0].values[0] : undefined;
  const columns =
    oneGene === undefined
      ? SCV_ROW_COLUMNS
      : scvRowColumns(geneRelationshipSql(`${params.add(Number(oneGene))}::INTEGER`));
  const page = db.query(
    release,
    `WITH page AS (
       SELECT s.scv_id, s.variation_id FROM scv s WHERE ${where}
       ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}
     )
     SELECT ${columns}
     FROM page p JOIN scv s ON s.variation_id = p.variation_id AND s.scv_id = p.scv_id
     ${SCV_ROW_JOINS}
     ORDER BY ${order}`,
    params.values,
  );
  let total: Promise<number | null> = Promise.resolve(null);
  if (query.count) {
    const countParams = new SqlParams();
    total = db
      .query(
        release,
        `SELECT count(*)::INTEGER AS n FROM scv s WHERE ${whereSql(query, countParams)}`,
        countParams.values,
      )
      .then((rows) => z.object({ n: z.int() }).parse(rows[0]).n);
  }
  const [rows, n] = await Promise.all([page, total]);
  return { rows: z.array(ScvRow).parse(rows), total: n };
}
