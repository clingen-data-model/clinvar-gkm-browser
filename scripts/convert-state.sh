#!/usr/bin/env bash
# Convert a release's state (from state-from-parquet.sh, or the bundle and its deltas) into the
# parquet tables load.sql reads, with a manifest.json that scripts/derive.sh accepts
# (docs/history.md#the-converter).
#
# Usage: scripts/convert-state.sh <state dir> <source dir to write>
set -euo pipefail

SQL_DIR="$(cd "$(dirname "$0")/../packages/derive/sql" && pwd)"
state="$(cd "$1" && pwd)"
dest="$2"
[[ -f "$state/state.json" ]] || { echo "$state has no state.json" >&2; exit 1; }
rm -rf "$dest.tmp"
mkdir -p "$dest.tmp"
out="$(cd "$dest.tmp" && pwd)"

sed -e "s|{state}|$state|g" -e "s|{out}|$out|g" "$SQL_DIR/from-state.sql" >"$out/from-state.sql"
# Records are large and nested (a variation's HGVS list): few threads, small row groups (in the SQL)
# and a spill directory keep the conversion within the memory limit.
mkdir -p "$out/spill"
duckdb <<SQL
SET memory_limit = '${DUCKDB_MEMORY_LIMIT:-4GB}';
SET threads = ${CONVERT_THREADS:-3};
SET temp_directory = '$out/spill';
SET preserve_insertion_order = false;
.bail on
.read $out/from-state.sql
SQL
rm -rf "$out/from-state.sql" "$out/spill"

# The manifest derive.sh checks: the state's release metadata and the converted files.
files=$(cd "$out" && for f in *.parquet; do
  printf '{"name":"%s","size":%s,"sha256":"%s"}\n' "$f" "$(stat -f %z "$f" 2>/dev/null || stat -c %s "$f")" \
    "$(shasum -a 256 "$f" | cut -d' ' -f1)"
done | jq -s .)
jq --argjson files "$files" '. + {files: $files}' "$state/state.json" >"$out/manifest.json"
rm -rf "$dest"
mv "$dest.tmp" "$dest"
du -sh "$dest"
