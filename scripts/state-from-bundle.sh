#!/usr/bin/env bash
# Build a release's state (docs/history.md#the-converter) from a ClinVar-GKM JSON bundle: one file per
# bundle section, rows (key, rec), where rec is the record's JSON as in the bundle. With --delta, the
# bundle is a weekly delta: its added and updated records, plus deleted.parquet (section, key) from
# the delta's manifest.
#
# The bundle's assembler writes one record per line (`    "<key>": <record>,`) inside one
# `  "<section>": {` block per section. That layout isn't a published guarantee, so any line that
# doesn't fit it stops the read.
#
# Usage: scripts/state-from-bundle.sh <bundle.json.gz> <state dir> <release> <build date>
#        scripts/state-from-bundle.sh --delta <manifest.json> <bundle.json.gz> <state dir> <build date>
set -euo pipefail

manifest=""
if [[ ${1:-} == --delta ]]; then
  manifest="$2"
  shift 2
fi
bundle="$1"
dest="$2"
if [[ -n $manifest ]]; then
  release="$(jq -r .release "$manifest")"
  build_date="$3"
else
  release="$3"
  build_date="$4"
fi
[[ $release =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "bad release '$release'" >&2; exit 1; }

# The 1.1.0 bundle sections, in the assembler's order. A delta leaves out the empty ones.
SECTIONS="sequenceReference location allele copyNumberCount copyNumberChange gene variation condition
  conditionSet therapy therapyGroup submitter propositionPathogenicity propositionOncogenicity
  propositionSomaticClinicalImpact propositionClinvarCustom evidenceLine scv vcv rcv"

rm -rf "$dest.tmp"
mkdir -p "$dest.tmp/split"
tmp="$(cd "$dest.tmp" && pwd)"

# Split the records into one gzipped `key<TAB>record` file per section. Compact JSON escapes tabs and
# newlines, so neither appears inside a record.
gzip -dc "$bundle" | awk -v dir="$tmp/split" -v sections="$(echo $SECTIONS)" '
  function fail(msg) { print "line " NR ": " msg > "/dev/stderr"; failed = 1; exit 1 }
  BEGIN { n = split(sections, s, " "); for (i = 1; i <= n; i++) if (s[i] != "") known[s[i]] = 1 }
  NR == 1 { if ($0 != "{") fail("expected {"); next }
  NR == 2 {
    if ($0 !~ /^  "schema_version": "[^"]+",?$/) fail("expected schema_version")
    v = $0; sub(/^  "schema_version": "/, "", v); sub(/",?$/, "", v); print v > (dir "/schema_version")
    next
  }
  /^  "[A-Za-z]+": \{$/ {
    if (section != "") fail("section " section " not closed")
    section = $0; sub(/^  "/, "", section); sub(/": \{$/, "", section)
    if (!(section in known)) fail("unknown section " section)
    if (section in seen) fail("section " section " twice")
    seen[section] = 1
    out = "gzip -1 > \"" dir "/" section ".tsv.gz\""
    next
  }
  /^    "/ {
    if (section == "") fail("record outside a section")
    i = index($0, "\": ")
    key = substr($0, 6, i - 6)
    if (i == 0 || key ~ /["\\\t]/) fail("unreadable key")
    rec = substr($0, i + 3); sub(/,$/, "", rec)
    print key "\t" rec | out
    count[section]++
    next
  }
  /^  \},?$/ { if (section == "") fail("unexpected }"); close(out); section = ""; next }
  /^\}$/ { ended = 1; next }
  { fail("unexpected line") }
  END {
    if (failed) exit 1
    if (!ended || section != "") { print "bundle ends early" > "/dev/stderr"; exit 1 }
    for (sec in count) print sec "\t" count[sec] > (dir "/counts.tsv")
  }'

schema_version="$(cat "$tmp/split/schema_version")"
[[ $schema_version == 1.1.0 ]] || { echo "schema_version $schema_version: only 1.1.0 is supported" >&2; exit 1; }
touch "$tmp/split/counts.tsv"

# A delta's records per section must be the manifest's added plus updated. Except conditionSet:
# the manifest counts every changed set, but the bundle leaves out sets of one member (upstream's
# export-gkm-dicts.sh), so it may hold fewer.
if [[ -n $manifest ]]; then
  bad=$(jq -r --rawfile counts "$tmp/split/counts.tsv" '
    ($counts | split("\n") | map(select(. != "") | split("\t") | {(.[0]): (.[1] | tonumber)}) | add // {}) as $got
    | .sections | to_entries[]
    | (.value.added + .value.updated) as $want | ($got[.key] // 0) as $n
    | select(if .key == "conditionSet" then $n > $want else $n != $want end)
    | "\(.key): \($n) records, manifest says \($want)"' "$manifest")
  extra=$(cut -f1 "$tmp/split/counts.tsv" | grep -vxF -f <(jq -r '.sections | keys[]' "$manifest") || true)
  if [[ -n $bad || -n $extra ]]; then
    echo "$bundle doesn't match its manifest:" >&2
    [[ -n $bad ]] && echo "$bad" >&2
    [[ -n $extra ]] && echo "sections not in the manifest: $extra" >&2
    exit 1
  fi
fi

{
  echo "SET memory_limit = '${DUCKDB_MEMORY_LIMIT:-4GB}'; SET temp_directory = '$tmp/spill';"
  echo "SET threads = ${STATE_THREADS:-3}; SET preserve_insertion_order = false;"
  for section in $SECTIONS; do
    if [[ -f "$tmp/split/$section.tsv.gz" ]]; then
      # Records reach about 0.5 MB; quoting is off, since the record is the rest of the line.
      echo "COPY (SELECT key, rec FROM read_csv('$tmp/split/$section.tsv.gz', delim = '\t', quote = '',
              escape = '', header = false, columns = {'key': 'VARCHAR', 'rec': 'VARCHAR'},
              max_line_size = 16000000))
            TO '$tmp/$section.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 20000);"
    else
      echo "COPY (SELECT NULL::VARCHAR AS key, NULL::VARCHAR AS rec WHERE false)
            TO '$tmp/$section.parquet' (FORMAT parquet);"
    fi
  done
  if [[ -n $manifest ]]; then
    jq -r '.sections | to_entries[] | .key as $s | .value.deleted[] | [$s, .] | @tsv' "$manifest" >"$tmp/split/deleted.tsv"
    echo "COPY (SELECT section, key FROM read_csv('$tmp/split/deleted.tsv', delim = '\t', quote = '', header = false,
              columns = {'section': 'VARCHAR', 'key': 'VARCHAR'}))
            TO '$tmp/deleted.parquet' (FORMAT parquet);"
  fi
} | duckdb >/dev/null

if [[ -n $manifest ]]; then
  jq --arg build_date "$build_date" --arg dataset "$(basename "$bundle")" \
    '{source_release: .release, baseline_release, build_date: $build_date, schema_version, dataset: $dataset,
      origin: "delta", sha256}' "$manifest" >"$tmp/state.json"
else
  jq -n --arg r "$release" --arg b "$build_date" --arg v "$schema_version" --arg d "$(basename "$bundle")" \
    --arg sha "$(shasum -a 256 "$bundle" | cut -d' ' -f1)" \
    '{source_release: $r, build_date: $b, schema_version: $v, dataset: $d, origin: "bundle", sha256: $sha}' >"$tmp/state.json"
fi
rm -rf "$tmp/split" "$tmp/spill"
rm -rf "$dest"
mv "$dest.tmp" "$dest"
du -sh "$dest"
