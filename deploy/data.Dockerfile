# The base image the app image builds on: Node and the data served, one derived release or the
# release history (docs/deploy.md). Built and pushed once per release or history (or Node
# version); app images then reuse its layers as they are, so pushing a code change uploads only
# the app's own small layers, never the 2 GB of data. Use scripts/build-image.sh, or:
#
#   podman build --platform linux/amd64 --pull=always --ignorefile deploy/data.dockerignore \
#     -f deploy/data.Dockerfile --build-arg SOURCE=derived/1/2026-10-18 --build-arg RELEASE=2026-10-18 \
#     -t <registry>/clinvar-gkm-data:2026-10-18 .

ARG NODE_VERSION=26.10.0
FROM --platform=$TARGETPLATFORM docker.io/library/node:${NODE_VERSION}-slim
# What to serve, under data/: derived/1/<release> or history/1. RELEASE is its newest release.
ARG SOURCE
ARG RELEASE
RUN test -n "${SOURCE}" -a -n "${RELEASE}" || \
    { echo 'Give --build-arg SOURCE=derived/1/YYYY-MM-DD or history/1, and RELEASE=YYYY-MM-DD' >&2; exit 1; }
# /data stays writable for DuckDB's spill directory (/data/tmp).
COPY --chown=node:node data/${SOURCE}/ /data/${SOURCE}/
LABEL org.opencontainers.image.title="ClinVar GKM browser data" \
      org.clinvar-gkm-browser.release="${RELEASE}" \
      org.clinvar-gkm-browser.source="${SOURCE}"
