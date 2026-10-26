# The app image: the server and the built web app, on top of a data image that holds Node and one
# derived release (deploy/data.Dockerfile). Pushing a new app image uploads only these layers;
# the data image's are already in the registry. Use scripts/build-image.sh, or:
#
#   podman build --platform linux/amd64 -f deploy/Dockerfile \
#     --build-arg DATA_IMAGE=<registry>/clinvar-gkm-data:2026-10-18 -t <registry>/clinvar-gkm-browser:<tag> .

# The data image to build on; its release is the one served.
ARG DATA_IMAGE
ARG PNPM_VERSION=12.13.0
ARG NODE_VERSION=26.10.0

# The web app, built on the build machine's own platform: its output is platform-independent,
# so this avoids emulating the target. The full node image, not -slim: this tag is only ever used
# for the build platform, so it can't be confused with the target's -slim in the data image.
FROM --platform=$BUILDPLATFORM docker.io/library/node:${NODE_VERSION} AS web
ARG PNPM_VERSION
RUN npm install --global pnpm@${PNPM_VERSION}
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @cvb/web...
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @cvb/web build

# The server's production dependencies, for the target platform (DuckDB's binding is native).
# Built on the data image: it has the target's Node, and the platform can't be mistaken (podman
# can otherwise reuse the build machine's copy of a shared node tag for the target's stages).
# --platform is explicit because podman 5.3, after a stage on the build platform, otherwise looks
# the data image up with the build machine's variant (arm64's v8) and doesn't find it.
FROM --platform=$TARGETPLATFORM ${DATA_IMAGE} AS deps
ARG PNPM_VERSION
USER root
RUN npm install --global pnpm@${PNPM_VERSION}
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --prod --filter @cvb/server...

FROM --platform=$TARGETPLATFORM ${DATA_IMAGE}
ARG TARGETARCH
# Node's name for the target's CPU must match node's own, or the image holds the wrong binaries.
RUN expected=$([ "$TARGETARCH" = amd64 ] && echo x64 || echo "$TARGETARCH"); \
    actual=$(node -p process.arch); \
    [ "$actual" = "$expected" ] || { echo "node is $actual, target is $expected" >&2; exit 1; }
# Listen on every interface: the container's port mapping, or Cloud Run, limits who reaches it.
# Logs go to stdout only, for podman logs and Cloud Logging. Allowed hosts and the rest come
# from the environment at run time (docs/local-app.md#built-for-the-container-run-natively).
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    CLINVAR_DATA_DIR=/data \
    WEB_DIST_DIR=/app/apps/web/dist \
    LOG_FILE=off
WORKDIR /app
COPY --from=deps /app ./
COPY packages/shared packages/shared
COPY apps/server/src apps/server/src
COPY --from=web /app/apps/web/dist apps/web/dist
USER node
EXPOSE 8080
CMD ["node", "apps/server/src/main.ts"]
