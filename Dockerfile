# TrueCourse server image (dashboard server + EE plugin + built client).
# Runs on Azure Container Apps. Deliberately cloud-neutral — env vars + a Postgres
# DATABASE_URL, no cloud SDK at runtime — so it stays portable for later. Boot it
# locally with `docker compose up --build`.

############################################
# 1. Builder — install + build the whole pnpm/turbo workspace (incl. ee/)
############################################
FROM node:20-bookworm-slim AS builder

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

# Build every workspace package (tsc/turbo) AND the client with the EE overlay.
# VITE_TC_EE=true is REQUIRED — a production client build excludes @truecourse/ee-client
# unless this is set (apps/dashboard/client/vite.config.ts). Builder cache is cold,
# so turbo runs the client build with this env honored.
ENV VITE_TC_EE=true
RUN pnpm build

# The server serves static assets from `<server>/dist/public`
# (apps/dashboard/server/src/app.ts). Place the built client there.
RUN cp -r apps/dashboard/client/dist apps/dashboard/server/dist/public

############################################
# 2. Runtime — the built workspace + its node_modules
############################################
FROM node:20-bookworm-slim AS runtime

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

# Writable data dir: community-mode file store (./.truecourse) + logs land here.
# EE mode stores everything in Postgres and never writes it.
RUN mkdir -p /data/logs && chown -R node:node /data
USER node
WORKDIR /data

EXPOSE 3001

# HTTP liveness on the SPA root — no curl in the slim image, so use node.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3001)+'/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "/app/apps/dashboard/server/dist/index.js"]
