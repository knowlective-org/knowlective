#!/usr/bin/env bash
# Installs knowlective (production Docker Compose). Asks for the settings,
# writes .env.production and, if wanted, starts it. Works with Docker (Compose
# v2) or Podman (`podman compose`, see docker/engine.sh).
#
#   ./install.sh
#   KNOWLECTIVE_ENGINE=podman ./install.sh    # Podman even if Docker is there
#
# Run again to remake it with the current .env.production values as defaults
# (the old file is kept as .env.production.bak.<timestamp>).
set -euo pipefail

cd "$(dirname "$0")"
ENV_FILE=".env.production"
COMPOSE_FILE_NAME="docker-compose.prod.yml"
# The bundled database's image (pg_tde); its psql also checks an external one.
# Fully qualified: Podman asks which registry a short name means.
PG_IMAGE="docker.io/percona/percona-distribution-postgresql:17.11"

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

# An IPv4 address, or an IPv6 one in brackets ([::], [fd00::5]).
valid_bind() {
  [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || [[ "$1" =~ ^\[[0-9A-Fa-f:.]+\]$ ]]
}

# Where this server reaches the app: the bind address, or loopback for "every address".
local_host() {
  case "$1" in
    0.0.0.0) echo 127.0.0.1 ;;
    "[::]") echo "[::1]" ;;
    *) echo "$1" ;;
  esac
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
# shellcheck source=docker/engine.sh
. docker/engine.sh
select_engine

info "${BOLD}Installing knowlective${RESET} (with $ENGINE)"
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
    if "$ENGINE" volume inspect knowlective-prod_postgres_tde_data >/dev/null 2>&1; then
      warn "Data of the bundled PostgreSQL already exists (volume knowlective-prod_postgres_tde_data)."
      warn "The new password won't connect to it. Restore your previous $ENV_FILE, or delete the volume if it's not needed."
      ask_yes_no "Continue anyway" n || { info "Cancelled."; exit 1; }
    fi
  fi
  # Data from before the bundled database was encrypted (pg_tde).
  if "$ENGINE" volume inspect knowlective-prod_postgres_data >/dev/null 2>&1 &&
    ! "$ENGINE" volume inspect knowlective-prod_postgres_tde_data >/dev/null 2>&1; then
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
          if [ "$ENGINE" = podman ]; then
            warn "use the server's IP address (or host.containers.internal)."
          else
            warn "use the server's IP address (host.docker.internal on Docker Desktop)."
          fi
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
      if version=$("$ENGINE" run --rm -e PGCONNECT_TIMEOUT=10 "$PG_IMAGE" \
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

section "File storage (attachments)"
info "Where attached files are kept (encrypted by the app either way)."
# The bundled one unless the current settings are without it. Settings from
# before this question (keys, but no bundled-storage profile) used it too.
default_storage=1
[ -f "$ENV_FILE" ] && [ -z "$(existing SEAWEEDFS_ACCESS_KEY)" ] && default_storage=2
ask_choice STORAGE_CHOICE "$default_storage" \
  "The bundled SeaweedFS (runs in a container on this server)" \
  "An S3-compatible storage of your own (AWS S3, Cloudflare R2, MinIO, …; set in the admin console)"
SEAWEEDFS_ACCESS_KEY=""
SEAWEEDFS_SECRET_KEY=""
if [ "$STORAGE_CHOICE" = 1 ]; then
  COMPOSE_PROFILES="${COMPOSE_PROFILES:+$COMPOSE_PROFILES,}bundled-storage"
  # Its credentials: nobody needs to choose them, so they're generated.
  SEAWEEDFS_ACCESS_KEY=$(existing SEAWEEDFS_ACCESS_KEY)
  SEAWEEDFS_SECRET_KEY=$(existing SEAWEEDFS_SECRET_KEY)
  [ -n "$SEAWEEDFS_ACCESS_KEY" ] || SEAWEEDFS_ACCESS_KEY=$(rand_hex 16)
  [ -n "$SEAWEEDFS_SECRET_KEY" ] || SEAWEEDFS_SECRET_KEY=$(rand_hex 32)
else
  note "After the first-time setup, set it under Files → File storage in the admin console. Until then, files can't be attached."
  if [ -n "$(existing SEAWEEDFS_ACCESS_KEY)" ]; then
    warn "The bundled storage won't run any more. Files kept in it are unreachable unless the admin console"
    warn "already points to your own storage with those files copied over (README: moving file storage)."
    ask_yes_no "Continue" n || { info "Cancelled."; exit 1; }
  fi
fi

# ---- Serving -----------------------------------------------------------------

section "Network"
info "Serve the app to others through a reverse proxy (Caddy, nginx, etc.)."
info "Keep 127.0.0.1 when the proxy runs on this server. If it's on another machine, enter this server's address"
info "the proxy connects to (e.g. 10.0.0.5; 0.0.0.0 = every address; IPv6 in brackets, e.g. [::])."
default_bind=$(existing KNOWLECTIVE_BIND); default_bind=${default_bind:-127.0.0.1}
while :; do
  ask KNOWLECTIVE_BIND "Address to listen on" "$default_bind"
  if ! valid_bind "$KNOWLECTIVE_BIND"; then
    info "Enter an IPv4 address (e.g. 127.0.0.1), or an IPv6 one in brackets (e.g. [::1])."
    continue
  fi
  [ "$KNOWLECTIVE_BIND" = 127.0.0.1 ] && break
  warn "Let only the reverse proxy reach this port (a firewall). Whoever reaches the app directly can fake"
  warn "X-Forwarded-For, which the login rate limits and the IP restrictions rely on."
  ask_yes_no "Listen on $KNOWLECTIVE_BIND" y && break
done
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
if [ "$STORAGE_CHOICE" = 1 ]; then
  info "File storage    : bundled SeaweedFS (credentials generated)"
else
  info "File storage    : your own S3 (set in the admin console after setup)"
fi
info "Listens on      : ${KNOWLECTIVE_BIND}:${KNOWLECTIVE_PORT}"
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
    profile_note=""
    IFS=',' read -r -a profile_list <<< "$COMPOSE_PROFILES"
    for p in "${profile_list[@]}"; do [ -n "$p" ] && profile_note+=" --profile $p"; done
    echo "# $ENGINE compose -f $COMPOSE_FILE_NAME --env-file $ENV_FILE$profile_note up -d --build"
    echo "# Contains secrets. Don't share or commit it; back it up somewhere safe."
    echo
    if [ -n "$COMPOSE_PROFILES" ]; then
      echo "# Bundled services to run (bundled-db: PostgreSQL, bundled-vectordb: the semantic search database, bundled-storage: SeaweedFS for files)"
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
    if [ "$STORAGE_CHOICE" = 1 ]; then
      echo "# The bundled file storage (SeaweedFS)"
      echo "SEAWEEDFS_ACCESS_KEY='$SEAWEEDFS_ACCESS_KEY'"
      echo "SEAWEEDFS_SECRET_KEY='$SEAWEEDFS_SECRET_KEY'"
    fi
    echo
    if [ "$KNOWLECTIVE_BIND" != 127.0.0.1 ]; then
      echo "# Not only this server: let only the reverse proxy reach this port"
      echo "KNOWLECTIVE_BIND='$KNOWLECTIVE_BIND'"
    fi
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

# The profiles as arguments too: podman-compose doesn't read COMPOSE_PROFILES
# from the env file (Docker does; both take --profile).
PROFILE_ARGS=()
IFS=',' read -r -a profile_list <<< "$COMPOSE_PROFILES"
for p in "${profile_list[@]}"; do
  [ -n "$p" ] && PROFILE_ARGS+=(--profile "$p")
done
COMPOSE=("${ENGINE_COMPOSE[@]}" -f "$COMPOSE_FILE_NAME" --env-file "$ENV_FILE" "${PROFILE_ARGS[@]}")

section "Start"
if ! ask_yes_no "Build the image and start (takes a few minutes the first time)" y; then
  info "Start it later with:"
  info "  ${COMPOSE[*]} up -d --build"
  exit 0
fi

"${COMPOSE[@]}" up -d --build

info "Waiting for it to start (including database migrations)…"
# The app's own health check over HTTP when curl is there (the same for both
# engines: Podman only runs container health checks where systemd timers
# can), else the container's health status.
health_url="http://$(local_host "$KNOWLECTIVE_BIND"):${KNOWLECTIVE_PORT}${KNOWLECTIVE_BASE_PATH}/api/health"
# (podman-compose's ps takes no service name: found by its labels then.)
app_id=$("${COMPOSE[@]}" ps -q app 2>/dev/null) || app_id=""
[ -n "$app_id" ] || app_id=$("$ENGINE" ps -aq --filter label=com.docker.compose.project=knowlective-prod \
  --filter label=com.docker.compose.service=app 2>/dev/null | head -n 1)
status=""
for _ in $(seq 1 60); do
  if command -v curl >/dev/null 2>&1; then
    if curl -fsS -o /dev/null --max-time 5 "$health_url" 2>/dev/null; then
      status=healthy
    else
      status=$("$ENGINE" inspect -f '{{.State.Status}}' "$app_id" 2>/dev/null || echo unknown)
    fi
  else
    status=$("$ENGINE" inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$app_id" 2>/dev/null || echo unknown)
  fi
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
info "${GREEN}knowlective is running (${KNOWLECTIVE_BIND}:${KNOWLECTIVE_PORT}).${RESET}"
info "Next steps:"
info "  1. Have the reverse proxy forward your public domain to $(local_host "$KNOWLECTIVE_BIND"):${KNOWLECTIVE_PORT}"
info "     (pass the /collab WebSocket too, and send X-Forwarded-For and X-Forwarded-Proto)"
info "  2. Open https://<your domain>/ and do the first-time setup (set the master password)"
if [ "$STORAGE_CHOICE" = 2 ]; then
  info "  3. In the admin console (/admin), set your S3 storage under Files → File storage"
else
  info "  3. Back up the file storage (volume knowlective-prod_seaweedfs_data) with the database"
fi
info "  4. Back up $ENV_FILE"
if [ "$DB_CHOICE" = 1 ]; then
  info "  5. Back up the database encryption keys (volume knowlective-prod_postgres_tde_keys) separately from the data"
  info "     (without them the database can't be read)"
fi
if [ "$ENGINE" = podman ]; then
  info "Podman: to start it again after the server restarts, enable the restart service"
  info "  (rootless: systemctl --user enable --now podman-restart.service; loginctl enable-linger \"$USER\")"
fi
info "Logs: ${COMPOSE[*]} logs -f app"
