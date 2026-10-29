#!/usr/bin/env bash
# Release history (docs/history.md): upstream's records as a log of each release's changes, and the
# derived tables with the releases each row held (valid_from inclusive, valid_to exclusive).
#
#   init <converted release>   start a history from a full release in load.sql's input shape
#                              (scripts/convert-state.sh output, with its manifest.json)
#   apply <delta state>        apply the next weekly delta (scripts/state-from-bundle.sh --delta):
#                              append it to the log, re-derive only the variants it touches, and
#                              close and add rows
#   check [release]            derive the full state as of a release (default the latest) from the
#                              log, and compare it with the history's rows as of that release
#
# Layout, under HISTORY_DIR (default data/history/<schema version>):
#   log/<table>/release=<date>/data.parquet   each release's records, plus log_deleted markers
#   derived/<table>.parquet                   derived tables; history tables add valid_from, valid_to
#   history_release.parquet                   the releases applied, in order
set -euo pipefail

DATA_DIR="${CLINVAR_DATA_DIR:-./data}"
SCHEMA_VERSION=1
HIST="${HISTORY_DIR:-$DATA_DIR/history/$SCHEMA_VERSION}"
SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
SQL_DIR="$SCRIPTS/../packages/derive/sql"
DUCKDB_SETTINGS="SET memory_limit = '${DUCKDB_MEMORY_LIMIT:-4GB}'; SET threads = ${DUCKDB_THREADS:-7};"

# load.sql's input tables, as written by the converter. Therapies are keyed by `key`, the rest by id.
LOG_TABLES="sequenceReference location allele copyNumberCount copyNumberChange gene variation condition
  conditionSet therapy therapyGroup submitter propositionPathogenicity propositionOncogenicity
  propositionSomaticClinicalImpact propositionClinvarCustom evidenceLine vcv_evidenceLine
  rcv_evidenceLine scv vcv rcv"
PROP_TABLES="propositionPathogenicity propositionOncogenicity propositionSomaticClinicalImpact propositionClinvarCustom"
log_key() { case $1 in therapy | therapyGroup) echo key ;; *) echo id ;; esac; }

# Derived tables with history. Most are grouped by variant and re-derived per affected variant; the
# lookups keep upstream's shape, one row per upstream record. The rest of a release (vocabularies,
# reference_issue) is copied as it stands.
VARIANT_TABLES="variant variant_gene variant_hgvs variant_xref vcv_statement rcv_statement scv scv_condition
  scv_classification_pair"
LOOKUP_TABLES="sequenceReference location allele copyNumberCount copyNumberChange gene condition conditionSet submitter"
PLAIN_TABLES="classification_type classification_term submission_level review_status reference_issue"
# Each table's stored order, as load.sql writes it, then valid_from.
sort_key() {
  case $1 in
    variant) echo variation_id ;;
    variant_gene) echo variation_id, gene_id ;;
    variant_hgvs) echo variation_id, ordinal ;;
    variant_xref) echo variation_id, system, code ;;
    vcv_statement | rcv_statement) echo variation_id, statement_id ;;
    scv) echo variation_id, scv_id ;;
    scv_condition) echo scv_id, condition_id ;;
    scv_classification_pair) echo a_submitter_id, variation_id, a_scv_id, b_scv_id ;;
    location) echo sequence_reference_id, loc_start_max, id ;;
    *) echo id ;;
  esac
}
# Numeric upstream ids are integers in the derived lookups (gene, submitter, condition).
lookup_key_expr() { case $1 in gene | submitter | condition) echo "id_int(key)" ;; *) echo key ;; esac; }

die() { echo "$*" >&2; exit 1; }
latest_release() { duckdb -noheader -list -c "SELECT max(release) FROM read_parquet('$HIST/history_release.parquet')"; }

# The log of one table: every release folder, plus a staged one not yet moved in.
log_glob() {
  local t=$1 extra=${2:-}
  if [[ -n $extra ]]; then echo "['$HIST/log/$t/*/*.parquet', '$extra/log/$t/*/*.parquet']"
  else echo "'$HIST/log/$t/*/*.parquet'"; fi
}
# A table's records as of a release: each key's newest row up to it, unless that row is a deletion.
# An optional filter on the raw rows (by key, or a column that never changes for a key) goes first.
# Deletion markers carry only the key, so they always pass it.
as_of() {
  local t=$1 release=$2 filter=${3:-} extra=${4:-}
  echo "SELECT * EXCLUDE (release, log_deleted)
        FROM read_parquet($(log_glob "$t" "$extra"), hive_partitioning = true, union_by_name = true)
        WHERE release <= DATE '$release' ${filter:+AND (($filter) OR log_deleted)}
        QUALIFY row_number() OVER (PARTITION BY $(log_key "$t") ORDER BY release DESC) = 1 AND NOT log_deleted"
}
# The records as of a release matching a condition on a column that can change under one key: the
# keys that matched at any release up to it, then the condition on each key's row as of it.
as_of_where() {
  local t=$1 release=$2 cond=$3 extra=${4:-}
  local k
  k=$(log_key "$t")
  echo "SELECT * FROM ($(as_of "$t" "$release" "$k IN (SELECT $k FROM read_parquet($(log_glob "$t" "$extra"), hive_partitioning = true, union_by_name = true)
                                                 WHERE release <= DATE '$release' AND ($cond))" "$extra"))
        WHERE $cond"
}

# Run schema.sql (references stripped, as derive.sh does), load.sql and validate.sql over a source
# directory, then write each table as parquet.
derive_into() {
  local src=$1 out=$2 work=$3
  mkdir -p "$out" "$work/spill"
  sed -E 's/ REFERENCES [A-Za-z_]+ \([a-z_]+\)//' "$SQL_DIR/schema.sql" >"$work/schema.sql"
  duckdb "$work/derive.duckdb" >"$work/derive.log" 2>&1 <<SQL || { tail -20 "$work/derive.log" >&2; die "derivation of $src failed"; }
$DUCKDB_SETTINGS
SET temp_directory = '$work/spill';
SET preserve_insertion_order = false;
SET VARIABLE src = '$src';
ATTACH '$work/stage.duckdb' AS stage;
.bail on
.echo on
.read $work/schema.sql
.read $SQL_DIR/load.sql
.read $SQL_DIR/validate.sql
DETACH stage;
DROP TABLE validation_problem;
SET preserve_insertion_order = true;
.mode list
.headers off
.output $work/export.sql
SELECT 'COPY "' || table_name || '" TO ''$out/' || table_name || '.parquet'' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000);'
FROM duckdb_tables() WHERE database_name = current_database() ORDER BY table_name;
.output
.read $work/export.sql
SQL
  rm -rf "$work/derive.duckdb" "$work/stage.duckdb" "$work/spill"
}

# A manifest.json that load.sql (and derive.sh) accept, for a source directory we wrote.
write_manifest() {
  local dir=$1 meta=$2
  local files
  files=$(cd "$dir" && for f in *.parquet; do
    printf '{"name":"%s","size":%s,"sha256":"%s"}\n' "$f" "$(stat -f %z "$f" 2>/dev/null || stat -c %s "$f")" \
      "$(shasum -a 256 "$f" | cut -d' ' -f1)"
  done | jq -s .)
  jq --argjson files "$files" '{source_release, build_date, schema_version, dataset} + {files: $files}' <<<"$meta" >"$dir/manifest.json"
}

cmd_init() {
  local src
  src="$(cd "$1" && pwd)"
  [[ -f "$src/manifest.json" ]] || die "$src has no manifest.json"
  [[ -e "$HIST" ]] && die "$HIST exists; a history starts once"
  local release work
  release="$(jq -r .source_release "$src/manifest.json")"
  work="$DATA_DIR/tmp/history-init-$release"
  rm -rf "$work"
  mkdir -p "$work"

  echo "deriving $release"
  DERIVE_SOURCE_DIR="$src" DERIVE_DEST_DIR="$work/derived" "$SCRIPTS/derive.sh" "$release" >"$work/derive.log" 2>&1 \
    || { tail -20 "$work/derive.log" >&2; die "derivation failed"; }

  echo "writing the log and the derived tables"
  mkdir -p "$work/hist/derived"
  {
    echo "$DUCKDB_SETTINGS"
    for t in $LOG_TABLES; do
      mkdir -p "$work/hist/log/$t/release=$release"
      echo "COPY (SELECT *, false AS log_deleted FROM read_parquet('$src/$t.parquet'))
            TO '$work/hist/log/$t/release=$release/data.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000);"
    done
    for t in $VARIANT_TABLES $LOOKUP_TABLES; do
      echo "COPY (SELECT *, DATE '$release' AS valid_from, NULL::DATE AS valid_to FROM read_parquet('$work/derived/$t.parquet'))
            TO '$work/hist/derived/$t.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000);"
    done
    for t in $PLAIN_TABLES; do
      echo "COPY (FROM read_parquet('$work/derived/$t.parquet')) TO '$work/hist/derived/$t.parquet' (FORMAT parquet);"
    done
    echo "COPY (SELECT DATE '$release' AS release, origin, dataset, sha256, build_date, schema_version,
                       current_localtimestamp() AS applied_at
                FROM read_json('$src/manifest.json', columns = {origin: 'VARCHAR', dataset: 'VARCHAR', sha256: 'VARCHAR',
                                                                build_date: 'VARCHAR', schema_version: 'VARCHAR'}))
          TO '$work/hist/history_release.parquet' (FORMAT parquet);"
  } | duckdb >/dev/null
  mkdir -p "$(dirname "$HIST")"
  mv "$work/hist" "$HIST"
  rm -rf "$work"
  du -sh "$HIST/log" "$HIST/derived"
}

cmd_apply() {
  local state
  state="$(cd "$1" && pwd)"
  [[ -f "$state/state.json" && -f "$state/deleted.parquet" ]] || die "$state isn't a delta state (scripts/state-from-bundle.sh --delta)"
  local release baseline previous
  release="$(jq -r .source_release "$state/state.json")"
  baseline="$(jq -r .baseline_release "$state/state.json")"
  previous="$(latest_release)"
  [[ $baseline == "$previous" ]] || die "the delta for $release applies to $baseline, but the history ends at $previous"

  local work="$DATA_DIR/tmp/history-apply-$release"
  rm -rf "$work"
  mkdir -p "$work/spill" "$work/sub" "$work/new" "$work/derived"
  local t0=$SECONDS

  echo "$((SECONDS - t0))s  converting the delta"
  "$SCRIPTS/convert-state.sh" "$state" "$work/delta" >/dev/null
  local delta="$work/delta"

  echo "$((SECONDS - t0))s  staging the log for $release"
  {
    echo "$DUCKDB_SETTINGS"
    # A key deleted and re-added in the same delta is an upsert: the deletion applies first.
    echo "CREATE TABLE del AS
          SELECT CASE WHEN section = 'evidenceLine' AND key LIKE 'VCV%' THEN 'vcv_evidenceLine'
                      WHEN section = 'evidenceLine' AND key LIKE 'RCV%' THEN 'rcv_evidenceLine'
                      ELSE section END AS tbl, key
          FROM read_parquet('$state/deleted.parquet');"
    for t in $LOG_TABLES; do
      local k
      k=$(log_key "$t")
      mkdir -p "$work/log/$t/release=$release"
      echo "COPY (SELECT *, false AS log_deleted FROM read_parquet('$delta/$t.parquet')
                  UNION ALL BY NAME
                  SELECT key AS $k, true AS log_deleted FROM del
                  WHERE tbl = '$t' AND key NOT IN (SELECT $k FROM read_parquet('$delta/$t.parquet')))
            TO '$work/log/$t/release=$release/data.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000);"
    done
  } | duckdb "$work/work.duckdb" >/dev/null

  echo "$((SECONDS - t0))s  finding the variants it touches"
  local props_r props_p
  props_r=$(for t in $PROP_TABLES; do echo "UNION ALL $(as_of "$t" "$release" "id IN (SELECT key FROM need_prop)" "$work")"; done | sed '1s/^UNION ALL //')
  props_p=$(for t in $PROP_TABLES; do echo "UNION ALL $(as_of "$t" "$previous" "id IN (SELECT key FROM need_prop)")"; done | sed '1s/^UNION ALL //')
  duckdb "$work/work.duckdb" <<SQL
$DUCKDB_SETTINGS
SET temp_directory = '$work/spill';
.bail on
CREATE TEMP MACRO id_int(id) AS CAST(split_part(id, ':', 2) AS INTEGER);
CREATE TEMP MACRO scv_number(id) AS CAST(regexp_extract(id, 'SCV(\d+)\.', 1) AS INTEGER);
CREATE TEMP MACRO line_statement(id) AS regexp_extract(id, '^(.*)\.(contributing|non-contributing)$', 1);
CREATE TEMP MACRO hist(t) AS TABLE SELECT * FROM read_parquet('$HIST/derived/' || t || '.parquet') WHERE valid_to IS NULL;

-- Every key the delta adds, changes or deletes, by table.
CREATE TABLE dk AS
$(for t in $LOG_TABLES; do echo "SELECT '$t' AS tbl, $(log_key "$t") AS key FROM read_parquet('$delta/$t.parquet') UNION ALL"; done)
SELECT tbl, key FROM del;

-- Propositions to look up, as of both releases: the changed ones, and those the changed SCVs,
-- RCV statements and SCV evidence lines point to.
CREATE TABLE need_prop AS
SELECT key FROM dk WHERE tbl LIKE 'proposition%'
UNION SELECT proposition_id FROM read_parquet('$delta/scv.parquet')
UNION SELECT proposition_id FROM read_parquet('$delta/rcv.parquet')
UNION SELECT target_proposition_id FROM read_parquet('$delta/evidenceLine.parquet');
CREATE TABLE old_evidence AS $(as_of evidenceLine "$previous" "id IN (SELECT key FROM dk WHERE tbl = 'evidenceLine')");
INSERT INTO need_prop SELECT target_proposition_id FROM old_evidence;
CREATE TABLE prop AS
SELECT id, id_int(subject_variant_id) AS variation_id FROM ($props_r)
UNION SELECT id, id_int(subject_variant_id) FROM ($props_p);

-- Conditions whose change reaches SCV rows: added, deleted, or a placeholder now or no longer.
-- (scv.condition_ids lists a set's conditions present in condition; condition_unspecified reads
-- placeholder.)
CREATE TABLE cond_changed AS
SELECT coalesce(n.id, o.id) AS id
FROM (SELECT id_int(id) AS id, lower(name) IN ('not provided', 'not specified') AS placeholder
      FROM read_parquet('$delta/condition.parquet')) n
FULL JOIN (SELECT id, placeholder FROM hist('condition')
           WHERE id IN (SELECT id_int(key) FROM dk WHERE tbl = 'condition')) o ON o.id = n.id
WHERE n.id IS NULL OR o.id IS NULL OR n.placeholder <> o.placeholder;
-- Condition sets whose expansion changes: changed sets, and sets naming a changed set or condition.
CREATE TABLE set_changed AS
WITH touched AS (SELECT key FROM dk WHERE tbl = 'conditionSet'
                 UNION SELECT 'clinvar.trait:' || id FROM cond_changed),
     sets AS ($(as_of conditionSet "$release" "" "$work") UNION ALL $(as_of conditionSet "$previous"))
SELECT key AS id FROM dk WHERE tbl = 'conditionSet'
UNION SELECT id FROM sets WHERE list_has_any(concepts, (SELECT list(key) FROM touched));

CREATE TABLE affected AS
SELECT id_int(key) AS variation_id FROM dk WHERE tbl = 'variation'
UNION SELECT variation_id FROM prop WHERE id IN (SELECT key FROM dk WHERE tbl LIKE 'proposition%')
UNION SELECT p.variation_id FROM read_parquet('$delta/scv.parquet') s JOIN prop p ON p.id = s.proposition_id
UNION SELECT variation_id FROM hist('scv') WHERE scv_id IN (SELECT scv_number(key) FROM dk WHERE tbl = 'scv')
UNION SELECT CAST(regexp_extract(key, '^VCV(\d+)\.', 1) AS INTEGER) FROM dk WHERE tbl IN ('vcv', 'vcv_evidenceLine')
UNION SELECT p.variation_id FROM read_parquet('$delta/rcv.parquet') r JOIN prop p ON p.id = r.proposition_id
UNION SELECT variation_id FROM hist('rcv_statement')
      WHERE statement_id IN (SELECT key FROM dk WHERE tbl = 'rcv'
                             UNION SELECT line_statement(key) FROM dk WHERE tbl = 'rcv_evidenceLine')
UNION SELECT p.variation_id FROM read_parquet('$delta/evidenceLine.parquet') e JOIN prop p ON p.id = e.target_proposition_id
UNION SELECT p.variation_id FROM old_evidence e JOIN prop p ON p.id = e.target_proposition_id
UNION SELECT variation_id FROM hist('scv')
      WHERE condition_set_id IN (SELECT id FROM set_changed) OR condition_id IN (SELECT id FROM cond_changed)
         OR scv_id IN (SELECT scv_id FROM hist('scv_condition') WHERE condition_id IN (SELECT id FROM cond_changed));
SELECT count(*) AS affected_variants FROM affected;
SQL

  echo "$((SECONDS - t0))s  writing their records as of $release"
  {
    echo "$DUCKDB_SETTINGS SET temp_directory = '$work/spill';"
    echo "CREATE TEMP MACRO id_int(id) AS CAST(split_part(id, ':', 2) AS INTEGER);"
    echo "CREATE TEMP MACRO line_statement(id) AS regexp_extract(id, '^(.*)\.(contributing|non-contributing)\$', 1);"
    # The affected variants' records, each selected the same way: every key whose rows ever matched,
    # then the condition on its row as of this release. A record can change what it points to under
    # the same key (a proposition's subject moves when ClinVar merges a variant into another).
    for t in $PROP_TABLES; do
      echo "CREATE TEMP TABLE p_$t AS $(as_of_where "$t" "$release" "id_int(subject_variant_id) IN (SELECT variation_id FROM affected)" "$work");"
    done
    echo "CREATE TEMP TABLE props AS $(for t in $PROP_TABLES; do echo "SELECT id FROM p_$t UNION ALL"; done | sed '$s/ UNION ALL$//');"
    for t in scv vcv rcv; do
      echo "CREATE TEMP TABLE s_$t AS $(as_of_where "$t" "$release" "proposition_id IN (SELECT id FROM props)" "$work");"
    done
    for t in $PROP_TABLES; do echo "COPY p_$t TO '$work/sub/$t.parquet' (FORMAT parquet);"; done
    for t in scv vcv rcv; do echo "COPY s_$t TO '$work/sub/$t.parquet' (FORMAT parquet);"; done
    echo "COPY ($(as_of_where variation "$release" "id_int(id) IN (SELECT variation_id FROM affected)" "$work")) TO '$work/sub/variation.parquet' (FORMAT parquet);"
    echo "COPY ($(as_of_where vcv_evidenceLine "$release" "line_statement(id) IN (SELECT id FROM s_vcv)" "$work")) TO '$work/sub/vcv_evidenceLine.parquet' (FORMAT parquet);"
    echo "COPY ($(as_of_where rcv_evidenceLine "$release" "line_statement(id) IN (SELECT id FROM s_rcv)" "$work")) TO '$work/sub/rcv_evidenceLine.parquet' (FORMAT parquet);"
    echo "COPY ($(as_of_where evidenceLine "$release" "target_proposition_id IN (SELECT id FROM props)" "$work")) TO '$work/sub/evidenceLine.parquet' (FORMAT parquet);"
    # The lookups the load joins to, whole; the genome tables only for the delta's own records.
    for t in condition conditionSet submitter gene therapy therapyGroup; do
      echo "COPY ($(as_of "$t" "$release" "" "$work")) TO '$work/sub/$t.parquet' (FORMAT parquet);"
    done
    for t in sequenceReference location allele copyNumberCount copyNumberChange; do
      echo "COPY (FROM read_parquet('$delta/$t.parquet')) TO '$work/sub/$t.parquet' (FORMAT parquet);"
    done
  } | duckdb "$work/work.duckdb" >/dev/null
  write_manifest "$work/sub" "$(cat "$state/state.json")"

  echo "$((SECONDS - t0))s  deriving them"
  derive_into "$work/sub" "$work/new" "$work/derive"

  echo "$((SECONDS - t0))s  closing and adding rows"
  {
    echo "$DUCKDB_SETTINGS SET temp_directory = '$work/spill'; SET preserve_insertion_order = true;"
    echo "CREATE TEMP MACRO id_int(id) AS CAST(split_part(id, ':', 2) AS INTEGER);"
    # SCVs of the affected variants, before and after, for scv_condition (which has no variant).
    echo "CREATE TEMP TABLE affected_scv AS
          SELECT scv_id FROM read_parquet('$HIST/derived/scv.parquet') WHERE valid_to IS NULL AND variation_id IN (SELECT variation_id FROM affected)
          UNION SELECT scv_id FROM read_parquet('$work/new/scv.parquet');"
    echo "CREATE TEMP TABLE changes (tbl VARCHAR, closed BIGINT, added BIGINT);"
    for t in $VARIANT_TABLES $LOOKUP_TABLES; do
      local filter
      case $t in
        scv_condition) filter="scv_id IN (SELECT scv_id FROM affected_scv)" ;;
        sequenceReference | location | allele | copyNumberCount | copyNumberChange | gene | condition | conditionSet | submitter)
          filter="id IN (SELECT $(lookup_key_expr "$t") FROM dk WHERE tbl = '$t')" ;;
        *) filter="variation_id IN (SELECT variation_id FROM affected)" ;;
      esac
      # Rows compare by a hash of every column: no derived table has two identical rows.
      echo "CREATE TABLE h AS FROM read_parquet('$HIST/derived/$t.parquet');
            CREATE TEMP TABLE cur AS SELECT rowid AS rid, hash(*COLUMNS(* EXCLUDE (valid_from, valid_to))) AS rh
              FROM h WHERE valid_to IS NULL AND $filter;
            CREATE TEMP TABLE nw AS SELECT *, hash(*COLUMNS(*)) AS rh FROM read_parquet('$work/new/$t.parquet') WHERE $filter;
            INSERT INTO changes SELECT '$t', (SELECT count(*) FROM cur WHERE rh NOT IN (SELECT rh FROM nw)),
                                             (SELECT count(*) FROM nw WHERE rh NOT IN (SELECT rh FROM cur));
            UPDATE h SET valid_to = DATE '$release' WHERE rowid IN (SELECT rid FROM cur WHERE rh NOT IN (SELECT rh FROM nw));
            INSERT INTO h SELECT * EXCLUDE (rh), DATE '$release', NULL FROM nw WHERE rh NOT IN (SELECT rh FROM cur);
            COPY (FROM h ORDER BY $(sort_key "$t"), valid_from)
              TO '$work/derived/$t.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000);
            DROP TABLE h; DROP TABLE cur; DROP TABLE nw;"
    done
    echo "COPY (FROM read_parquet('$HIST/history_release.parquet')
                UNION ALL
                SELECT DATE '$release', origin, dataset, sha256, build_date, schema_version, current_localtimestamp()
                FROM read_json('$state/state.json', columns = {origin: 'VARCHAR', dataset: 'VARCHAR', sha256: 'VARCHAR',
                                                               build_date: 'VARCHAR', schema_version: 'VARCHAR'})
                ORDER BY 1)
          TO '$work/history_release.parquet' (FORMAT parquet);"
    echo ".mode box"
    echo "SELECT * FROM changes WHERE closed + added > 0;"
  } | duckdb "$work/work.duckdb"

  # Move the release in: its log folders, the rewritten tables, the release list.
  for t in $LOG_TABLES; do mv "$work/log/$t/release=$release" "$HIST/log/$t/"; done
  for t in $VARIANT_TABLES $LOOKUP_TABLES; do mv "$work/derived/$t.parquet" "$HIST/derived/$t.parquet"; done
  mv "$work/history_release.parquet" "$HIST/history_release.parquet"
  rm -rf "$work"
  echo "applied $release in $((SECONDS - t0)) s"
}

cmd_check() {
  local release=${1:-$(latest_release)}
  local work="$DATA_DIR/tmp/history-check-$release"
  rm -rf "$work"
  mkdir -p "$work/src" "$work/spill"
  local t0=$SECONDS
  echo "writing the full state as of $release from the log"
  {
    echo "$DUCKDB_SETTINGS SET temp_directory = '$work/spill'; SET preserve_insertion_order = false;"
    for t in $LOG_TABLES; do
      echo "COPY ($(as_of "$t" "$release")) TO '$work/src/$t.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 20000);"
    done
  } | duckdb >/dev/null
  write_manifest "$work/src" "$(duckdb -json -c "SELECT CAST(release AS VARCHAR) AS source_release, build_date, schema_version, dataset
                                                 FROM read_parquet('$HIST/history_release.parquet') WHERE release = DATE '$release'" | jq '.[0]')"
  echo "deriving it in full"
  derive_into "$work/src" "$work/derived" "$work/derive"
  echo "comparing with the history's rows as of $release"
  local status=0
  for t in $VARIANT_TABLES $LOOKUP_TABLES; do
    read -r missing extra < <(duckdb -noheader -list -separator ' ' -c "
      $DUCKDB_SETTINGS SET temp_directory = '$work/spill';
      CREATE TEMP TABLE h AS SELECT * EXCLUDE (valid_from, valid_to) FROM read_parquet('$HIST/derived/$t.parquet')
        WHERE valid_from <= DATE '$release' AND (valid_to IS NULL OR valid_to > DATE '$release');
      CREATE TEMP TABLE d AS FROM read_parquet('$work/derived/$t.parquet');
      SELECT (SELECT count(*) FROM (FROM d EXCEPT ALL FROM h)), (SELECT count(*) FROM (FROM h EXCEPT ALL FROM d))")
    printf '  %-26s %s\n' "$t" "$([[ $missing == 0 && $extra == 0 ]] && echo same || echo "DIFFERS: $missing derived rows missing from history, $extra history rows not derived")"
    [[ $missing == 0 && $extra == 0 ]] || status=1
  done
  echo "checked in $((SECONDS - t0)) s"
  [[ $status == 0 ]] && rm -rf "$work"
  return $status
}

case ${1:-} in
  init) cmd_init "$2" ;;
  apply) cmd_apply "$2" ;;
  check) cmd_check "${2:-}" ;;
  *) die "usage: $0 init <converted release> | apply <delta state> | check [release]" ;;
esac
