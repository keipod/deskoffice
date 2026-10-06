#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "${1:-}" in
  -h|--help) printf '사용법: ./down.sh — DeskOffice 종료 (데이터 보존)\n'; exit 0 ;;
  '') ;;
  *) printf '지원하지 않는 인자: %s\n' "$1" >&2; exit 1 ;;
esac
if (( $# > 0 )); then
  printf '사용법: ./down.sh\n' >&2
  exit 1
fi

python3 "$REPO_ROOT/scripts/cli-provider-service.py" stop
command -v docker >/dev/null || { printf 'Docker를 찾을 수 없습니다.\n' >&2; exit 1; }
if ! docker info >/dev/null 2>&1; then
  printf 'Docker에 연결할 수 없어 종료 상태를 확인할 수 없습니다.\n' >&2
  exit 1
fi
compose=(docker compose -p deskoffice)
if [[ -f "$REPO_ROOT/.env.lite" ]]; then
  compose+=(--env-file "$REPO_ROOT/.env.lite")
fi
if [[ -f "$REPO_ROOT/.env.hermes" ]]; then
  compose+=(--env-file "$REPO_ROOT/.env.hermes")
fi
if [[ -f "$REPO_ROOT/.env.cli" ]]; then
  compose+=(--env-file "$REPO_ROOT/.env.cli")
fi
compose+=(-f "$REPO_ROOT/docker/docker-compose.local.yml")
"${compose[@]}" stop --timeout 30 deskrpg-app hermes hermes-setup plugin-pin
printf 'DeskOffice 종료됨. 데이터는 보존됩니다.\n'
