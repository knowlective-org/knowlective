#!/bin/sh
# Container entrypoint (see Dockerfile).
#   (no arguments)  apply pending database migrations, then start knowlective
#   <command>       run that instead, e.g. `pnpm admin:recover --clear-lockout`
set -e

# The bundled databases' URLs, when none is given (docker-compose.prod.yml
# passes the parts: a variable inside another's default isn't read alike by
# every compose, podman-compose among them). The password is URL-encoded.
urlencode() { node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"; }
if [ -z "$DATABASE_URL" ]; then
  if [ -z "$POSTGRES_PASSWORD" ]; then
    echo "Set DATABASE_URL, or POSTGRES_PASSWORD for the bundled database" >&2
    exit 1
  fi
  DATABASE_URL="postgresql://knowlective:$(urlencode "$POSTGRES_PASSWORD")@postgres:5432/knowlective"
  export DATABASE_URL
fi
if [ -z "$VECTOR_DATABASE_URL" ] && [ -n "$VECTORDB_PASSWORD" ]; then
  VECTOR_DATABASE_URL="postgresql://knowlective:$(urlencode "$VECTORDB_PASSWORD")@vectordb:5432/knowlective_vectors"
  export VECTOR_DATABASE_URL
fi

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

if [ -z "$KNOWLECTIVE_SERVER_KEY" ]; then
  echo "KNOWLECTIVE_SERVER_KEY is not set (generate one with: openssl rand -base64 32)" >&2
  exit 1
fi

if [ "$KNOWLECTIVE_SKIP_MIGRATIONS" != "1" ]; then
  echo "> applying database migrations"
  # The database may still be starting (compose doesn't wait for it: the
  # bundled one is optional): tried again for about 90 seconds.
  tries=0
  until (cd /app/packages/shared && ./node_modules/.bin/prisma migrate deploy); do
    tries=$((tries + 1))
    if [ "$tries" -ge 30 ]; then
      echo "> the database migrations failed" >&2
      exit 1
    fi
    echo "> the database isn't ready yet, trying again in 3s ($tries/30)"
    sleep 3
  done
fi

# The built app, with the base path (KNOWLECTIVE_BASE_PATH, possibly none) set.
node /app/docker/apply-base-path.mjs /app/apps/web/.next-template /app/apps/web/.next

cd /app/apps/web
# tsx as a loader in this process (not the tsx CLI, which runs a child
# process), so SIGTERM from `docker stop` reaches the server and open
# documents are saved before exit.
exec node --import tsx server/index.ts --prod
