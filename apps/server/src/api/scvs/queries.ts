// SCV reads. Column aliases are the response's field names, so rows parse straight into the
// shared schemas.

import { ScvDetail, ScvRow } from '@cvb/shared/api';
import { RELATIONSHIP_CODE_SQL, SqlParams, whereSql, type ParsedQuery } from '@cvb/shared/query';
import { z } from 'zod';
import type { Database } from '../../data/database.ts';

/**
 * An ScvRow's select list over `scv s` (needs SCV_ROW_JOINS), with `geneRelationship` from the
 * given SQL: NULL, or geneRelationshipSql for a list filtered by one gene.
 */
export function scvRowColumns(geneRelationship = 'NULL'): string {
  return `
  s.scv_id AS "scvId",
  'SCV' || lpad(s.scv_id::VARCHAR, 9, '0') AS accession,
  s.scv_version AS version,
  s.variation_id AS "variationId",
  {'submitterId': s.submitter_id, 'name': sub.name} AS submitter,
  s.classification_type AS "classificationType",
  s.classification AS classification,
  s.term AS term,
  ct.label AS "termLabel",
  ct.bucket AS bucket,
  s.submission_level AS "submissionLevel",
  s.review_status AS "reviewStatus",
  rs.stars AS stars,
  s.collection_methods AS "collectionMethods",
  s.date_last_evaluated::VARCHAR AS "dateLastEvaluated",
  s.date_submitted::VARCHAR AS "dateSubmitted",
  coalesce((
    SELECT list({'conditionId': c.id, 'name': c.name} ORDER BY c.name)
    FROM scv_condition sc JOIN condition c ON c.id = sc.condition_id
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
            'otherGenes': coalesce(list(coalesce(g.name, 'Gene ' || vg.gene_id) ORDER BY g.name)
                                     FILTER (WHERE vg.gene_id <> ${gene}), [])[1:5],
            'otherGeneCount': (count(*) FILTER (WHERE vg.gene_id <> ${gene}))::INTEGER}
    FROM variant_gene vg LEFT JOIN gene g ON g.id = vg.gene_id
    WHERE vg.variation_id = s.variation_id
  )`;
}

export const SCV_ROW_JOINS = `
  LEFT JOIN submitter sub ON sub.id = s.submitter_id
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
    `SELECT ${scvRowColumns()}
     FROM scv s ${SCV_ROW_JOINS}
     LEFT JOIN classification_type t ON t.code = s.classification_type
     WHERE s.variation_id = $1
     ORDER BY t.display_order, rs.rank DESC, s.date_last_evaluated DESC NULLS LAST, s.scv_id`,
    [variationId],
  );
  return z.array(ScvRow).parse(rows);
}

/** A submitted condition (a struct of scv.submitted_condition, or of its set's concepts) as JSON. */
function submittedConditionSql(c: string): string {
  return `{'name': ${c}.name, 'medgenId': ${c}.medgen_id,
           'conditionId': CASE WHEN ${c}.normalized_match LIKE 'clinvar.trait:%'
                               THEN split_part(${c}.normalized_match, ':', 2)::INTEGER END,
           'resolution': ${c}.normalized_resolution}`;
}

/**
 * One SCV with every field. scv is sorted by variant, not SCV, so the SCV's variant is looked up
 * first, and the row is then read from only that variant's rows. Citations and submitted
 * conditions are lists on the row, as upstream publishes them.
 */
export async function scvDetail(
  db: Database,
  release: string,
  scvId: number,
): Promise<ScvDetail | null> {
  const found = await db.query(release, 'SELECT variation_id FROM scv WHERE scv_id = $1', [scvId]);
  const variationId = z.object({ variation_id: z.int() }).optional().parse(found[0])?.variation_id;
  if (variationId === undefined) return null;
  const rows = await db.query(
    release,
    `SELECT ${scvRowColumns()},
         s.classification_code AS "classificationCode",
         s.submitted_classification AS "submittedClassification",
         s.direction AS direction,
         s.strength AS strength,
         s.assertion_criteria AS "assertionCriteria",
         s.date_created::VARCHAR AS "dateCreated",
         s.local_key AS "localKey",
         s.predicate AS predicate,
         s.mode_of_inheritance AS "modeOfInheritance",
         s.penetrance AS penetrance,
         CASE WHEN s.gene_context_symbol IS NOT NULL OR s.gene_context_id IS NOT NULL THEN
           {'geneId': s.gene_context_id, 'symbol': s.gene_context_symbol, 'source': s.gene_context_source}
         END AS "geneContext",
         s.submitted_gene_symbols AS "submittedGeneSymbols",
         -- The VCV and RCV nodes citing the SCV: those with its classification type, level and tier.
         (SELECT v.statement_id FROM vcv_statement v
          WHERE v.variation_id = s.variation_id AND v.classification_type = s.classification_type
            AND v.submission_level = s.submission_level AND v.tier IS NOT DISTINCT FROM s.tier) AS "vcvStatementId",
         (SELECT r.statement_id FROM rcv_statement r
          WHERE r.variation_id = s.variation_id AND r.rcv_accession = s.rcv_accession
            AND r.classification_type = s.classification_type
            AND r.submission_level = s.submission_level AND r.tier IS NOT DISTINCT FROM s.tier) AS "rcvStatementId",
         list_concat(
           CASE WHEN s.submitted_condition IS NULL THEN [] ELSE [${submittedConditionSql('s.submitted_condition')}] END,
           coalesce([${submittedConditionSql('c')} for c in s.submitted_condition_set.concepts], [])
         ) AS "submittedConditions",
         coalesce([{'pmid': c.pmid, 'doi': c.doi, 'urls': c.urls, 'name': c.name} for c in s.reported_in], [])
           AS citations
       FROM scv s ${SCV_ROW_JOINS}
       WHERE s.variation_id = $2 AND s.scv_id = $1`,
    [scvId, variationId],
  );
  const row = rows[0];
  return row === undefined ? null : ScvDetail.parse(row);
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
      ? scvRowColumns()
      : scvRowColumns(geneRelationshipSql(`${params.add(Number(oneGene))}::INTEGER`));
  const page = db.query(
    release,
    `WITH page AS (
       SELECT s.scv_id AS scv_id, s.variation_id AS variation_id FROM scv s WHERE ${where}
       ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}
     )
     SELECT ${columns}
     FROM scv s
     ${SCV_ROW_JOINS}
     -- The page's rows by a filter on scv's sort key, not a join back to scv: the engine skips
     -- every block that can't hold them.
     WHERE (s.variation_id, s.scv_id) IN (SELECT variation_id, scv_id FROM page)
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
