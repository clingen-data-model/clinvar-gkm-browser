#!/usr/bin/env bash
# Regenerate the derived schema's diagrams in the docs from schema.sql's REFERENCES clauses
# (packages/derive/schema-diagram.awk). A diagram goes between
#   <!-- schema-diagram area=<area> -->  and  <!-- /schema-diagram -->
# replacing whatever is there. Upstream's diagrams are written by hand: its parquet declares no
# references.
#
# Usage: scripts/schema-diagrams.sh [--check]   (--check: fail if a doc is out of date, change nothing)
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
awk_file="$root/packages/derive/schema-diagram.awk"
schema="$root/packages/derive/sql/schema.sql"
docs=("$root/docs/schema.md" "$root/docs/upstream-vs-derived.md")
begin='^<!-- schema-diagram area=([a-z]+) -->$'

render() {
  local line inside=0
  while IFS= read -r line || [[ -n $line ]]; do
    if [[ $line =~ $begin ]]; then
      printf '%s\n```mermaid\n' "$line"
      awk -v area="${BASH_REMATCH[1]}" -f "$awk_file" "$schema"
      printf '```\n'
      inside=1
    elif [[ $line == '<!-- /schema-diagram -->' ]]; then
      printf '%s\n' "$line"
      inside=0
    elif ((!inside)); then
      printf '%s\n' "$line"
    fi
  done <"$1"
}

status=0
for doc in "${docs[@]}"; do
  new="$(render "$doc")"
  if [[ $new == "$(cat "$doc")" ]]; then
    continue
  elif [[ ${1:-} == --check ]]; then
    echo "out of date: ${doc#"$root"/} (run scripts/schema-diagrams.sh)" >&2
    status=1
  else
    printf '%s\n' "$new" >"$doc"
    echo "updated ${doc#"$root"/}"
  fi
done
exit $status
