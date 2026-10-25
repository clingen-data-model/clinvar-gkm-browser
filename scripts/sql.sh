#!/usr/bin/env bash
# Open a DuckDB shell over one derived release, with a view per table.
#
# Usage: scripts/sql.sh [release] [duckdb args...]   (default: the newest derived release)
set -euo pipefail

DATA_DIR="${CLINVAR_DATA_DIR:-./data}"
SCHEMA_VERSION=1
base="$DATA_DIR/derived/$SCHEMA_VERSION"
release="${1:-$(ls "$base" | sort | tail -1)}"
dir="$(cd "$base/$release" && pwd)"
shift || true

init="$(mktemp)"
trap 'rm -f "$init"' EXIT
{
  echo "SET parquet_metadata_cache = true;"
  for f in "$dir"/*.parquet; do
    t="$(basename "$f" .parquet)"
    echo "CREATE VIEW $t AS FROM read_parquet('$f');"
  done
  echo ".print ClinVar release $release ($dir): one view per table"
} >"$init"

duckdb -init "$init" "$@"
