#!/usr/bin/env bash
# Build the app image for Cloud Run (docs/deploy.md), on a data image holding one derived release.
# The data image is built once per release and reused, so a code change rebuilds and pushes only
# the app's small layers.
#
# Usage: CLINVAR_GKM_BROWSER_PROJECT=<project> scripts/build-image.sh [--push] [release]
#   (default release: the newest derived one; CLINVAR_GKM_BROWSER_REGION defaults to us-east1)
# Tags: <registry>/clinvar-gkm-data:<release>-<derived> and <registry>/clinvar-gkm-browser:<release>-<commit>,
# where <derived> is when the release was derived (its manifest's loaded_at), so deriving a release
# again (say, with a new table) makes a new data image rather than reusing the old one.
set -euo pipefail

# The Google Cloud project holding the Artifact Registry repository. Required: it isn't recorded here.
PROJECT="${CLINVAR_GKM_BROWSER_PROJECT:?set CLINVAR_GKM_BROWSER_PROJECT to the Google Cloud project to build for}"
REGION="${CLINVAR_GKM_BROWSER_REGION:-us-east1}"
REGISTRY="$REGION-docker.pkg.dev/$PROJECT/clinvar-gkm-browser"
PLATFORM="${CLINVAR_IMAGE_PLATFORM:-linux/amd64}"
DATA_DIR="${CLINVAR_DATA_DIR:-./data}"
NODE_VERSION=26.10.0

push=false
if [[ "${1:-}" == --push ]]; then
  push=true
  shift
fi
base="$DATA_DIR/derived/1"
release="${1:-$(ls "$base" | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' | sort | tail -1)}"
[[ -f "$base/$release/manifest.json" ]] || { echo "no derived release $release under $base" >&2; exit 1; }

commit=$(git rev-parse --short HEAD)
if [[ -n "$(git status --porcelain)" ]]; then
  # A pushed tag names the commit it was built from, so only clean trees are pushed.
  $push && { echo "uncommitted changes: commit before pushing" >&2; exit 1; }
  commit="$commit-dirty"
fi
derived=$(jq -r '.loaded_at' "$base/$release/manifest.json" | tr -d ' :-' | cut -c1-14 | sed 's/\(........\)\(......\)/\1T\2/')
data_image="$REGISTRY/clinvar-gkm-data:$release-$derived"
app_image="$REGISTRY/clinvar-gkm-browser:$release-$commit"

if podman image exists "$data_image"; then
  echo "data image $data_image: already built"
else
  echo "data image $data_image: building"
  # --pull=always so the target platform's node is fetched, not the build machine's copy.
  podman build --platform "$PLATFORM" --pull=always --ignorefile deploy/data.dockerignore \
    -f deploy/data.Dockerfile --build-arg NODE_VERSION="$NODE_VERSION" --build-arg RELEASE="$release" \
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
