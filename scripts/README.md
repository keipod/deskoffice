# Scripts

## Local service

From the repository root, run `./up.sh` to start DeskOffice at
`http://localhost:17770`, and `./down.sh` to stop it while retaining data.
All interfaces (`0.0.0.0`) serve HTTP/API on port `17770` and Socket.IO on
port `17771`; the remaining ports `17772–17779` are reserved.
Docker Desktop is required. The launcher creates `.env.lite` only when missing,
uses the isolated Compose project `deskoffice`, and checks database and HTTP
readiness before reporting success. Existing configuration is preserved.

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
