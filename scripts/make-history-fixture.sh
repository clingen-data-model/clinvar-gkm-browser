#!/usr/bin/env bash
# Write the history test's fixture (scripts/test-history.sh) from a full release and the next delta:
# a few variants with every record they reach, as published, and the delta cut to the same records.
# Output: packages/derive/test/history/{base,delta}/, committed.
#
# The variants: 13572 and 4897201 (ClinVar merged 4897201 into 13572 in 2026-10-24, moving its SCV:
# a proposition changes subject, a variation and its VCV are deleted, a VCV version goes up);
# 2136846 (an SCV naming condition 5851, which the delta changes); 279 (an SCV naming condition set
# 48185, used by the synthetic deltas). Set 9448 comes along for the synthetic nested-set case.
#
# Each input is a state and its converted tables (the converted columns find the records quickly).
# Usage: scripts/make-history-fixture.sh <full state> <full converted> <delta state> <delta converted>
#   e.g. data/tmp/state-2026-10-18 data/tmp/conv-2026-10-18 data/tmp/state-delta-2026-10-24 data/tmp/conv-delta-2026-10-24
set -euo pipefail

bs="$(cd "$1" && pwd)"; bc="$(cd "$2" && pwd)"; ds="$(cd "$3" && pwd)"; dc="$(cd "$4" && pwd)"
out="packages/derive/test/history"
VARIANTS="13572, 4897201, 2136846, 279"
EXTRA_KEYS="'clinvar.traitset:9448'"
SECTIONS="sequenceReference location allele copyNumberCount copyNumberChange gene variation condition
  conditionSet therapy therapyGroup submitter propositionPathogenicity propositionOncogenicity
  propositionSomaticClinicalImpact propositionClinvarCustom evidenceLine scv vcv rcv"
LOOKUPS="sequenceReference location allele copyNumberCount copyNumberChange gene condition conditionSet
  therapy therapyGroup submitter"
rm -rf "$out"
mkdir -p "$out/base" "$out/delta"

# The keys the variants reach in one release's converted tables: propositions about them, statements
# on those, their evidence lines, and the variations.
reach() {  # <converted dir>
  echo "SELECT 'variation' AS section, id AS key FROM read_parquet('$1/variation.parquet') WHERE id_int(id) IN ($VARIANTS)
  UNION ALL SELECT p.section, p.id FROM props_$2 p
  UNION ALL SELECT s.section, s.id FROM stmts_$2 s
  UNION ALL SELECT 'evidenceLine', id FROM read_parquet(['$1/vcv_evidenceLine.parquet', '$1/rcv_evidenceLine.parquet'])
            WHERE regexp_extract(id, '^(.*)\.(contributing|non-contributing)$', 1) IN (SELECT id FROM stmts_$2)
  UNION ALL SELECT 'evidenceLine', id FROM read_parquet('$1/evidenceLine.parquet') WHERE target_proposition_id IN (SELECT id FROM props_$2)"
}
props() {  # <converted dir>
  for s in propositionPathogenicity propositionOncogenicity propositionSomaticClinicalImpact propositionClinvarCustom; do
    echo "UNION ALL SELECT '$s' AS section, id FROM read_parquet('$1/$s.parquet') WHERE id_int(subject_variant_id) IN ($VARIANTS)"
  done | sed '1s/^UNION ALL //'
}
stmts() {  # <converted dir> <props table>
  for s in scv vcv rcv; do echo "UNION ALL SELECT '$s' AS section, id FROM read_parquet('$1/$s.parquet') WHERE proposition_id IN (SELECT id FROM $2)"; done | sed '1s/^UNION ALL //'
}
raw() {  # <state dir> <pick table>: the picked records
  for s in $SECTIONS; do echo "UNION ALL SELECT '$s' AS section, key, rec FROM read_parquet('$1/$s.parquet') WHERE key IN (SELECT key FROM $2 WHERE section = '$s')"; done | sed '1s/^UNION ALL //'
}
lookup_keys() {  # <state dir>
  for s in $LOOKUPS; do echo "UNION ALL SELECT '$s' AS section, key FROM read_parquet('$1/$s.parquet')"; done | sed '1s/^UNION ALL //'
}
spill="$(mktemp -d)"
trap 'rm -rf "$spill"' EXIT
duckdb <<SQL
SET threads = 3; SET memory_limit = '4GB'; SET preserve_insertion_order = false; SET temp_directory = '$spill';
CREATE MACRO id_int(id) AS CAST(split_part(id, ':', 2) AS INTEGER);
CREATE MACRO bare(p) AS regexp_replace(p, '^#/[^/]+/', '');
CREATE TABLE props_b AS $(props "$bc");
CREATE TABLE props_d AS $(props "$dc");
CREATE TABLE stmts_b AS $(stmts "$bc" props_b);
CREATE TABLE stmts_d AS $(stmts "$dc" props_d);
-- A record the delta moves onto a variant is reached through the delta; its base version comes too.
CREATE TABLE pick AS SELECT section, key FROM ($(reach "$bc" b) UNION $(reach "$dc" d))
                     UNION SELECT 'conditionSet', unnest([$EXTRA_KEYS]);

-- Then the lookups the picked records name, repeatedly: alleles, then locations, then sequences;
-- sets, then their conditions and member sets; submitters; genes.
CREATE TABLE lk AS SELECT DISTINCT * FROM ($(lookup_keys "$bs") UNION ALL $(lookup_keys "$ds"));
$(for i in 1 2 3 4; do echo "
CREATE OR REPLACE TABLE recs AS SELECT rec FROM ($(raw "$bs" pick)) UNION ALL SELECT rec FROM ($(raw "$ds" pick));
INSERT INTO pick SELECT section, key FROM lk
  WHERE key IN (SELECT DISTINCT bare(unnest(regexp_extract_all(rec, '\"([^\"]+)\"', 1))) FROM recs)
    AND (section, key) NOT IN (SELECT (section, key) FROM pick);"; done)

CREATE TABLE b AS $(raw "$bs" pick);
CREATE TABLE d AS $(raw "$ds" pick);
$(for s in $SECTIONS; do echo "
COPY (SELECT key, rec FROM b WHERE section = '$s' ORDER BY key) TO '$out/base/$s.parquet' (FORMAT parquet);
COPY (SELECT key, rec FROM d WHERE section = '$s' ORDER BY key) TO '$out/delta/$s.parquet' (FORMAT parquet);"; done)
-- The delta's deletions of records in the base.
COPY (SELECT x.section, x.key FROM read_parquet('$ds/deleted.parquet') x SEMI JOIN b USING (section, key) ORDER BY ALL)
  TO '$out/delta/deleted.parquet' (FORMAT parquet);
SELECT 'base' AS state, count(*) AS records FROM b UNION ALL SELECT 'delta', count(*) FROM d
UNION ALL SELECT 'deleted', count(*) FROM read_parquet('$out/delta/deleted.parquet');
SQL
cp "$bs/state.json" "$out/base/"
cp "$ds/state.json" "$out/delta/"
du -sh "$out"
