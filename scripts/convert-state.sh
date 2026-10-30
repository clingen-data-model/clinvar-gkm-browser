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

SECTIONS="sequenceReference location allele copyNumberCount copyNumberChange gene variation condition
  conditionSet therapy therapyGroup submitter propositionPathogenicity propositionOncogenicity
  propositionSomaticClinicalImpact propositionClinvarCustom evidenceLine scv vcv rcv"
# DuckDB converts 2,048 records at a time, and a large record (a variation's HGVS list, up to about
# 0.3 MB of JSON) expands into many nested values: 2,048 large records together exceed 4 GB even on
# one thread. They are spread thin in a whole release but can cluster in a subset (the variants a
# big week touches). So records over LARGE_RECORD bytes convert separately, at most BATCH_BYTES of
# JSON at a time (the 200 largest in 2026-10-18 peak at 1.2 GB).
LARGE_RECORD=50000
BATCH_BYTES=32000000
SETTINGS="SET memory_limit = '${DUCKDB_MEMORY_LIMIT:-4GB}'; SET threads = ${CONVERT_THREADS:-3};
          SET temp_directory = '$out/spill'; SET preserve_insertion_order = false;"
mkdir -p "$out/spill" "$out/small"

# Split: each section's ordinary records, and the large ones numbered into batches.
{
  echo "$SETTINGS"
  for s in $SECTIONS; do
    echo "COPY (SELECT key, rec FROM read_parquet('$state/$s.parquet') WHERE strlen(rec) <= $LARGE_RECORD)
          TO '$out/small/$s.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 20000);"
  done
  echo "COPY (SELECT section, key, rec, CAST((sum(strlen(rec)) OVER (ORDER BY section, key) - 1) // $BATCH_BYTES AS INTEGER) AS batch
              FROM ($(for s in $SECTIONS; do echo "UNION ALL SELECT '$s' AS section, key, rec FROM read_parquet('$state/$s.parquet') WHERE strlen(rec) > $LARGE_RECORD"; done | sed '1s/^UNION ALL //')))
        TO '$out/large.parquet' (FORMAT parquet);"
} | duckdb >/dev/null
batches=$(duckdb -noheader -list -c "SELECT coalesce(max(batch) + 1, 0) FROM read_parquet('$out/large.parquet')")

# Each batch as a state of its own, every section present.
for ((b = 0; b < batches; b++)); do
  mkdir -p "$out/b$b"
  {
    for s in $SECTIONS; do
      echo "COPY (SELECT key, rec FROM read_parquet('$out/large.parquet') WHERE batch = $b AND section = '$s') TO '$out/b$b/$s.parquet' (FORMAT parquet);"
    done
  } | duckdb >/dev/null
done

# Convert the ordinary records, then each batch, in one session.
parts="small"
for ((b = 0; b < batches; b++)); do parts="$parts b$b"; done
{
  echo "$SETTINGS"
  echo ".bail on"
  for p in $parts; do
    mkdir -p "$out/conv-$p"
    sed -e "s|{state}|$out/$p|g" -e "s|{out}|$out/conv-$p|g" "$SQL_DIR/from-state.sql"
  done
} >"$out/from-state.sql"
duckdb <"$out/from-state.sql" >/dev/null

# One file per table, from the parts.
tables=$(cd "$out/conv-small" && ls *.parquet | sed 's/\.parquet$//')
{
  echo "$SETTINGS"
  for t in $tables; do
    echo "COPY (FROM read_parquet([$(for p in $parts; do printf "'%s'," "$out/conv-$p/$t.parquet"; done | sed 's/,$//')]))
          TO '$out/$t.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 20000);"
  done
} | duckdb >/dev/null
rm -rf "$out/spill" "$out/small" "$out/large.parquet" "$out/from-state.sql" "$out"/b[0-9]* "$out"/conv-*

# Every record converts to exactly one row (the evidence-line section into three tables).
read -r records rows < <(duckdb -noheader -list -separator ' ' -c "
  SELECT (SELECT count(*) FROM read_parquet([$(for s in $SECTIONS; do printf "'%s'," "$state/$s.parquet"; done | sed 's/,$//')])),
         (SELECT count(*) FROM read_parquet([$(for t in $tables; do printf "'%s'," "$out/$t.parquet"; done | sed 's/,$//')], union_by_name = true))")
[[ $records == "$rows" ]] || { echo "converted $rows rows from $records records" >&2; exit 1; }

# The manifest derive.sh checks: the state's release metadata and the converted files.
files=$(cd "$out" && for f in *.parquet; do
  printf '{"name":"%s","size":%s,"sha256":"%s"}\n' "$f" "$(stat -f %z "$f" 2>/dev/null || stat -c %s "$f")" \
    "$(shasum -a 256 "$f" | cut -d' ' -f1)"
done | jq -s .)
jq --argjson files "$files" '. + {files: $files}' "$state/state.json" >"$out/manifest.json"
rm -rf "$dest"
mv "$dest.tmp" "$dest"
du -sh "$dest"
