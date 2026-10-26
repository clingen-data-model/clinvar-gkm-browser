#!/usr/bin/env bash
# Build the app image for Cloud Run (docs/deploy.md), on a data image holding one derived release.
# The data image is built once per release and reused, so a code change rebuilds and pushes only
# the app's small layers.
#
# Usage: scripts/build-image.sh [--push] [release]   (default: the newest derived release)
# Tags: <registry>/clinvar-gkm-data:<release> and <registry>/clinvar-gkm-browser:<release>-<commit>.
set -euo pipefail

REGISTRY="${CLINVAR_IMAGE_REGISTRY:-us-east1-docker.pkg.dev/clingen-dev/clinvar-gkm-browser}"
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
data_image="$REGISTRY/clinvar-gkm-data:$release"
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
