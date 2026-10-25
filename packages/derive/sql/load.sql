-- ClinVar GKM browser: load one ClinVar-GKM parquet release into the schema in schema.sql.
--
-- Expects the variable src to name the directory holding the 22 parquet files and manifest.json,
-- and a scratch database attached as stage, for intermediate tables (deleted after the load):
--   SET VARIABLE src = 'data/source/2026-10-18';
--   ATTACH 'data/tmp/stage.duckdb' AS stage;
-- Tables are filled parents first, because every FOREIGN KEY is checked as rows are inserted.
-- See docs/schema.md for the column sources.

CREATE OR REPLACE TEMP MACRO src_file(name) AS getvariable('src') || '/' || name;

-- Upstream ids and nested fields, parsed once ---------------------------------------------------

CREATE TEMP MACRO id_int(id) AS CAST(split_part(id, ':', 2) AS INTEGER);
CREATE TEMP MACRO ext_string(exts, ext_name) AS list_filter(exts, lambda x: x.name = ext_name)[1].value_string;
CREATE TEMP MACRO ext_value(exts, ext_name) AS list_filter(exts, lambda x: x.name = ext_name)[1].value;
CREATE TEMP MACRO contribution(cs, activity) AS list_filter(cs, lambda c: c.activityType = activity)[1];

-- All propositions, 28M rows, read once.
CREATE TABLE stage.prop AS
SELECT id, type, predicate, id_int(subject_variant_id) AS variation_id, object_id, object_type,
       condition_qualifier_id, gene_context_id, gene_context_name, submitted_gene_symbols,
       gene_context_source, mode_of_inheritance, penetrance
FROM read_parquet(src_file('proposition*.parquet'));

-- Release metadata -----------------------------------------------------------------------------

INSERT INTO release
SELECT CAST(source_release AS DATE), CAST(build_date AS TIMESTAMP), schema_version, dataset,
       1, current_localtimestamp()
FROM read_json(src_file('manifest.json'));

INSERT INTO source_file
SELECT f.name, f.size, f.sha256
FROM (SELECT unnest(files) AS f FROM read_json(src_file('manifest.json')));

-- Genome -----------------------------------------------------------------------------------------

INSERT INTO sequence_reference
SELECT id, name, molecule_type FROM read_parquet(src_file('sequenceReference.parquet'));

INSERT INTO location
SELECT id, sequence_reference_id, loc_start, loc_end, loc_start_min, loc_start_max, loc_end_min, loc_end_max
FROM read_parquet(src_file('location.parquet'))
ORDER BY sequence_reference_id, loc_start_max;

INSERT INTO allele
WITH a AS (
    SELECT id, location_id, name,
           CAST(json_extract(data, '$.expressions') AS JSON[]) AS expressions,
           json_extract(data, '$.state') AS state
    FROM read_parquet(src_file('allele.parquet'))
), x AS (
    SELECT id, location_id, name, state,
           list_filter(expressions, lambda e: e->>'syntax' = 'spdi')[1]->>'value' AS spdi,
           list_filter(expressions, lambda e: e->>'syntax' = 'gnomad')[1]->>'value' AS vcf_key
    FROM a
)
SELECT id, location_id, name, spdi, vcf_key,
       split_part(vcf_key, '-', 1),
       CAST(nullif(split_part(vcf_key, '-', 2), '') AS BIGINT),
       nullif(split_part(vcf_key, '-', 3), ''),
       nullif(split_part(vcf_key, '-', 4), ''),
       state->>'type',
       state->>'sequence',
       CAST(state->>'length' AS BIGINT),
       CAST(state->>'repeatSubunitLength' AS BIGINT)
FROM x;

INSERT INTO copy_number
SELECT id, 'count', location_id, copies, NULL FROM read_parquet(src_file('copyNumberCount.parquet'))
UNION ALL
SELECT id, 'change', location_id, NULL, copy_change FROM read_parquet(src_file('copyNumberChange.parquet'));

-- Genes and variants -----------------------------------------------------------------------------

INSERT INTO gene
SELECT id_int(id), name FROM read_parquet(src_file('gene.parquet')) ORDER BY 1;

CREATE TABLE stage.variation AS
SELECT id_int(id) AS variation_id, name, extensions, mappings, members, constraints
FROM read_parquet(src_file('variation.parquet'));

INSERT INTO variant
SELECT v.variation_id,
       vcv.vcv_version,
       v.name,
       ext_string(v.extensions, 'clinvarVariationType'),
       ext_string(v.extensions, 'clinvarSubclassType'),
       ext_string(v.extensions, 'categoricalVariationType'),
       ext_string(v.extensions, 'definingVrsVariationType'),
       ext_string(v.extensions, 'clinvarCytogeneticLocation'),
       ext_string(v.extensions, 'vrsPreProcessingIssue'),
       ext_string(v.extensions, 'vrsProcessingException'),
       CASE WHEN v.members[1] LIKE 'ga4gh:VA.%' THEN v.members[1] END,
       CASE WHEN v.members[1] LIKE 'ga4gh:CN.%' OR v.members[1] LIKE 'ga4gh:CX.%' THEN v.members[1] END,
       list_filter(v.constraints, lambda c: c.type = 'DefiningLocationConstraint')[1].location
FROM stage.variation v
LEFT JOIN (
    SELECT DISTINCT CAST(regexp_extract(id, '^VCV(\d+)\.', 1) AS INTEGER) AS variation_id,
                    CAST(regexp_extract(id, '^VCV\d+\.(\d+)-', 1) AS INTEGER) AS vcv_version
    FROM read_parquet(src_file('vcv.parquet'))
) vcv USING (variation_id)
ORDER BY v.variation_id;

INSERT INTO variant_gene
SELECT variation_id, id_int(g.gene), g.relationship_type, g.source
FROM (SELECT variation_id, unnest(list_filter(extensions, lambda x: x.name = 'clinvarGeneList')[1].value_gene_array) AS g
      FROM stage.variation)
ORDER BY 1, 2;

INSERT INTO variant_hgvs
SELECT variation_id, ordinal,
       h.nucleotideExpression.syntax, h.nucleotideExpression.value, h.nucleotideType,
       h.proteinExpression.value, coalesce(h.maneSelect, false), coalesce(h.manePlus, false),
       [mc.name for mc in h.molecularConsequence]
FROM (SELECT variation_id, unnest(hs) AS h, unnest(range(1, len(hs) + 1)) AS ordinal
      FROM (SELECT variation_id, list_filter(extensions, lambda x: x.name = 'clinvarHgvsList')[1].value_hgvs_array AS hs
            FROM stage.variation))
ORDER BY variation_id, ordinal;

INSERT INTO variant_xref
SELECT variation_id, m.coding.system, m.coding.code, m.relation
FROM (SELECT variation_id, unnest(mappings) AS m FROM stage.variation)
ORDER BY variation_id;

DROP TABLE stage.variation;

-- Conditions and therapies -----------------------------------------------------------------------

INSERT INTO condition
SELECT id_int(id), name, conceptType, primaryCoding.code, aliases
FROM read_parquet(src_file('condition.parquet'))
ORDER BY 1;

INSERT INTO condition_xref
SELECT id_int(id), m.coding.system, m.coding.code, m.coding.name, m.relation
FROM (SELECT id, unnest(mappings) AS m FROM read_parquet(src_file('condition.parquet')))
ORDER BY 1;

INSERT INTO condition_set
SELECT row_number() OVER (ORDER BY id), id,
       CASE WHEN id LIKE 'clinvar.traitset:%' THEN id_int(id) END,
       conceptSetType, membershipOperator
FROM read_parquet(src_file('conditionSet.parquet'));

INSERT INTO condition_set_member
SELECT s.condition_set_key,
       CASE WHEN m.member LIKE 'clinvar.trait:%' THEN id_int(m.member) END,
       ms.condition_set_key
FROM (SELECT id, unnest(concepts) AS member FROM read_parquet(src_file('conditionSet.parquet'))) m
JOIN condition_set s ON s.condition_set_id = m.id
LEFT JOIN condition_set ms ON ms.condition_set_id = m.member;

-- Every condition reachable from a set, nested TraitSets expanded, for statement and SCV rollups.
CREATE TABLE stage.condition_set_condition AS
SELECT condition_set_key, condition_id FROM condition_set_member WHERE condition_id IS NOT NULL
UNION
SELECT m.condition_set_key, n.condition_id
FROM condition_set_member m JOIN condition_set_member n ON n.condition_set_key = m.member_set_key
WHERE n.condition_id IS NOT NULL;

INSERT INTO therapy
SELECT key, name FROM read_parquet(src_file('therapy.parquet'));

INSERT INTO therapy_group
SELECT key, membership_operator FROM read_parquet(src_file('therapyGroup.parquet'));

INSERT INTO therapy_group_member
SELECT DISTINCT key, unnest(members) FROM read_parquet(src_file('therapyGroup.parquet'));

INSERT INTO submitter
SELECT id_int(id), name FROM read_parquet(src_file('submitter.parquet')) ORDER BY 1;

-- Aggregate statements ---------------------------------------------------------------------------
--
-- VCV and RCV statements are staged together (their ids can't collide), then each tree is
-- inserted in three passes (roots, levels, tiers) so a parent row exists before the rows that
-- reference it.

CREATE TEMP MACRO statement_parts(id) AS
    regexp_extract(id, '^[VR]CV(\d+)\.(\d+)-([GS])-([A-Z]+)(?:-(PG|EP|CP|NOCP|NOCL|FLAG))?(?:-(T\d))?$',
                   ['accession', 'version', 'lane', 'code', 'level', 'tier']);

-- Evidence-line edges: which statement cites which (another statement, or an SCV).
CREATE TABLE stage.edge AS
SELECT regexp_extract(id, '^(.*)\.(contributing|non-contributing)$', 1) AS citing,
       strengthOfEvidenceProvided.name = 'Contributing' AS contributes,
       unnest(evidence_items) AS cited
FROM read_parquet([src_file('vcv_evidenceLine.parquet'), src_file('rcv_evidenceLine.parquet')]);

CREATE TABLE stage.statement_staged AS
WITH s AS (
    SELECT lower(left(st.id, 3)) AS tree, st.id, statement_parts(st.id) AS p, st.classification,
           st.extensions, st.direction, st.strength, pr.predicate, pr.object_id, pr.object_type,
           pr.variation_id
    FROM read_parquet([src_file('vcv.parquet'), src_file('rcv.parquet')]) st
    JOIN stage.prop pr ON pr.id = st.proposition_id
)
SELECT s.tree,
       row_number() OVER (PARTITION BY s.tree ORDER BY s.variation_id, s.id) AS statement_key,
       s.id AS statement_id,
       CAST(s.p.accession AS INTEGER) AS accession,
       CAST(s.p.version AS INTEGER) AS version,
       s.variation_id,
       s.p.code AS classification_type,
       CASE WHEN s.p.level = '' THEN 'root' WHEN s.p.tier = '' THEN 'level' ELSE 'tier' END AS node_kind,
       nullif(s.p.level, '') AS submission_level,
       nullif(s.p.tier, '') AS tier,
       e.citing AS parent_statement_id,
       e.contributes,
       s.classification.name AS classification,
       ext_value(s.classification.extensions, 'conflictingExplanation') AS conflicting_explanation,
       ext_value(s.extensions, 'clinvarReviewStatus') AS review_status,
       s.direction,
       s.strength.name AS strength,
       s.predicate,
       CASE WHEN s.object_type = 'condition' THEN id_int(s.object_id) END AS condition_id,
       CASE WHEN s.object_type = 'conditionSet' THEN s.object_id END AS condition_set_id
FROM s
LEFT JOIN stage.edge e ON e.cited = s.id;

CREATE VIEW stage.statement_row AS
SELECT s.*, parent.statement_key AS parent_key, cs.condition_set_key
FROM stage.statement_staged s
LEFT JOIN stage.statement_staged parent ON parent.tree = s.tree AND parent.statement_id = s.parent_statement_id
LEFT JOIN condition_set cs ON cs.condition_set_id = s.condition_set_id;

INSERT INTO vcv_statement BY NAME
SELECT statement_key AS vcv_statement_key, statement_id, variation_id, classification_type, node_kind,
       submission_level, tier, parent_key, contributes, classification, conflicting_explanation,
       review_status, direction, strength, predicate, condition_id, condition_set_key
FROM stage.statement_row WHERE tree = 'vcv' AND node_kind = 'root' ORDER BY statement_key;

INSERT INTO vcv_statement BY NAME
SELECT statement_key AS vcv_statement_key, statement_id, variation_id, classification_type, node_kind,
       submission_level, tier, parent_key, contributes, classification, conflicting_explanation,
       review_status, direction, strength, predicate, condition_id, condition_set_key
FROM stage.statement_row WHERE tree = 'vcv' AND node_kind = 'level' ORDER BY statement_key;

INSERT INTO vcv_statement BY NAME
SELECT statement_key AS vcv_statement_key, statement_id, variation_id, classification_type, node_kind,
       submission_level, tier, parent_key, contributes, classification, conflicting_explanation,
       review_status, direction, strength, predicate, condition_id, condition_set_key
FROM stage.statement_row WHERE tree = 'vcv' AND node_kind = 'tier' ORDER BY statement_key;

INSERT INTO rcv_statement BY NAME
SELECT statement_key AS rcv_statement_key, statement_id, accession AS rcv_accession, version AS rcv_version,
       variation_id, classification_type, node_kind, submission_level, tier, parent_key, contributes,
       classification, conflicting_explanation, review_status, direction, strength, predicate,
       condition_id, condition_set_key
FROM stage.statement_row WHERE tree = 'rcv' AND node_kind = 'root' ORDER BY statement_key;

INSERT INTO rcv_statement BY NAME
SELECT statement_key AS rcv_statement_key, statement_id, accession AS rcv_accession, version AS rcv_version,
       variation_id, classification_type, node_kind, submission_level, tier, parent_key, contributes,
       classification, conflicting_explanation, review_status, direction, strength, predicate,
       condition_id, condition_set_key
FROM stage.statement_row WHERE tree = 'rcv' AND node_kind = 'level' ORDER BY statement_key;

INSERT INTO rcv_statement BY NAME
SELECT statement_key AS rcv_statement_key, statement_id, accession AS rcv_accession, version AS rcv_version,
       variation_id, classification_type, node_kind, submission_level, tier, parent_key, contributes,
       classification, conflicting_explanation, review_status, direction, strength, predicate,
       condition_id, condition_set_key
FROM stage.statement_row WHERE tree = 'rcv' AND node_kind = 'tier' ORDER BY statement_key;

-- Submissions ------------------------------------------------------------------------------------

-- The statement citing each SCV, per tree.
CREATE TABLE stage.scv_citing AS
SELECT e.cited AS scv_statement_id, s.tree, s.statement_key
FROM stage.edge e JOIN stage.statement_staged s ON s.statement_id = e.citing
WHERE e.cited LIKE 'clinvar.submission:%';

DROP VIEW stage.statement_row;
DROP TABLE stage.statement_staged;
DROP TABLE stage.edge;

CREATE TEMP MACRO scv_number(id) AS CAST(regexp_extract(id, 'SCV(\d+)\.', 1) AS INTEGER);

-- Flatten scv.parquet first, in one streaming pass with no join or sort: its nested structs are
-- wide, and carrying them through the join below ran out of memory at 4 GB.
CREATE TABLE stage.scv_flat AS
SELECT id AS scv_statement_id,
       scv_number(id) AS scv_id,
       CAST(regexp_extract(id, 'SCV\d+\.(\d+)$', 1) AS INTEGER) AS scv_version,
       proposition_id,
       id_int(contribution(contributions, 'submitted').contributor) AS submitter_id,
       regexp_extract(proposition_id, '-([A-Z]+)$', 1) AS classification_type,
       ext_string(extensions, 'submissionLevel') AS submission_level,
       ext_string(extensions, 'clinvarScvReviewStatus') AS review_status,
       classification.name AS classification,
       classification.primaryCoding.code AS classification_code,
       ext_string(extensions, 'submittedScvClassification') AS submitted_classification,
       direction,
       strength.name AS strength,
       string_split(specifiedBy.methodType, ', ') AS collection_methods,
       specifiedBy.name AS assertion_criteria,
       description,
       contribution(contributions, 'submitted').date AS date_submitted,
       contribution(contributions, 'created').date AS date_created,
       contribution(contributions, 'evaluated').date AS date_last_evaluated,
       ext_string(extensions, 'submittedScvLocalKey') AS local_key
FROM read_parquet(src_file('scv.parquet'));

-- Only the SCV propositions (6.85M of 28M).
CREATE TABLE stage.scv_prop AS
SELECT * FROM stage.prop WHERE id LIKE 'SCV%';

INSERT INTO scv
SELECT s.scv_id, s.scv_version, p.variation_id, s.submitter_id, s.classification_type,
       s.submission_level, s.review_status, s.classification, s.classification_code, ct.term,
       s.submitted_classification, s.direction, s.strength, s.collection_methods,
       s.assertion_criteria, s.description, s.date_submitted, s.date_created,
       s.date_last_evaluated, s.local_key,
       p.predicate,
       CASE WHEN p.object_type = 'condition' THEN id_int(p.object_id) END,
       cs.condition_set_key,
       p.mode_of_inheritance,
       p.penetrance,
       id_int(p.gene_context_id),
       p.gene_context_name,
       p.gene_context_source,
       p.submitted_gene_symbols,
       v.statement_key,
       r.statement_key
FROM stage.scv_flat s
JOIN stage.scv_prop p ON p.id = s.proposition_id
LEFT JOIN classification_term ct
    ON ct.classification_type = s.classification_type AND ct.source_code = lower(s.classification_code)
-- CASE keeps this an equi-join; with AND in ON, DuckDB plans a nested loop (10 minutes here).
LEFT JOIN condition_set cs ON cs.condition_set_id = CASE WHEN p.object_type = 'conditionSet' THEN p.object_id END
LEFT JOIN stage.scv_citing v ON v.tree = 'vcv' AND v.scv_statement_id = s.scv_statement_id
LEFT JOIN stage.scv_citing r ON r.tree = 'rcv' AND r.scv_statement_id = s.scv_statement_id
ORDER BY p.variation_id, s.scv_id;

-- Terms the vocabulary doesn't know load as published, with term NULL, and are listed here.
INSERT INTO reference_issue
SELECT 'scv', 'classification_code', 'classification_term', 'source_code',
       classification_type || ': ' || coalesce(classification_code, '(none)'), count(*)
FROM scv WHERE term IS NULL GROUP BY ALL;

DROP TABLE stage.scv_flat;
DROP TABLE stage.scv_prop;
DROP TABLE stage.scv_citing;

INSERT INTO scv_citation
SELECT scv_id, ordinal, c.pmid, c.doi, c.urls, c.name, c.documentType
FROM (SELECT scv_number(id) AS scv_id, unnest(reportedIn) AS c, unnest(range(1, len(reportedIn) + 1)) AS ordinal
      FROM read_parquet(src_file('scv.parquet')))
ORDER BY scv_id, ordinal;

INSERT INTO scv_submitted_condition
WITH x AS (
    SELECT scv_number(id) AS scv_id, unnest(extensions) AS x FROM read_parquet(src_file('scv.parquet'))
), c AS (
    SELECT scv_id, 1 AS ordinal, x.value_submitted_condition.name, x.value_submitted_condition.type,
           x.value_submitted_condition.medgen_id, x.value_submitted_condition.normalized_match,
           x.value_submitted_condition.normalized_resolution, x.value_submitted_condition.mapping
    FROM x
    WHERE x.name = 'submittedCondition'
    UNION ALL
    SELECT scv_id, ordinal, m.name, m.type, m.medgen_id, m.normalized_match, m.normalized_resolution, m.mapping
    FROM (SELECT scv_id, unnest(cs) AS m, unnest(range(1, len(cs) + 1)) AS ordinal
          FROM (SELECT scv_id, x.value_submitted_condition_set.concepts AS cs
                FROM x
                WHERE x.name = 'submittedConditionSet'))
)
SELECT scv_id, ordinal, name, type, medgen_id,
       CASE WHEN normalized_match LIKE 'clinvar.trait:%' THEN id_int(normalized_match) END,
       normalized_resolution, mapping.type, mapping.ref, mapping.value
FROM c
ORDER BY scv_id, ordinal;

INSERT INTO scv_condition
SELECT scv_id, condition_id, NULL FROM scv WHERE condition_id IS NOT NULL
UNION ALL
SELECT s.scv_id, c.condition_id, s.condition_set_key
FROM scv s JOIN stage.condition_set_condition c ON c.condition_set_key = s.condition_set_key
ORDER BY 1, 2;

INSERT INTO scv_somatic_impact
SELECT scv_number(e.id),
       regexp_extract(e.target_proposition_id, '-([A-Z]+)$', 1),
       e.evidenceOutcome.name,
       e.directionOfEvidenceProvided,
       p.predicate,
       CASE WHEN p.object_type = 'condition' THEN id_int(p.object_id) END,
       cs.condition_set_key,
       CASE WHEN p.object_type = 'therapy' THEN p.object_id END,
       CASE WHEN p.object_type = 'therapyGroup' THEN p.object_id END,
       id_int(p.condition_qualifier_id)
FROM read_parquet(src_file('evidenceLine.parquet')) e
JOIN stage.prop p ON p.id = e.target_proposition_id
-- CASE keeps this an equi-join; with AND in ON, DuckDB plans a nested loop (10 minutes here).
LEFT JOIN condition_set cs ON cs.condition_set_id = CASE WHEN p.object_type = 'conditionSet' THEN p.object_id END;

CHECKPOINT;
