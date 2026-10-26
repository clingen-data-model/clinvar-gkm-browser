-- ClinVar GKM browser: convert a release's records from ClinVar-GKM's JSON form into the parquet
-- tables load.sql reads (docs/history.md#building-it).
--
-- Input, {state}/<section>.parquet: one file per bundle section, rows (key, rec) where rec is the
-- record's JSON exactly as in the bundle (and in the published parquet's `data` column). The
-- sections are the bundle's: evidenceLine holds the SCV, VCV and RCV evidence lines together.
-- Output, {out}/<table>.parquet: the published parquet's table names and the columns load.sql
-- reads, with upstream's types and names. Each column follows upstream's export
-- (clinvar-gkm src/scripts/parquet-schemas/<table>.sql): typed values picked from the record by
-- name, `#/<section>/` pointers stripped to bare ids. Columns load.sql doesn't read are left out.
--
-- {state} and {out} are replaced by scripts/convert-state.sh.

-- `->` is JSON extraction here, not the deprecated lambda arrow (list comprehensions need no lambdas).
SET lambda_syntax = 'DISABLE_SINGLE_ARROW';

CREATE OR REPLACE TEMP MACRO bare(p) AS regexp_replace(p, '^#/[^/]+/', '');
CREATE OR REPLACE TEMP MACRO pointer_section(p) AS regexp_extract(p, '^#/([^/]+)/', 1);
-- Upstream's lists are never NULL (BigQuery arrays): an absent list is [].
CREATE OR REPLACE TEMP MACRO json_list(j) AS coalesce(CAST(j AS JSON[]), []);
CREATE OR REPLACE TEMP MACRO bare_list(j) AS [bare(x) FOR x IN coalesce(CAST(j AS VARCHAR[]), [])];
-- An extension value as upstream's value_string: the value when it's a JSON string.
CREATE OR REPLACE TEMP MACRO ext_value_string(e) AS
    CASE WHEN json_type(e->'value') = 'VARCHAR' THEN e->>'value' END;

-- Genome ----------------------------------------------------------------------------------------

COPY (
    SELECT key AS id, j->>'name' AS name, j->>'moleculeType' AS molecule_type
    FROM (SELECT key, rec::JSON AS j FROM read_parquet('{state}/sequenceReference.parquet'))
) TO '{out}/sequenceReference.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 20000);

-- A start or end is a number, or a [min, max] range with either bound null (upstream's location.sql).
COPY (
    SELECT key AS id, bare(j->>'sequenceReference') AS sequence_reference_id,
           TRY_CAST(j->>'start' AS BIGINT) AS loc_start,
           TRY_CAST(j->>'end' AS BIGINT) AS loc_end,
           coalesce(TRY_CAST(j->>'start' AS BIGINT), CAST(j->>'$.start[0]' AS BIGINT)) AS loc_start_min,
           coalesce(TRY_CAST(j->>'start' AS BIGINT), CAST(j->>'$.start[1]' AS BIGINT)) AS loc_start_max,
           coalesce(TRY_CAST(j->>'end' AS BIGINT), CAST(j->>'$.end[0]' AS BIGINT)) AS loc_end_min,
           coalesce(TRY_CAST(j->>'end' AS BIGINT), CAST(j->>'$.end[1]' AS BIGINT)) AS loc_end_max
    FROM (SELECT key, rec::JSON AS j FROM read_parquet('{state}/location.parquet'))
) TO '{out}/location.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 20000);

-- load.sql reads the allele's expressions and state from `data`, the record itself.
COPY (
    SELECT key AS id, bare(rec::JSON->>'location') AS location_id, rec::JSON->>'name' AS name, rec AS data
    FROM read_parquet('{state}/allele.parquet')
) TO '{out}/allele.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 20000);

COPY (
    SELECT key AS id, bare(j->>'location') AS location_id, CAST(j->>'copies' AS BIGINT) AS copies
    FROM (SELECT key, rec::JSON AS j FROM read_parquet('{state}/copyNumberCount.parquet'))
) TO '{out}/copyNumberCount.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 20000);

COPY (
    SELECT key AS id, bare(j->>'location') AS location_id, j->>'copyChange' AS copy_change
    FROM (SELECT key, rec::JSON AS j FROM read_parquet('{state}/copyNumberChange.parquet'))
) TO '{out}/copyNumberChange.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 20000);

-- Genes, variants, submitters ---------------------------------------------------------------------

COPY (
    SELECT key AS id, rec::JSON->>'name' AS name FROM read_parquet('{state}/gene.parquet')
) TO '{out}/gene.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 20000);

COPY (
    SELECT key AS id, rec::JSON->>'name' AS name FROM read_parquet('{state}/submitter.parquet')
) TO '{out}/submitter.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 20000);

-- Extensions carry one JSON `value`; upstream's typed column splits it into value_<type> fields
-- by the extension (variation.sql), with [] for the list fields an extension doesn't use.
-- Gene-list entries name their gene by pointer.
COPY (
    SELECT key AS id, j->>'name' AS name,
           [{
               name: e->>'name',
               value_string: ext_value_string(e),
               value_hgvs_array: CASE WHEN e->>'name' = 'clinvarHgvsList' THEN
                   [{nucleotideExpression: h.nucleotideExpression, nucleotideType: h.nucleotideType,
                     maneSelect: h.maneSelect, manePlus: h.manePlus, proteinExpression: h.proteinExpression,
                     molecularConsequence: coalesce(h.molecularConsequence, [])}
                    FOR h IN from_json(e->'value',
                   '[{"nucleotideExpression": {"syntax": "VARCHAR", "value": "VARCHAR"}, "nucleotideType": "VARCHAR",
                      "maneSelect": "BOOLEAN", "manePlus": "BOOLEAN",
                      "proteinExpression": {"syntax": "VARCHAR", "value": "VARCHAR"},
                      "molecularConsequence": [{"code": "VARCHAR", "system": "VARCHAR", "name": "VARCHAR"}]}]')] ELSE [] END,
               value_gene_array: CASE WHEN e->>'name' = 'clinvarGeneList' THEN
                   [{gene: bare(g.gene), relationship_type: g.relationship_type, source: g.source}
                    FOR g IN from_json(e->'value', '[{"gene": "VARCHAR", "relationship_type": "VARCHAR", "source": "VARCHAR"}]')] ELSE [] END
           } FOR e IN json_list(j->'extensions')] AS extensions,
           coalesce(from_json(j->'mappings', '[{"coding": {"system": "VARCHAR", "code": "VARCHAR"}, "relation": "VARCHAR"}]'), []) AS mappings,
           bare_list(j->'members') AS members,
           [{type: c->>'type', allele: bare(c->>'allele'), location: bare(c->>'location')}
            FOR c IN json_list(j->'constraints')] AS constraints
    FROM (SELECT key, rec::JSON AS j FROM read_parquet('{state}/variation.parquet'))
) TO '{out}/variation.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 20000);

-- Conditions and therapies ----------------------------------------------------------------------

-- condition keeps upstream's camelCase column names (condition.sql).
COPY (
    SELECT key AS id, j->>'name' AS name, j->>'conceptType' AS conceptType,
           from_json(j->'primaryCoding', '{"name": "VARCHAR", "code": "VARCHAR", "system": "VARCHAR"}') AS primaryCoding,
           coalesce(CAST(j->'aliases' AS VARCHAR[]), []) AS aliases,
           coalesce(from_json(j->'mappings', '[{"coding": {"name": "VARCHAR", "code": "VARCHAR", "system": "VARCHAR"}, "relation": "VARCHAR"}]'), []) AS mappings
    FROM (SELECT key, rec::JSON AS j FROM read_parquet('{state}/condition.parquet'))
) TO '{out}/condition.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 20000);

COPY (
    SELECT key AS id, j->>'conceptSetType' AS conceptSetType, j->>'membershipOperator' AS membershipOperator,
           bare_list(j->'concepts') AS concepts
    FROM (SELECT key, rec::JSON AS j FROM read_parquet('{state}/conditionSet.parquet'))
) TO '{out}/conditionSet.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 20000);

COPY (
    SELECT key, rec::JSON->>'name' AS name FROM read_parquet('{state}/therapy.parquet')
) TO '{out}/therapy.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 20000);

COPY (
    SELECT key, j->>'membershipOperator' AS membership_operator, bare_list(j->'concepts') AS members
    FROM (SELECT key, rec::JSON AS j FROM read_parquet('{state}/therapyGroup.parquet'))
) TO '{out}/therapyGroup.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 20000);

-- Propositions: one column schema for the four sections (proposition.sql) ------------------------

-- A table macro, not a scalar one: macro parameters aren't substituted inside list comprehensions.
CREATE OR REPLACE TEMP MACRO propositions(path) AS TABLE
SELECT key AS id,
       j->>'type' AS type,
       j->>'predicate' AS predicate,
       bare(j->>'subject') AS subject_variant_id,
       bare(j->>'object') AS object_id,
       pointer_section(j->>'object') AS object_type,
       bare(j->>'conditionQualifier') AS condition_qualifier_id,
       'ncbigene:' || (j->>'$.geneContextQualifier.primaryCoding.code') AS gene_context_id,
       j->>'$.geneContextQualifier.name' AS gene_context_name,
       coalesce(flatten([TRY_CAST(x->'value' AS VARCHAR[])
           FOR x IN json_list(j->'$.geneContextQualifier.extensions') IF x->>'name' = 'submittedGeneSymbols']),
           []::VARCHAR[]) AS submitted_gene_symbols,
       [x->>'value' FOR x IN json_list(j->'$.geneContextQualifier.extensions')
           IF x->>'name' = 'geneContextSource'][1] AS gene_context_source,
       j->>'$.modeOfInheritanceQualifier.name' AS mode_of_inheritance,
       j->>'$.penetranceQualifier.name' AS penetrance
FROM (SELECT key, rec::JSON AS j FROM read_parquet(path));

COPY (FROM propositions('{state}/propositionPathogenicity.parquet')) TO '{out}/propositionPathogenicity.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 20000);
COPY (FROM propositions('{state}/propositionOncogenicity.parquet')) TO '{out}/propositionOncogenicity.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 20000);
COPY (FROM propositions('{state}/propositionSomaticClinicalImpact.parquet')) TO '{out}/propositionSomaticClinicalImpact.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 20000);
COPY (FROM propositions('{state}/propositionClinvarCustom.parquet')) TO '{out}/propositionClinvarCustom.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 20000);

-- Aggregate statements and their evidence lines ---------------------------------------------------

CREATE OR REPLACE TEMP MACRO statements(path) AS TABLE
SELECT key AS id,
       j->>'direction' AS direction,
       CASE WHEN (j->'strength') IS NOT NULL THEN {name: j->>'$.strength.name'} END AS strength,
       CASE WHEN (j->'classification') IS NOT NULL THEN {name: j->>'$.classification.name',
        extensions: [{name: e->>'name', value: e->>'value'} FOR e IN json_list(j->'$.classification.extensions')]} END AS classification,
       [{name: e->>'name', value: e->>'value'} FOR e IN json_list(j->'extensions')] AS extensions,
       bare(j->>'proposition') AS proposition_id
FROM (SELECT key, rec::JSON AS j FROM read_parquet(path));

COPY (FROM statements('{state}/vcv.parquet')) TO '{out}/vcv.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 20000);
COPY (FROM statements('{state}/rcv.parquet')) TO '{out}/rcv.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 20000);

-- The bundle's one evidenceLine section is three parquet tables: the VCV's, the RCV's, and the
-- SCVs' own (somatic clinical impact), told apart by id.
CREATE OR REPLACE TEMP MACRO aggregate_evidence(path, prefix) AS TABLE
SELECT key AS id,
       CASE WHEN (j->'strengthOfEvidenceProvided') IS NOT NULL THEN {name: j->>'$.strengthOfEvidenceProvided.name'} END AS strengthOfEvidenceProvided,
       bare_list(j->'hasEvidenceItems') AS evidence_items
FROM (SELECT key, rec::JSON AS j FROM read_parquet(path) WHERE starts_with(key, prefix));

COPY (FROM aggregate_evidence('{state}/evidenceLine.parquet', 'VCV')) TO '{out}/vcv_evidenceLine.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 20000);
COPY (FROM aggregate_evidence('{state}/evidenceLine.parquet', 'RCV')) TO '{out}/rcv_evidenceLine.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 20000);
COPY (
    SELECT key AS id, j->>'directionOfEvidenceProvided' AS directionOfEvidenceProvided,
           CASE WHEN (j->'evidenceOutcome') IS NOT NULL THEN {name: j->>'$.evidenceOutcome.name'} END AS evidenceOutcome,
           bare(j->>'targetProposition') AS target_proposition_id
    FROM (SELECT key, rec::JSON AS j FROM read_parquet('{state}/evidenceLine.parquet')
          WHERE key NOT LIKE 'VCV%' AND key NOT LIKE 'RCV%')
) TO '{out}/evidenceLine.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 20000);

-- Submissions ------------------------------------------------------------------------------------

-- Upstream's typed submitted condition (scv.sql); the set form holds a list of the same concepts.
CREATE OR REPLACE TEMP MACRO submitted_condition(v) AS from_json(v,
    '{"id": "VARCHAR", "name": "VARCHAR", "type": "VARCHAR", "medgen_id": "VARCHAR",
      "normalized_match": "VARCHAR", "normalized_resolution": "VARCHAR",
      "mapping": {"type": "VARCHAR", "ref": "VARCHAR", "value": "VARCHAR"}}');

COPY (
    SELECT key AS id,
           bare(j->>'proposition') AS proposition_id,
           [{contributor: bare(c->>'contributor'), date: CAST(c->>'date' AS DATE), activityType: c->>'activityType'}
            FOR c IN json_list(j->'contributions')] AS contributions,
           [{
               name: e->>'name',
               value_string: ext_value_string(e),
               value_submitted_condition: CASE WHEN e->>'name' = 'submittedCondition' THEN submitted_condition(e->'value') END,
               value_submitted_condition_set: CASE WHEN e->>'name' = 'submittedConditionSet' THEN
                   {concepts: [submitted_condition(c) FOR c IN json_list(e->'$.value.concepts')]} END
           } FOR e IN json_list(j->'extensions')] AS extensions,
           CASE WHEN (j->'classification') IS NOT NULL THEN {name: j->>'$.classification.name',
               primaryCoding: CASE WHEN (j->'$.classification.primaryCoding') IS NOT NULL THEN {code: j->>'$.classification.primaryCoding.code'} END} END AS classification,
           j->>'direction' AS direction,
           CASE WHEN (j->'strength') IS NOT NULL THEN {name: j->>'$.strength.name'} END AS strength,
           CASE WHEN (j->'specifiedBy') IS NOT NULL THEN {methodType: j->>'$.specifiedBy.methodType', name: j->>'$.specifiedBy.name'} END AS specifiedBy,
           j->>'description' AS description,
           [{pmid: r.pmid, doi: r.doi, urls: coalesce(r.urls, []), name: r.name, documentType: r.documentType}
            FOR r IN coalesce(from_json(j->'reportedIn',
                '[{"pmid": "VARCHAR", "doi": "VARCHAR", "urls": ["VARCHAR"], "name": "VARCHAR", "documentType": "VARCHAR"}]'), [])] AS reportedIn
    FROM (SELECT key, rec::JSON AS j FROM read_parquet('{state}/scv.parquet'))
) TO '{out}/scv.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 20000);
