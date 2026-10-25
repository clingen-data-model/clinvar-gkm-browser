# The whole app in one image: the server, the built web app, and one derived release baked in
# (docs/deploy.md). Data needs no download or derivation at startup.
#
#   podman build --platform linux/amd64 --pull=always -f deploy/Dockerfile \
#     --build-arg RELEASE=2026-10-18 -t clinvar-gkm-browser:2026-10-18 .
#
# --pull=always matters when building for another platform: the stages share the node image's
# tag, and without it podman reuses the build machine's copy (arm64 on a Mac) for the target's
# stages too, producing an image labelled amd64 with arm64 binaries inside. The architecture
# check below catches that.

ARG NODE_VERSION=26.10.0
ARG PNPM_VERSION=12.13.0

# The web app, built on the build machine's own platform: its output is platform-independent,
# so this avoids emulating the target.
FROM --platform=$BUILDPLATFORM docker.io/library/node:${NODE_VERSION}-slim AS web
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
FROM --platform=$TARGETPLATFORM docker.io/library/node:${NODE_VERSION}-slim AS deps
ARG PNPM_VERSION
RUN npm install --global pnpm@${PNPM_VERSION}
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --prod --filter @cvb/server...

FROM --platform=$TARGETPLATFORM docker.io/library/node:${NODE_VERSION}-slim
ARG RELEASE
ARG TARGETARCH
RUN test -n "${RELEASE}" || { echo 'Give --build-arg RELEASE=YYYY-MM-DD' >&2; exit 1; }
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
# The data first: the biggest layer, which changes weekly, so code changes don't resend it.
# /data stays writable for DuckDB's spill directory (/data/tmp).
COPY --chown=node:node data/derived/1/${RELEASE}/ /data/derived/1/${RELEASE}/
WORKDIR /app
COPY --from=deps /app ./
COPY packages/shared packages/shared
COPY apps/server/src apps/server/src
COPY --from=web /app/apps/web/dist apps/web/dist
USER node
EXPOSE 8080
CMD ["node", "apps/server/src/main.ts"]
