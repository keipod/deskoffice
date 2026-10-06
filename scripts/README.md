# Scripts

## Local service

From the repository root, run `./up.sh` to start DeskOffice at
`http://localhost:17770`, and `./down.sh` to stop it while retaining data.
All interfaces (`0.0.0.0`) serve HTTP/API on port `17770` and Socket.IO on
port `17771`, the authenticated Hermes gateway on port `17772`, and the CLI
provider connection on port `17773`. The remaining ports `17774–17779` are reserved.
Docker Desktop, Python 3, Claude Code, and Codex CLI are required. The launcher
creates `.env.lite`, `.env.hermes`, and `.env.cli` only when missing,
uses the isolated Compose project `deskoffice`, and checks database and HTTP
readiness before reporting success. Existing configuration is preserved.
Hermes uses its own persistent volume and the DeskRPG image's pinned plugin.
Its initial model is the local Ollama `qwen3.6:35b` at
`http://host.docker.internal:11434/v1`, with a 65,536 token context; optional `.env.lite` settings
`HERMES_MODEL_BASE_URL`, `HERMES_MODEL`, and `HERMES_MODEL_CONTEXT` configure a
new Hermes home. Existing Hermes model settings are preserved.
Claude Code and Codex run on the host with their existing logins; credentials
are not copied into Docker. `./down.sh` stops only the recorded CLI provider
process and the repository's containers. LM Studio and Ollama remain independent.

The gateway creates these provider profiles only when their names are absent:

| Profile | Provider/model | Host connection |
| --- | --- | --- |
| `lmstudio` | LM Studio / `deskoffice-lmstudio` | `1234/v1` |
| `ollama` | Ollama / `qwen3.6:35b` | `11434/v1` |
| `claude-code` | Claude Code, current subscription login | `17773/claude/v1` |
| `codex-cli` | Codex CLI, current ChatGPT login | `17773/codex/v1` |

Open **Connections → DeskOffice Hermes → Employee management** to select a
registered profile. On a new installation, use **Import existing Hermes employees**
to register the generated profiles. Each has its own gateway token and a 65,536 token
context. Existing profiles are preserved when the launcher runs again.

LM Studio must serve a loaded model with identifier `deskoffice-lmstudio`, for example
`lms load <downloaded-model> --context-length 65536 --identifier deskoffice-lmstudio --yes`.
Run `lms server start --port 1234` if its server is stopped. Ollama must have
`qwen3.6:35b` available. Local model servers keep their existing independent ports.
CLI completions use each CLI's default model and may consume subscription usage.
The CLI bridge buffers a completed response before sending SSE chunks.

Focused checks: `python3 scripts/lifecycle.test.py`,
`python3 scripts/cli-provider-service.test.py`, and
`python3 scripts/cli-provider-bridge.test.py`.

This folder is split by purpose.

- `setup/`
  - Public setup scripts that are safe to keep in the repository.
- `assets/`
  - No public scripts currently remain in this folder.
- `deprecated/`
  - No tracked deprecated scripts currently remain.
- `local/`
  - Personal admin and diagnostic scripts.
  - Ignored by Git and not part of the open-source distribution.

Current public entry points:

- `node scripts/setup/setup-lite.js`
- `bash scripts/tc` (run `npm run tc pre-deploy` for pre-deploy automated checks)
- `bash scripts/tc` (run `npm run tc test-deploy -- --build` for a pre-release Docker test deployment)

Current local-only examples:

- `scripts/local/seed-channel.ts`
- `scripts/local/task-workflow-api-socket-check.ts`
