#!/usr/bin/env bash
# Write a small test release from a derived one: every variant on HFE's gene list, two BRCA1 variants,
# and a few somatic oncogenicity and clinical-impact variants, with only the rows they reach.
# Output: apps/server/test/fixture/derived/<schema>/<release>/, committed for tests.
#
# Usage: scripts/make-fixture.sh [release]   (default: the newest derived release)
set -euo pipefail

DATA_DIR="${CLINVAR_DATA_DIR:-./data}"
SCHEMA_VERSION=1
base="$DATA_DIR/derived/$SCHEMA_VERSION"
release="${1:-$(ls "$base" | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' | sort | tail -1)}"
src="$(cd "$base/$release" && pwd)"
out="apps/server/test/fixture/derived/$SCHEMA_VERSION/$release"
rm -rf "$out"
mkdir -p "$out"

{
  for f in "$src"/*.parquet; do
    t="$(basename "$f" .parquet)"
    echo "CREATE VIEW src_$t AS FROM read_parquet('$f');"
  done
  cat <<SQL
CREATE TABLE pick AS
SELECT DISTINCT variation_id FROM src_variant_gene
WHERE gene_id = 3077                                                   -- HFE, every relationship
UNION SELECT unnest([17661, 17662])                                    -- BRCA1 c.181T>G, c.68_69del
UNION SELECT unnest([13961, 1299388, 13652, 372511, 12356, 12579]);    -- somatic SCI, ONCO

CREATE TABLE variant AS SELECT * FROM src_variant WHERE variation_id IN (FROM pick) ORDER BY variation_id;
CREATE TABLE scv AS SELECT * FROM src_scv WHERE variation_id IN (FROM pick) ORDER BY variation_id, scv_id;
CREATE TABLE variant_gene AS SELECT * FROM src_variant_gene WHERE variation_id IN (FROM pick) ORDER BY ALL;
CREATE TABLE variant_hgvs AS SELECT * FROM src_variant_hgvs WHERE variation_id IN (FROM pick) ORDER BY variation_id, expression, protein_expression;
CREATE TABLE variant_xref AS SELECT * FROM src_variant_xref WHERE variation_id IN (FROM pick) ORDER BY ALL;
CREATE TABLE vcv_statement AS SELECT * FROM src_vcv_statement WHERE variation_id IN (FROM pick) ORDER BY variation_id, statement_id;
CREATE TABLE rcv_statement AS SELECT * FROM src_rcv_statement WHERE variation_id IN (FROM pick) ORDER BY variation_id, statement_id;
CREATE TABLE allele AS SELECT * FROM src_allele WHERE id IN (SELECT allele_id FROM variant) ORDER BY id;
CREATE TABLE copyNumberCount AS SELECT * FROM src_copyNumberCount WHERE id IN (SELECT copy_number_count_id FROM variant) ORDER BY id;
CREATE TABLE copyNumberChange AS SELECT * FROM src_copyNumberChange WHERE id IN (SELECT copy_number_change_id FROM variant) ORDER BY id;
CREATE TABLE location AS SELECT * FROM src_location WHERE id IN (
  SELECT location_id FROM allele UNION SELECT location_id FROM copyNumberCount
  UNION SELECT location_id FROM copyNumberChange UNION SELECT defining_location_id FROM variant) ORDER BY id;
CREATE TABLE sequenceReference AS FROM src_sequenceReference;
CREATE TABLE scv_condition AS SELECT * FROM src_scv_condition WHERE scv_id IN (SELECT scv_id FROM scv) ORDER BY scv_id, condition_id;
CREATE TABLE scv_classification_pair AS SELECT * FROM src_scv_classification_pair WHERE variation_id IN (FROM pick)
  ORDER BY a_submitter_id, variation_id, a_scv_id, b_scv_id;
CREATE TABLE conditionSet AS SELECT * FROM src_conditionSet WHERE id IN (
  SELECT condition_set_id FROM scv UNION SELECT condition_set_id FROM vcv_statement
  UNION SELECT condition_set_id FROM rcv_statement UNION SELECT via_condition_set_id FROM scv_condition);
-- Minted sets' member TraitSets too, one level deep.
INSERT INTO conditionSet SELECT * FROM src_conditionSet WHERE id IN (SELECT unnest(concepts) FROM conditionSet)
  AND id NOT IN (SELECT id FROM conditionSet);
CREATE TABLE condition AS SELECT * FROM src_condition WHERE id IN (
  SELECT condition_id FROM scv_condition
  UNION SELECT CAST(split_part(m, ':', 2) AS INTEGER)
        FROM (SELECT submitted_condition.normalized_match AS m FROM scv
              UNION ALL SELECT c.normalized_match FROM (SELECT unnest(submitted_condition_set.concepts) AS c FROM scv))
        WHERE m LIKE 'clinvar.trait:%'
  UNION SELECT condition_id FROM vcv_statement UNION SELECT condition_id FROM rcv_statement
  UNION SELECT CAST(split_part(c, ':', 2) AS INTEGER)
        FROM (SELECT unnest(concepts) AS c FROM conditionSet) WHERE c LIKE 'clinvar.trait:%') ORDER BY id;
CREATE TABLE gene AS SELECT * FROM src_gene WHERE id IN (
  SELECT gene_id FROM variant_gene UNION SELECT gene_context_id FROM scv) ORDER BY id;
CREATE TABLE submitter AS SELECT * FROM src_submitter WHERE id IN (SELECT submitter_id FROM scv) ORDER BY id;
CREATE TABLE classification_type AS FROM src_classification_type;
CREATE TABLE classification_term AS FROM src_classification_term;
CREATE TABLE submission_level AS FROM src_submission_level;
CREATE TABLE review_status AS FROM src_review_status;
CREATE TABLE release AS FROM src_release;
CREATE TABLE source_file AS FROM src_source_file;
CREATE TABLE reference_issue AS FROM src_reference_issue WHERE false;
DROP TABLE pick;
SQL
  for f in "$src"/*.parquet; do
    t="$(basename "$f" .parquet)"
    echo "COPY $t TO '$out/$t.parquet' (FORMAT parquet, COMPRESSION zstd);"
  done
  cat <<SQL
COPY (
  SELECT r.*, (SELECT list({name: table_name, rows: estimated_size} ORDER BY table_name)
               FROM duckdb_tables() WHERE schema_name = 'main') AS tables
  FROM release r
) TO '$out/manifest.json' (FORMAT json);
SQL
} | duckdb
# The manifest is committed, so keep it as `pnpm format` would.
pnpm exec prettier --write "$out/manifest.json" >/dev/null

du -sh "$out"
