# Scripts

## Local service

From the repository root, run `./up.sh` to start DeskOffice at
`http://localhost:17770`, and `./down.sh` to stop it while retaining data.
All interfaces (`0.0.0.0`) serve HTTP/API on port `17770` and Socket.IO on
port `17771`, and the authenticated Hermes gateway on port `17772`.
The remaining ports `17773–17779` are reserved.
Docker Desktop is required. The launcher creates `.env.lite` and `.env.hermes` only when missing,
uses the isolated Compose project `deskoffice`, and checks database and HTTP
readiness before reporting success. Existing configuration is preserved.
Hermes uses its own persistent volume and the DeskRPG image's pinned plugin.
Its initial model is the local Ollama `qwen3.6:35b` at
`http://host.docker.internal:11434/v1`, with a 65,536 token context; optional `.env.lite` settings
`HERMES_MODEL_BASE_URL`, `HERMES_MODEL`, and `HERMES_MODEL_CONTEXT` configure a
new Hermes home. Existing Hermes model settings are preserved.

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
