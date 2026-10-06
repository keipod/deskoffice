#!/usr/bin/env python3
"""격리된 가짜 CLI로 서비스 시작과 종료의 사용자 계약을 검증한다."""

import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(os.environ.get("DESKOFFICE_TEST_SOURCE", str(ROOT)))


class LifecycleTest(unittest.TestCase):
    """실제 Docker나 네트워크 접근 없이 lifecycle 동작을 확인한다."""

    def setUp(self) -> None:
        """임시 저장소와 호출 기록용 CLI를 준비한다."""
        self.temporary = tempfile.TemporaryDirectory(prefix="deskoffice-lifecycle-")
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.repo = self.base / "repo with spaces"
        self.repo.mkdir()
        (self.repo / "docker").mkdir()
        for name in ("up.sh", "down.sh"):
            shutil.copy2(SOURCE / name, self.repo / name)
        compose = SOURCE / "docker/docker-compose.local.yml"
        destination = self.repo / "docker/docker-compose.local.yml"
        if compose.exists():
            shutil.copy2(compose, destination)
        else:
            destination.write_text("services: {}\n", encoding="utf-8")
        self.bin = self.base / "bin"
        self.bin.mkdir()
        self.log = self.base / "calls.jsonl"
        cli = f"""#!{sys.executable}
import json
import os
from pathlib import Path
import sys

name = Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ['FAKE_CLI_LOG'], 'a', encoding='utf-8') as log:
    log.write(json.dumps([name, *args]) + '\\n')
if name == 'openssl':
    sys.stdout.write('1' * 64 + '\\n')
elif name == 'curl':
    if os.environ.get('FAKE_CURL_FAIL') == '1':
        sys.exit(22)
    if any('/api/health' in arg for arg in args):
        if os.environ.get('FAKE_UNHEALTHY_DB') == '1':
            sys.stdout.write('{{"status":"ok","db":"disconnected"}}\\n')
        else:
            sys.stdout.write('{{"status":"ok","db":"connected"}}\\n')
    else:
        if os.environ.get('FAKE_NON_HTML_PAGE') == '1':
            sys.stdout.write('Service starting\\n')
        else:
            sys.stdout.write('<!DOCTYPE html><html><body>DeskRPG</body></html>\\n')
elif name == 'docker':
    if args == ['info'] and os.environ.get('FAKE_DOCKER_UNAVAILABLE') == '1':
        sys.exit(1)
    elif args[:2] == ['compose', 'version']:
        sys.stdout.write('Docker Compose version v2.0.0\\n')
    elif args and args[0] == 'inspect':
        sys.stdout.write('true\\n')
    elif args and args[0] == 'compose' and 'ps' in args and ('-q' in args or '--quiet' in args):
        sys.stdout.write('deskoffice-test-container\\n')
    elif args and args[0] == 'compose' and 'ps' in args and '--format' in args:
        sys.stdout.write('{{"State":"running","Service":"deskrpg-app"}}\\n')
"""
        for name in ("docker", "curl", "openssl", "open"):
            target = self.bin / name
            target.write_text(cli, encoding="utf-8")
            target.chmod(0o755)
        self.environment = {
            **os.environ,
            "PATH": f"{self.bin}{os.pathsep}{os.environ.get('PATH', '')}",
            "FAKE_CLI_LOG": str(self.log),
            "DESKOFFICE_READY_TIMEOUT": "0",
        }

    def run_script(self, name: str, *args: str) -> subprocess.CompletedProcess[str]:
        """다른 작업 디렉터리에서 스크립트를 실행하고 결과를 반환한다."""
        return subprocess.run(
            ["bash", str(self.repo / name), *args],
            cwd=self.base,
            env=self.environment,
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )

    def calls(self) -> list[list[str]]:
        """기록된 CLI 인자 목록을 반환한다."""
        if not self.log.exists():
            return []
        return [json.loads(line) for line in self.log.read_text(encoding="utf-8").splitlines()]

    def assert_success(self, result: subprocess.CompletedProcess[str]) -> None:
        """실패할 경우 실제 stdout과 stderr를 진단에 포함한다."""
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def compose_calls(self, operation: str) -> list[list[str]]:
        """지정한 Compose 작업의 호출 목록을 반환한다."""
        return [
            call for call in self.calls()
            if call[:2] == ["docker", "compose"] and operation in call
        ]

    def assert_compose_scope(self, call: list[str]) -> None:
        """명시된 프로젝트와 저장소의 설정 파일이 사용되는지 확인한다."""
        for flag, expected in (
            ("-p", "deskoffice"),
            ("--env-file", str(self.repo / ".env.lite")),
            ("-f", str(self.repo / "docker/docker-compose.local.yml")),
        ):
            self.assertIn(flag, call)
            self.assertEqual(call[call.index(flag) + 1], expected)

    def test_up_help_has_no_side_effects(self) -> None:
        self.assert_success(self.run_script("up.sh", "--help"))
        self.assertEqual(self.calls(), [])
        self.assertFalse((self.repo / ".env.lite").exists())

    def test_down_help_has_no_side_effects(self) -> None:
        self.assert_success(self.run_script("down.sh", "--help"))
        self.assertEqual(self.calls(), [])
        self.assertFalse((self.repo / ".env.lite").exists())

    def test_invalid_argument_is_rejected_before_mutation(self) -> None:
        result = self.run_script("up.sh", "--not-supported")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.calls(), [])
        self.assertFalse((self.repo / ".env.lite").exists())

    def test_up_creates_private_environment_and_uses_own_configuration(self) -> None:
        self.assert_success(self.run_script("up.sh"))
        env_file = self.repo / ".env.lite"
        self.assertIn("JWT_SECRET=" + "1" * 64, env_file.read_text(encoding="utf-8"))
        self.assertEqual(stat.S_IMODE(env_file.stat().st_mode), 0o600)
        up_calls = self.compose_calls("up")
        self.assertEqual(len(up_calls), 1)
        self.assert_compose_scope(up_calls[0])
        self.assertIn("-d", up_calls[0])
        self.assertIn("deskrpg-app", up_calls[0])
        self.assertTrue(any(call[0] == "curl" for call in self.calls()))

    def test_existing_environment_survives_repeated_up(self) -> None:
        env_file = self.repo / ".env.lite"
        original = "JWT_SECRET=already-configured\nCUSTOM_VALUE=보존\n"
        env_file.write_text(original, encoding="utf-8")
        env_file.chmod(0o640)
        for _ in range(2):
            self.assert_success(self.run_script("up.sh"))
        self.assertEqual(env_file.read_text(encoding="utf-8"), original)
        self.assertEqual(stat.S_IMODE(env_file.stat().st_mode), 0o640)
        self.assertFalse(any(call[0] == "openssl" for call in self.calls()))
        self.assertEqual(len(self.compose_calls("up")), 2)

    def test_readiness_failure_returns_nonzero(self) -> None:
        self.environment["FAKE_CURL_FAIL"] = "1"
        result = self.run_script("up.sh")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len(self.compose_calls("up")), 1)
        self.assertTrue(any(call[0] == "curl" for call in self.calls()))

    def test_disconnected_database_is_not_ready(self) -> None:
        self.environment["FAKE_UNHEALTHY_DB"] = "1"
        self.assertNotEqual(self.run_script("up.sh").returncode, 0)
        self.assertTrue(any("/api/health" in arg for call in self.calls() for arg in call))

    def test_non_html_page_is_not_ready(self) -> None:
        self.environment["FAKE_NON_HTML_PAGE"] = "1"
        self.assertNotEqual(self.run_script("up.sh").returncode, 0)
        self.assertTrue(any("http://127.0.0.1:3102/" in call for call in self.calls()))

    def test_down_cannot_claim_success_when_docker_is_unavailable(self) -> None:
        self.environment["FAKE_DOCKER_UNAVAILABLE"] = "1"
        self.assertNotEqual(self.run_script("down.sh").returncode, 0)
        self.assertEqual(self.compose_calls("stop"), [])

    def test_down_stops_only_owned_service_and_preserves_data(self) -> None:
        env_file = self.repo / ".env.lite"
        original = "JWT_SECRET=already-configured\n"
        env_file.write_text(original, encoding="utf-8")
        self.assert_success(self.run_script("down.sh"))
        stop_calls = self.compose_calls("stop")
        self.assertEqual(len(stop_calls), 1)
        self.assert_compose_scope(stop_calls[0])
        self.assertEqual(stop_calls[0][-4:], ["stop", "--timeout", "30", "deskrpg-app"])
        self.assertEqual(env_file.read_text(encoding="utf-8"), original)
        for call in self.calls():
            self.assertFalse(set(call) & {"rm", "down", "prune", "kill", "--volumes", "-v"})


if __name__ == "__main__":
    unittest.main()
