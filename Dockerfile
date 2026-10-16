# syntax=docker/dockerfile:1
#
# expenses.amberxai.com — the Expense Tracker PEELED out of the studio.
#
# Build context is the peeled app directory, which `deploy/expenses/build.sh`
# regenerates (`npm run peel expenses --with accounts`) and overlays before
# every build:
#
#     docker build -f packages/studio/deploy/expenses/Dockerfile \
#         -t amberx-expenses:latest peeled/expenses
#
# The peeled app vendors @axf/core (vendor/axf-core) and resolves nothing from
# the SDK tree, so unlike the studio image this context is self-contained.
# It runs `next start` over the full tree rather than a standalone trace: the
# plugin engine reads `src/plugins/` and `scripts/lib/*.mjs` at runtime, and a
# trace would have to be told about each — the studio pays that cost with a
# generated COPY list; this app is small enough not to.

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Manifests plus the vendored framework (a `file:` dependency) first, so a
# source edit does not re-run the install.
COPY package.json package-lock.json* ./
COPY vendor ./vendor
RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
COPY . .
RUN npx next build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3200 \
    HOSTNAME=0.0.0.0 \
    AXS_DATA_ROOT=/data \
    AXF_ROOT=/app \
    AXF_ASSETS_ROOT=/app/assets
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs && \
    mkdir -p /home/nextjs && chown nextjs:nodejs /home/nextjs
# The assistant (src/server/ai): git for its patch workspace, ripgrep for
# Claude Code's search, and Claude Code's CLI for the subscription backend.
RUN apt-get update && apt-get install -y --no-install-recommends git ripgrep ca-certificates && rm -rf /var/lib/apt/lists/* \
    && npm i -g @anthropic-ai/claude-code && npm cache clean --force
COPY --from=build --chown=nextjs:nodejs /app /app
# The assistant's codebase knowledge: a source snapshot (no build output) it
# reads in Chat mode and copies into a per-user workspace in Edit/Build modes.
ARG SOURCE_VERSION=dev
ENV SOURCE_DIR=/app/source
RUN mkdir -p /app/source && cd /app && \
    for p in app src vendor proxy.ts package.json package-lock.json tsconfig.json next.config.ts next-env.d.ts README.md Dockerfile docker-compose.yml .dockerignore .github scripts; do \
      [ -e "$p" ] && cp -r "$p" /app/source/ || true; \
    done && \
    rm -rf /app/source/vendor/axf-core/node_modules && \
    echo "$SOURCE_VERSION" > /app/source/.source-version
RUN mkdir -p /data /app/assets && chown -R nextjs:nodejs /data /app
VOLUME ["/data"]
USER nextjs
EXPOSE 3200
CMD ["node", "node_modules/next/dist/bin/next", "start", "--port", "3200"]
