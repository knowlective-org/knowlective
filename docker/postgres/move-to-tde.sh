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
  PROJECT=yosuga-prod
else
  COMPOSE=(docker compose)
  PROJECT=yosuga
fi
OLD_VOLUME="${PROJECT}_postgres_data"
OLD_CONTAINER="${PROJECT}-move-to-tde"

die() { printf 'エラー: %s\n' "$*" >&2; exit 1; }
wait_ready() { # <command prefix...>
  for _ in $(seq 1 60); do
    "$@" pg_isready -q -U yosuga -d yosuga && return 0
    sleep 2
  done
  return 1
}

docker volume inspect "$OLD_VOLUME" >/dev/null 2>&1 || die "移行元のボリューム $OLD_VOLUME がありません。"

echo "== アプリと、移行元のデータベースを止めます"
"${COMPOSE[@]}" stop app postgres 2>/dev/null || "${COMPOSE[@]}" stop postgres
# The old container of the postgres service (still the old image) holds the
# old volume; it is replaced by the new one below.
"${COMPOSE[@]}" rm -f postgres >/dev/null

echo "== 移行元（$OLD_VOLUME）を一時的なコンテナで起動します"
docker rm -f "$OLD_CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$OLD_CONTAINER" -v "$OLD_VOLUME:/var/lib/postgresql/data" \
  -e POSTGRES_PASSWORD=unused postgres:16-alpine >/dev/null
trap 'docker rm -f "$OLD_CONTAINER" >/dev/null 2>&1 || true' EXIT
wait_ready docker exec "$OLD_CONTAINER" || die "移行元のデータベースが起動しませんでした。"

echo "== 暗号化したデータベースを起動します（初回は鍵を作ります）"
"${COMPOSE[@]}" up -d postgres
# The first start initializes the database on a temporary server, then
# restarts it: WAL encryption is on only once that's done.
for _ in $(seq 1 60); do
  [ "$("${COMPOSE[@]}" exec -T postgres psql -U yosuga -d yosuga -tAc 'SHOW pg_tde.wal_encrypt' 2>/dev/null)" = on ] && break
  sleep 2
done
wait_ready "${COMPOSE[@]}" exec -T postgres || die "暗号化したデータベースが起動しませんでした。"
tables=$("${COMPOSE[@]}" exec -T postgres psql -U yosuga -d yosuga -tAc \
  "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")
[ "$tables" = 0 ] || die "暗号化したデータベースにすでにテーブルがあります（$tables 個）。移行済みではありませんか。"

echo "== データを移します"
# Tables get the default access method (tde_heap), not the dump's "heap".
docker exec "$OLD_CONTAINER" pg_dump -U yosuga -d yosuga -Fc --no-owner |
  "${COMPOSE[@]}" exec -T postgres pg_restore -U yosuga -d yosuga --no-owner --no-table-access-method --exit-on-error

unencrypted=$("${COMPOSE[@]}" exec -T postgres psql -U yosuga -d yosuga -tAc \
  "SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND NOT pg_tde_is_encrypted(format('%I.%I', schemaname, tablename)::regclass)")
[ "$unencrypted" = 0 ] || die "暗号化されていないテーブルがあります（$unencrypted 個）。"
echo "移しました（テーブルはすべて暗号化されています）。"

echo "== アプリを起動します"
"${COMPOSE[@]}" up -d --build

cat <<EOF

完了しました。動作を確かめたら、暗号化されていない移行元のボリュームを削除してください:
  docker volume rm $OLD_VOLUME
暗号化の鍵はボリューム ${PROJECT}_postgres_tde_keys にあります。データ（${PROJECT}_postgres_tde_data）とは別に
バックアップしてください。鍵がないと、データベースを読めません。
EOF
