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
CREATE TABLE variant_hgvs AS SELECT * FROM src_variant_hgvs WHERE variation_id IN (FROM pick) ORDER BY variation_id, ordinal;
CREATE TABLE variant_xref AS SELECT * FROM src_variant_xref WHERE variation_id IN (FROM pick) ORDER BY variation_id;
CREATE TABLE vcv_statement AS SELECT * FROM src_vcv_statement WHERE variation_id IN (FROM pick) ORDER BY vcv_statement_key;
CREATE TABLE rcv_statement AS SELECT * FROM src_rcv_statement WHERE variation_id IN (FROM pick) ORDER BY rcv_statement_key;
CREATE TABLE allele AS SELECT * FROM src_allele WHERE allele_id IN (SELECT allele_id FROM variant);
CREATE TABLE copy_number AS SELECT * FROM src_copy_number WHERE copy_number_id IN (SELECT copy_number_id FROM variant);
CREATE TABLE location AS SELECT * FROM src_location WHERE location_id IN (
  SELECT location_id FROM allele UNION SELECT location_id FROM copy_number UNION SELECT defining_location_id FROM variant);
CREATE TABLE sequence_reference AS FROM src_sequence_reference;
CREATE TABLE scv_citation AS SELECT * FROM src_scv_citation WHERE scv_id IN (SELECT scv_id FROM scv) ORDER BY scv_id, ordinal;
CREATE TABLE scv_condition AS SELECT * FROM src_scv_condition WHERE scv_id IN (SELECT scv_id FROM scv) ORDER BY scv_id, condition_id;
CREATE TABLE scv_submitted_condition AS SELECT * FROM src_scv_submitted_condition WHERE scv_id IN (SELECT scv_id FROM scv) ORDER BY scv_id, ordinal;
CREATE TABLE scv_somatic_impact AS SELECT * FROM src_scv_somatic_impact WHERE scv_id IN (SELECT scv_id FROM scv);
CREATE TABLE scv_classification_pair AS SELECT * FROM src_scv_classification_pair WHERE variation_id IN (FROM pick)
  ORDER BY a_submitter_id, variation_id, a_scv_id, b_scv_id;
CREATE TABLE condition_set AS SELECT * FROM src_condition_set WHERE condition_set_key IN (
  SELECT condition_set_key FROM scv UNION SELECT condition_set_key FROM vcv_statement
  UNION SELECT condition_set_key FROM rcv_statement UNION SELECT via_condition_set_key FROM scv_condition);
CREATE TABLE condition_set_member AS SELECT * FROM src_condition_set_member WHERE condition_set_key IN (SELECT condition_set_key FROM condition_set);
CREATE TABLE condition AS SELECT * FROM src_condition WHERE condition_id IN (
  SELECT condition_id FROM scv_condition UNION SELECT condition_id FROM scv_submitted_condition
  UNION SELECT condition_id FROM vcv_statement UNION SELECT condition_id FROM rcv_statement
  UNION SELECT condition_id FROM condition_set_member UNION SELECT condition_id FROM scv_somatic_impact
  UNION SELECT condition_qualifier_id FROM scv_somatic_impact) ORDER BY condition_id;
CREATE TABLE condition_xref AS SELECT * FROM src_condition_xref WHERE condition_id IN (SELECT condition_id FROM condition);
CREATE TABLE gene AS SELECT * FROM src_gene WHERE gene_id IN (
  SELECT gene_id FROM variant_gene UNION SELECT gene_context_id FROM scv) ORDER BY gene_id;
CREATE TABLE submitter AS SELECT * FROM src_submitter WHERE submitter_id IN (SELECT submitter_id FROM scv) ORDER BY submitter_id;
CREATE TABLE therapy AS FROM src_therapy;
CREATE TABLE therapy_group AS FROM src_therapy_group;
CREATE TABLE therapy_group_member AS FROM src_therapy_group_member;
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

du -sh "$out"
