#!/usr/bin/env bash
#
# ci-e2e-up.sh — Brings the disposable Redmine+Postgres test stack to a fully
# READY and SEEDED state in a SINGLE command, so the CI E2E job (issue #80) can
# use it right away. This is the CI-facing entrypoint of the M5-05.1 infra.
#
# It does NOT fork anything: it reuses the M1-02 compose, the wait-for-healthy
# helper and the idempotent REST seed:
#   - docker/docker-compose.yml   (Redmine 6 + Postgres 16, healthchecks, one-shots)
#   - docker/wait-for-healthy.sh  (blocks until postgres + redmine are healthy)
#   - scripts/seed.mjs            (idempotent seed via REST; asserts counts)
#
# Steps:
#   1) docker compose up -d                         (start everything)
#   2) wait-for-healthy.sh postgres redmine         (core services healthy)
#   3) poll `docker compose ps -a` for the one-shots (load-default-data +
#      enable-rest-api must reach state=exited with exit code 0)
#   4) node scripts/seed.mjs                        (idempotent seed; re-runnable)
#
# The stack is LEFT UP on success (teardown is the caller's job, e.g.
# `docker compose -f docker/docker-compose.yml down -v`). Re-running this script
# against an up stack is safe: the seed is idempotent.
#
# Usage:
#   ./scripts/ci-e2e-up.sh
#
# Environment (all optional; defaults match the test compose / .env.example):
#   COMPOSE_FILE     Path to the compose file (default: docker/docker-compose.yml)
#   TIMEOUT          Max seconds to wait for healthy (default: 300; see wait-for-healthy.sh)
#   ONESHOT_TIMEOUT  Max seconds to wait for each one-shot to exit (default: 180)
#   REDMINE_URL / REDMINE_ADMIN_USER / REDMINE_ADMIN_PASSWORD  (consumed by seed.mjs)
#
# Exit codes:
#   0  stack up, one-shots completed, seed applied and asserted
#   !0 any step failed (up, healthy timeout, one-shot non-zero, or seed failure)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/docker/docker-compose.yml}"
ONESHOT_TIMEOUT="${ONESHOT_TIMEOUT:-180}"
# Definido com default para ser repassado explícito ao wait-for-healthy (evita
# depender de o TIMEOUT estar exportado no ambiente; sob `set -u` seria unbound).
TIMEOUT="${TIMEOUT:-300}"

# One-shot services that must exit 0 before the REST API is fully usable.
ONE_SHOTS=(load-default-data enable-rest-api)

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }
log() { printf '[ci-e2e-up] %s\n' "$*" >&2; }

# Blocks until a one-shot service reaches state=exited, then asserts exit 0.
# Uses `docker compose ps -a` (which, unlike `docker compose wait`, correctly
# reports already-exited containers and their exit codes). Returns non-zero on a
# non-zero exit code or timeout.
wait_one_shot() {
  local svc="$1" deadline line state code
  deadline=$(( $(date +%s) + ONESHOT_TIMEOUT ))
  while :; do
    # Custom Go-template output has no header; one line per container.
    line="$(compose ps -a --format '{{.Service}} {{.State}} {{.ExitCode}}' \
      | awk -v s="$svc" '$1==s {print $2" "$3; exit}')"
    state="${line%% *}"
    code="${line##* }"
    if [ "$state" = "exited" ]; then
      if [ "$code" = "0" ]; then
        log "one-shot '$svc' completed (exit 0)"
        return 0
      fi
      log "ERROR: one-shot '$svc' exited with code '$code'"
      compose logs "$svc" >&2 || true
      return 1
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
      log "ERROR: timeout (${ONESHOT_TIMEOUT}s) waiting for one-shot '$svc' (last state: '${state:-missing}')"
      compose logs "$svc" >&2 || true
      return 1
    fi
    sleep 3
  done
}

# 1) Start the whole stack (Postgres, Redmine and the one-shots).
log "starting stack: docker compose -f $COMPOSE_FILE up -d"
compose up -d

# 2) Wait for the core services to become healthy (reuses the M1 helper).
log "waiting for core services (postgres, redmine) to be healthy..."
COMPOSE_FILE="$COMPOSE_FILE" TIMEOUT="$TIMEOUT" "$ROOT/docker/wait-for-healthy.sh" postgres redmine

# 3) Wait for the one-shots to finish and assert they exited 0. Without this,
#    the seed could race the REST-API enablement / default-data load.
for svc in "${ONE_SHOTS[@]}"; do
  log "waiting for one-shot '$svc' to complete..."
  wait_one_shot "$svc"
done

# 4) Seed idempotently via REST (reuses scripts/seed.mjs; asserts counts).
log "running idempotent REST seed (scripts/seed.mjs)..."
node "$ROOT/scripts/seed.mjs"

log "OK: stack is up, one-shots done, fixtures seeded. Stack left running."
