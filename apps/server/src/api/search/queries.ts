// Search by the shape of the input (docs/search.md): identifiers are exact lookups, HGVS an exact
// match on ClinVar's expressions, anything else a name prefix over genes, conditions (names and
// aliases) and submitters. The prefix term table in docs/search.md is deferred; these lookups
// use the small tables directly.

import { SearchResult, type SearchResponse } from '@cvb/shared/api';
import { z } from 'zod';
import type { Database } from '../../data/database.ts';

type Found = Pick<SearchResponse, 'recognizedAs' | 'results'>;

const Results = z.array(SearchResult);

const VARIANT_LABEL = `(SELECT name FROM variant WHERE variant.variation_id = x.variation_id)`;

export async function search(
  db: Database,
  release: string,
  q: string,
  limit: number,
): Promise<Found> {
  const run = async (sql: string, params: (string | number)[]) =>
    Results.parse(await db.query(release, sql, params));

  let m: RegExpExecArray | null;
  if ((m = /^(?:VCV)?0*(\d{1,9})(?:\.\d+)?$/i.exec(q)) !== null) {
    const results = await run(
      `SELECT 'variant' AS kind, variation_id AS id, name AS label, 'variation ID' AS match
       FROM variant WHERE variation_id = $1`,
      [Number(m[1])],
    );
    return { recognizedAs: 'variation ID or VCV accession', results };
  }
  if ((m = /^SCV0*(\d{1,9})(?:\.\d+)?$/i.exec(q)) !== null) {
    const results = await run(
      `SELECT 'scv' AS kind, s.scv_id AS id,
              'SCV' || lpad(s.scv_id::VARCHAR, 9, '0') || ' (' || sub.name || ')' AS label,
              'SCV accession' AS match
       FROM scv s LEFT JOIN submitter sub ON sub.submitter_id = s.submitter_id WHERE s.scv_id = $1`,
      [Number(m[1])],
    );
    return { recognizedAs: 'SCV accession', results };
  }
  if ((m = /^RCV0*(\d{1,9})(?:\.\d+)?$/i.exec(q)) !== null) {
    const results = await run(
      `SELECT DISTINCT 'variant' AS kind, x.variation_id AS id, ${VARIANT_LABEL} AS label,
              'RCV accession' AS match
       FROM rcv_statement x WHERE x.rcv_accession = $1`,
      [Number(m[1])],
    );
    return { recognizedAs: 'RCV accession', results };
  }
  if ((m = /^rs(\d+)$/i.exec(q)) !== null) {
    const results = await run(
      `SELECT DISTINCT 'variant' AS kind, x.variation_id AS id, ${VARIANT_LABEL} AS label,
              'rsID rs' || x.code AS match
       FROM variant_xref x WHERE x.system LIKE '%/snp/' AND x.code = $1 LIMIT $2`,
      [m[1] ?? '', limit],
    );
    return { recognizedAs: 'dbSNP rsID', results };
  }
  if (/^CA\d+$/i.test(q)) {
    const results = await run(
      `SELECT DISTINCT 'variant' AS kind, x.variation_id AS id, ${VARIANT_LABEL} AS label,
              'ClinGen allele ' || x.code AS match
       FROM variant_xref x WHERE x.system LIKE '%reg.clinicalgenome.org%' AND x.code = $1 LIMIT $2`,
      [q.toUpperCase(), limit],
    );
    return { recognizedAs: 'ClinGen Allele Registry ID', results };
  }
  if (/^ga4gh:VA\./.test(q)) {
    const results = await run(
      `SELECT 'variant' AS kind, x.variation_id AS id, ${VARIANT_LABEL} AS label, 'VRS allele' AS match
       FROM variant x WHERE x.allele_id = $1`,
      [q],
    );
    return { recognizedAs: 'VRS allele ID', results };
  }
  if (
    (m = /^(?:chr)?([0-9]{1,2}|X|Y|MT?)[-:](\d+)[-:]([ACGTN]+)[-:]([ACGTN]+)$/i.exec(q)) !== null
  ) {
    const key = [m[1], m[2], m[3], m[4]].join('-').toUpperCase().replace(/^M-/, 'MT-');
    const results = await run(
      `SELECT 'variant' AS kind, v.variation_id AS id, v.name AS label, 'GRCh38 ' || a.vcf_key AS match
       FROM allele a JOIN variant v ON v.allele_id = a.allele_id WHERE a.vcf_key = $1 LIMIT $2`,
      [key, limit],
    );
    return { recognizedAs: 'GRCh38 chrom-pos-ref-alt', results };
  }
  if (/:[cgmnpr]\.\S/.test(q)) {
    const results = await run(
      `SELECT DISTINCT 'variant' AS kind, x.variation_id AS id, ${VARIANT_LABEL} AS label,
              'HGVS ' || $1 AS match
       FROM variant_hgvs x WHERE x.expression = $1 OR x.protein_expression = $1 LIMIT $2`,
      [q, limit],
    );
    return { recognizedAs: 'HGVS expression', results };
  }

  // A name: prefix match on genes, conditions (and aliases) and submitters, shortest first.
  const prefix = q.toLowerCase();
  // Genes, then conditions, then submitters: UNION ALL guarantees no order of its own (an engine
  // may run the branches in parallel), so each branch numbers its rows and the outer query sorts.
  const results = await run(
    `SELECT kind, id, label, match FROM (
     (SELECT 1 AS grp, row_number() OVER (ORDER BY lower(symbol) = $1 DESC, length(symbol), symbol) AS pos,
             'gene' AS kind, gene_id AS id, symbol AS label, 'gene symbol' AS match
      FROM gene WHERE lower(symbol) >= $1 AND lower(symbol) < $1 || '￿'
      ORDER BY pos LIMIT $2)
     UNION ALL
     (SELECT 2, row_number() OVER (ORDER BY length(name), name), 'condition', condition_id, name,
             CASE WHEN lower(name) LIKE $1 || '%' THEN 'condition name' ELSE 'alias ' || alias END
      FROM (SELECT condition_id, name, unnest(list_prepend(name, coalesce(aliases, []))) AS alias FROM condition)
      WHERE lower(alias) LIKE $1 || '%'
      QUALIFY row_number() OVER (PARTITION BY condition_id ORDER BY length(alias)) = 1
      ORDER BY length(name), name LIMIT $2)
     UNION ALL
     (SELECT 3, row_number() OVER (ORDER BY lower(name) LIKE $1 || '%' DESC, length(name), name), 'submitter',
             submitter_id, name, 'submitter name'
      FROM submitter WHERE lower(name) LIKE '%' || $1 || '%'
      ORDER BY lower(name) LIKE $1 || '%' DESC, length(name), name LIMIT $2)
    ) ORDER BY grp, pos`,
    [prefix, limit],
  );
  return { recognizedAs: 'name', results };
}
