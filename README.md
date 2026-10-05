# DeskOffice

Standalone AI workforce operating system.

This repository is intentionally **not a DeskRPG fork**. DeskRPG/Hermes patterns were inspected only as product and protocol references; DeskOffice keeps its own small React + Fastify + SQLite codebase.

## Core model

DeskOffice treats an AI employee as a real work identity rather than a chat preset.

- Organization hierarchy: manager / reports, department, title, profession, seniority
- Expert system: specialty, skill levels, responsibilities, personal operating instructions
- Executor binding: OpenCode, Hermes, or Bside browser automation
- Runtime state: idle / working / meeting / blocked / offline
- Specialist workspace per employee
- Three.js quarter-view live office

## Work OS

### People / Hermes profiles

Hermes profiles are managed as employee identities.

- Register / validate / delete Hermes profiles
- Non-default profiles use Hermes `/p/<profileName>/...` routing
- One Hermes profile can be bound to **one employee only**
- Secrets are **not stored in SQLite**; a profile stores the environment variable name such as `HERMES_API_KEY`
- Validation caches capabilities and connection state

### Kanban

- Projects and task cards
- backlog / todo / in_progress / review / done / blocked
- priority, required specialty, required expertise, due date
- automatic expert recommendation and assignment
- high/urgent tasks automatically get a reviewer different from the implementer
- task execution through the assigned employee's executor
- persistent run history and result/error capture

### Meeting mode

- Explicit participant roster and agenda
- Participants enter `meeting` runtime state
- round-robin speaker turns with a configurable turn limit
- each speaker receives recent transcript and meeting-mode instructions
- persistent transcript
- decisions / action items / summary generation
- ending a meeting returns participants to idle

### Cron

- Persistent cron jobs assigned to a specific employee
- real in-process scheduler with timezone support
- pause / resume / run-now / delete
- overlap protection
- next/last run timestamps
- persistent run history

## Integrations

### OpenCode

Default lightweight knowledge-work executor.

```bash
opencode auth login
```

Default model:

```text
opencode/muse-spark-1.3-contributor-free
```

The CLI runs locally; the model itself is provided by OpenCode and is not local inference.

### Bside

Browser Operator uses Bside through its HTTP API only. DeskOffice does not embed or copy Bside.

Default API:

```text
http://127.0.0.1:27433
```

### Hermes

Hermes is optional. Profiles can point at a local or remote Hermes API server. The default local address used by the profile form is:

```text
http://127.0.0.1:8642
```

## Ports

- DeskOffice production: `32180`
- Vite development UI: `32180`
- development API: `32182`
- Bside: `27433` (external service)

## Run

```bash
npm install
npm run build
npm start
```

Open:

```text
http://localhost:32180
```

## Validation

```bash
npm run build
npm test
npm audit --omit=dev
```

The standalone guard tests fail if implementation dependencies on DeskRPG are reintroduced.
