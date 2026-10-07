# Production image: one container runs the Next.js app and the collaboration
# WebSocket (/collab) on one port, like `pnpm start`. See README「本番での起動」.
#
#   docker build -t yosuga .

FROM node:24-bookworm-slim AS base
# openssl: Prisma's schema engine (used by `prisma migrate deploy`).
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@12.9.1
# Dependencies are installed at build time only. Without this, `pnpm <script>`
# (e.g. admin:recover in the container) first tries to reinstall them.
ENV pnpm_config_verify_deps_before_run=false
WORKDIR /app
# prisma.config.ts requires DATABASE_URL to be set even for commands that
# don't connect (generate). The real value comes from the container's env.
ENV DATABASE_URL="postgresql://unused:unused@localhost:5432/unused"

# ---- Build: all dependencies, Prisma client, `next build` --------------------
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm db:generate \
  && pnpm --filter web build \
  && rm -rf apps/web/.next/cache

# ---- Runtime: production dependencies only ----------------------------------
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
# The store and cache are only needed while installing (node_modules
# hard-links to the store).
RUN pnpm install --frozen-lockfile --prod \
  && rm -rf "$(pnpm store path)" /root/.cache/pnpm
# packages/shared is used as TypeScript source (by the app via tsx, and by
# the migrate / recovery commands).
COPY packages/shared/prisma packages/shared/prisma
COPY packages/shared/prisma.config.ts packages/shared/tsconfig.json packages/shared/
COPY packages/shared/src packages/shared/src
COPY packages/shared/scripts packages/shared/scripts
RUN pnpm db:generate
COPY apps/web/server apps/web/server
COPY apps/web/src apps/web/src
COPY apps/web/public apps/web/public
COPY apps/web/next.config.ts apps/web/tsconfig.json apps/web/
# Owned by the app user: Next.js writes its cache under .next at runtime.
COPY --from=build --chown=node:node /app/apps/web/.next apps/web/.next
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["docker-entrypoint.sh"]
