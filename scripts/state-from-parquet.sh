#!/usr/bin/env bash
# Build a release's state (docs/history.md#building-it) from a published parquet set: one file per
# bundle section, rows (key, rec), where rec is the record's JSON, from the parquet's `data` column
# (`value` for therapies). The parquet's three evidence-line tables are the bundle's one
# evidenceLine section. Used to check the converter against the published typed columns, and as
# the starting state when the latest release is the only one in parquet.
#
# Usage: scripts/state-from-parquet.sh <source dir> <state dir>
set -euo pipefail

src="$(cd "$1" && pwd)"
dest="$2"
[[ -f "$src/manifest.json" ]] || { echo "$src has no manifest.json" >&2; exit 1; }
rm -rf "$dest.tmp"
mkdir -p "$dest.tmp"

# One DuckDB process per section. Records are large strings (up to 0.5 MB): small row groups and a
# spill directory keep each copy within the memory limit.
copy() {  # <section> <select>
  duckdb -c "SET memory_limit = '${DUCKDB_MEMORY_LIMIT:-4GB}'; SET temp_directory = '$dest.tmp/spill';
             SET threads = ${STATE_THREADS:-3}; SET preserve_insertion_order = false;
             COPY ($2) TO '$dest.tmp/$1.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 20000);" \
    >/dev/null || { echo "copying $1 failed" >&2; exit 1; }
}
mkdir -p "$dest.tmp/spill"
for section in sequenceReference location allele copyNumberCount copyNumberChange gene variation \
  condition conditionSet submitter propositionPathogenicity propositionOncogenicity \
  propositionSomaticClinicalImpact propositionClinvarCustom scv vcv rcv; do
  copy "$section" "SELECT id AS key, data AS rec FROM read_parquet('$src/$section.parquet')"
done
for section in therapy therapyGroup; do
  copy "$section" "SELECT key, value AS rec FROM read_parquet('$src/$section.parquet')"
done
copy evidenceLine "SELECT id AS key, data AS rec FROM read_parquet(['$src/evidenceLine.parquet',
                   '$src/vcv_evidenceLine.parquet', '$src/rcv_evidenceLine.parquet'])"
rm -rf "$dest.tmp/spill"
jq '{source_release, build_date, schema_version, dataset, origin: "parquet"}' "$src/manifest.json" >"$dest.tmp/state.json"
rm -rf "$dest"
mv "$dest.tmp" "$dest"
du -sh "$dest"
