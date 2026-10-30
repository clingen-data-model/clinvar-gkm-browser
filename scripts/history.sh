#!/usr/bin/env bash
# Release history (docs/history.md): upstream's records as a log of each release's changes, and the
# derived tables with the releases each row held.
#
#   init <state>           start a history from a full release's state (scripts/state-from-bundle.sh
#                          or scripts/state-from-parquet.sh)
#   apply <delta state>    add the next weekly delta (scripts/state-from-bundle.sh --delta) to the log,
#                          then to the derived history
#   rebuild                rebuild the derived history from the log, e.g. after a schema change
#   check [release]        derive the full state as of a release (default the latest) from the log, and
#                          compare it with the derived history's rows as of that release
#
# Both stores have one layout. Files are written once and never changed; a release's files count only
# once the release is listed in releases.parquet, which is written last (so a failed apply leaves
# nothing half-applied, and the next run clears its files).
#
#   <store>/added/<table>/release=<date>/data.parquet    rows that release added
#   <store>/closed/<table>/release=<date>/data.parquet   rows it closed: (key, valid_from) for the log,
#                                                        (natural key, valid_from) for derived tables
#   <store>/releases.parquet                             the releases in the store, in order
#
# A row holds from its release (valid_from) until the release that closes it (valid_to), if any.
#
# The log (HISTORY_DIR/log) holds upstream's records as published, (key, rec JSON) per bundle
# section, with the pointers the tracing follows. It doesn't depend on this app's schema. The derived
# history (HISTORY_DIR/<schema version>) holds the derived tables; a closed row is named by its
# table's natural key (nat_key) and valid_from, and rows compare by a hash of every column.
set -euo pipefail

DATA_DIR="${CLINVAR_DATA_DIR:-./data}"
SCHEMA_VERSION=1
ROOT="${HISTORY_DIR:-$DATA_DIR/history}"
LOG="$ROOT/log"
DER="$ROOT/$SCHEMA_VERSION"
SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
SQL_DIR="$SCRIPTS/../packages/derive/sql"
# Sessions that set no spill directory of their own spill here, not to DuckDB's default ./.tmp.
DUCKDB_SETTINGS="SET memory_limit = '${DUCKDB_MEMORY_LIMIT:-4GB}'; SET threads = ${DUCKDB_THREADS:-7};
                 SET temp_directory = '$DATA_DIR/tmp/history-spill';"
# For reading and writing the log's records: they reach 0.5 MB of JSON each, so few threads, small
# row groups and a spill directory keep within the memory limit (as state-from-parquet.sh does).
record_settings() {  # <spill dir>
  echo "SET memory_limit = '${DUCKDB_MEMORY_LIMIT:-4GB}'; SET threads = ${STATE_THREADS:-3};
        SET temp_directory = '$1'; SET preserve_insertion_order = false;"
}

# The 1.1.0 bundle sections.
SECTIONS="sequenceReference location allele copyNumberCount copyNumberChange gene variation condition
  conditionSet therapy therapyGroup submitter propositionPathogenicity propositionOncogenicity
  propositionSomaticClinicalImpact propositionClinvarCustom evidenceLine scv vcv rcv"
PROP_SECTIONS="propositionPathogenicity propositionOncogenicity propositionSomaticClinicalImpact propositionClinvarCustom"
GENOME_SECTIONS="sequenceReference location allele copyNumberCount copyNumberChange"

# Derived tables with history: those grouped by variant, re-derived per affected variant, and the
# lookups, one row per upstream record. The vocabularies come from schema.sql and are copied as they
# are; reference_issue describes one derivation and is left out.
VARIANT_TABLES="variant variant_gene variant_hgvs variant_xref vcv_statement rcv_statement scv scv_condition
  scv_classification_pair"
LOOKUP_TABLES="sequenceReference location allele copyNumberCount copyNumberChange gene condition conditionSet submitter"
PLAIN_TABLES="classification_type classification_term submission_level review_status"

die() { echo "$*" >&2; exit 1; }
sql() { duckdb -noheader -list -c "$1"; }
latest() { sql "SELECT max(release) FROM read_parquet('$1/releases.parquet')"; }
releases_after() { sql "SELECT release FROM read_parquet('$1/releases.parquet') WHERE release > DATE '$2' ORDER BY 1"; }

# One table's files in a store, plus a staging copy not yet moved in.
glob() {  # <store> <added|closed> <table> [staging store]
  if [[ -n ${4:-} ]]; then echo "['$1/$2/$3/*/*.parquet', '$4/$2/$3/*/*.parquet']"
  else echo "'$1/$2/$3/*/*.parquet'"; fi
}
# A log section's records as of a release (with the valid_from of each), optionally only those
# matching a condition. Each row carries its own validity, so the condition applies to the version
# that holds at the release.
log_as_of() {  # <section> <release> [condition] [staging]
  echo "SELECT r.* EXCLUDE (release), r.release AS valid_from FROM read_parquet($(glob "$LOG" added "$1" "${4:-}"), hive_partitioning = true) r
        ANTI JOIN read_parquet($(glob "$LOG" closed "$1" "${4:-}"), hive_partitioning = true) c
          ON c.key = r.key AND c.valid_from = r.release AND c.release <= DATE '$2'
        WHERE r.release <= DATE '$2' ${3:+AND ($3)}"
}
# Each derived table's natural key: unique among the rows that hold at any one release.
nat_key() {
  case $1 in
    variant) echo variation_id ;;
    variant_gene) echo variation_id, gene_id ;;
    variant_hgvs) echo variation_id, expression, protein_expression ;;
    variant_xref) echo variation_id, system, code ;;
    vcv_statement | rcv_statement) echo statement_id ;;
    scv) echo scv_id ;;
    scv_condition) echo scv_id, condition_id ;;
    scv_classification_pair) echo a_scv_id, b_scv_id ;;
    *) echo id ;;
  esac
}
# A derived table's rows as of a release, with valid_from.
der_as_of() {  # <table> <release> [condition]
  local on k
  on=$(for k in $(nat_key "$1" | tr -d ,); do printf 'c.%s IS NOT DISTINCT FROM a.%s AND ' "$k" "$k"; done)
  echo "SELECT a.* EXCLUDE (release), a.release AS valid_from FROM read_parquet($(glob "$DER" added "$1"), hive_partitioning = true) a
        ANTI JOIN read_parquet($(glob "$DER" closed "$1"), hive_partitioning = true) c
          ON ${on}c.valid_from = a.release AND c.release <= DATE '$2'
        WHERE a.release <= DATE '$2' ${3:+AND ($3)}"
}

# The pointers the tracing follows, from a record: a proposition's subject, a statement's
# proposition, an evidence line's statement and target.
POINTERS="CASE WHEN section LIKE 'proposition%' THEN regexp_replace(rec::JSON->>'subject', '^#/[^/]+/', '') END AS subject,
          CASE WHEN section IN ('scv', 'vcv', 'rcv') THEN regexp_replace(rec::JSON->>'proposition', '^#/[^/]+/', '') END AS proposition,
          CASE WHEN section = 'evidenceLine' THEN regexp_extract(key, '^(.*)\.(contributing|non-contributing)\$', 1) END AS statement,
          CASE WHEN section = 'evidenceLine' THEN regexp_replace(rec::JSON->>'targetProposition', '^#/[^/]+/', '') END AS target"

# Remove files of releases a store doesn't list: what a failed run left behind.
clear_unlisted() {  # <store>
  [[ -f "$1/releases.parquet" ]] || return 0
  local last d r
  last="$(latest "$1")"
  for d in "$1"/added/*/release=* "$1"/closed/*/release=*; do
    [[ -d $d ]] || continue
    r="${d##*release=}"
    [[ $r > $last ]] && rm -rf "$d"
  done
  return 0
}

# Move a staging store's files in, then list the release: the release counts from that write on.
commit() {  # <staging store> <store> <releases row SQL>
  local d
  for d in "$1"/added/*/release=* "$1"/closed/*/release=*; do
    local rel="${d#"$1"/}"
    mkdir -p "$2/$(dirname "$rel")"
    mv "$d" "$2/$rel"
  done
  local list="$2/releases.parquet"
  if [[ -f $list ]]; then
    duckdb -c "COPY (FROM read_parquet('$list') UNION ALL $3 ORDER BY release) TO '$list.new' (FORMAT parquet)"
  else
    duckdb -c "COPY ($3) TO '$list.new' (FORMAT parquet)"
  fi
  mv "$list.new" "$list"
}
release_row() {  # <state dir>: the releases.parquet row for a state
  echo "SELECT CAST(source_release AS DATE) AS release, origin, dataset, sha256, build_date, schema_version,
               current_localtimestamp() AS applied_at
        FROM read_json('$1/state.json', columns = {source_release: 'VARCHAR', origin: 'VARCHAR', dataset: 'VARCHAR',
                       sha256: 'VARCHAR', build_date: 'VARCHAR', schema_version: 'VARCHAR'})"
}

# Run schema.sql (references stripped, as derive.sh does), load.sql and validate.sql over a source
# directory, then write each table as parquet.
derive_into() {  # <converted source> <out> <work>
  local src=$1 out=$2 work=$3
  mkdir -p "$out" "$work/spill"
  sed -E 's/ REFERENCES [A-Za-z_]+ \([a-z_]+\)//' "$SQL_DIR/schema.sql" >"$work/schema.sql"
  duckdb "$work/derive.duckdb" >"$work/derive.log" 2>&1 <<SQL || { tail -20 "$work/derive.log" >&2; die "derivation of $src failed (log: $work/derive.log)"; }
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
.echo off
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

# The log's state as of a release, as a state directory (one (key, rec) file per section), optionally
# only some records: SQL conditions per section, from a function given the section name.
write_state() {  # <release> <dest> <db> [condition function]
  local release=$1 dest=$2 db=$3 cond_fn=${4:-} s cond
  mkdir -p "$dest"
  {
    record_settings "$dest.spill"
    echo "CREATE OR REPLACE TEMP MACRO id_int(id) AS CAST(split_part(id, ':', 2) AS INTEGER);"
    for s in $SECTIONS; do
      cond=""
      [[ -n $cond_fn ]] && cond="$($cond_fn "$s")"
      echo "COPY (SELECT key, rec FROM ($(log_as_of "$s" "$release" "$cond"))) TO '$dest/$s.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 20000);"
    done
  } | duckdb "$db" >/dev/null
  rm -rf "$dest.spill"
  duckdb -json -c "SELECT CAST(release AS VARCHAR) AS source_release, origin, dataset, sha256, build_date, schema_version
                   FROM read_parquet('$LOG/releases.parquet') WHERE release = DATE '$release'" | jq '.[0]' >"$dest/state.json"
}

# Derive a state (convert, then load) into <out>.
derive_state() {  # <state> <out> <work>
  "$SCRIPTS/convert-state.sh" "$1" "$3/converted" >/dev/null
  derive_into "$3/converted" "$2" "$3/derive"
  rm -rf "$3/converted"
  check_keys "$2"
}

# A closing names its row by the table's natural key, so the key must be unique in a release
# (NULLs equal, as the anti-joins compare them). Upstream's data could break that for the keys
# drawn from its lists (variant_hgvs, variant_xref); stop rather than close the wrong rows.
check_keys() {  # <derived dir>
  local t dup
  for t in $VARIANT_TABLES $LOOKUP_TABLES; do
    dup=$(duckdb -noheader -list -c "SELECT count(*) - count(DISTINCT ($(nat_key "$t"))) FROM read_parquet('$1/$t.parquet')")
    [[ $dup == 0 ]] || die "$t: $dup rows share a natural key ($(nat_key "$t")) with another"
  done
}

# ---- the log ------------------------------------------------------------------------------------

log_init() {  # <state>
  local state=$1 release work
  release="$(jq -r .source_release "$state/state.json")"
  work="$DATA_DIR/tmp/history-log-$release"
  rm -rf "$work"
  {
    record_settings "$work/spill"
    for s in $SECTIONS; do
      mkdir -p "$work/added/$s/release=$release" "$work/closed/$s/release=$release"
      echo "COPY (SELECT key, rec, $POINTERS FROM (SELECT '$s' AS section, key, rec FROM read_parquet('$state/$s.parquet')))
            TO '$work/added/$s/release=$release/data.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 20000);"
      echo "COPY (SELECT NULL::VARCHAR AS key, NULL::DATE AS valid_from WHERE false) TO '$work/closed/$s/release=$release/data.parquet' (FORMAT parquet);"
    done
  } | duckdb >/dev/null
  mkdir -p "$LOG"
  commit "$work" "$LOG" "$(release_row "$state")"
  rm -rf "$work"
}

# A delta's records and deletions: a key whose record differs from (or is missing in) the previous
# release is added; its previous row, if any, is closed, as is a deleted key's.
log_apply() {  # <delta state>
  local state=$1 release previous work
  release="$(jq -r .source_release "$state/state.json")"
  previous="$(latest "$LOG")"
  work="$DATA_DIR/tmp/history-log-$release"
  rm -rf "$work"
  {
    record_settings "$work/spill"
    echo "CREATE TEMP TABLE del AS SELECT section, key FROM read_parquet('$state/deleted.parquet');"
    for s in $SECTIONS; do
      mkdir -p "$work/added/$s/release=$release" "$work/closed/$s/release=$release"
      echo "CREATE OR REPLACE TEMP TABLE d AS SELECT key, rec FROM read_parquet('$state/$s.parquet');
            CREATE OR REPLACE TEMP TABLE o AS
              SELECT key, rec, valid_from FROM ($(log_as_of "$s" "$previous" "r.key IN (SELECT key FROM d UNION SELECT key FROM del WHERE section = '$s')"));
            COPY (SELECT key, rec, $POINTERS FROM (SELECT '$s' AS section, d.key, d.rec FROM d ANTI JOIN o ON o.key = d.key AND o.rec = d.rec))
              TO '$work/added/$s/release=$release/data.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 20000);
            COPY (SELECT o.key, o.valid_from FROM o ANTI JOIN d ON d.key = o.key AND d.rec = o.rec)
              TO '$work/closed/$s/release=$release/data.parquet' (FORMAT parquet);"
    done
  } | duckdb >/dev/null
  commit "$work" "$LOG" "$(release_row "$state")"
  rm -rf "$work"
}

# ---- the derived history ------------------------------------------------------------------------

# Start the derived history from the log's first release (or any release, deriving it in full).
der_init() {  # <release>
  local release=$1 work="$DATA_DIR/tmp/history-derive-$1"
  rm -rf "$work"
  mkdir -p "$work"
  echo "  writing the full state as of $release"
  write_state "$release" "$work/state" "$work/work.duckdb"
  echo "  deriving it"
  derive_state "$work/state" "$work/new" "$work"
  {
    echo "$DUCKDB_SETTINGS"
    for t in $VARIANT_TABLES $LOOKUP_TABLES; do
      mkdir -p "$work/stage/added/$t/release=$release" "$work/stage/closed/$t/release=$release"
      echo "COPY (FROM read_parquet('$work/new/$t.parquet'))
            TO '$work/stage/added/$t/release=$release/data.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000);
            COPY (SELECT $(nat_key "$t"), NULL::DATE AS valid_from FROM read_parquet('$work/new/$t.parquet') WHERE false)
            TO '$work/stage/closed/$t/release=$release/data.parquet' (FORMAT parquet);"
    done
  } | duckdb >/dev/null
  mkdir -p "$DER/plain"
  for t in $PLAIN_TABLES; do cp "$work/new/$t.parquet" "$DER/plain/$t.parquet"; done
  commit "$work/stage" "$DER" "SELECT * FROM read_parquet('$LOG/releases.parquet') WHERE release = DATE '$release'"
  rm -rf "$work"
}

# Apply one log release to the derived history: re-derive the variants its changes reach, however
# many, and close and add rows.
der_apply() {  # <release>
  local release=$1 previous work t0=$SECONDS
  previous="$(latest "$DER")"
  work="$DATA_DIR/tmp/history-derive-$release"
  rm -rf "$work"
  mkdir -p "$work/spill"
  local db="$work/work.duckdb"

  echo "  $((SECONDS - t0))s  finding the variants its changes reach"
  local prop_union_p prop_union_r stmt_union_p stmt_union_r
  stmt_union() { for s in scv vcv rcv; do echo "UNION ALL SELECT key, proposition FROM ($(log_as_of "$s" "$1" "r.key IN (SELECT key FROM stmt_keys)"))"; done | sed '1s/^UNION ALL //'; }
  prop_union() { for s in $PROP_SECTIONS; do echo "UNION ALL SELECT key, subject FROM ($(log_as_of "$s" "$1" "r.key IN (SELECT key FROM prop_keys)"))"; done | sed '1s/^UNION ALL //'; }
  duckdb "$db" >"$work/trace.log" 2>&1 <<SQL || { cat "$work/trace.log" >&2; die "tracing failed"; }
$DUCKDB_SETTINGS
SET temp_directory = '$work/spill';
.bail on
CREATE OR REPLACE TEMP MACRO id_int(id) AS CAST(split_part(id, ':', 2) AS INTEGER);
-- Every record the release added or closed, by section.
CREATE TABLE ck AS
$(for s in $SECTIONS; do echo "SELECT '$s' AS section, key FROM read_parquet('$LOG/added/$s/release=$release/data.parquet')
UNION SELECT '$s', key FROM read_parquet('$LOG/closed/$s/release=$release/data.parquet') UNION"; done | sed '$s/ UNION$//');

-- Statements changed, or whose evidence lines changed; then the propositions changed or pointed to,
-- before and after. A record's pointers can change under one key (a merged variant's SCV moves), so
-- both versions count.
CREATE TABLE stmt_keys AS
SELECT key FROM ck WHERE section IN ('scv', 'vcv', 'rcv')
UNION SELECT regexp_extract(key, '^(.*)\.(contributing|non-contributing)$', 1) FROM ck WHERE section = 'evidenceLine';
CREATE TABLE stmt AS $(stmt_union "$previous") UNION $(stmt_union "$release");
CREATE TABLE prop_keys AS SELECT key FROM ck WHERE section LIKE 'proposition%' UNION SELECT proposition FROM stmt;
CREATE TABLE prop AS $(prop_union "$previous") UNION $(prop_union "$release");

-- Condition sets whose expansion changed: changed sets, and every set naming one, at any depth.
CREATE TABLE set_edge AS
SELECT DISTINCT key AS parent, regexp_replace(unnest(CAST(rec::JSON->'concepts' AS VARCHAR[])), '^#/[^/]+/', '') AS child
FROM ($(log_as_of conditionSet "$previous") UNION ALL $(log_as_of conditionSet "$release"));
CREATE TABLE set_changed AS
WITH RECURSIVE up(id) AS (
    SELECT key FROM ck WHERE section = 'conditionSet'
    UNION SELECT e.parent FROM set_edge e JOIN up ON e.child = up.id
)
SELECT id FROM up;

CREATE TABLE affected AS
SELECT id_int(key) AS variation_id FROM ck WHERE section = 'variation'
UNION SELECT id_int(subject) FROM prop
-- SCVs naming a changed condition, directly or through a set (scv_condition holds the expansion),
-- or using a set whose expansion changed. Any change to the condition counts.
UNION SELECT s.variation_id FROM ($(der_as_of scv "$previous" "a.condition_set_id IN (SELECT id FROM set_changed)")) s
UNION SELECT s.variation_id FROM ($(der_as_of scv "$previous")) s
      SEMI JOIN ($(der_as_of scv_condition "$previous" "a.condition_id IN (SELECT id_int(key) FROM ck WHERE section = 'condition')")) c
        ON c.scv_id = s.scv_id;
DELETE FROM affected WHERE variation_id IS NULL;
SQL
  echo "  $((SECONDS - t0))s  $(duckdb -noheader -list "$db" -c "SELECT count(*) FROM affected") variants affected"

  echo "  $((SECONDS - t0))s  writing their records as of $release"
  # The affected variants' records, each matched on the version that holds at the release; the small
  # lookups the load joins to, whole; the genome records the release changed.
  subset_cond() {
    case $1 in
      variation) echo "id_int(r.key) IN (SELECT variation_id FROM affected)" ;;
      proposition*) echo "id_int(r.subject) IN (SELECT variation_id FROM affected)" ;;
      scv | vcv | rcv) echo "r.proposition IN (SELECT key FROM sub_prop)" ;;
      evidenceLine) echo "r.statement IN (SELECT key FROM sub_stmt) OR r.target IN (SELECT key FROM sub_prop)" ;;
      condition | conditionSet | submitter | gene) echo "" ;;
      *) echo "r.key IN (SELECT key FROM ck WHERE section = '$1')" ;;
    esac
  }
  {
    echo "$DUCKDB_SETTINGS CREATE OR REPLACE TEMP MACRO id_int(id) AS CAST(split_part(id, ':', 2) AS INTEGER);"
    echo "CREATE OR REPLACE TABLE sub_prop AS $(for s in $PROP_SECTIONS; do echo "UNION ALL SELECT key FROM ($(log_as_of "$s" "$release" "$(subset_cond "$s")"))"; done | sed '1s/^UNION ALL //');"
    echo "CREATE OR REPLACE TABLE sub_stmt AS $(for s in scv vcv rcv; do echo "UNION ALL SELECT key FROM ($(log_as_of "$s" "$release" "$(subset_cond "$s")"))"; done | sed '1s/^UNION ALL //');"
  } | duckdb "$db" >/dev/null
  write_state "$release" "$work/state" "$db" subset_cond

  echo "  $((SECONDS - t0))s  deriving them"
  derive_state "$work/state" "$work/new" "$work"

  echo "  $((SECONDS - t0))s  closing and adding rows"
  {
    echo "$DUCKDB_SETTINGS SET temp_directory = '$work/spill';"
    echo "CREATE OR REPLACE TEMP MACRO id_int(id) AS CAST(split_part(id, ':', 2) AS INTEGER);"
    echo "CREATE TEMP TABLE affected_scv AS
          SELECT scv_id FROM ($(der_as_of scv "$previous" "a.variation_id IN (SELECT variation_id FROM affected)"))
          UNION SELECT scv_id FROM read_parquet('$work/new/scv.parquet');"
    echo "CREATE TEMP TABLE changes (tbl VARCHAR, closed BIGINT, added BIGINT);"
    for t in $VARIANT_TABLES $LOOKUP_TABLES; do
      local filter
      case $t in
        scv_condition) filter="scv_id IN (SELECT scv_id FROM affected_scv)" ;;
        gene | submitter | condition) filter="id IN (SELECT id_int(key) FROM ck WHERE section = '$t')" ;;
        sequenceReference | location | allele | copyNumberCount | copyNumberChange | conditionSet)
          filter="id IN (SELECT key FROM ck WHERE section = '$t')" ;;
        *) filter="variation_id IN (SELECT variation_id FROM affected)" ;;
      esac
      mkdir -p "$work/stage/added/$t/release=$release" "$work/stage/closed/$t/release=$release"
      echo "CREATE OR REPLACE TEMP TABLE cur AS
              SELECT $(nat_key "$t"), valid_from, hash(*COLUMNS(* EXCLUDE (valid_from))) AS rh
              FROM ($(der_as_of "$t" "$previous" "${filter:+a.$filter}"));
            CREATE OR REPLACE TEMP TABLE nw AS SELECT *, hash(*COLUMNS(*)) AS rh FROM read_parquet('$work/new/$t.parquet') ${filter:+WHERE $filter};
            INSERT INTO changes SELECT '$t', (SELECT count(*) FROM cur ANTI JOIN nw USING (rh)),
                                             (SELECT count(*) FROM nw ANTI JOIN cur USING (rh));
            COPY (SELECT cur.* EXCLUDE (rh) FROM cur ANTI JOIN nw USING (rh))
              TO '$work/stage/closed/$t/release=$release/data.parquet' (FORMAT parquet);
            COPY (SELECT nw.* EXCLUDE (rh) FROM nw ANTI JOIN cur USING (rh))
              TO '$work/stage/added/$t/release=$release/data.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000);"
    done
    echo ".mode box"
    echo "SELECT * FROM changes WHERE closed + added > 0;"
  } | duckdb "$db"
  commit "$work/stage" "$DER" "SELECT * FROM read_parquet('$LOG/releases.parquet') WHERE release = DATE '$release'"
  rm -rf "$work"
  echo "  $((SECONDS - t0))s  done"
}

# ---- commands -----------------------------------------------------------------------------------

cmd_init() {
  local state
  state="$(cd "$1" && pwd)"
  [[ -f "$state/state.json" ]] || die "$state has no state.json"
  [[ -e "$LOG" ]] && die "$LOG exists; a history starts once (rebuild re-derives it)"
  local release
  release="$(jq -r .source_release "$state/state.json")"
  echo "log: $release"
  log_init "$state"
  echo "derived: $release"
  der_init "$release"
}

cmd_apply() {
  local state
  state="$(cd "$1" && pwd)"
  [[ -f "$state/state.json" && -f "$state/deleted.parquet" ]] || die "$state isn't a delta state (scripts/state-from-bundle.sh --delta)"
  clear_unlisted "$LOG"
  clear_unlisted "$DER"
  local release baseline version log_version last
  release="$(jq -r .source_release "$state/state.json")"
  baseline="$(jq -r .baseline_release "$state/state.json")"
  version="$(jq -r .schema_version "$state/state.json")"
  log_version="$(sql "SELECT DISTINCT schema_version FROM read_parquet('$LOG/releases.parquet')")"
  [[ $version == "$log_version" ]] || die "the delta is ClinVar-GKM $version, the log $log_version: a new format needs a new log"
  last="$(latest "$LOG")"
  if [[ $last == "$release" ]]; then
    echo "log: $release already applied"
  else
    [[ $baseline == "$last" ]] || die "the delta for $release applies to $baseline, but the log ends at $last"
    echo "log: $release"
    log_apply "$state"
  fi
  local t
  for t in $(releases_after "$LOG" "$(latest "$DER")"); do
    echo "derived: $t"
    der_apply "$t"
  done
}

cmd_rebuild() {
  [[ -f "$LOG/releases.parquet" ]] || die "no log at $LOG"
  rm -rf "$DER"
  local first t
  first="$(sql "SELECT min(release) FROM read_parquet('$LOG/releases.parquet')")"
  echo "derived: $first"
  der_init "$first"
  for t in $(releases_after "$LOG" "$first"); do
    echo "derived: $t"
    der_apply "$t"
  done
}

cmd_check() {
  local release=${1:-$(latest "$DER")}
  local work="$DATA_DIR/tmp/history-check-$release" t0=$SECONDS
  rm -rf "$work"
  mkdir -p "$work/spill"
  echo "writing the full state as of $release from the log"
  write_state "$release" "$work/state" "$work/work.duckdb"
  echo "deriving it in full"
  derive_state "$work/state" "$work/derived" "$work"
  echo "comparing with the derived history's rows as of $release"
  local status=0 t missing extra
  for t in $VARIANT_TABLES $LOOKUP_TABLES; do
    read -r missing extra < <(duckdb -noheader -list -separator ' ' -c "
      $DUCKDB_SETTINGS SET temp_directory = '$work/spill';
      CREATE TEMP TABLE h AS SELECT * EXCLUDE (valid_from) FROM ($(der_as_of "$t" "$release"));
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
  rebuild) cmd_rebuild ;;
  check) cmd_check "${2:-}" ;;
  *) die "usage: $0 init <state> | apply <delta state> | rebuild | check [release]" ;;
esac
