#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "${1:-}" in
  -h|--help) printf '사용법: ./up.sh — DeskOffice 시작 (http://localhost:17770)\n'; exit 0 ;;
  '') ;;
  *) printf '지원하지 않는 인자: %s\n' "$1" >&2; exit 1 ;;
esac
if (( $# > 0 )); then
  printf '사용법: ./up.sh\n' >&2
  exit 1
fi

for tool in docker curl openssl python3; do
  command -v "$tool" >/dev/null || { printf '필요한 명령을 찾을 수 없습니다: %s\n' "$tool" >&2; exit 1; }
done
docker compose version >/dev/null
if ! docker info >/dev/null 2>&1; then
  if [[ "$(uname -s)" == Darwin ]]; then
    printf 'Docker Desktop 시작 중...\n'
    open -a Docker
    docker_deadline=$((SECONDS + 60))
    until docker info >/dev/null 2>&1; do
      if (( SECONDS >= docker_deadline )); then
        printf 'Docker Desktop이 준비되지 않았습니다. 상태를 확인하고 ./up.sh를 다시 실행하세요.\n' >&2
        exit 1
      fi
      sleep 2
    done
  else
    printf 'Docker를 먼저 실행하세요.\n' >&2
    exit 1
  fi
fi

ENV_FILE="$REPO_ROOT/.env.lite"
if [[ ! -e "$ENV_FILE" ]]; then
  jwt_secret="$(openssl rand -hex 32)"
  (umask 077; set -o noclobber; printf 'JWT_SECRET=%s\n' "$jwt_secret" > "$ENV_FILE")
  unset jwt_secret
fi
HERMES_ENV_FILE="$REPO_ROOT/.env.hermes"
if [[ ! -e "$HERMES_ENV_FILE" ]]; then
  gateway_secret="$(openssl rand -hex 32)"
  (umask 077; set -o noclobber; printf 'HERMES_API_KEY=%s\n' "$gateway_secret" > "$HERMES_ENV_FILE")
  unset gateway_secret
fi
python3 "$REPO_ROOT/scripts/cli-provider-service.py" start
compose=(docker compose -p deskoffice --env-file "$ENV_FILE" --env-file "$HERMES_ENV_FILE" --env-file "$REPO_ROOT/.env.cli" -f "$REPO_ROOT/docker/docker-compose.local.yml")
ready_timeout="${DESKOFFICE_READY_TIMEOUT:-120}"
if [[ ! "$ready_timeout" =~ ^[0-9]+$ ]]; then
  printf 'DESKOFFICE_READY_TIMEOUT은 0 이상의 정수여야 합니다.\n' >&2
  exit 1
fi

"${compose[@]}" up -d deskrpg-app hermes
printf 'DeskOffice 접속 확인 중...\n'
deadline=$((SECONDS + ready_timeout))
while :; do
  health="$(curl --fail --silent --max-time 3 http://127.0.0.1:17770/api/health || true)"
  if [[ "$health" =~ \"status\"[[:space:]]*:[[:space:]]*\"ok\" && "$health" =~ \"db\"[[:space:]]*:[[:space:]]*\"connected\" ]]; then
    page="$(curl --fail --silent --location --max-time 3 http://127.0.0.1:17770/ || true)"
    if [[ "$page" == *'<html'* || "$page" == *'<!DOCTYPE html'* ]] && "${compose[@]}" exec -T hermes python -c '
import json, os, urllib.request
headers = {"Authorization": "Bearer " + os.environ["API_SERVER_KEY"]}
def probe(path):
    request = urllib.request.Request("http://127.0.0.1:17772" + path, headers=headers)
    with urllib.request.urlopen(request, timeout=3) as response:
        return json.load(response)
capabilities = probe("/v1/capabilities")
plugin = probe("/deskrpg/info")
assert capabilities.get("auth", {}).get("required") is True
assert plugin.get("plugin") == "deskrpg" and plugin.get("version")
' >/dev/null 2>&1; then
      printf 'DeskOffice 시작됨: http://localhost:17770 (0.0.0.0에서 서빙)\nHermes 게이트웨이: http://localhost:17772\n종료: ./down.sh\n'
      exit 0
    fi
  fi
  if (( SECONDS >= deadline )); then
    break
  fi
  sleep 2
done
printf 'DeskOffice/Hermes 접속 확인 시간이 초과되었습니다. ./down.sh로 종료한 뒤 Docker 상태를 확인하세요.\n' >&2
exit 1
