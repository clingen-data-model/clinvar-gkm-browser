# The base image the app image builds on: Node and one derived release (docs/deploy.md). Built
# and pushed once per release (or Node version); app images then reuse its layers as they are,
# so pushing a code change uploads only the app's own small layers, never the 1.8 GB of data.
#
#   podman build --platform linux/amd64 --pull=always --ignorefile deploy/data.dockerignore \
#     -f deploy/data.Dockerfile --build-arg RELEASE=2026-10-18 -t <registry>/clinvar-gkm-data:2026-10-18 .

ARG NODE_VERSION=26.10.0
FROM --platform=$TARGETPLATFORM docker.io/library/node:${NODE_VERSION}-slim
ARG RELEASE
RUN test -n "${RELEASE}" || { echo 'Give --build-arg RELEASE=YYYY-MM-DD' >&2; exit 1; }
# /data stays writable for DuckDB's spill directory (/data/tmp).
COPY --chown=node:node data/derived/1/${RELEASE}/ /data/derived/1/${RELEASE}/
LABEL org.opencontainers.image.title="ClinVar GKM browser data" \
      org.clinvar-gkm-browser.release="${RELEASE}"
