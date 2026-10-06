#!/usr/bin/env python3
"""저장소 소유 CLI 제공자 서버의 시작과 종료를 관리한다."""

import argparse
import json
import logging
import os
from pathlib import Path
import secrets
import shlex
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
BRIDGE = ROOT / "scripts/cli-provider-bridge.py"
STATE_DIR = ROOT / ".artifacts/cli-providers"
STATE = STATE_DIR / "process.json"
KEY_FILE = ROOT / ".env.cli"
PORT = 17773
LOGGER = logging.getLogger(__name__)


def read_key() -> str:
    """전용 설정 파일에서 서버 키를 읽고 길이를 확인한다."""
    for line in KEY_FILE.read_text(encoding="utf-8").splitlines():
        if line.startswith("DESKOFFICE_CLI_API_KEY="):
            key = line.split("=", 1)[1].strip()
            if len(key) < 32:
                raise ValueError(".env.cli의 DESKOFFICE_CLI_API_KEY가 너무 짧습니다")
            return key
    raise ValueError(".env.cli에 DESKOFFICE_CLI_API_KEY가 없습니다")


def owned_process() -> tuple[int, int] | None:
    """PID와 실제 명령, 프로세스 그룹이 모두 일치할 때만 소유권을 반환한다."""
    if not STATE.exists():
        return None
    state = json.loads(STATE.read_text(encoding="utf-8"))
    pid, pgid = state.get("pid"), state.get("pgid")
    if not isinstance(pid, int) or not isinstance(pgid, int):
        return None
    try:
        os.kill(pid, 0)
        actual_group = os.getpgid(pid)
    except ProcessLookupError:
        return None
    result = subprocess.run(
        ["ps", "-p", str(pid), "-o", "args="],
        capture_output=True, text=True, check=False,
    )
    arguments = shlex.split(result.stdout.strip())
    interpreters = {
        Path(sys.executable).resolve(),
        (Path(sys.base_prefix) / "Resources/Python.app/Contents/MacOS/Python").resolve(),
    }
    matches = (
        len(arguments) >= 2
        and Path(arguments[0]).resolve() in interpreters
        and arguments[1] == str(BRIDGE)
    )
    if actual_group != pgid or pgid != pid or not matches:
        raise RuntimeError("기록된 PID가 다른 프로세스 소유입니다. 종료하지 않았습니다")
    return pid, pgid


def healthy(key: str) -> bool:
    """인증된 서비스 응답으로 서버가 준비됐는지 확인한다."""
    request = urllib.request.Request(
        f"http://127.0.0.1:{PORT}/health",
        headers={"Authorization": "Bearer " + key},
    )
    try:
        with urllib.request.urlopen(request, timeout=2) as response:
            data = json.load(response)
            return (
                isinstance(data, dict)
                and data.get("service") == "deskoffice-cli-provider"
                and data.get("status") == "ready"
                and data.get("providers") == {"claude": True, "codex": True}
            )
    except (OSError, ValueError, urllib.error.HTTPError):
        return False


def save_state(pid: int | None, pgid: int | None) -> None:
    """현재 소유 프로세스 상태를 전용 파일에 저장한다."""
    STATE.write_text(json.dumps({"pid": pid, "pgid": pgid}), encoding="utf-8")
    STATE.chmod(0o600)


def start() -> None:
    """외부 리스너를 보존하고 전용 서버를 시작한다."""
    if not KEY_FILE.exists():
        with KEY_FILE.open("x", encoding="utf-8") as stream:
            KEY_FILE.chmod(0o600)
            stream.write("DESKOFFICE_CLI_API_KEY=" + secrets.token_hex(32) + "\n")
    key = read_key()
    if owned_process():
        if not healthy(key):
            raise RuntimeError("기존 CLI 제공자 서버가 응답하지 않습니다. ./down.sh 후 재시도하세요")
        return
    with socket.socket() as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind(("0.0.0.0", PORT))
        except OSError as error:
            raise RuntimeError(f"{PORT} 포트를 다른 서비스가 사용 중입니다. 보존했습니다") from error
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    STATE_DIR.chmod(0o700)
    log_path = STATE_DIR / "server.log"
    environment = dict(os.environ)
    environment["DESKOFFICE_CLI_API_KEY"] = key
    environment["DESKOFFICE_CLI_WORKDIR"] = str(STATE_DIR / "workspaces")
    with log_path.open("a", encoding="utf-8") as log:
        log_path.chmod(0o600)
        process = subprocess.Popen(
            [sys.executable, str(BRIDGE), "--host", "0.0.0.0", "--port", str(PORT)],
            cwd=ROOT, env=environment, stdin=subprocess.DEVNULL,
            stdout=log, stderr=log, start_new_session=True,
        )
    save_state(process.pid, os.getpgid(process.pid))
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"CLI 제공자 서버가 종료됐습니다. 로그: {log_path}")
        if healthy(key):
            LOGGER.info("CLI 제공자 서버 시작됨: 0.0.0.0:%s", PORT)
            return
        time.sleep(0.2)
    raise RuntimeError(f"CLI 제공자 서버 준비 시간 초과. 로그: {log_path}")


def stop() -> None:
    """검증된 소유 프로세스 그룹만 종료한다."""
    owned = owned_process()
    if not owned:
        LOGGER.info("관리 중인 CLI 제공자 서버가 없습니다")
        return
    pid, pgid = owned
    os.killpg(pgid, signal.SIGTERM)
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            save_state(None, None)
            LOGGER.info("CLI 제공자 서버 종료됨")
            return
        time.sleep(0.1)
    if owned_process() == owned:
        os.killpg(pgid, signal.SIGKILL)
    save_state(None, None)
    LOGGER.info("CLI 제공자 서버 종료됨")


def main() -> int:
    """명령을 파싱하고 시작 또는 종료 결과를 반환한다."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("start", "stop"))
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    try:
        if args.action == "start":
            start()
        else:
            stop()
    except (OSError, ValueError, RuntimeError) as error:
        LOGGER.error("%s", error)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
