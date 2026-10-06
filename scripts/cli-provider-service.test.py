#!/usr/bin/env python3
"""실제 리스너나 프로세스를 조작하지 않고 CLI 서비스 소유권을 검증한다."""

from contextlib import ExitStack
import importlib.util
import io
import json
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, Mock, patch


MODULE_PATH = Path(__file__).with_name("cli-provider-service.py")
SPEC = importlib.util.spec_from_file_location("deskoffice_cli_provider_service", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
service = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = service
SPEC.loader.exec_module(service)


class ServiceTest(unittest.TestCase):
    """임시 저장소와 mock 경계를 사용하여 lifecycle을 검사한다."""

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="deskoffice-service-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.state_dir = self.root / ".artifacts/cli-providers"
        self.state = self.state_dir / "process.json"
        self.key_file = self.root / ".env.cli"
        self.bridge = self.root / "scripts/cli-provider-bridge.py"
        self.key = "a" * 64
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        for name, value in (("ROOT", self.root), ("STATE_DIR", self.state_dir), ("STATE", self.state),
                            ("KEY_FILE", self.key_file), ("BRIDGE", self.bridge)):
            self.stack.enter_context(patch.object(service, name, value))

    def write_key(self, content: str | None = None) -> None:
        """테스트용 기존 키를 저장한다."""
        self.key_file.write_text(content or f"DESKOFFICE_CLI_API_KEY={self.key}\n", encoding="utf-8")

    def write_state(self, pid: object = 123, pgid: object = 123) -> None:
        """테스트용 PID 기록을 저장한다."""
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.state.write_text(json.dumps({"pid": pid, "pgid": pgid}), encoding="utf-8")

    def test_read_key_preserves_file_and_accepts_existing_secret(self) -> None:
        original = f"CUSTOM=보존\nDESKOFFICE_CLI_API_KEY={self.key}\n"
        self.write_key(original)
        self.key_file.chmod(0o640)
        self.assertEqual(service.read_key(), self.key)
        self.assertEqual(self.key_file.read_text(encoding="utf-8"), original)
        self.assertEqual(self.key_file.stat().st_mode & 0o777, 0o640)

    def test_read_key_rejects_missing_and_short_secret(self) -> None:
        for content in ("OTHER_KEY=value\n", "DESKOFFICE_CLI_API_KEY=short\n"):
            with self.subTest(content=content):
                self.write_key(content)
                with self.assertRaises(ValueError):
                    service.read_key()

    def test_absent_or_unpopulated_state_has_no_owned_process(self) -> None:
        self.assertIsNone(service.owned_process())
        self.write_state(None, None)
        with patch.object(service.os, "kill") as kill:
            self.assertIsNone(service.owned_process())
        kill.assert_not_called()

    def test_owned_process_checks_live_pid_group_and_exact_script(self) -> None:
        self.write_state()
        with patch.object(service.os, "kill") as kill, \
             patch.object(service.os, "getpgid", return_value=123), \
             patch.object(service.subprocess, "run", return_value=subprocess.CompletedProcess(
                 [], 0, f"{sys.executable} {self.bridge} --host 0.0.0.0 --port 17773\n", "",
             )):
            self.assertEqual(service.owned_process(), (123, 123))
        kill.assert_called_once_with(123, 0)

    def test_dead_pid_is_not_owned(self) -> None:
        self.write_state()
        with patch.object(service.os, "kill", side_effect=ProcessLookupError):
            self.assertIsNone(service.owned_process())

    def test_mismatched_group_is_rejected(self) -> None:
        self.write_state()
        with patch.object(service.os, "kill"), patch.object(service.os, "getpgid", return_value=456), \
             patch.object(service.subprocess, "run", return_value=subprocess.CompletedProcess(
                 [], 0, f"{sys.executable} {self.bridge}", "",
             )), self.assertRaises(RuntimeError):
            service.owned_process()

    def test_shared_process_group_is_not_owned(self) -> None:
        self.write_state(123, 456)
        with patch.object(service.os, "kill"), patch.object(service.os, "getpgid", return_value=456), \
             patch.object(service.subprocess, "run", return_value=subprocess.CompletedProcess(
                 [], 0, f"{sys.executable} {self.bridge}", "",
             )), self.assertRaises(RuntimeError):
            service.owned_process()

    def test_macos_framework_interpreter_is_recognized(self) -> None:
        self.write_state()
        interpreter = Path(sys.base_prefix) / "Resources/Python.app/Contents/MacOS/Python"
        with patch.object(service.os, "kill"), patch.object(service.os, "getpgid", return_value=123), \
             patch.object(service.subprocess, "run", return_value=subprocess.CompletedProcess(
                 [], 0, f"{interpreter} {self.bridge} --host 0.0.0.0 --port 17773", "",
             )):
            self.assertEqual(service.owned_process(), (123, 123))

    def test_script_path_in_unrelated_arguments_is_not_ownership(self) -> None:
        self.write_state()
        with patch.object(service.os, "kill"), patch.object(service.os, "getpgid", return_value=123), \
             patch.object(service.subprocess, "run", return_value=subprocess.CompletedProcess(
                 [], 0, f"/usr/bin/other --note {self.bridge}", "",
             )), self.assertRaises(RuntimeError):
            service.owned_process()

    def test_health_requires_identity_and_both_providers(self) -> None:
        payloads = [
            ({"service": "deskoffice-cli-provider", "status": "ready", "providers": {"claude": True, "codex": True}}, True),
            ({"service": "foreign", "status": "ready", "providers": {"claude": True, "codex": True}}, False),
            ({"service": "deskoffice-cli-provider", "status": "ready", "providers": {"claude": True, "codex": False}}, False),
            ({}, False),
        ]
        for payload, expected in payloads:
            with self.subTest(payload=payload), patch.object(service.urllib.request, "urlopen", return_value=io.BytesIO(json.dumps(payload).encode())) as open_url:
                self.assertEqual(service.healthy(self.key), expected)
                request = open_url.call_args.args[0]
                self.assertEqual(request.full_url, "http://127.0.0.1:17773/health")
                self.assertEqual(request.get_header("Authorization"), "Bearer " + self.key)

    def test_failed_or_malformed_health_is_not_ready(self) -> None:
        with patch.object(service.urllib.request, "urlopen", side_effect=OSError):
            self.assertFalse(service.healthy(self.key))
        for response in (b"{broken", b"[]", b"null"):
            with self.subTest(response=response), patch.object(service.urllib.request, "urlopen", return_value=io.BytesIO(response)):
                self.assertFalse(service.healthy(self.key))

    def test_start_preserves_foreign_listener_and_creates_private_key(self) -> None:
        probe = MagicMock()
        probe.__enter__.return_value.bind.side_effect = OSError("address in use")
        with patch.object(service.socket, "socket", return_value=probe), \
             patch.object(service, "owned_process", return_value=None), \
             patch.object(service.secrets, "token_hex", return_value=self.key), \
             patch.object(service.subprocess, "Popen") as popen, \
             patch.object(service.os, "killpg") as kill, \
             self.assertRaises(RuntimeError):
            service.start()
        popen.assert_not_called()
        kill.assert_not_called()
        probe.__enter__.return_value.setsockopt.assert_called_once_with(
            service.socket.SOL_SOCKET, service.socket.SO_REUSEADDR, 1,
        )
        self.assertEqual(service.read_key(), self.key)
        self.assertEqual(self.key_file.stat().st_mode & 0o777, 0o600)

    def test_repeated_start_uses_owned_healthy_service_without_mutation(self) -> None:
        self.write_key()
        self.key_file.chmod(0o640)
        with patch.object(service, "owned_process", return_value=(123, 123)), \
             patch.object(service, "healthy", return_value=True), \
             patch.object(service.socket, "socket") as socket, \
             patch.object(service.subprocess, "Popen") as popen, \
             patch.object(service.secrets, "token_hex") as generate:
            service.start()
        socket.assert_not_called()
        popen.assert_not_called()
        generate.assert_not_called()
        self.assertEqual(self.key_file.stat().st_mode & 0o777, 0o640)

    def test_owned_unhealthy_service_is_not_replaced(self) -> None:
        self.write_key()
        with patch.object(service, "owned_process", return_value=(123, 123)), \
             patch.object(service, "healthy", return_value=False), \
             patch.object(service.subprocess, "Popen") as popen, self.assertRaises(RuntimeError):
            service.start()
        popen.assert_not_called()

    def test_new_start_uses_isolated_session_and_records_private_state(self) -> None:
        self.write_key()
        process = Mock(pid=123)
        process.poll.return_value = None
        with patch.object(service, "owned_process", return_value=None), \
             patch.object(service, "healthy", return_value=True), \
             patch.object(service.socket, "socket", return_value=MagicMock()), \
             patch.object(service.subprocess, "Popen", return_value=process) as popen, \
             patch.object(service.os, "getpgid", return_value=123), \
             patch.object(service.time, "monotonic", side_effect=[0, 0]), \
             patch.object(service.time, "sleep") as sleep:
            service.start()
        sleep.assert_not_called()
        command = popen.call_args.args[0]
        self.assertEqual(command[1:], [str(self.bridge), "--host", "0.0.0.0", "--port", "17773"])
        self.assertNotIn(self.key, command)
        self.assertTrue(popen.call_args.kwargs["start_new_session"])
        self.assertEqual(popen.call_args.kwargs["env"]["DESKOFFICE_CLI_API_KEY"], self.key)
        self.assertEqual(json.loads(self.state.read_text()), {"pid": 123, "pgid": 123})
        self.assertEqual(self.state.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.state_dir.stat().st_mode & 0o777, 0o700)

    def test_stop_without_ownership_does_not_signal_any_process(self) -> None:
        with patch.object(service, "owned_process", return_value=None), patch.object(service.os, "killpg") as kill:
            service.stop()
        kill.assert_not_called()

    def test_stop_signals_owned_group_and_preserves_key(self) -> None:
        self.write_key()
        with patch.object(service, "owned_process", return_value=(123, 123)), \
             patch.object(service.os, "killpg") as kill, \
             patch.object(service.os, "kill", side_effect=ProcessLookupError), \
             patch.object(service, "save_state") as save, \
             patch.object(service.time, "monotonic", side_effect=[0, 0]), \
             patch.object(service.time, "sleep") as sleep:
            service.stop()
        kill.assert_called_once_with(123, signal.SIGTERM)
        save.assert_called_once_with(None, None)
        sleep.assert_not_called()
        self.assertEqual(service.read_key(), self.key)

    def test_stop_does_not_escalate_to_a_reused_pid(self) -> None:
        with patch.object(service, "owned_process", side_effect=[(123, 123), None]), \
             patch.object(service.os, "killpg") as kill, \
             patch.object(service, "save_state"), \
             patch.object(service.time, "monotonic", side_effect=[0, 11]):
            service.stop()
        kill.assert_called_once_with(123, signal.SIGTERM)


if __name__ == "__main__":
    unittest.main()
