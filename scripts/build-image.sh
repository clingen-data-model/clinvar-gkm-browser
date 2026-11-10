#!/usr/bin/env bash
# Build the app image for Cloud Run (docs/deploy.md), on a data image holding one derived release
# or the release history (docs/history.md). The data image is built once per release or history
# and reused, so a code change rebuilds and pushes only the app's small layers.
#
# Usage: CLINVAR_GKM_BROWSER_PROJECT=<project> scripts/build-image.sh [--push] [release | --history]
#   (options in any order)
#   (default release: the newest derived one; CLINVAR_GKM_BROWSER_REGION defaults to us-east1)
# Tags: <registry>/clinvar-gkm-data:<release>-<derived> and <registry>/clinvar-gkm-browser:<release>-<commit>,
# where <derived> is when the release was derived (its manifest's loaded_at), so deriving a release
# again (say, with a new table) makes a new data image rather than reusing the old one. With
# --history: clinvar-gkm-data:history-<last release>-<written> and clinvar-gkm-browser:history-<last
# release>-<commit>, where <written> is when the history's releases.parquet was last written (by an
# apply or a rebuild), so changing the history in any way makes a new data image.
set -euo pipefail

# The Google Cloud project holding the Artifact Registry repository. Required: it isn't recorded here.
PROJECT="${CLINVAR_GKM_BROWSER_PROJECT:?set CLINVAR_GKM_BROWSER_PROJECT to the Google Cloud project to build for}"
REGION="${CLINVAR_GKM_BROWSER_REGION:-us-east1}"
REGISTRY="$REGION-docker.pkg.dev/$PROJECT/clinvar-gkm-browser"
PLATFORM="${CLINVAR_IMAGE_PLATFORM:-linux/amd64}"
DATA_DIR="${CLINVAR_DATA_DIR:-./data}"
NODE_VERSION=26.10.0

push=false
history=false
release=
for arg in "$@"; do
  case $arg in
    --push) push=true ;;
    --history) history=true ;;
    -*) echo "unknown option $arg" >&2; exit 1 ;;
    *) [[ -z $release ]] || { echo "one release at most" >&2; exit 1; }; release=$arg ;;
  esac
done
if $history; then
  [[ -z $release ]] || { echo "--history serves every release in the history; name no release" >&2; exit 1; }
  # The derived history only: the log of upstream's records isn't served, so it stays out.
  source=history/1
  dir="$DATA_DIR/$source"
  [[ -f "$dir/releases.parquet" ]] || { echo "no release history at $dir" >&2; exit 1; }
  release=$(duckdb -noheader -list -c "SELECT max(release) FROM read_parquet('$dir/releases.parquet')")
  # Files of a release not yet listed (an apply running, or one that failed) would be dead weight
  # in the image; the server ignores them, but finish or clear the apply before building.
  unlisted=$(find "$dir/added" "$dir/closed" -mindepth 2 -maxdepth 2 -name 'release=*' \
    | sed 's/.*release=//' | sort -u | awk -v last="$release" '$0 > last')
  [[ -z $unlisted ]] || { echo "the history has files of unlisted releases: $unlisted" >&2; exit 1; }
  written=$(date -r "$dir/releases.parquet" +%Y%m%dT%H%M%S)
  data_tag="history-$release-$written"
  app_prefix="history-$release"
else
  base="$DATA_DIR/derived/1"
  release="${release:-$(ls "$base" | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' | sort | tail -1)}"
  [[ -f "$base/$release/manifest.json" ]] || { echo "no derived release $release under $base" >&2; exit 1; }
  source="derived/1/$release"
  derived=$(jq -r '.loaded_at' "$base/$release/manifest.json" | tr -d ' :-' | cut -c1-14 | sed 's/\(........\)\(......\)/\1T\2/')
  data_tag="$release-$derived"
  app_prefix="$release"
fi

commit=$(git rev-parse --short HEAD)
if [[ -n "$(git status --porcelain)" ]]; then
  # A pushed tag names the commit it was built from, so only clean trees are pushed.
  $push && { echo "uncommitted changes: commit before pushing" >&2; exit 1; }
  commit="$commit-dirty"
fi
data_image="$REGISTRY/clinvar-gkm-data:$data_tag"
app_image="$REGISTRY/clinvar-gkm-browser:$app_prefix-$commit"

if podman image exists "$data_image"; then
  echo "data image $data_image: already built"
else
  echo "data image $data_image: building"
  # --pull=always so the target platform's node is fetched, not the build machine's copy.
  podman build --platform "$PLATFORM" --pull=always --ignorefile deploy/data.dockerignore \
    -f deploy/data.Dockerfile --build-arg NODE_VERSION="$NODE_VERSION" --build-arg SOURCE="$source" --build-arg RELEASE="$release" \
    -t "$data_image" .
fi

echo "app image $app_image: building"
# Local images only: with --platform set, podman otherwise looks the data image up in the registry
# first. The web stage's node, for the build machine's own platform, is fetched here instead.
podman pull --quiet "docker.io/library/node:$NODE_VERSION" >/dev/null
podman build --platform "$PLATFORM" --pull=never -f deploy/Dockerfile \
  --build-arg NODE_VERSION="$NODE_VERSION" --build-arg DATA_IMAGE="$data_image" -t "$app_image" .

if $push; then
  registry_host="${REGISTRY%%/*}"
  gcloud auth print-access-token | podman login -u oauth2accesstoken --password-stdin "$registry_host"
  # Layers the registry already has are skipped, so after the first push of a release the data
  # image's push and the app image's base layers cost nothing.
  podman push "$data_image"
  podman push "$app_image"
fi
echo "$app_image"
