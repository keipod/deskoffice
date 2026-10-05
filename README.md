# DeskOffice

Standalone AI office control plane.

This repository is intentionally **not a DeskRPG fork**. DeskRPG was only used as a product reference during prototyping; the current codebase is a fresh implementation.

## What it does

- Three.js quarter-view office
- Employee CRUD and reporting hierarchy
- Runtime status: idle / working / meeting / blocked / offline
- Specialist workspaces
- Local OpenCode CLI as the default LLM executor
- Bside browser automation adapter
- Optional Hermes executor adapter
- Meetings and participant state
- SQLite persistence
- Server-Sent Events for live office updates

## Ports

- DeskOffice: `32180`
- Dev API only: `32182`
- Bside: `27433` (external service)

## Run

```bash
npm install
npm run build
npm start
```

Open: `http://localhost:32180`

For Muse Spark through OpenCode, authenticate OpenCode first:

```bash
opencode auth login
```
