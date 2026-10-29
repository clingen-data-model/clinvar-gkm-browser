#!/usr/bin/env bash
# Check the JSON converter (packages/derive/sql/from-state.sql) against a published parquet set,
# whose `data` columns hold the same records as the bundle (docs/history.md#the-converter):
#   columns: each converted table equals the published table's same columns, for the same keys
#            (all of 2026-10-18: about 11 minutes, mostly variation);
#   derived: the converted set, derived, equals the release derived from the published parquet,
#            table by table.
#
# Usage: scripts/check-converter.sh columns <published source dir> <converted dir>
#        scripts/check-converter.sh derived <derived from converted> <derived from published>
#   (convert first: scripts/state-from-parquet.sh, then scripts/convert-state.sh; derive with
#   DERIVE_SOURCE_DIR and DERIVE_DEST_DIR)
set -euo pipefail

mode="$1"
status=0

if [[ $mode == columns ]]; then
  pub="$(cd "$2" && pwd)"
  conv="$(cd "$3" && pwd)"
  echo "== columns: converted vs published, for the converted keys"
  for f in "$conv"/*.parquet; do
    t="$(basename "$f" .parquet)"
    key=id
    [[ $t == therapy || $t == therapyGroup ]] && key=key
    # The published columns, cast to the converted (narrower) types: struct fields the converter
    # leaves out are dropped by the cast.
    cols=$(duckdb -noheader -list -c "SELECT string_agg('\"' || column_name || '\"::' || column_type || ' AS \"' || column_name || '\"', ', ')
                                      FROM (DESCRIBE FROM read_parquet('$f'))")
    read -r missing extra < <(duckdb -noheader -list -separator ' ' -c "
      WITH c AS (FROM read_parquet('$f')),
           p AS (SELECT $cols FROM read_parquet('$pub/$t.parquet') WHERE $key IN (SELECT $key FROM c))
      SELECT (SELECT count(*) FROM (FROM p EXCEPT ALL FROM c)), (SELECT count(*) FROM (FROM c EXCEPT ALL FROM p))")
    printf '  %-34s %s\n' "$t" "$([[ $missing == 0 && $extra == 0 ]] && echo same || echo "DIFFERS: $missing published rows unmatched, $extra converted rows unmatched")"
    [[ $missing == 0 && $extra == 0 ]] || status=1
  done
elif [[ $mode == derived ]]; then
  derived="$(cd "$2" && pwd)"
  ref="$(cd "$3" && pwd)"
  echo "== derived: from converted vs from published"
  for f in "$ref"/*.parquet; do
    t="$(basename "$f" .parquet)"
    # release and source_file describe the input files and the load time, which differ by design.
    [[ $t == release || $t == source_file ]] && continue
    read -r missing extra < <(duckdb -noheader -list -separator ' ' -c "
      SELECT (SELECT count(*) FROM (FROM read_parquet('$f') EXCEPT ALL FROM read_parquet('$derived/$t.parquet'))),
             (SELECT count(*) FROM (FROM read_parquet('$derived/$t.parquet') EXCEPT ALL FROM read_parquet('$f')))")
    printf '  %-34s %s\n' "$t" "$([[ $missing == 0 && $extra == 0 ]] && echo same || echo "DIFFERS: $missing reference rows unmatched, $extra rows unmatched")"
    [[ $missing == 0 && $extra == 0 ]] || status=1
  done
else
  echo "usage: $0 columns|derived <dir> <dir>" >&2
  exit 2
fi
exit $status
