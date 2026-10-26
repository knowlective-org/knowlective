# Which container engine the scripts drive (sourced by install.sh and
# docker/postgres/move-to-tde.sh): Docker with Compose v2, or Podman with
# `podman compose` (Podman 4.7 or later, with docker-compose or podman-compose
# installed as its provider).
#
#   KNOWLECTIVE_ENGINE=docker|podman   choose; otherwise Docker if it works,
#                                      else Podman
#
# Sets ENGINE (docker / podman) and ENGINE_COMPOSE (the compose command as an
# array), or exits with what's missing. Expects die() from the caller.

engine_works() {
  case "$1" in
    docker) command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 && docker info >/dev/null 2>&1 ;;
    podman) command -v podman >/dev/null 2>&1 && podman compose version >/dev/null 2>&1 && podman info >/dev/null 2>&1 ;;
    *) return 1 ;;
  esac
}

# Why an engine doesn't work, for the error message.
engine_problem() {
  case "$1" in
    docker)
      if ! command -v docker >/dev/null 2>&1; then echo "docker not found. Install Docker Engine (or Docker Desktop), or Podman."
      elif ! docker compose version >/dev/null 2>&1; then echo "docker compose (v2) isn't available. Install the Docker Compose plugin."
      else echo "Can't connect to Docker. Check that Docker is running and that this user can run docker."
      fi ;;
    podman)
      if ! command -v podman >/dev/null 2>&1; then echo "podman not found."
      elif ! podman compose version >/dev/null 2>&1; then
        echo "podman compose isn't available. Use Podman 4.7 or later and install docker-compose or podman-compose (1.1 or later)."
      else echo "Can't use Podman. Check that 'podman info' works for this user."
      fi ;;
  esac
}

select_engine() {
  case "${KNOWLECTIVE_ENGINE:-}" in
    docker|podman)
      engine_works "$KNOWLECTIVE_ENGINE" || die "$(engine_problem "$KNOWLECTIVE_ENGINE")"
      ENGINE=$KNOWLECTIVE_ENGINE ;;
    "")
      if engine_works docker; then ENGINE=docker
      elif engine_works podman; then ENGINE=podman
      elif command -v podman >/dev/null 2>&1 && ! command -v docker >/dev/null 2>&1; then die "$(engine_problem podman)"
      else die "$(engine_problem docker)"
      fi ;;
    *) die "KNOWLECTIVE_ENGINE must be docker or podman (got '$KNOWLECTIVE_ENGINE')." ;;
  esac
  ENGINE_COMPOSE=("$ENGINE" compose)
}
