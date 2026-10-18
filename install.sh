#!/usr/bin/env bash
# Installs knowlective (production Docker Compose). Asks for the settings,
# writes .env.production and, if wanted, starts it.
#
#   ./install.sh
#
# Run again to remake it with the current .env.production values as defaults
# (the old file is kept as .env.production.bak.<timestamp>).
set -euo pipefail

cd "$(dirname "$0")"
ENV_FILE=".env.production"
COMPOSE_FILE_NAME="docker-compose.prod.yml"
# The bundled database's image (pg_tde); its psql also checks an external one.
PG_IMAGE="percona/percona-distribution-postgresql:17.11"

# ---- Output and input --------------------------------------------------------

if [ -t 1 ]; then
  BOLD=$'\e[1m'; DIM=$'\e[2m'; RED=$'\e[31m'; YELLOW=$'\e[33m'; GREEN=$'\e[32m'; RESET=$'\e[0m'
else
  BOLD=""; DIM=""; RED=""; YELLOW=""; GREEN=""; RESET=""
fi

section() { printf '\n%s== %s ==%s\n' "$BOLD" "$1" "$RESET"; }
info()    { printf '%s\n' "$*"; }
note()    { printf '%s%s%s\n' "$DIM" "$*" "$RESET"; }
warn()    { printf '%sWarning: %s%s\n' "$YELLOW" "$*" "$RESET" >&2; }
die()     { printf '%sError: %s%s\n' "$RED" "$*" "$RESET" >&2; exit 1; }

# ask <variable> <question> [default]
ask() {
  local __var=$1 __prompt=$2 __default=${3-} __answer
  if [ -n "$__default" ]; then
    read -r -p "$__prompt [$__default]: " __answer || exit 1
    __answer=${__answer:-$__default}
  else
    read -r -p "$__prompt: " __answer || exit 1
  fi
  printf -v "$__var" '%s' "$__answer"
}

# ask_secret <variable> <question> (input hidden; can't be empty)
ask_secret() {
  local __var=$1 __prompt=$2 __answer
  while :; do
    read -r -s -p "$__prompt: " __answer || exit 1
    echo
    [ -n "$__answer" ] && break
    info "Please enter a value."
  done
  printf -v "$__var" '%s' "$__answer"
}

# ask_yes_no <question> <y|n> (default) → 0 for yes
ask_yes_no() {
  local __prompt=$1 __default=$2 __answer __hint
  [ "$__default" = y ] && __hint="Y/n" || __hint="y/N"
  while :; do
    read -r -p "$__prompt [$__hint]: " __answer || exit 1
    __answer=${__answer:-$__default}
    case "$__answer" in
      [yY]*) return 0 ;;
      [nN]*) return 1 ;;
    esac
  done
}

# ask_choice <variable> <default number> <choice 1> <choice 2> ... → number
ask_choice() {
  local __var=$1 __default=$2 __answer i
  shift 2
  for i in $(seq 1 $#); do
    info "  $i) ${!i}"
  done
  while :; do
    read -r -p "Choose a number [$__default]: " __answer || exit 1
    __answer=${__answer:-$__default}
    if [[ "$__answer" =~ ^[0-9]+$ ]] && [ "$__answer" -ge 1 ] && [ "$__answer" -le $# ]; then
      break
    fi
  done
  printf -v "$__var" '%s' "$__answer"
}

# ---- Generating and checking values ------------------------------------------

rand_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$1"
  else
    head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

rand_base64_32() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32
  else
    head -c 32 /dev/urandom | base64
  fi
}

# KNOWLECTIVE_SERVER_KEY's format (32 bytes in base64)
valid_server_key() {
  [[ "$1" =~ ^[A-Za-z0-9+/]+=*$ ]] || return 1
  [ "$(printf '%s' "$1" | base64 --decode 2>/dev/null | wc -c | tr -d ' ')" = 32 ]
}

valid_port() {
  [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -ge 1 ] && [ "$1" -le 65535 ]
}

# Percent-encoding for a connection URL
urlencode() {
  local LC_ALL=C s=$1 out="" c i
  for ((i = 0; i < ${#s}; i++)); do
    c=${s:i:1}
    case "$c" in
      [A-Za-z0-9._~-]) out+=$c ;;
      *) out+=$(printf '%%%02X' "'$c") ;;
    esac
  done
  printf '%s' "$out"
}

# A value from .env.production (without its single quotes)
existing() {
  [ -f "$ENV_FILE" ] || return 0
  local line
  line=$(grep -E "^$1=" "$ENV_FILE" | tail -n 1) || return 0
  line=${line#*=}
  line=${line#\'}; line=${line%\'}
  line=${line#\"}; line=${line%\"}
  printf '%s' "$line"
}

# Only the start of a secret is shown
mask() { printf '%s… (%d characters)' "${1:0:4}" "${#1}"; }

# A connection URL without its password (user@host:port/db?...)
display_url() { printf '%s' "$1" | sed -E 's#^[a-z]+://##; s#^([^:@]*):[^@]*@#\1@#'; }

# ---- Checks first ------------------------------------------------------------

[ -f "$COMPOSE_FILE_NAME" ] || die "$COMPOSE_FILE_NAME not found. Run this in the knowlective directory."
command -v docker >/dev/null 2>&1 || die "docker not found. Install Docker Engine (or Docker Desktop)."
docker compose version >/dev/null 2>&1 || die "docker compose (v2) isn't available. Install the Docker Compose plugin."
docker info >/dev/null 2>&1 || die "Can't connect to Docker. Check that Docker is running and that this user can run docker."

info "${BOLD}Installing knowlective${RESET}"
info "Answer the questions to create $ENV_FILE. Values in [ ] are defaults: press Enter to use them."

if [ -f "$ENV_FILE" ]; then
  section "Existing settings"
  info "$ENV_FILE already exists. It will be remade with its current values as defaults (the old file is kept)."
  ask_yes_no "Continue" y || { info "Cancelled."; exit 0; }
fi

# ---- Database ----------------------------------------------------------------

section "Database (PostgreSQL)"
info "Which PostgreSQL should be used?"
default_db=1
[ -n "$(existing DATABASE_URL)" ] && default_db=2
ask_choice DB_CHOICE "$default_db" \
  "The bundled PostgreSQL (runs in a container on this server)" \
  "A PostgreSQL of your own (16 or later recommended)"

DATABASE_URL=""
POSTGRES_PASSWORD=""
COMPOSE_PROFILES=""

if [ "$DB_CHOICE" = 1 ]; then
  COMPOSE_PROFILES="bundled-db"
  POSTGRES_PASSWORD=$(existing POSTGRES_PASSWORD)
  if [ -n "$POSTGRES_PASSWORD" ]; then
    note "Keeping the current password (changing it has no effect on a database already initialized)."
  else
    POSTGRES_PASSWORD=$(rand_hex 32)
    note "Generated a password."
    if docker volume inspect knowlective-prod_postgres_tde_data >/dev/null 2>&1; then
      warn "Data of the bundled PostgreSQL already exists (volume knowlective-prod_postgres_tde_data)."
      warn "The new password won't connect to it. Restore your previous $ENV_FILE, or delete the volume if it's not needed."
      ask_yes_no "Continue anyway" n || { info "Cancelled."; exit 1; }
    fi
  fi
  # Data from before the bundled database was encrypted (pg_tde).
  if docker volume inspect knowlective-prod_postgres_data >/dev/null 2>&1 &&
    ! docker volume inspect knowlective-prod_postgres_tde_data >/dev/null 2>&1; then
    warn "There is data of the bundled PostgreSQL from before encryption (volume knowlective-prod_postgres_data)."
    warn "It has to be moved into the encrypted database. After $ENV_FILE is written, don't start the app; run"
    warn "  bash docker/postgres/move-to-tde.sh prod"
    warn "instead (it moves the data, then starts the app). Starting without moving it begins with an empty database."
    ask_yes_no "Continue anyway" y || { info "Cancelled."; exit 1; }
  fi
elif [ -n "$(existing DATABASE_URL)" ] &&
  ask_yes_no "Keep the current connection ($(display_url "$(existing DATABASE_URL)"))" y; then
  DATABASE_URL=$(existing DATABASE_URL)
else
  info "Enter the connection. Create the database and user beforehand, and let the user create tables."
  info "(Migrations create the tables at startup.)"
  while :; do
    while :; do
      ask DB_HOST "Host name or IP address"
      case "$DB_HOST" in
        "") info "Please enter a value." ;;
        localhost|127.0.0.1|::1)
          warn "Inside a container, localhost is the container itself. For a PostgreSQL running on this server,"
          warn "use the server's IP address (host.docker.internal on Docker Desktop)."
          ask_yes_no "Keep $DB_HOST" n && break ;;
        *) break ;;
      esac
    done
    while :; do
      ask DB_PORT "Port" 5432
      valid_port "$DB_PORT" && break
      info "Enter a number from 1 to 65535."
    done
    ask DB_NAME "Database name" knowlective
    ask DB_USER "User name" knowlective
    ask_secret DB_PASSWORD "Password (input hidden)"
    info "Connect over SSL?"
    ask_choice DB_SSL 1 "No (e.g. within the same network)" "Yes (sslmode=require)"

    DATABASE_URL="postgresql://$(urlencode "$DB_USER"):$(urlencode "$DB_PASSWORD")@${DB_HOST}:${DB_PORT}/$(urlencode "$DB_NAME")"
    [ "$DB_SSL" = 2 ] && DATABASE_URL+="?sslmode=require"

    if ask_yes_no "Test the connection (from a $PG_IMAGE container)" y; then
      info "Connecting…"
      if version=$(docker run --rm -e PGCONNECT_TIMEOUT=10 "$PG_IMAGE" \
          psql "$DATABASE_URL" -tA -c "SHOW server_version" 2>&1); then
        info "${GREEN}Connected (PostgreSQL ${version%%$'\n'*}).${RESET}"
        break
      fi
      warn "Couldn't connect:"
      printf '%s\n' "$version" | tail -n 3 >&2
      ask_yes_no "Enter it again" y && continue
      ask_yes_no "Continue anyway" n || { info "Cancelled."; exit 1; }
    fi
    break
  done
fi

# ---- Semantic search ---------------------------------------------------------

section "Semantic search"
info "Finds pages close in meaning, even without the same words. Queries and page text are processed on this server and never sent out."
info "Uses the bundled vector database and a ~130MB model in the image (a few hundred MB more memory)."
default_vector=y
[ -f "$ENV_FILE" ] && [ -z "$(existing VECTORDB_PASSWORD)" ] && default_vector=n
VECTORDB_PASSWORD=""
if ask_yes_no "Use semantic search" "$default_vector"; then
  VECTORDB_PASSWORD=$(existing VECTORDB_PASSWORD)
  [ -n "$VECTORDB_PASSWORD" ] || VECTORDB_PASSWORD=$(rand_hex 32)
  COMPOSE_PROFILES="${COMPOSE_PROFILES:+$COMPOSE_PROFILES,}bundled-vectordb"
fi

# ---- Server key --------------------------------------------------------------

section "Server key (KNOWLECTIVE_SERVER_KEY)"
info "The key that unlocks the data encryption key. If both this and the master password are lost, the data can't be recovered."
KNOWLECTIVE_SERVER_KEY=$(existing KNOWLECTIVE_SERVER_KEY)
if [ -n "$KNOWLECTIVE_SERVER_KEY" ] && valid_server_key "$KNOWLECTIVE_SERVER_KEY"; then
  note "Keeping the current key (changing it would make the data unreadable; rotate it with pnpm rotate-server-key)."
else
  ask_choice KEY_CHOICE 1 "Generate a new one (new installation)" "Enter an existing key (moving or restoring)"
  if [ "$KEY_CHOICE" = 1 ]; then
    KNOWLECTIVE_SERVER_KEY=$(rand_base64_32)
    note "Generated a key."
  else
    while :; do
      ask_secret KNOWLECTIVE_SERVER_KEY "Server key (input hidden)"
      valid_server_key "$KNOWLECTIVE_SERVER_KEY" && break
      info "Wrong format (32 bytes in base64, e.g. the output of openssl rand -base64 32)."
    done
  fi
fi

# ---- File storage ------------------------------------------------------------

# The bundled SeaweedFS's credentials: nobody needs to choose them, so they're generated.
SEAWEEDFS_ACCESS_KEY=$(existing SEAWEEDFS_ACCESS_KEY)
SEAWEEDFS_SECRET_KEY=$(existing SEAWEEDFS_SECRET_KEY)
[ -n "$SEAWEEDFS_ACCESS_KEY" ] || SEAWEEDFS_ACCESS_KEY=$(rand_hex 16)
[ -n "$SEAWEEDFS_SECRET_KEY" ] || SEAWEEDFS_SECRET_KEY=$(rand_hex 32)

# ---- Serving -----------------------------------------------------------------

section "Network"
info "The app listens on a port of 127.0.0.1. Serve it to others through a reverse proxy (Caddy, nginx, etc.)."
default_port=$(existing KNOWLECTIVE_PORT); default_port=${default_port:-3000}
while :; do
  ask KNOWLECTIVE_PORT "Port to listen on" "$default_port"
  valid_port "$KNOWLECTIVE_PORT" && break
  info "Enter a number from 1 to 65535."
done
default_hops=$(existing KNOWLECTIVE_TRUSTED_PROXY_HOPS); default_hops=${default_hops:-1}
while :; do
  ask KNOWLECTIVE_TRUSTED_PROXY_HOPS "Number of reverse proxies in front of the app (2 for CDN → nginx)" "$default_hops"
  [[ "$KNOWLECTIVE_TRUSTED_PROXY_HOPS" =~ ^[1-9][0-9]*$ ]] && break
  info "Enter a number of 1 or more."
done
# Sub-path (may be empty). The previous value is the default; - removes it.
default_base=$(existing KNOWLECTIVE_BASE_PATH)
info "If the reverse proxy serves the app under a sub-path, like https://example.com/knowlective/, enter that path (e.g. /knowlective)."
info "If it's served at the root (https://knowlective.example.com/), just press Enter."
while :; do
  if [ -n "$default_base" ]; then
    ask KNOWLECTIVE_BASE_PATH "Sub-path (- for none)" "$default_base"
    [ "$KNOWLECTIVE_BASE_PATH" = "-" ] && KNOWLECTIVE_BASE_PATH=""
  else
    ask KNOWLECTIVE_BASE_PATH "Sub-path (empty for none)"
  fi
  KNOWLECTIVE_BASE_PATH=${KNOWLECTIVE_BASE_PATH%/}
  [ -z "$KNOWLECTIVE_BASE_PATH" ] && break
  [[ "$KNOWLECTIVE_BASE_PATH" =~ ^(/[A-Za-z0-9._~-]+)+$ ]] && break
  info "Enter an alphanumeric path starting with / (e.g. /knowlective, /tools/knowlective)."
done

section "Other"
default_tz=$(existing TZ); default_tz=${default_tz:-Asia/Tokyo}
while :; do
  ask TZ_VALUE "Time zone (for dates in the admin console)" "$default_tz"
  [[ "$TZ_VALUE" =~ ^[A-Za-z0-9_+/-]+$ ]] && break
  info "Enter it like Asia/Tokyo."
done
info "If you serve a modified knowlective, enter the URL of the modified source code (AGPL-3.0)."
url_pattern='^https?://[^[:space:]'"'"'"]+$'
while :; do
  ask KNOWLECTIVE_SOURCE_URL "Source code URL (empty for the official repository)" "$(existing KNOWLECTIVE_SOURCE_URL)"
  if [ -z "$KNOWLECTIVE_SOURCE_URL" ] || [[ "$KNOWLECTIVE_SOURCE_URL" =~ $url_pattern ]]; then break; fi
  info "Enter a URL starting with http:// or https://."
done

# ---- Review and write --------------------------------------------------------

section "Review"
if [ "$DB_CHOICE" = 1 ]; then
  info "Database        : bundled PostgreSQL (password $(mask "$POSTGRES_PASSWORD"))"
else
  info "Database        : $(display_url "$DATABASE_URL")"
fi
info "Semantic search : $([ -n "$VECTORDB_PASSWORD" ] && echo "on (bundled vector database)" || echo "off")"
info "Server key      : $(mask "$KNOWLECTIVE_SERVER_KEY")"
info "File storage    : bundled SeaweedFS (credentials generated; set an external S3 in the admin console)"
info "Port            : 127.0.0.1:${KNOWLECTIVE_PORT}"
info "Proxy hops      : ${KNOWLECTIVE_TRUSTED_PROXY_HOPS}"
info "Sub-path        : ${KNOWLECTIVE_BASE_PATH:-(none; served at the root)}"
info "Time zone       : ${TZ_VALUE}"
info "Source code URL : ${KNOWLECTIVE_SOURCE_URL:-(the official repository)}"
echo
ask_yes_no "Write $ENV_FILE with these values" y || { info "Cancelled (nothing written)."; exit 0; }

if [ -f "$ENV_FILE" ]; then
  backup="$ENV_FILE.bak.$(date +%Y%m%d%H%M%S)"
  cp -p "$ENV_FILE" "$backup"
  chmod 600 "$backup" 2>/dev/null || true
  note "Kept the old file as $backup."
fi

(
  umask 077
  {
    echo "# knowlective production settings (written by install.sh: $(date '+%Y-%m-%d %H:%M:%S'))"
    echo "# docker compose -f $COMPOSE_FILE_NAME --env-file $ENV_FILE up -d --build"
    echo "# Contains secrets. Don't share or commit it; back it up somewhere safe."
    echo
    if [ -n "$COMPOSE_PROFILES" ]; then
      echo "# Bundled services to run (bundled-db: PostgreSQL, bundled-vectordb: the semantic search database)"
      echo "COMPOSE_PROFILES='$COMPOSE_PROFILES'"
    fi
    if [ "$DB_CHOICE" = 1 ]; then
      echo "# The bundled PostgreSQL"
      echo "POSTGRES_PASSWORD='$POSTGRES_PASSWORD'"
    else
      echo "# A PostgreSQL of your own"
      echo "DATABASE_URL='$DATABASE_URL'"
    fi
    if [ -n "$VECTORDB_PASSWORD" ]; then
      echo "# Semantic search (the bundled vector database)"
      echo "VECTORDB_PASSWORD='$VECTORDB_PASSWORD'"
    fi
    echo
    echo "KNOWLECTIVE_SERVER_KEY='$KNOWLECTIVE_SERVER_KEY'"
    echo "SEAWEEDFS_ACCESS_KEY='$SEAWEEDFS_ACCESS_KEY'"
    echo "SEAWEEDFS_SECRET_KEY='$SEAWEEDFS_SECRET_KEY'"
    echo
    echo "KNOWLECTIVE_PORT='$KNOWLECTIVE_PORT'"
    echo "KNOWLECTIVE_TRUSTED_PROXY_HOPS='$KNOWLECTIVE_TRUSTED_PROXY_HOPS'"
    if [ -n "$KNOWLECTIVE_BASE_PATH" ]; then
      echo "KNOWLECTIVE_BASE_PATH='$KNOWLECTIVE_BASE_PATH'"
    fi
    echo "TZ='$TZ_VALUE'"
    if [ -n "$KNOWLECTIVE_SOURCE_URL" ]; then
      echo "KNOWLECTIVE_SOURCE_URL='$KNOWLECTIVE_SOURCE_URL'"
    fi
  } > "$ENV_FILE"
)
chmod 600 "$ENV_FILE" 2>/dev/null || true
info "${GREEN}Wrote $ENV_FILE.${RESET}"
warn "Back up $ENV_FILE (KNOWLECTIVE_SERVER_KEY above all) somewhere safe."

# ---- Start -------------------------------------------------------------------

COMPOSE=(docker compose -f "$COMPOSE_FILE_NAME" --env-file "$ENV_FILE")

section "Start"
if ! ask_yes_no "Build the image and start (takes a few minutes the first time)" y; then
  info "Start it later with:"
  info "  ${COMPOSE[*]} up -d --build"
  exit 0
fi

"${COMPOSE[@]}" up -d --build

info "Waiting for it to start (including database migrations)…"
app_id=$("${COMPOSE[@]}" ps -q app)
status=""
for _ in $(seq 1 60); do
  status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$app_id" 2>/dev/null || echo unknown)
  case "$status" in
    healthy) break ;;
    exited|dead) break ;;
  esac
  sleep 5
done

if [ "$status" != healthy ]; then
  warn "Couldn't confirm it started (status: $status). Check the logs:"
  "${COMPOSE[@]}" logs --tail 40 app >&2 || true
  exit 1
fi

section "Done"
info "${GREEN}knowlective is running (127.0.0.1:${KNOWLECTIVE_PORT}).${RESET}"
info "Next steps:"
info "  1. Have the reverse proxy forward your public domain to 127.0.0.1:${KNOWLECTIVE_PORT}"
info "     (pass the /collab WebSocket too, and send X-Forwarded-For and X-Forwarded-Proto)"
info "  2. Open https://<your domain>/ and do the first-time setup (set the master password)"
info "  3. Back up $ENV_FILE"
if [ "$DB_CHOICE" = 1 ]; then
  info "  4. Back up the database encryption keys (volume knowlective-prod_postgres_tde_keys) separately from the data"
  info "     (without them the database can't be read)"
fi
info "Logs: ${COMPOSE[*]} logs -f app"
