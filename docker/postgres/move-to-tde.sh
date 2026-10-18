#!/usr/bin/env bash
# Moves the bundled database from before encryption (PostgreSQL 16, volume
# <project>_postgres_data) into the encrypted one (pg_tde, volumes
# <project>_postgres_tde_data / _postgres_tde_keys). Run once, after updating
# to the compose files with pg_tde:
#
#   bash docker/postgres/move-to-tde.sh          # development (docker-compose.yml)
#   bash docker/postgres/move-to-tde.sh prod     # production (docker-compose.prod.yml + .env.production)
#
# The data goes straight from pg_dump into pg_restore: no unencrypted dump
# file is written. The old volume is left as it is; delete it once the app
# works (it is not encrypted).
set -euo pipefail
cd "$(dirname "$0")/../.."

if [ "${1-}" = prod ]; then
  COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env.production)
  PROJECT=knowlective-prod
else
  COMPOSE=(docker compose)
  PROJECT=knowlective
fi
OLD_VOLUME="${PROJECT}_postgres_data"
OLD_CONTAINER="${PROJECT}-move-to-tde"

die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
wait_ready() { # <command prefix...>
  for _ in $(seq 1 60); do
    "$@" pg_isready -q -U knowlective -d knowlective && return 0
    sleep 2
  done
  return 1
}

docker volume inspect "$OLD_VOLUME" >/dev/null 2>&1 || die "The source volume $OLD_VOLUME doesn't exist."

echo "== Stopping the app and the source database"
"${COMPOSE[@]}" stop app postgres 2>/dev/null || "${COMPOSE[@]}" stop postgres
# The old container of the postgres service (still the old image) holds the
# old volume; it is replaced by the new one below.
"${COMPOSE[@]}" rm -f postgres >/dev/null

echo "== Starting the source ($OLD_VOLUME) in a temporary container"
docker rm -f "$OLD_CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$OLD_CONTAINER" -v "$OLD_VOLUME:/var/lib/postgresql/data" \
  -e POSTGRES_PASSWORD=unused postgres:16-alpine >/dev/null
trap 'docker rm -f "$OLD_CONTAINER" >/dev/null 2>&1 || true' EXIT
wait_ready docker exec "$OLD_CONTAINER" || die "The source database didn't start."

echo "== Starting the encrypted database (makes its keys the first time)"
"${COMPOSE[@]}" up -d postgres
# The first start initializes the database on a temporary server, then
# restarts it: WAL encryption is on only once that's done.
for _ in $(seq 1 60); do
  [ "$("${COMPOSE[@]}" exec -T postgres psql -U knowlective -d knowlective -tAc 'SHOW pg_tde.wal_encrypt' 2>/dev/null)" = on ] && break
  sleep 2
done
wait_ready "${COMPOSE[@]}" exec -T postgres || die "The encrypted database didn't start."
tables=$("${COMPOSE[@]}" exec -T postgres psql -U knowlective -d knowlective -tAc \
  "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")
[ "$tables" = 0 ] || die "The encrypted database already has tables ($tables). Has it been moved already?"

echo "== Moving the data"
# Tables get the default access method (tde_heap), not the dump's "heap".
docker exec "$OLD_CONTAINER" pg_dump -U knowlective -d knowlective -Fc --no-owner |
  "${COMPOSE[@]}" exec -T postgres pg_restore -U knowlective -d knowlective --no-owner --no-table-access-method --exit-on-error

unencrypted=$("${COMPOSE[@]}" exec -T postgres psql -U knowlective -d knowlective -tAc \
  "SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND NOT pg_tde_is_encrypted(format('%I.%I', schemaname, tablename)::regclass)")
[ "$unencrypted" = 0 ] || die "Some tables aren't encrypted ($unencrypted)."
echo "Moved (every table is encrypted)."

echo "== Starting the app"
"${COMPOSE[@]}" up -d --build

cat <<EOF

Done. Once the app works, delete the source volume (it isn't encrypted):
  docker volume rm $OLD_VOLUME
The encryption keys are in the volume ${PROJECT}_postgres_tde_keys. Back it up separately
from the data (${PROJECT}_postgres_tde_data): without the keys, the database can't be read.
EOF
