-- ClinVar GKM browser: checks run after load.sql and the reference checks, before a release is
-- written out. These check the derivation itself (counts, uniqueness, tree structure), not
-- upstream's data: dangling references in the data are recorded in reference_issue instead (see
-- docs/schema.md, "Faithful to upstream"). Problems are collected in validation_problem; the last
-- statement fails the build if there are any.
--
-- Expects the same src variable as load.sql.

CREATE OR REPLACE TEMP MACRO src_file(name) AS getvariable('src') || '/' || name;

CREATE TEMP TABLE validation_problem (problem VARCHAR, detail VARCHAR);

-- Row counts that must match the source exactly.
INSERT INTO validation_problem
SELECT 'count mismatch', t || ': derived ' || derived || ', source ' || source
FROM (
    SELECT 'variant' AS t, (SELECT count(*) FROM variant) AS derived,
           (SELECT count(*) FROM read_parquet(src_file('variation.parquet'))) AS source
    UNION ALL SELECT 'scv', (SELECT count(*) FROM scv), (SELECT count(*) FROM read_parquet(src_file('scv.parquet')))
    UNION ALL SELECT 'vcv_statement', (SELECT count(*) FROM vcv_statement), (SELECT count(*) FROM read_parquet(src_file('vcv.parquet')))
    UNION ALL SELECT 'rcv_statement', (SELECT count(*) FROM rcv_statement), (SELECT count(*) FROM read_parquet(src_file('rcv.parquet')))
    UNION ALL SELECT 'allele', (SELECT count(*) FROM allele), (SELECT count(*) FROM read_parquet(src_file('allele.parquet')))
    UNION ALL SELECT 'condition', (SELECT count(*) FROM condition), (SELECT count(*) FROM read_parquet(src_file('condition.parquet')))
    UNION ALL SELECT 'submitter', (SELECT count(*) FROM submitter), (SELECT count(*) FROM read_parquet(src_file('submitter.parquet')))
    UNION ALL SELECT 'conditionSet', (SELECT count(*) FROM conditionSet), (SELECT count(*) FROM read_parquet(src_file('conditionSet.parquet')))
)
WHERE derived <> source;

-- Statement ids are unique (not indexed, to save memory during the load).
INSERT INTO validation_problem
SELECT 'duplicate vcv statement_id', statement_id FROM vcv_statement GROUP BY statement_id HAVING count(*) > 1
UNION ALL
SELECT 'duplicate rcv statement_id', statement_id FROM rcv_statement GROUP BY statement_id HAVING count(*) > 1;

-- scv_classification_pair holds every ordered pair exactly once: n*(n-1) per variant and
-- conflict-detectable type, each pair's reverse present, no pair twice, and the stored level
-- matching a recomputation.
INSERT INTO validation_problem
SELECT 'pair count', 'derived ' || (SELECT count(*) FROM scv_classification_pair) || ', expected ' || expected
FROM (SELECT sum(n * (n - 1)) AS expected
      FROM (SELECT count(*) AS n FROM scv s
            JOIN classification_type ct ON ct.code = s.classification_type AND ct.conflict_detectable
            GROUP BY s.variation_id, s.classification_type))
WHERE expected <> (SELECT count(*) FROM scv_classification_pair)
UNION ALL
SELECT 'duplicate pair', a_scv_id || ',' || b_scv_id
FROM scv_classification_pair GROUP BY a_scv_id, b_scv_id HAVING count(*) > 1
UNION ALL
SELECT 'pair without its reverse', p.a_scv_id || ',' || p.b_scv_id
FROM scv_classification_pair p
ANTI JOIN scv_classification_pair r ON r.a_scv_id = p.b_scv_id AND r.b_scv_id = p.a_scv_id
UNION ALL
SELECT 'asymmetric pair level', p.a_scv_id || ',' || p.b_scv_id
FROM scv_classification_pair p
JOIN scv_classification_pair r ON r.a_scv_id = p.b_scv_id AND r.b_scv_id = p.a_scv_id
WHERE p.level IS DISTINCT FROM r.level OR p.same_condition <> r.same_condition;

-- Every non-root statement found its parent (the CHECK only says roots have none).
INSERT INTO validation_problem
SELECT 'orphan statement', statement_id FROM vcv_statement WHERE node_kind <> 'root' AND parent_statement_id IS NULL
UNION ALL
SELECT 'orphan statement', statement_id FROM rcv_statement WHERE node_kind <> 'root' AND parent_statement_id IS NULL;

-- An SCV agrees with the aggregate statement citing it.
INSERT INTO validation_problem
SELECT 'scv disagrees with its vcv statement', s.scv_id::VARCHAR
FROM scv s JOIN vcv_statement v ON v.statement_id = s.vcv_statement_id
WHERE v.variation_id <> s.variation_id
   OR v.classification_type <> s.classification_type
   OR v.submission_level <> s.submission_level;

-- Every SCV has at least one condition after set expansion.
INSERT INTO validation_problem
SELECT 'scv without condition', s.scv_id::VARCHAR
FROM scv s ANTI JOIN scv_condition c ON c.scv_id = s.scv_id;

-- scv.condition_ids lists exactly the SCV's rows in scv_condition.
INSERT INTO validation_problem
SELECT 'scv condition_ids disagree with scv_condition', s.scv_id::VARCHAR
FROM scv s
LEFT JOIN (SELECT scv_id, list(condition_id ORDER BY condition_id) AS ids FROM scv_condition GROUP BY 1) c
  ON c.scv_id = s.scv_id
WHERE list_sort(s.condition_ids) IS DISTINCT FROM coalesce(c.ids, []);

-- Every variant with VCV statements got its version.
INSERT INTO validation_problem
SELECT 'variant missing vcv_version', variation_id::VARCHAR
FROM variant v WHERE vcv_version IS NULL AND EXISTS (SELECT 1 FROM vcv_statement s WHERE s.variation_id = v.variation_id);

SELECT problem, count(*) AS n, min(detail) AS example FROM validation_problem GROUP BY problem;

SELECT CASE WHEN count(*) > 0 THEN error('validation failed: ' || count(*) || ' problem(s), listed above') END
FROM validation_problem;
