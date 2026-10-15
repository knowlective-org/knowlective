#!/usr/bin/env bash
# Starts Percona Server for PostgreSQL with pg_tde (transparent data
# encryption) loaded. Runs as root only to prepare the key directory — a
# volume of its own, apart from the data — then hands over to the image's
# entrypoint, which drops to the postgres user.
set -euo pipefail

mkdir -p /tde
chown postgres:postgres /tde
chmod 700 /tde

exec /entrypoint.sh postgres -c shared_preload_libraries=pg_tde "$@"
