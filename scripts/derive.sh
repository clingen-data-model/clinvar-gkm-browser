#!/usr/bin/env bash
# Build the derived tables for one downloaded ClinVar-GKM release, as parquet:
#   $CLINVAR_DATA_DIR/source/<release>/  ->  $CLINVAR_DATA_DIR/derived/<schema>/<release>/<table>.parquet
# Loads into a scratch DuckDB database, checks references, validates, then writes each table as
# sorted ZSTD parquet plus manifest.json. The release directory is replaced only if every step
# succeeds. M0 tooling; the server runs the same SQL through @duckdb/node-api from M1.
#
# Usage: scripts/derive.sh [release]   (default: the newest directory under source/)
set -euo pipefail

DATA_DIR="${CLINVAR_DATA_DIR:-./data}"
SCHEMA_VERSION=1
SQL_DIR="$(cd "$(dirname "$0")/../packages/derive/sql" && pwd)"

release="${1:-$(ls "$DATA_DIR/source" | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' | sort | tail -1)}"
src="$(cd "$DATA_DIR/source/$release" && pwd)"
dest_dir="$DATA_DIR/derived/$SCHEMA_VERSION/$release"
tmp_dir="$DATA_DIR/tmp/derive-$release"
out_dir="$tmp_dir/out"

# A complete download has its manifest (fetch-source.sh writes it last); check the files against
# it, so a derived release is built from exactly one verified build.
if [[ ! -f "$src/manifest.json" ]]; then
  echo "$src has no manifest.json: the download is incomplete; run scripts/fetch-source.sh" >&2
  exit 1
fi
echo "verifying $src against its manifest"
jq -r '.files[] | "\(.sha256)  \(.name)"' "$src/manifest.json" | (cd "$src" && shasum -a 256 -c --quiet -)
if [[ -n "$(comm -13 <(jq -r '.files[].name' "$src/manifest.json" | sort) <(cd "$src" && ls *.parquet | sort))" ]]; then
  echo "$src has parquet files its manifest doesn't list" >&2
  exit 1
fi

# One derivation per release at a time; the lock goes, with the scratch files, when this exits.
mkdir -p "$DATA_DIR/tmp"
lock="$DATA_DIR/tmp/derive-$release.lock"
if ! mkdir "$lock" 2>/dev/null; then
  echo "another derivation of $release is running (or left $lock behind)" >&2
  exit 1
fi
trap 'rm -rf "$tmp_dir" "$lock"' EXIT
rm -rf "$tmp_dir"
mkdir -p "$tmp_dir/spill" "$out_dir"

# DERIVE_PROFILE=1 prints DuckDB's memory use by category after every statement of load.sql.
load_sql="$SQL_DIR/load.sql"
if [[ "${DERIVE_PROFILE:-}" == 1 ]]; then
  load_sql="$tmp_dir/load-profiled.sql"
  awk '{print} /;[[:space:]]*$/ && !/^--/ {print "SELECT tag, round(memory_usage_bytes/1e6) AS mb, round(temporary_storage_bytes/1e6) AS spill_mb FROM duckdb_memory() WHERE memory_usage_bytes + temporary_storage_bytes > 50e6 ORDER BY 2 DESC;"}' \
    "$SQL_DIR/load.sql" >"$load_sql"
fi

# REFERENCES clauses declare relationships; they are checked, not enforced (docs/schema.md).
# Primary keys stay, so duplicate ids fail the load.
schema_sql="$tmp_dir/schema.sql"
sed -E 's/ REFERENCES [a-z_]+ \([a-z_]+\)//' "$SQL_DIR/schema.sql" >"$schema_sql"

# One check per declared reference, recording dangling values in reference_issue.
checks_sql="$tmp_dir/reference-checks.sql"
awk -f "$SQL_DIR/../reference-checks.awk" "$SQL_DIR/schema.sql" >"$checks_sql"

echo "deriving $src -> $dest_dir (memory limit ${DUCKDB_MEMORY_LIMIT:-4GB})"
duckdb "$tmp_dir/work.duckdb" <<SQL
SET memory_limit = '${DUCKDB_MEMORY_LIMIT:-4GB}';
SET threads = ${DUCKDB_THREADS:-7};
SET temp_directory = '$tmp_dir/spill';
SET preserve_insertion_order = false;
SET VARIABLE src = '$src';
ATTACH '$tmp_dir/stage.duckdb' AS stage;
.bail on
.timer on
.echo on
.read $schema_sql
.read $load_sql
.read $checks_sql
SELECT child_table || '.' || child_column || ' -> ' || parent_table AS reference,
       count(*) AS missing_values, sum(row_count) AS rows_affected
FROM reference_issue GROUP BY ALL ORDER BY rows_affected DESC;
.read $SQL_DIR/validate.sql
DETACH stage;

-- Write every table as parquet, in its stored (sorted) order. EXPORT DATABASE also writes
-- schema.sql and load.sql, which recreate a DuckDB database from the files.
DROP TABLE validation_problem;
SET preserve_insertion_order = true;
EXPORT DATABASE '$out_dir' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000);
COPY (
    SELECT r.*,
           (SELECT list({name: table_name, rows: estimated_size} ORDER BY table_name) FROM duckdb_tables()) AS tables
    FROM release r
) TO '$out_dir/manifest.json' (FORMAT json);
SQL

# Replace the release directory in one step.
rm -rf "$dest_dir.old"
if [[ -d "$dest_dir" ]]; then mv "$dest_dir" "$dest_dir.old"; fi
mkdir -p "$(dirname "$dest_dir")"
mv "$out_dir" "$dest_dir"
rm -rf "$dest_dir.old"
du -sh "$dest_dir"
