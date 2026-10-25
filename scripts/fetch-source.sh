#!/usr/bin/env bash
# Download the current ClinVar-GKM parquet set into $CLINVAR_DATA_DIR/source/<release>/,
# verifying each file against the manifest's sha256. Re-running skips verified files and
# resumes partial ones. M0 tooling; the app's own downloader replaces it in M1.
set -euo pipefail

BASE_URL="${CLINVAR_SOURCE_URL:-https://data.clinvar-gkm.org/v1/1.1/}"
DATA_DIR="${CLINVAR_DATA_DIR:-./data}"

manifest_json=$(curl -fsS "${BASE_URL}parquet/manifest.json")
release=$(jq -r .source_release <<<"$manifest_json")
build_date=$(jq -r .build_date <<<"$manifest_json")
dest="$DATA_DIR/source/$release"
tmp="$DATA_DIR/tmp/source-$release"
mkdir -p "$dest" "$tmp"
echo "ClinVar release $release, parquet built $build_date -> $dest"

sha256_of() { shasum -a 256 "$1" | cut -d' ' -f1; }

jq -r '.files[] | "\(.name) \(.size) \(.sha256)"' <<<"$manifest_json" | while read -r name size sha; do
  if [[ -f "$dest/$name" ]] && [[ "$(sha256_of "$dest/$name")" == "$sha" ]]; then
    echo "ok       $name"
    continue
  fi
  echo "fetching $name ($((size / 1000000)) MB)"
  curl -fsS --retry 5 --retry-all-errors -C - -o "$tmp/$name" "${BASE_URL}parquet/$name"
  if [[ "$(sha256_of "$tmp/$name")" != "$sha" ]]; then
    # The set is overwritten in place each week; a mismatch may mean it was rebuilt mid-download.
    current=$(curl -fsS "${BASE_URL}parquet/manifest.json" | jq -r .build_date)
    rm -f "$tmp/$name"
    if [[ "$current" != "$build_date" ]]; then
      echo "upstream rebuilt during download ($build_date -> $current); run again" >&2
    else
      echo "checksum mismatch for $name" >&2
    fi
    exit 1
  fi
  mv "$tmp/$name" "$dest/$name"
done

printf '%s\n' "$manifest_json" >"$dest/manifest.json"
echo "done: $dest"
