#!/usr/bin/env bash
# Security checks that don't need a running site (pnpm security:scan):
#
#   1. check-auth      every Server Action / Route Handler checks access (scripts/check-auth.mjs)
#   2. pnpm audit      known vulnerabilities in production dependencies
#   3. gitleaks        secrets committed to the git history
#   4. trivy           known vulnerabilities in the Docker image (only if
#                      KNOWLECTIVE_SCAN_IMAGE names a built image, e.g. knowlective:latest)
#
# gitleaks and trivy run as containers (Docker, or Podman: KNOWLECTIVE_ENGINE).
# Exits non-zero if any check fails. AUDIT_LEVEL (default "moderate") is the
# lowest severity that fails the audit.
set -uo pipefail

cd "$(dirname "$0")/.."
die() { echo "security-scan: $*" >&2; exit 1; }
# shellcheck source=../docker/engine.sh
. docker/engine.sh

GITLEAKS_IMAGE=docker.io/zricethezav/gitleaks:v8.24.2
TRIVY_IMAGE=docker.io/aquasec/trivy:0.63.0
failed=()

step() { printf '\n== %s\n' "$1"; }

step "Access checks (check-auth)"
node scripts/check-auth.mjs || failed+=("check-auth")

step "Dependencies (pnpm audit --prod, failing at ${AUDIT_LEVEL:-moderate})"
pnpm audit --prod --audit-level "${AUDIT_LEVEL:-moderate}" || failed+=("pnpm audit")

if engine_works docker || engine_works podman; then
  select_engine
  step "Secrets in the git history (gitleaks)"
  MSYS_NO_PATHCONV=1 "$ENGINE" run --rm -v "$PWD:/repo:ro" "$GITLEAKS_IMAGE" git /repo --no-banner --redact || failed+=("gitleaks")

  if [ -n "${KNOWLECTIVE_SCAN_IMAGE:-}" ]; then
    step "Image ${KNOWLECTIVE_SCAN_IMAGE} (trivy: HIGH, CRITICAL with a fix)"
    if [ "$ENGINE" = docker ]; then
      MSYS_NO_PATHCONV=1 docker run --rm -v /var/run/docker.sock:/var/run/docker.sock "$TRIVY_IMAGE" image \
        --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 "$KNOWLECTIVE_SCAN_IMAGE" || failed+=("trivy")
    else
      archive="$(mktemp -d)/image.tar"
      podman save -o "$archive" "$KNOWLECTIVE_SCAN_IMAGE" &&
        podman run --rm -v "$(dirname "$archive"):/scan:ro,z" "$TRIVY_IMAGE" image --input /scan/image.tar \
          --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 || failed+=("trivy")
    fi
  fi
else
  echo "security-scan: no Docker or Podman: gitleaks and trivy skipped" >&2
fi

if [ ${#failed[@]} -gt 0 ]; then
  printf '\nsecurity-scan: failed: %s\n' "${failed[*]}" >&2
  exit 1
fi
printf '\nsecurity-scan: ok\n'
