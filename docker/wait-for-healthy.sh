#!/usr/bin/env bash
#
# wait-for-healthy.sh — Blocks until the given docker compose services report
# a "healthy" status, or fails after a timeout. Intended for local use and CI.
#
# Usage:
#   ./wait-for-healthy.sh [service ...]        # defaults to: postgres redmine
#
# Environment:
#   COMPOSE_FILE   Path to the compose file (default: ./docker-compose.yml)
#   TIMEOUT        Max seconds to wait (default: 300)
#   INTERVAL       Seconds between polls (default: 5)
#
# Exit codes:
#   0  all requested services healthy
#   1  timeout reached before all services became healthy
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$SCRIPT_DIR/docker-compose.yml}"
TIMEOUT="${TIMEOUT:-300}"
INTERVAL="${INTERVAL:-5}"

SERVICES=("$@")
if [ "${#SERVICES[@]}" -eq 0 ]; then
  SERVICES=(postgres redmine)
fi

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

# Prints the health status of a service's container, or "missing" if the
# container does not exist yet, or "none" if it has no healthcheck.
health_of() {
  local svc="$1" cid
  cid="$(compose ps -q "$svc" 2>/dev/null || true)"
  if [ -z "$cid" ]; then
    echo "missing"
    return
  fi
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
    "$cid" 2>/dev/null || echo "missing"
}

deadline=$(( $(date +%s) + TIMEOUT ))
echo "Waiting for services [${SERVICES[*]}] to become healthy (timeout ${TIMEOUT}s)..."

while :; do
  all_ok=true
  for svc in "${SERVICES[@]}"; do
    status="$(health_of "$svc")"
    printf '  %-14s %s\n' "$svc" "$status"
    if [ "$status" != "healthy" ]; then
      all_ok=false
    fi
  done

  if $all_ok; then
    echo "OK: all services healthy."
    exit 0
  fi

  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "ERROR: timeout after ${TIMEOUT}s; services not healthy: ${SERVICES[*]}" >&2
    compose ps >&2 || true
    exit 1
  fi

  sleep "$INTERVAL"
done
