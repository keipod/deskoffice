#!/usr/bin/env python3
"""외부 CLI와 네트워크 호출 없이 OpenAI 브리지 계약을 검증한다."""

import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


MODULE_PATH = Path(__file__).with_name("cli-provider-bridge.py")
SPEC = importlib.util.spec_from_file_location("deskoffice_cli_provider_bridge", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
bridge = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = bridge
SPEC.loader.exec_module(bridge)


def request_body() -> dict[str, object]:
    """유효한 한국어 메시지 요청을 반환한다."""
    return {"model": "claude-code", "messages": [{"role": "user", "content": "한국어로 답해줘 🐈"}]}


def request_with_tool() -> dict[str, object]:
    """허용된 함수 도구가 있는 요청을 반환한다."""
    return {
        **request_body(),
        "tools": [{"type": "function", "function": {
            "name": "read_file", "description": "파일 읽기",
            "parameters": {"type": "object", "properties": {"path": {"type": "string"}}},
        }}],
    }


class ValidationTest(unittest.TestCase):
    """요청의 허용 범위와 Unicode 프롬프트를 확인한다."""

    def test_valid_request_keeps_unicode_messages(self) -> None:
        request = bridge.validate_request(request_body(), "claude")
        self.assertEqual(request["messages"][0]["content"], "한국어로 답해줘 🐈")

    def test_unknown_provider_is_rejected(self) -> None:
        with self.assertRaises(bridge.BridgeError):
            bridge.validate_request(request_body(), "unknown")

    def test_non_object_body_is_rejected(self) -> None:
        for body in (None, [], "text", 17):
            with self.subTest(body=body), self.assertRaises(bridge.BridgeError):
                bridge.validate_request(body, "claude")

    def test_missing_messages_are_rejected(self) -> None:
        with self.assertRaises(bridge.BridgeError):
            bridge.validate_request({"model": "claude-code"}, "claude")

    def test_malformed_messages_are_rejected(self) -> None:
        for messages in ([], "bad", ["bad"], [{"role": "invalid", "content": "text"}]):
            with self.subTest(messages=messages), self.assertRaises(bridge.BridgeError):
                bridge.validate_request({"messages": messages}, "claude")

    def test_malformed_tool_is_rejected(self) -> None:
        for tools in ("bad", ["bad"], [{"type": "unknown"}], [{"type": "function", "function": {}}]):
            with self.subTest(tools=tools), self.assertRaises(bridge.BridgeError):
                bridge.validate_request({**request_body(), "tools": tools}, "claude")

    def test_prompt_contains_korean_and_original_tool_schema(self) -> None:
        request = bridge.validate_request(request_with_tool(), "claude")
        prompt = bridge.build_prompt(request)
        self.assertIn("한국어로 답해줘 🐈", prompt)
        self.assertIn("read_file", prompt)
        self.assertIn("파일 읽기", prompt)

    def test_model_and_stream_types_are_checked(self) -> None:
        for body in ({**request_body(), "model": "unknown"}, {**request_body(), "stream": "true"}):
            with self.subTest(body=body), self.assertRaises(bridge.BridgeError):
                bridge.validate_request(body, "claude")

    def test_tool_choice_cannot_select_an_unprovided_function(self) -> None:
        for choice in ("bad", "required", {"type": "function", "function": {"name": "unprovided"}}):
            with self.subTest(choice=choice), self.assertRaises(bridge.BridgeError):
                bridge.validate_request({**request_body(), "tool_choice": choice}, "claude")

    def test_unhashable_role_returns_request_error(self) -> None:
        with self.assertRaises(bridge.BridgeError) as raised:
            bridge.validate_request({"messages": [{"role": {}, "content": "text"}]}, "claude")
        self.assertEqual(raised.exception.status, 400)

    def test_request_rejects_unpaired_unicode_and_nonfinite_numbers(self) -> None:
        for content in ("\ud800", float("nan"), float("inf")):
            with self.subTest(content=repr(content)), self.assertRaises(bridge.BridgeError) as raised:
                bridge.validate_request({"messages": [{"role": "user", "content": content}]}, "claude")
            self.assertEqual(raised.exception.status, 400)


class CompletionTest(unittest.TestCase):
    """구조화된 응답을 호출자가 실행할 OpenAI 함수 요청으로 변환한다."""

    def test_text_completion_finishes_with_stop(self) -> None:
        message, finish = bridge.normalize_completion({"content": "안녕하세요", "tool_calls": []}, request_body())
        self.assertEqual(message, {"role": "assistant", "content": "안녕하세요"})
        self.assertEqual(finish, "stop")

    def test_structured_function_preserves_unicode_json_arguments(self) -> None:
        with patch.object(bridge.uuid, "uuid4", return_value=SimpleNamespace(hex="1" * 32)):
            message, finish = bridge.normalize_completion({
                "content": "", "tool_calls": [{"name": "read_file", "arguments": '{"path":"문서.txt"}'}],
            }, request_with_tool())
        call = message["tool_calls"][0]
        self.assertEqual(finish, "tool_calls")
        self.assertEqual(call["id"], "call_" + "1" * 32)
        self.assertEqual(call["type"], "function")
        self.assertEqual(call["function"]["name"], "read_file")
        self.assertEqual(json.loads(call["function"]["arguments"]), {"path": "문서.txt"})
        self.assertIn("문서.txt", call["function"]["arguments"])

    def test_unprovided_and_disabled_tool_calls_are_rejected(self) -> None:
        for request, name in ((request_body(), "read_file"), (request_with_tool(), "delete_file"),
                              ({**request_with_tool(), "tool_choice": "none"}, "read_file")):
            with self.subTest(name=name), self.assertRaises(bridge.BridgeError) as raised:
                bridge.normalize_completion({"content": "", "tool_calls": [{"name": name, "arguments": "{}"}]}, request)
            self.assertEqual((raised.exception.status, raised.exception.code), (502, "invalid_cli_tool_call"))

    def test_tool_arguments_must_be_a_valid_json_object(self) -> None:
        for arguments in ("{broken", "[]", "null", "1", '{"value":NaN}', '{"value":Infinity}'):
            with self.subTest(arguments=arguments), self.assertRaises(bridge.BridgeError) as raised:
                bridge.normalize_completion({"content": "", "tool_calls": [{
                    "name": "read_file", "arguments": arguments,
                }]}, request_with_tool())
            self.assertEqual(raised.exception.code, "invalid_cli_tool_call")

    def test_required_tool_choice_cannot_complete_without_call(self) -> None:
        with self.assertRaises(bridge.BridgeError) as raised:
            bridge.normalize_completion({"content": "answer", "tool_calls": []}, {
                **request_with_tool(), "tool_choice": "required",
            })
        self.assertEqual(raised.exception.code, "missing_cli_tool_call")

    def test_malformed_completion_is_rejected(self) -> None:
        for output in (None, [], {}, {"content": 1, "tool_calls": []},
                       {"content": "", "tool_calls": "bad"}, {"content": "", "tool_calls": [], "extra": True}):
            with self.subTest(output=output), self.assertRaises(bridge.BridgeError) as raised:
                bridge.normalize_completion(output, request_body())
            self.assertEqual(raised.exception.code, "invalid_cli_output")

    def test_completion_content_requires_valid_utf8(self) -> None:
        with self.assertRaises(bridge.BridgeError) as raised:
            bridge.normalize_completion({"content": "\ud800", "tool_calls": []}, request_body())
        self.assertEqual((raised.exception.status, raised.exception.code), (502, "invalid_cli_output"))

    def test_parsed_tool_arguments_require_valid_utf8(self) -> None:
        with self.assertRaises(bridge.BridgeError):
            bridge.normalize_completion({"content": "", "tool_calls": [{
                "name": "read_file", "arguments": '{"path":"\\ud800"}',
            }]}, request_with_tool())


class CliParsingTest(unittest.TestCase):
    """서로 다른 CLI 출력 형식을 해석하고 오류 원문을 숨긴다."""

    def test_claude_reads_structured_output(self) -> None:
        output = {"content": "한국어", "tool_calls": []}
        parsed = bridge.parse_cli_output("claude", json.dumps({"is_error": False, "structured_output": output}))
        self.assertEqual(parsed, output)

    def test_codex_reads_last_message_instead_of_progress_stdout(self) -> None:
        output = {"content": "한국어", "tool_calls": []}
        self.assertEqual(bridge.parse_cli_output("codex", "unstructured progress", json.dumps(output)), output)

    def test_cli_error_does_not_expose_private_output(self) -> None:
        with self.assertRaises(bridge.BridgeError) as raised:
            bridge.parse_cli_output("claude", json.dumps({"is_error": True, "result": "private-secret"}))
        self.assertEqual((raised.exception.status, raised.exception.code), (502, "cli_failed"))
        self.assertNotIn("private-secret", str(raised.exception))

    def test_malformed_cli_json_is_rejected(self) -> None:
        for provider, stdout, last in (("claude", "not json", None), ("claude", "{}", None),
                                      ("codex", "ignored", "[]"), ("codex", "ignored", None)):
            with self.subTest(provider=provider), self.assertRaises(bridge.BridgeError):
                bridge.parse_cli_output(provider, stdout, last)

    def test_cli_commands_disable_independent_tool_execution(self) -> None:
        workspace = Path("/private/request")
        claude = bridge.build_cli_command("claude", "/fake/claude", workspace)
        codex = bridge.build_cli_command("codex", "/fake/codex", workspace)
        self.assertEqual(claude[claude.index("--tools") + 1], "")
        self.assertIn("--strict-mcp-config", claude)
        self.assertEqual(codex[codex.index("--sandbox") + 1], "read-only")
        self.assertEqual(codex[-1], "-")
        with self.assertRaises(bridge.BridgeError):
            bridge.build_cli_command("unknown", "/fake/binary", workspace)

    def test_child_environment_keeps_subscription_auth_paths_and_excludes_api_keys(self) -> None:
        environment = {
            "HOME": "/private/home", "CODEX_HOME": "/private/codex",
            "CLAUDE_CONFIG_DIR": "/private/claude", "PATH": "/private/bin",
            "LANG": "ko_KR.UTF-8", "HTTPS_PROXY": "http://local-proxy",
            "ANTHROPIC_API_KEY": "paid-api-secret", "OPENAI_API_KEY": "paid-api-secret",
            "DESKOFFICE_CLI_API_KEY": "bridge-secret", "UNRELATED_SECRET": "private-secret",
        }
        result = bridge.build_child_env(environment)
        self.assertEqual(result, {key: environment[key] for key in (
            "HOME", "CODEX_HOME", "CLAUDE_CONFIG_DIR", "PATH", "LANG", "HTTPS_PROXY",
        )})
        self.assertIn("DESKOFFICE_CLI_API_KEY", environment)


class CliExecutionTest(unittest.TestCase):
    """프로세스 생성 경계만 모킹하여 비밀 출력과 프롬프트 전달을 검사한다."""

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="deskoffice-cli-test-")
        self.addCleanup(self.temporary.cleanup)
        self.server = SimpleNamespace(
            workdir=Path(self.temporary.name), binaries={"claude": "/fake/claude", "codex": "/fake/codex"},
            cli_timeout=12, track_process=Mock(), untrack_process=Mock(),
        )

    def test_prompt_goes_to_unicode_stdin_and_private_files(self) -> None:
        process = Mock(returncode=0)
        process.poll.return_value = 0
        output = {"content": "답변", "tool_calls": []}
        captured: dict[str, object] = {}

        def fake_popen(command: list[str], **kwargs: object) -> Mock:
            captured.update(kwargs)
            captured["command"] = command
            kwargs["stdout"].write(json.dumps({"structured_output": output}, ensure_ascii=False))
            workspace = Path(kwargs["cwd"])
            self.assertEqual(workspace.stat().st_mode & 0o777, 0o700)
            for name in ("stdout", "stderr", "result.json", "schema.json"):
                self.assertEqual((workspace / name).stat().st_mode & 0o777, 0o600)
            return process

        with patch.object(bridge.subprocess, "Popen", side_effect=fake_popen):
            self.assertEqual(bridge.run_cli("claude", request_body(), self.server), output)
        self.assertIn("한국어로 답해줘 🐈", process.communicate.call_args.kwargs["input"])
        self.assertEqual(process.communicate.call_args.kwargs["timeout"], 12)
        self.assertEqual(captured["stdin"], subprocess.PIPE)
        self.assertEqual(captured["encoding"], "utf-8")
        self.assertTrue(captured["start_new_session"])
        self.assertFalse(any("한국어" in arg for arg in captured["command"]))
        self.server.track_process.assert_called_once_with(process)
        self.server.untrack_process.assert_called_once_with(process)

    def test_codex_final_message_file_is_used(self) -> None:
        process = Mock(returncode=0)
        process.poll.return_value = 0
        output = {"content": "Codex 답변", "tool_calls": []}

        def fake_popen(command: list[str], **kwargs: object) -> Mock:
            kwargs["stdout"].write("progress text")
            (Path(kwargs["cwd"]) / "result.json").write_text(json.dumps(output), encoding="utf-8")
            return process

        with patch.object(bridge.subprocess, "Popen", side_effect=fake_popen):
            self.assertEqual(bridge.run_cli("codex", request_body(), self.server), output)

    def test_timeout_stops_owned_process_and_returns_safe_error(self) -> None:
        process = Mock(returncode=0)
        process.poll.return_value = 0
        process.communicate.side_effect = subprocess.TimeoutExpired("private-command", 12)
        with patch.object(bridge.subprocess, "Popen", return_value=process), \
             patch.object(bridge, "_kill_process_group") as kill, \
             self.assertLogs(bridge.LOGGER, level="WARNING") as logs, \
             self.assertRaises(bridge.BridgeError) as raised:
            bridge.run_cli("claude", request_body(), self.server)
        kill.assert_called_once_with(process)
        self.assertEqual((raised.exception.status, raised.exception.code), (504, "cli_timeout"))
        self.assertNotIn("private-command", " ".join(logs.output))
        self.server.untrack_process.assert_called_once_with(process)

    def test_missing_binary_never_starts_a_process(self) -> None:
        self.server.binaries["claude"] = None
        with patch.object(bridge.subprocess, "Popen") as popen, self.assertRaises(bridge.BridgeError) as raised:
            bridge.run_cli("claude", request_body(), self.server)
        popen.assert_not_called()
        self.assertEqual(raised.exception.status, 503)

    def test_failed_cli_does_not_expose_stderr_or_untrack_late(self) -> None:
        process = Mock(returncode=1)
        process.poll.return_value = 1

        def fake_popen(command: list[str], **kwargs: object) -> Mock:
            kwargs["stderr"].write("private-provider-secret")
            return process

        with patch.object(bridge.subprocess, "Popen", side_effect=fake_popen), \
             self.assertLogs(bridge.LOGGER, level="WARNING") as logs, \
             self.assertRaises(bridge.BridgeError) as raised:
            bridge.run_cli("claude", request_body(), self.server)
        self.assertEqual((raised.exception.status, raised.exception.code), (502, "cli_failed"))
        self.assertNotIn("private-provider-secret", str(raised.exception) + " ".join(logs.output))
        self.server.untrack_process.assert_called_once_with(process)


class HandlerTest(unittest.TestCase):
    """메모리 스트림으로 인증 및 HTTP 경로 계약을 검사한다."""

    def handler(self, path: str, body: bytes = b"", authorization: str | None = None) -> object:
        handler = object.__new__(bridge.BridgeHandler)
        handler.server = SimpleNamespace(
            api_key="private-test-key-" + "1" * 32,
            binaries={"claude": "/fake/claude", "codex": "/fake/codex"},
            provider_slots={name: threading.BoundedSemaphore(1) for name in ("claude", "codex")},
        )
        handler.path = path
        handler.headers = {
            "Authorization": authorization if authorization is not None else "Bearer " + handler.server.api_key,
            "Content-Length": str(len(body)),
        }
        handler.rfile = io.BytesIO(body)
        handler.wfile = io.BytesIO()
        handler.connection = Mock()
        handler.send_response = Mock()
        handler.send_header = Mock()
        handler.end_headers = Mock()
        return handler

    def test_auth_uses_private_constant_time_bearer_comparison(self) -> None:
        handler = self.handler("/health")
        with patch.object(bridge.hmac, "compare_digest", wraps=bridge.hmac.compare_digest) as compare:
            self.assertTrue(handler._authorize())
        compare.assert_called_once_with(
            ("Bearer " + handler.server.api_key).encode("utf-8"),
            ("Bearer " + handler.server.api_key).encode("utf-8"),
        )

    def test_wrong_auth_returns_no_secret_or_route_details(self) -> None:
        handler = self.handler("/private-secret", authorization="Bearer wrong-key")
        handler.do_GET()
        handler.send_response.assert_called_once_with(401)
        response = handler.wfile.getvalue().decode("utf-8")
        self.assertNotIn(handler.server.api_key, response)
        self.assertNotIn("wrong-key", response)
        self.assertNotIn("private-secret", response)

    def test_unknown_routes_and_providers_are_rejected_without_cli(self) -> None:
        for path in ("/unknown/v1/chat/completions", "/claude/v1/other", "/claude/v1/chat/completions/extra"):
            with self.subTest(path=path), patch.object(bridge, "run_cli") as run:
                handler = self.handler(path, json.dumps(request_body()).encode("utf-8"))
                handler.do_POST()
                handler.send_response.assert_called_once_with(404)
                run.assert_not_called()

    def test_health_identifies_bridge_and_available_providers(self) -> None:
        handler = self.handler("/health")
        handler.server.binaries["codex"] = None
        handler.do_GET()
        handler.send_response.assert_called_once_with(200)
        response = json.loads(handler.wfile.getvalue())
        self.assertEqual(response["service"], "deskoffice-cli-provider")
        self.assertEqual(response["providers"], {"claude": True, "codex": False})

    def test_model_routes_are_stable_and_provider_specific(self) -> None:
        for provider, alias in (("claude", "claude-code"), ("codex", "codex-cli")):
            with self.subTest(provider=provider):
                handler = self.handler(f"/{provider}/v1/models")
                handler.do_GET()
                self.assertEqual(json.loads(handler.wfile.getvalue())["data"][0]["id"], alias)

    def test_oversized_or_chunked_bodies_are_rejected_before_cli(self) -> None:
        for header, value, status in (("Content-Length", str(bridge.MAX_BODY_BYTES + 1), 413),
                                      ("Transfer-Encoding", "chunked", 400)):
            with self.subTest(header=header), patch.object(bridge, "run_cli") as run:
                handler = self.handler("/claude/v1/chat/completions", b"{}")
                handler.headers[header] = value
                handler.do_POST()
                handler.send_response.assert_called_once_with(status)
                run.assert_not_called()

    def test_malformed_request_json_does_not_start_cli(self) -> None:
        handler = self.handler("/claude/v1/chat/completions", b"{broken")
        with patch.object(bridge, "run_cli") as run:
            handler.do_POST()
        handler.send_response.assert_called_once_with(400)
        run.assert_not_called()

    def test_openai_response_contains_tool_call_and_finish_reason(self) -> None:
        request = request_with_tool()
        output = {"content": "", "tool_calls": [{"name": "read_file", "arguments": '{"path":"a"}'}]}
        handler = self.handler("/claude/v1/chat/completions", json.dumps(request).encode("utf-8"))
        with patch.object(bridge, "run_cli", return_value=output), \
             patch.object(bridge.uuid, "uuid4", return_value=SimpleNamespace(hex="1" * 32)), \
             patch.object(bridge.time, "time", return_value=1234):
            handler.do_POST()
        handler.send_response.assert_called_once_with(200)
        response = json.loads(handler.wfile.getvalue())
        self.assertEqual(response["object"], "chat.completion")
        self.assertEqual(response["created"], 1234)
        self.assertEqual(response["choices"][0]["finish_reason"], "tool_calls")
        self.assertEqual(json.loads(response["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"]), {"path": "a"})

    def test_stream_is_openai_chunks_with_done_terminator(self) -> None:
        handler = self.handler("/claude/v1/chat/completions", json.dumps({**request_body(), "stream": True}).encode("utf-8"))
        with patch.object(bridge, "run_cli", return_value={"content": "한국어", "tool_calls": []}), \
             patch.object(bridge.uuid, "uuid4", return_value=SimpleNamespace(hex="1" * 32)), \
             patch.object(bridge.time, "time", return_value=1234):
            handler.do_POST()
        events = handler.wfile.getvalue().decode("utf-8").split("\n\n")
        self.assertEqual(events[-2], "data: [DONE]")
        chunks = [json.loads(event.removeprefix("data: ")) for event in events[:2]]
        self.assertEqual(chunks[0]["object"], "chat.completion.chunk")
        self.assertEqual(chunks[0]["choices"][0]["delta"]["content"], "한국어")
        self.assertEqual(chunks[1]["choices"][0]["finish_reason"], "stop")


if __name__ == "__main__":
    unittest.main()
