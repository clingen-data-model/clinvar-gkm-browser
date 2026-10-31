#!/usr/bin/env bash
# Build a release history from ClinVar-GKM's JSON (docs/history.md#backfill): download an official
# monthly and every weekly delta after it, start the history from the monthly, and apply each delta
# in order. Files are checked against the line index's sha256 and kept under data/gkm-json/, mirroring
# upstream's paths, so a rerun downloads nothing twice.
#
# A run that stopped carries on from the log's last release (history.sh apply first brings the
# derived history up to the log).
#
# Usage: scripts/backfill-history.sh <monthly, e.g. 2026-07> [through release, e.g. 2026-10-24]
#   CHECK=1 also runs scripts/history.sh check after every release (about 10 minutes each).
set -euo pipefail

BASE_URL="https://data.clinvar-gkm.org"
LINE="v1/1.1"
DATA_DIR="${CLINVAR_DATA_DIR:-./data}"
JSON_DIR="$DATA_DIR/gkm-json"
SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
month="$1"
through="${2:-9999-12-31}"

mkdir -p "$JSON_DIR"
index="$(curl -sSf "$BASE_URL/$LINE/index.json")"

# Download a file (if absent or wrong) and check its sha256.
fetch() {  # <path under the host> <sha256>
  local path=$1 sha=$2 dest="$JSON_DIR/$1"
  if [[ ! -f $dest ]] || [[ $(shasum -a 256 "$dest" | cut -d' ' -f1) != "$sha" ]]; then
    mkdir -p "$(dirname "$dest")"
    echo "downloading $path" >&2
    curl -sSf -o "$dest.part" "$BASE_URL/$path"
    mv "$dest.part" "$dest"
  fi
  [[ $(shasum -a 256 "$dest" | cut -d' ' -f1) == "$sha" ]] || { echo "$path: sha256 mismatch" >&2; exit 1; }
  echo "$dest"
}

monthly="$(jq -c --arg m "$month" '.datasets.monthly[] | select(.release == $m and (.latest | not))' <<<"$index")"
[[ -n $monthly ]] || { echo "no monthly $month in the line index" >&2; exit 1; }
start="$(jq -r .source_release <<<"$monthly")"
deltas="$(jq -c --arg s "$start" --arg t "$through" '[.deltas[] | select(.release > $s and .release <= $t)] | sort_by(.release)[]' <<<"$index")"
echo "monthly $month (release $start), then $(grep -c . <<<"$deltas" || true) deltas through $(jq -r .release <<<"$deltas" | tail -1)"

work="$DATA_DIR/tmp/backfill"
mkdir -p "$work"
log_releases="${HISTORY_DIR:-$DATA_DIR/history}/log/releases.parquet"

# A history already started (an earlier run that stopped) carries on from the log's last release.
if [[ -f $log_releases ]]; then
  last="$(duckdb -noheader -list -c "SELECT max(release) FROM read_parquet('$log_releases')")"
  echo "resuming: the log ends at $last"
else
  last="$start"
  bundle="$(fetch "$(jq -r .path <<<"$monthly")" "$(jq -r .sha256 <<<"$monthly")")"
  echo "reading the monthly"
  "$SCRIPTS/state-from-bundle.sh" "$bundle" "$work/state-$start" "$start" "$(jq -r .modified <<<"$monthly")"
  "$SCRIPTS/history.sh" init "$work/state-$start"
  rm -rf "$work/state-$start"
fi

while read -r d; do
  [[ -n $d ]] || continue
  release="$(jq -r .release <<<"$d")"
  [[ $release > $last ]] || continue
  manifest_path="$(jq -r .manifest <<<"$d")"
  mkdir -p "$(dirname "$JSON_DIR/$manifest_path")"
  curl -sSf -o "$JSON_DIR/$manifest_path" "$BASE_URL/$manifest_path"
  delta="$(fetch "$(jq -r .bundle.path <<<"$d")" "$(jq -r .bundle.sha256 <<<"$d")")"
  "$SCRIPTS/state-from-bundle.sh" --delta "$JSON_DIR/$manifest_path" "$delta" "$work/state-$release" "$(jq -r .modified <<<"$d")"
  "$SCRIPTS/history.sh" apply "$work/state-$release"
  rm -rf "$work/state-$release"
  if [[ ${CHECK:-} == 1 ]]; then "$SCRIPTS/history.sh" check "$release"; fi
done <<<"$deltas"
rm -rf "$work"
