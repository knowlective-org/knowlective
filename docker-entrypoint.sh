#!/bin/sh
# Container entrypoint (see Dockerfile).
#   (no arguments)  apply pending database migrations, then start knowlective
#   <command>       run that instead, e.g. `pnpm admin:recover --clear-lockout`
set -e

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

if [ -z "$KNOWLECTIVE_SERVER_KEY" ]; then
  echo "KNOWLECTIVE_SERVER_KEY is not set (generate one with: openssl rand -base64 32)" >&2
  exit 1
fi

if [ "$KNOWLECTIVE_SKIP_MIGRATIONS" != "1" ]; then
  echo "> applying database migrations"
  (cd /app/packages/shared && ./node_modules/.bin/prisma migrate deploy)
fi

# The built app, with the base path (KNOWLECTIVE_BASE_PATH, possibly none) set.
node /app/docker/apply-base-path.mjs /app/apps/web/.next-template /app/apps/web/.next

cd /app/apps/web
# tsx as a loader in this process (not the tsx CLI, which runs a child
# process), so SIGTERM from `docker stop` reaches the server and open
# documents are saved before exit.
exec node --import tsx server/index.ts --prod
