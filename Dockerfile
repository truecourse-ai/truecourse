# TrueCourse server image (dashboard server + built client) — the one deployment
# artifact, for self-hosting and the hosted product alike. Deliberately
# cloud-neutral: configuration is env vars + a Postgres DATABASE_URL, no cloud
# SDK at runtime. `docker compose up --build` boots it with a database (see
# docker-compose.yml for the required env vars).

############################################
# 1. Builder — install + build the whole pnpm/turbo workspace
############################################
# Pinned to the exact patch in .node-version — bump both together. A floating
# `node:22` tag would silently drift the container off the version CI runs.
FROM node:22.23.2-bookworm-slim AS builder

# node-gyp toolchain for any dependency that compiles natively (builder-only).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# pnpm is pinned by the repo's "packageManager" field; corepack honors it.
RUN corepack enable
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app
COPY . .

# Plain RUN (no BuildKit cache mount) — ACR Tasks builds with the classic Docker
# builder, which doesn't support `--mount`, and the cache wouldn't persist between
# CI builds anyway.
RUN pnpm install --frozen-lockfile

# Build every workspace package (tsc/turbo) and the client.
RUN pnpm build

# The server serves static assets from `<server>/dist/public`
# (apps/dashboard/server/src/app.ts). Place the built client there.
RUN cp -r apps/dashboard/client/dist apps/dashboard/server/dist/public

############################################
# 2. Runtime — the built workspace + its node_modules
############################################
FROM node:22.23.2-bookworm-slim AS runtime

# git: the gate clones the repo at runtime to scan it (`spawn git` in the gate
# runner). ca-certificates: HTTPS clones. (Builder had the toolchain; runtime is
# a fresh slim image, so install what runtime actually needs.)
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3001 \
    TRUECOURSE_LOG_DIR=/data/logs

WORKDIR /app
# Copy the whole built workspace. We DON'T prune devDependencies: the analyzer's
# tree-sitter WASM grammars are declared as devDeps but are needed at runtime, so
# pruning would break `analyze`. (Image-size trimming is a later optimization.)
COPY --from=builder /app /app

# Writable data dir for logs. Durable state lives in Postgres; per-run clones
# and session transcripts go under the node user's home (~/.truecourse).
RUN mkdir -p /data/logs && chown -R node:node /data
USER node
WORKDIR /data

EXPOSE 3001

# HTTP liveness on the SPA root — no curl in the slim image, so use node.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3001)+'/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "/app/apps/dashboard/server/dist/index.js"]
