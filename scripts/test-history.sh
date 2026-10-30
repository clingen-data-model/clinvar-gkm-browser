#!/usr/bin/env bash
# Test scripts/history.sh on the committed fixture (packages/derive/test/history, written by
# scripts/make-history-fixture.sh): start from the base, apply the real 2026-10-24 delta and two
# synthetic ones, and after each, check the derived history against a full derivation. Then resume
# an interrupted run and rebuild from the log. About half a minute.
#
# The real delta has a merged variant (a proposition changes subject; a variation, its VCV and RCV
# are deleted) and a changed condition. The synthetic deltas, built from the base records, add:
#   2026-10-31  a condition becoming a placeholder; a set gaining a member set (nesting); an SCV
#               deleted and re-added in one delta; an SCV removed with its evidence-line citations;
#               a VCV version bump (every statement and evidence line re-keyed)
#   2026-11-07  a change to the nested member set only, which reaches the SCV through its parent
#
# Usage: scripts/test-history.sh   (or pnpm test:history)
set -euo pipefail

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
FIXTURE="$(cd "$SCRIPTS/../packages/derive/test/history" && pwd)"
tmp="$(mktemp -d)"
trap '[[ -n ${KEEP:-} ]] || rm -rf "$tmp"' EXIT; echo "tmp: $tmp"

SECTIONS="sequenceReference location allele copyNumberCount copyNumberChange gene variation condition
  conditionSet therapy therapyGroup submitter propositionPathogenicity propositionOncogenicity
  propositionSomaticClinicalImpact propositionClinvarCustom evidenceLine scv vcv rcv"
base_records() {
  for s in $SECTIONS; do echo "UNION ALL SELECT '$s' AS section, key, rec FROM read_parquet('$FIXTURE/base/$s.parquet')"; done | sed '1s/^UNION ALL //'
}

# A delta state from a table d(section, key, rec) and a table del(section, key).
write_delta() {  # <dir> <release> <baseline> <SQL creating d and del>
  local dir=$1 s
  mkdir -p "$dir"
  {
    echo ".bail on"
    echo "SET lambda_syntax = 'DISABLE_SINGLE_ARROW';"
    echo "CREATE MACRO bare(p) AS regexp_replace(p, '^#/[^/]+/', '');"
    echo "CREATE TABLE b AS $(base_records);"
    echo "$4"
    for s in $SECTIONS; do echo "COPY (SELECT key, rec FROM d WHERE section = '$s') TO '$dir/$s.parquet' (FORMAT parquet);"; done
    echo "COPY (SELECT section, key FROM del) TO '$dir/deleted.parquet' (FORMAT parquet);"
  } | duckdb >/dev/null
  jq -n --arg r "$2" --arg b "$3" '{source_release: $r, baseline_release: $b, build_date: $r, schema_version: "1.1.0",
                                    dataset: "synthetic", origin: "delta", sha256: null}' >"$dir/state.json"
}

# 2026-10-31, on variant 279 and its condition set 48185.
REMOVED_SCV="clinvar.submission:SCV000742796.4"
write_delta "$tmp/synthetic-1" 2026-10-31 2026-10-24 "
CREATE TABLE d (section VARCHAR, key VARCHAR, rec VARCHAR);
CREATE TABLE del (section VARCHAR, key VARCHAR);
-- Condition 1962 (Desbuquois dysplasia 1), named by SCV000020447 and in set 48185, becomes a placeholder.
INSERT INTO d SELECT section, key, json_merge_patch(rec, '{\"name\": \"not provided\"}') FROM b
  WHERE section = 'condition' AND key = 'clinvar.trait:1962';
-- Set 48185 gains set 9448 as a member.
INSERT INTO d SELECT section, key,
    json_merge_patch(rec, json_object('concepts', list_append(CAST(rec::JSON->'concepts' AS VARCHAR[]), '#/conditionSet/clinvar.traitset:9448')))
  FROM b WHERE section = 'conditionSet' AND key = 'clinvar.traitset:48185';
-- An SCV deleted and re-added in the same delta, with a new description.
INSERT INTO d SELECT section, key, json_merge_patch(rec, '{\"description\": \"re-added by the history test\"}') FROM b
  WHERE section = 'scv' AND key = 'clinvar.submission:SCV003442519.4';
INSERT INTO del VALUES ('scv', 'clinvar.submission:SCV003442519.4');
-- An SCV removed, with its proposition and its citations in the RCV's evidence lines.
INSERT INTO del VALUES ('scv', '$REMOVED_SCV'), ('propositionPathogenicity', 'SCV000742796-PATH');
CREATE MACRO without_removed(rec) AS json_merge_patch(rec, json_object('hasEvidenceItems',
    list_filter(CAST(rec::JSON->'hasEvidenceItems' AS VARCHAR[]), lambda x: x <> '#/scv/$REMOVED_SCV')));
INSERT INTO d SELECT section, key, without_removed(rec) FROM b
  WHERE section = 'evidenceLine' AND key LIKE 'RCV%' AND contains(rec, '$REMOVED_SCV');
-- VCV 279 goes from version 9 to 10: every statement and evidence line gets a new key, and the
-- removed SCV is gone from the new lines.
INSERT INTO d SELECT section, replace(key, 'VCV000000279.9-', 'VCV000000279.10-'),
    replace(CASE WHEN contains(rec, '$REMOVED_SCV') THEN without_removed(rec) ELSE rec END, 'VCV000000279.9-', 'VCV000000279.10-')
  FROM b WHERE section IN ('vcv', 'evidenceLine') AND key LIKE 'VCV000000279.9-%';
INSERT INTO del SELECT section, key FROM b WHERE section IN ('vcv', 'evidenceLine') AND key LIKE 'VCV000000279.9-%';
"

# 2026-11-07: only the member set changes, gaining a condition set 48185 lacks; SCV008082313, which
# names set 48185, is reached through it.
write_delta "$tmp/synthetic-2" 2026-11-07 2026-10-31 "
CREATE TABLE d AS SELECT section, key,
    json_merge_patch(rec, json_object('concepts', list_append(CAST(rec::JSON->'concepts' AS VARCHAR[]), '#/condition/clinvar.trait:5851'))) AS rec
  FROM b WHERE section = 'conditionSet' AND key = 'clinvar.traitset:9448';
CREATE TABLE del (section VARCHAR, key VARCHAR);
"

run() {  # <name>
  local name=$1 out
  export CLINVAR_DATA_DIR="$tmp/$name" HISTORY_DIR="$tmp/$name/history"
  mkdir -p "$CLINVAR_DATA_DIR/tmp"
  echo "== $name"
  "$SCRIPTS/history.sh" init "$FIXTURE/base" >/dev/null
  "$SCRIPTS/history.sh" check >/dev/null || { echo "check failed at 2026-10-18"; exit 1; }
  for delta in "$FIXTURE/delta" "$tmp/synthetic-1" "$tmp/synthetic-2"; do
    local release
    release="$(jq -r .source_release "$delta/state.json")"
    out="$("$SCRIPTS/history.sh" apply "$delta")"
    "$SCRIPTS/history.sh" check >/dev/null || { echo "$out"; echo "check failed at $release"; exit 1; }
    echo "  $release: same as a full derivation; rows changed in $(grep -E '│ [a-zA-Z_]+ +│ [0-9]' <<<"$out" | awk '{print $2}' | paste -sd, -)"
    # The synthetic deltas must reach the rows they were written to change.
    case $release in
      2026-10-31) for t in scv scv_condition vcv_statement condition; do
                    grep -q "│ $t " <<<"$out" || { echo "$out"; echo "2026-10-31 should change $t"; exit 1; }
                  done ;;
      2026-11-07) grep -q '│ scv_condition ' <<<"$out" || { echo "$out"; echo "2026-11-07 should change scv_condition through the nested set"; exit 1; } ;;
    esac
  done
  # A run that stopped after writing a release's derived files but before listing it: the next apply
  # clears those files and applies the release again.
  local der="$HISTORY_DIR/1" last
  last="$(duckdb -noheader -list -c "SELECT max(release) FROM read_parquet('$der/releases.parquet')")"
  duckdb -c "COPY (FROM read_parquet('$der/releases.parquet') WHERE release < DATE '$last') TO '$der/releases.new' (FORMAT parquet)"
  mv "$der/releases.new" "$der/releases.parquet"
  "$SCRIPTS/history.sh" apply "$tmp/synthetic-2" >/dev/null
  "$SCRIPTS/history.sh" check >/dev/null || { echo "check failed after resuming $last"; exit 1; }
  echo "  resumed $last after an interrupted run"
  # Past releases still read as they were.
  "$SCRIPTS/history.sh" check 2026-10-18 >/dev/null && "$SCRIPTS/history.sh" check 2026-10-24 >/dev/null \
    || { echo "a past release changed"; exit 1; }
  echo "  2026-10-18 and 2026-10-24 unchanged"
  # The derived history rebuilt from the log alone, as after a schema change.
  "$SCRIPTS/history.sh" rebuild >/dev/null
  "$SCRIPTS/history.sh" check >/dev/null && "$SCRIPTS/history.sh" check 2026-10-24 >/dev/null \
    || { echo "check failed after rebuilding from the log"; exit 1; }
  echo "  rebuilt from the log"
}

run history
echo "history tests passed"
