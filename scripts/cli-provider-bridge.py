#!/usr/bin/env python3
"""Expose the host's authenticated coding CLIs as a small chat completion API.

CLI tools are disabled for Claude. Codex runs in its read-only sandbox. Tool
requests in the completion are data for Hermes to execute, never local commands.
"""

from __future__ import annotations

import argparse
import hmac
import json
import logging
import os
import re
import shutil
import signal
import subprocess
import tempfile
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

LOGGER = logging.getLogger("deskoffice.cli_bridge")
MAX_BODY_BYTES = 1024 * 1024
PROVIDER_MODELS = {"claude": "claude-code", "codex": "codex-cli"}
CLI_ENV_KEYS = frozenset({
    "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL",
    "LC_CTYPE", "TERM", "CLAUDE_CONFIG_DIR", "CODEX_HOME", "HTTP_PROXY",
    "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "SSL_CERT_FILE", "SSL_CERT_DIR",
})
COMPLETION_SCHEMA = {
    "type": "object",
    "properties": {
        "content": {"type": "string"},
        "tool_calls": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "arguments": {"type": "string"},
                },
                "required": ["name", "arguments"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["content", "tool_calls"],
    "additionalProperties": False,
}


class BridgeError(Exception):
    """Carry a safe HTTP status and error code without provider output."""

    def __init__(self, status: int, code: str) -> None:
        super().__init__(code)
        self.status = status
        self.code = code


def validate_request(body: object, provider: str) -> dict[str, Any]:
    """Validate chat input; return the request without exposing its contents."""
    if provider not in PROVIDER_MODELS:
        raise BridgeError(404, "not_found")
    if not isinstance(body, dict):
        raise BridgeError(400, "invalid_request")
    try:
        json.dumps(body, ensure_ascii=False, allow_nan=False).encode("utf-8")
    except (TypeError, ValueError, UnicodeError, RecursionError):
        raise BridgeError(400, "invalid_request") from None
    if body.get("model", PROVIDER_MODELS[provider]) != PROVIDER_MODELS[provider]:
        raise BridgeError(400, "invalid_model")
    if not isinstance(body.get("stream", False), bool):
        raise BridgeError(400, "invalid_stream")
    messages = body.get("messages")
    if not isinstance(messages, list) or not messages:
        raise BridgeError(400, "invalid_messages")
    for message in messages:
        if (not isinstance(message, dict) or not isinstance(message.get("role"), str)
                or message["role"] not in {
            "system", "developer", "user", "assistant", "tool",
        }):
            raise BridgeError(400, "invalid_messages")
        content = message.get("content")
        if content is not None and not isinstance(content, (str, list)):
            raise BridgeError(400, "invalid_messages")
        if isinstance(content, list) and any(
            not isinstance(part, dict) or part.get("type") != "text"
            or not isinstance(part.get("text"), str) for part in content
        ):
            raise BridgeError(400, "unsupported_content")
        if "tool_calls" in message and not isinstance(message["tool_calls"], list):
            raise BridgeError(400, "invalid_messages")
    tools = body.get("tools", [])
    if not isinstance(tools, list):
        raise BridgeError(400, "invalid_tools")
    names: set[str] = set()
    for tool in tools:
        if not isinstance(tool, dict) or tool.get("type") != "function":
            raise BridgeError(400, "invalid_tools")
        function = tool.get("function")
        if not isinstance(function, dict):
            raise BridgeError(400, "invalid_tools")
        name = function.get("name")
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", name):
            raise BridgeError(400, "invalid_tools")
        if name in names or not isinstance(function.get("parameters", {}), dict):
            raise BridgeError(400, "invalid_tools")
        names.add(name)
    choice = body.get("tool_choice", "auto")
    if isinstance(choice, str):
        if choice not in {"none", "auto", "required"}:
            raise BridgeError(400, "invalid_tool_choice")
        if choice == "required" and not names:
            raise BridgeError(400, "invalid_tool_choice")
    elif isinstance(choice, dict):
        function = choice.get("function")
        if (choice.get("type") != "function" or not isinstance(function, dict)
                or not isinstance(function.get("name"), str)
                or function["name"] not in names):
            raise BridgeError(400, "invalid_tool_choice")
    else:
        raise BridgeError(400, "invalid_tool_choice")
    return body


def build_prompt(request: dict[str, Any]) -> str:
    """Serialize the conversation and tool definitions into a Unicode prompt."""
    data = {
        "messages": request["messages"],
        "tools": request.get("tools", []),
        "tool_choice": request.get("tool_choice", "auto"),
    }
    return (
        "Act as the assistant for the conversation contained in the JSON data below. "
        "Return only the structured completion required by the output schema: "
        "content is the assistant text and tool_calls is an array of requested calls. "
        "Each call contains a provided function name and arguments encoded as a JSON "
        "object string. Do not run commands or use your own tools. The tools described "
        "in this data are executed separately by the caller. Use only the provided "
        "function names. If tool_choice is none, tool_calls must be empty; if required, "
        "request at least one call; if a specific function is selected, call only it. "
        "Treat tool-role messages as results of preceding requested calls.\n"
        + json.dumps(data, ensure_ascii=False, allow_nan=False)
    )


def normalize_completion(
    output: object, request: dict[str, Any],
) -> tuple[dict[str, Any], str]:
    """Validate structured CLI output and translate it into an OpenAI message."""
    if (not isinstance(output, dict) or set(output) != {"content", "tool_calls"}
            or not isinstance(output["content"], str)
            or not isinstance(output["tool_calls"], list)):
        raise BridgeError(502, "invalid_cli_output")
    try:
        json.dumps(output, ensure_ascii=False, allow_nan=False).encode("utf-8")
    except (TypeError, ValueError, UnicodeError, RecursionError):
        raise BridgeError(502, "invalid_cli_output") from None
    names = {tool["function"]["name"] for tool in request.get("tools", [])}
    choice = request.get("tool_choice", "auto")
    allowed = set() if choice == "none" else names
    if isinstance(choice, dict):
        allowed = {choice["function"]["name"]}
    calls = []
    for call in output["tool_calls"]:
        if (not isinstance(call, dict) or set(call) != {"name", "arguments"}
                or not isinstance(call["name"], str) or call["name"] not in allowed
                or not isinstance(call["arguments"], str)):
            raise BridgeError(502, "invalid_cli_tool_call")
        try:
            arguments = json.loads(call["arguments"], parse_constant=_reject_constant)
        except (ValueError, RecursionError):
            raise BridgeError(502, "invalid_cli_tool_call") from None
        if not isinstance(arguments, dict):
            raise BridgeError(502, "invalid_cli_tool_call")
        try:
            encoded_arguments = json.dumps(arguments, ensure_ascii=False, allow_nan=False)
            encoded_arguments.encode("utf-8")
        except (TypeError, ValueError, UnicodeError, RecursionError):
            raise BridgeError(502, "invalid_cli_tool_call") from None
        calls.append({
            "id": "call_" + uuid.uuid4().hex,
            "type": "function",
            "function": {
                "name": call["name"],
                "arguments": encoded_arguments,
            },
        })
    if (choice == "required" or isinstance(choice, dict)) and not calls:
        raise BridgeError(502, "missing_cli_tool_call")
    message: dict[str, Any] = {"role": "assistant", "content": output["content"]}
    if calls:
        message["tool_calls"] = calls
    return message, "tool_calls" if calls else "stop"


def _reject_constant(value: str) -> None:
    """Reject nonstandard JSON numbers rather than forwarding them to Hermes."""
    raise ValueError("invalid_json_number")


def parse_cli_output(
    provider: str, stdout: str, last_message: str | None = None,
) -> dict[str, Any]:
    """Read Claude structured_output or Codex's final JSON message."""
    try:
        if provider == "claude":
            envelope = json.loads(stdout, parse_constant=_reject_constant)
            if not isinstance(envelope, dict) or envelope.get("is_error"):
                raise BridgeError(502, "cli_failed")
            output = envelope.get("structured_output")
        elif provider == "codex":
            output = json.loads(last_message or "", parse_constant=_reject_constant)
        else:
            raise BridgeError(404, "not_found")
    except (ValueError, RecursionError):
        raise BridgeError(502, "invalid_cli_output") from None
    if not isinstance(output, dict):
        raise BridgeError(502, "invalid_cli_output")
    return output


def build_cli_command(provider: str, binary: str, workspace: Path) -> list[str]:
    """Build fixed CLI arguments; no request data can change execution options."""
    if provider == "claude":
        return [
            binary, "-p", "--tools", "", "--disable-slash-commands",
            "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
            "--setting-sources", "", "--settings", '{"disableAllHooks":true}',
            "--no-session-persistence", "--output-format", "json",
            "--json-schema", json.dumps(COMPLETION_SCHEMA),
        ]
    if provider == "codex":
        return [
            binary, "exec", "--ignore-user-config", "--ignore-rules", "--ephemeral",
            "--sandbox", "read-only", "--skip-git-repo-check",
            "--output-schema", str(workspace / "schema.json"),
            "--output-last-message", str(workspace / "result.json"), "-",
        ]
    raise BridgeError(404, "not_found")


def _kill_process_group(process: subprocess.Popen[str]) -> None:
    """Kill only the process group created for this request, then reap it."""
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait()


def _read_output(path: Path) -> str:
    """Read a bounded UTF-8 CLI result from the private request directory."""
    try:
        with path.open("rb") as handle:
            raw = handle.read(MAX_BODY_BYTES + 1)
        if len(raw) > MAX_BODY_BYTES:
            raise BridgeError(502, "cli_output_too_large")
        return raw.decode("utf-8")
    except (OSError, UnicodeError):
        raise BridgeError(502, "invalid_cli_output") from None


def build_child_env(environment: dict[str, str] | None = None) -> dict[str, str]:
    """Keep host subscription auth paths; omit API keys and bridge credentials.

    Parameters: environment is the source environment, or the current process.
    Returns: only the explicit CLI runtime, locale, proxy, and auth-path entries.
    """
    source = os.environ if environment is None else environment
    return {key: value for key, value in source.items() if key in CLI_ENV_KEYS}


def run_cli(provider: str, request: dict[str, Any], server: BridgeServer) -> dict[str, Any]:
    """Run one isolated CLI request and return its structured response data."""
    binary = server.binaries.get(provider)
    if not binary:
        raise BridgeError(503, "cli_unavailable")
    with tempfile.TemporaryDirectory(prefix=provider + "-", dir=server.workdir) as directory:
        workspace = Path(directory)
        workspace.chmod(0o700)
        for name, text in [("schema.json", json.dumps(COMPLETION_SCHEMA)), ("result.json", "")]:
            path = workspace / name
            path.touch(mode=0o600)
            path.write_text(text, encoding="utf-8")
        command = build_cli_command(provider, binary, workspace)
        stdout_path, stderr_path = workspace / "stdout", workspace / "stderr"
        for path in (stdout_path, stderr_path):
            path.touch(mode=0o600)
        process = None
        child_env = build_child_env()
        try:
            with stdout_path.open("w", encoding="utf-8") as stdout, stderr_path.open(
                "w", encoding="utf-8",
            ) as stderr:
                process = subprocess.Popen(
                    command, stdin=subprocess.PIPE, stdout=stdout, stderr=stderr,
                    text=True, encoding="utf-8", cwd=workspace, start_new_session=True,
                    env=child_env,
                )
                server.track_process(process)
                try:
                    process.communicate(input=build_prompt(request), timeout=server.cli_timeout)
                except subprocess.TimeoutExpired:
                    _kill_process_group(process)
                    LOGGER.warning("provider=%s timed_out", provider)
                    raise BridgeError(504, "cli_timeout") from None
            if process.returncode != 0:
                LOGGER.warning("provider=%s exit_code=%s", provider, process.returncode)
                raise BridgeError(502, "cli_failed")
            return parse_cli_output(
                provider, _read_output(stdout_path),
                _read_output(workspace / "result.json") if provider == "codex" else None,
            )
        except OSError:
            LOGGER.warning("provider=%s launch_failed", provider)
            raise BridgeError(503, "cli_unavailable") from None
        finally:
            if process is not None:
                if process.poll() is None:
                    _kill_process_group(process)
                server.untrack_process(process)


class BridgeServer(ThreadingHTTPServer):
    """Hold provider limits and own all child processes started by the bridge."""

    daemon_threads = True

    def __init__(
        self, server_address: tuple[str, int], api_key: str, workdir: Path,
        binaries: dict[str, str | None], timeout: float = 120,
    ) -> None:
        if not re.fullmatch(r"[A-Za-z0-9._~-]{32,}", api_key):
            raise ValueError("DESKOFFICE_CLI_API_KEY must contain at least 32 token characters")
        self.api_key = api_key
        self.workdir = workdir.resolve()
        self.workdir.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.workdir.chmod(0o700)
        self.binaries = binaries
        self.cli_timeout = timeout
        self.provider_slots = {name: threading.BoundedSemaphore(1) for name in PROVIDER_MODELS}
        self.stopping = threading.Event()
        self.process_lock = threading.Lock()
        self.processes: set[subprocess.Popen[str]] = set()
        super().__init__(server_address, BridgeHandler)

    def track_process(self, process: subprocess.Popen[str]) -> None:
        """Register an owned subprocess, including races with server shutdown."""
        with self.process_lock:
            self.processes.add(process)
            if self.stopping.is_set():
                _kill_process_group(process)

    def untrack_process(self, process: subprocess.Popen[str]) -> None:
        """Remove a completed subprocess from the shutdown registry."""
        with self.process_lock:
            self.processes.discard(process)

    def stop_children(self) -> None:
        """Stop owned CLI groups when the bridge itself is stopped."""
        self.stopping.set()
        with self.process_lock:
            for process in self.processes:
                if process.poll() is None:
                    _kill_process_group(process)


class BridgeHandler(BaseHTTPRequestHandler):
    """Serve authenticated, bounded OpenAI chat and model routes."""

    server: BridgeServer

    def log_message(self, format: str, *args: Any) -> None:
        """Suppress raw HTTP paths and headers in access logs."""

    def _authorize(self) -> bool:
        """Validate the bearer token with a timing-safe comparison."""
        expected = "Bearer " + self.server.api_key
        supplied = self.headers.get("Authorization", "")
        if not hmac.compare_digest(supplied.encode("utf-8"), expected.encode("utf-8")):
            self._error(BridgeError(401, "unauthorized"))
            return False
        return True

    def _json(self, status: int, payload: dict[str, Any]) -> None:
        """Write JSON without caching credentials or completion text."""
        encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def _error(self, error: BridgeError) -> None:
        """Return only safe error codes, never CLI stdout or stderr."""
        self.close_connection = True
        self._json(error.status, {"error": {"message": error.code, "type": "bridge_error", "code": error.code}})

    def _route(self, action: str) -> str | None:
        """Resolve only known provider paths and reject arbitrary routes."""
        path = urlsplit(self.path).path
        for provider in PROVIDER_MODELS:
            if path == f"/{provider}/v1/{action}":
                return provider
        return None

    def do_GET(self) -> None:
        """Serve readiness and the stable provider model aliases."""
        if not self._authorize():
            return
        if urlsplit(self.path).path == "/health":
            self._json(200, {"service": "deskoffice-cli-provider", "status": "ready", "providers": {
                provider: bool(self.server.binaries.get(provider)) for provider in PROVIDER_MODELS
            }})
            return
        provider = self._route("models")
        if provider is None:
            self._error(BridgeError(404, "not_found"))
            return
        self._json(200, {"object": "list", "data": [{
            "id": PROVIDER_MODELS[provider], "object": "model", "created": 0,
            "owned_by": "deskoffice",
        }]})

    def _body(self) -> object:
        """Read a size-limited JSON body; chunked requests are unsupported."""
        if self.headers.get("Transfer-Encoding"):
            raise BridgeError(400, "unsupported_transfer_encoding")
        raw_length = self.headers.get("Content-Length", "")
        if not raw_length.isascii() or not raw_length.isdecimal():
            raise BridgeError(400, "invalid_content_length")
        if len(raw_length) > 8:
            raise BridgeError(413, "request_too_large")
        length = int(raw_length)
        if length > MAX_BODY_BYTES:
            raise BridgeError(413, "request_too_large")
        self.connection.settimeout(15)
        try:
            raw = self.rfile.read(length)
            if len(raw) != length:
                raise BridgeError(400, "invalid_json")
            return json.loads(raw.decode("utf-8"), parse_constant=_reject_constant)
        except (UnicodeError, ValueError, RecursionError):
            raise BridgeError(400, "invalid_json") from None
        except TimeoutError:
            raise BridgeError(408, "request_timeout") from None

    def do_POST(self) -> None:
        """Run one completion per provider and encode JSON or SSE responses."""
        if not self._authorize():
            return
        provider = self._route("chat/completions")
        if provider is None:
            self._error(BridgeError(404, "not_found"))
            return
        slot = self.server.provider_slots[provider]
        acquired = False
        try:
            request = validate_request(self._body(), provider)
            acquired = slot.acquire(blocking=False)
            if not acquired:
                raise BridgeError(429, "provider_busy")
            output = run_cli(provider, request, self.server)
            message, finish_reason = normalize_completion(output, request)
            completion = {
                "id": "chatcmpl-" + uuid.uuid4().hex,
                "object": "chat.completion", "created": int(time.time()),
                "model": PROVIDER_MODELS[provider],
                "choices": [{"index": 0, "message": message, "finish_reason": finish_reason}],
            }
            if request.get("stream", False):
                self._stream(completion)
            else:
                self._json(200, completion)
        except BridgeError as error:
            self._error(error)
        except (BrokenPipeError, ConnectionResetError):
            LOGGER.info("provider=%s client_disconnected", provider)
        finally:
            if acquired:
                slot.release()

    def _stream(self, completion: dict[str, Any]) -> None:
        """Emit buffered completion chunks followed by the OpenAI SSE terminator."""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        choice = completion["choices"][0]
        message = dict(choice["message"])
        if "tool_calls" in message:
            message["tool_calls"] = [dict(call, index=i) for i, call in enumerate(message["tool_calls"])]
        for delta, finish in [(message, None), ({}, choice["finish_reason"])]:
            chunk = {key: value for key, value in completion.items() if key != "choices"}
            chunk["object"] = "chat.completion.chunk"
            chunk["choices"] = [{"index": 0, "delta": delta, "finish_reason": finish}]
            encoded = json.dumps(chunk, ensure_ascii=False, allow_nan=False)
            self.wfile.write(("data: " + encoded + "\n\n").encode("utf-8"))
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()


def main() -> int:
    """Start the host bridge using credentials that stay in the host environment."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="0.0.0.0", choices=["0.0.0.0", "127.0.0.1"])
    parser.add_argument("--port", type=int, default=17773, choices=range(17770, 17780))
    args = parser.parse_args()
    binaries = {
        "claude": shutil.which(os.environ.get("DESKOFFICE_CLAUDE_BIN", "claude")),
        "codex": shutil.which(os.environ.get("DESKOFFICE_CODEX_BIN", "codex")),
    }
    workdir = Path(os.environ.get(
        "DESKOFFICE_CLI_WORKDIR",
        str(Path(__file__).resolve().parents[1] / ".artifacts" / "cli-workspaces"),
    ))
    try:
        server = BridgeServer(
            (args.host, args.port), os.environ.get("DESKOFFICE_CLI_API_KEY", ""),
            workdir, binaries,
        )
    except (ValueError, OSError):
        LOGGER.error("bridge_start_failed; check API key, private workspace, and port")
        return 1
    server.timeout = 0.5

    def request_stop(signum: int, frame: Any) -> None:
        server.stopping.set()

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    LOGGER.info("bridge_ready address=%s port=%s", args.host, args.port)
    try:
        while not server.stopping.is_set():
            server.handle_request()
    finally:
        server.stop_children()
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
