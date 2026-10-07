# DeskRPG

한국어 문서: [README.ko.md](README.ko.md)

<img src="public/readme/home-screenshot.png" alt="DeskRPG home screen" width="100%" />

Run the office and its Hermes Agent 24/7 on one VPS — see [deploy/hostinger](deploy/hostinger/README.md).

**Starting with a new VPS** — DeskRPG is in Hostinger's one-click catalog. Open its page and pick DeskRPG when you order (KVM 2 or larger; 8 GB recommended):

[![Deploy on Hostinger](https://assets.hostinger.com/vps/deploy.svg)](https://www.hostinger.com/applications/deskrpg)

**Already have a VPS** — load the compose into Docker Manager:

[![Deploy on Hostinger](https://assets.hostinger.com/vps/deploy.svg)](https://www.hostinger.com/vps/docker-hosting?compose_url=https://raw.githubusercontent.com/dandacompany/deskrpg/refs/heads/master/docker-compose.yml)

> ⚠️ **Docker Manager route: then deploy Traefik** — it gives the office its HTTPS address. After this deploy, Docker Manager shows an _"Enable HTTPS for Docker projects"_ banner: press **Deploy Traefik**, then add `TRAEFIK_HOST=srvNNNNNN.hstgr.cloud` to the DeskRPG project's environment and **Save and deploy** — it is not filled in for you. Either Traefik shape Hostinger installs works (host mode or a `traefik-proxy` network).

Want a VPS for the Docker Manager route? [Get one here](https://hostinger.com/DANTE-DOCKER) (referral link — it supports this project at no extra cost to you), then come back and press the button above.

> **Already running DeskRPG on Hostinger? Replace the compose file once.** Update never reads a new compose file, so the part that installs the Hermes plugin stays as it was on the day you set it up. If your compose file has no `plugin-pin` in it, follow [these four steps](deploy/hostinger/README.md#set-up-before-this-change-replace-the-compose-once); your data is kept.

DeskRPG is a self-hosted **3D miniature virtual office for AI agents**. Your [Hermes Agent](https://github.com/NousResearch/hermes-agent) profiles become employees: they sit at desks, answer when you mention them, hold meetings with turn control, and work kanban cards. **Call them over and read their completion reports in office chat.** Several people can be in the same office at once.

DeskRPG does not bundle an agent runtime. It attaches to the Hermes gateway you already run, so existing Hermes users bring their profiles as they are — nothing to migrate.

- Website: [https://deskrpg.com](https://deskrpg.com) (live)
- Source code: `https://github.com/dandacompany/deskrpg`
- Version: `v2026.1003.1` — Skills as chat chips: type `/` in a DM or a room to pick an employee's skills (up to five); they appear as chips in the input, and the employee receives the same message Hermes' TUI builds for `/skill …`. In a room, mention exactly one employee to use skills. The Skills tab has a Use button that drops the skill into that employee's DM input. If a skill is off or cannot be loaded, the message is marked failed instead of being sent without it. Includes everything in 2026.929.2. Requires plugin 0.31.0.

## What You Can Do

- Pick one of 50 stylized office looks (CC0 Quaternius bases, rebuilt as complete characters) for yourself and for every NPC — one GLB per look, shared by the map, the roster and the meeting room.
- Walk a live 3D office rendered with three.js, in five curated environments (trading company, agency, tech startup, executive suite, publisher).
- Register a Hermes gateway by address, or let the setup wizard discover a local / SSH-reachable Hermes install, check the plugin, and register its profiles.
- Hire AI NPCs bound to Hermes profiles, edit their `SOUL.md` from the web, and choose model, provider, toolsets and reasoning effort per NPC.
- Talk in the office room (mention to address one employee), open group rooms with invited NPCs, and watch the full response lifecycle (queued → thinking → streaming → complete, failed or cancelled) plus what tool the agent is using right now.
- Walk into the meeting space on each office map. Meeting mode keeps the original room and characters, fades walls that block the camera, and follows the current speaker; floor control, hand raising and exportable minutes remain available.
- Track Hermes-owned kanban cards from planning through execution and review to completion. Call NPCs over and receive card completion or blocked-work notices in office chat.
- Manage each NPC's Hermes cron jobs: create schedules from blueprints, pause or resume them, run them immediately, inspect run history and receive results in office chat.
- Share the office with other people (multiplayer, groups and role-based access), in Korean, English, Japanese or Chinese.

## Screenshots

<table width="100%">
  <tr>
    <td width="50%" valign="top" align="center"><img src="public/readme/deskrpg-home-commute.gif" alt="DeskRPG 3D office morning commute" width="100%" /><br /><strong>Morning Commute</strong></td>
    <td width="50%" valign="top" align="center"><img src="public/readme/deskrpg-walk-report.gif" alt="DeskRPG agent called over, walking to the player to report" width="100%" /><br /><strong>Call Them Over to Report</strong></td>
  </tr>
  <tr>
    <td width="50%" valign="top" align="center"><img src="public/readme/deskrpg-small-talk.gif" alt="DeskRPG live office small talk" width="100%" /><br /><strong>Live Small Talk</strong></td>
    <td width="50%" valign="top" align="center"><img src="public/readme/deskrpg-ai-meeting.gif" alt="DeskRPG agent meeting" width="100%" /><br /><strong>Agent Meeting</strong></td>
  </tr>
</table>

## Quick Start

Choose one of these six ways to start DeskRPG.

### Option 1: npm Install Runtime

This is the simplest self-hosted path if you want DeskRPG as an installed app instead of a cloned repo.

**Older releases:** npm `2026.9.18` and `2026.9.19` cannot start when installed under `node_modules` (`Cannot find module '@/db'`). Use `2026.9.20` or later — the release pipeline now boots the registry-installed package before announcing it.

```bash
npx deskrpg init
npx deskrpg start
```

DeskRPG stores mutable runtime state under `~/.deskrpg/`:

- `~/.deskrpg/.env.local`
- `~/.deskrpg/data/deskrpg.db`
- `~/.deskrpg/uploads/`
- `~/.deskrpg/logs/`

Open `http://localhost:3000`.

Published npm package: `deskrpg`

### Option 2: Local Run with PostgreSQL

```bash
git clone https://github.com/dandacompany/deskrpg.git
cd deskrpg
npm install
cp .env.example .env.local
npm run setup
npm run dev
```

Open `http://localhost:3000`.

This is the best option if you want to run the full app directly from the repo.

### Option 3: Local Run with SQLite

```bash
git clone https://github.com/dandacompany/deskrpg.git
cd deskrpg
npm install
npm run setup:lite
npm run dev
```

SQLite stores data in `data/deskrpg.db`.

### Option 4: Docker with PostgreSQL

Recommended if you expect multiple users or want a more durable database.

```bash
git clone https://github.com/dandacompany/deskrpg.git
cd deskrpg
printf 'JWT_SECRET=%s\nPOSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 16)" > .env.docker
docker compose --env-file .env.docker -f docker/docker-compose.external.yml up -d
```

DeskRPG will open on `http://localhost:3102`.

Pass `-f docker/docker-compose.external.yml` every time, including `down` and `logs`. The
repository root also holds a `docker-compose.yml`, but that one is the Hostinger one-click stack:
it publishes no HTTP port and defaults `COOKIE_SECURE` to `true`, so a plain `docker compose up`
gives you nothing to connect to, and a browser would discard the login cookie over HTTP. See
[deploy/hostinger/README.md](deploy/hostinger/README.md) for that path.

Public images live on GHCR: `ghcr.io/dandacompany/deskrpg`. The Compose default is `ghcr.io/dandacompany/deskrpg:latest`; to pin a release, set `DESKRPG_IMAGE=ghcr.io/dandacompany/deskrpg:<release tag>` in `.env.docker`. The old Docker Hub `dandacompany/deskrpg` images are legacy and stop at `2026.9.19` — they receive no new releases.

### Option 5: Docker with SQLite

Recommended if you want the simplest single-machine setup.

```bash
git clone https://github.com/dandacompany/deskrpg.git
cd deskrpg
printf 'JWT_SECRET=%s\n' "$(openssl rand -hex 32)" > .env.lite
docker compose --env-file .env.lite -f docker/docker-compose.lite.yml up -d
```

DeskRPG will open on `http://localhost:3102`.

To pin a specific release, add `DESKRPG_IMAGE=ghcr.io/dandacompany/deskrpg:<release tag>` before the command ([release tags](https://github.com/dandacompany/deskrpg/releases)).

Use SQLite if you want to get started quickly. Use PostgreSQL if you want a setup that is easier to keep long term.

### Option 6: Docker with Hermes on your own computer

Runs the office and a Hermes gateway together on one machine — no VPS, no HTTPS. Ports are bound to `127.0.0.1` only.

```bash
git clone https://github.com/dandacompany/deskrpg.git
cd deskrpg
printf 'HERMES_API_KEY=%s\n' "$(openssl rand -hex 32)" > .env.hermes
echo 'OPENROUTER_API_KEY=<your key>' >> .env.hermes   # or OPENAI_API_KEY / ANTHROPIC_API_KEY
docker compose --env-file .env.hermes -f docker/docker-compose.hermes.yml up -d
```

Open `http://localhost:3102`, then add a gateway with URL `http://hermes:8642` and the `HERMES_API_KEY` value as the token. The DeskRPG plugin is installed and enabled for you. Without a model provider key the gateway does not start. Set `HERMES_DASHBOARD_PASSWORD` to also open the Hermes dashboard on `http://localhost:9119`.

To update the plugin later (the gateway screen shows when it is behind), recreate the Hermes service — this pulls the plugin and restarts Hermes; a plain `up -d` leaves the running gateway on the old plugin:

```bash
docker compose --env-file .env.hermes -f docker/docker-compose.hermes.yml up -d --force-recreate hermes
```

### Environment

Important environment variables:

- `JWT_SECRET`
- `POSTGRES_PASSWORD` (PostgreSQL Docker setup)
- `DESKRPG_LOCAL_DISCOVERY_ENABLED` (optional; lets a loopback gateway read `~/.hermes/profiles` on the host — off by default)
- `DESKRPG_HOST_SETUP_ENABLED` (optional; the local/SSH gateway setup wizard is open to `system_admin` by default — set `0` to turn it off)
- `DESKRPG_FEEDBACK_URL` (optional; where surveys and private bug reports go — see [Data DeskRPG sends](#data-deskrpg-sends). Set it to an empty value to turn both off)

For production, always set a real `JWT_SECRET`.

Gateway URL and token are not environment variables. They are registered inside the app on the
`My Gateways` page and then attached to a channel from `Settings -> Channel Settings -> AI Connection`.

## Hermes Connection

AI NPCs, task automation, and AI meetings all run through a Hermes gateway.

DeskRPG does not ship a bundled agent runtime. Run a
[Hermes Agent](https://github.com/NousResearch/hermes-agent) API server yourself — on the same
machine or on any host you can reach — and note two things from it:

- the base URL it listens on (for example `http://127.0.0.1:8642`)
- the **listener owner key** — the `API_SERVER_KEY` of the profile that owns the listener

Hermes config is machine-scoped but auth is per profile, so each profile carries its own key. Give
DeskRPG the owner key, not a secondary profile's key: kanban, cron and the event stream live on
unprefixed routes that Hermes authenticates with the owner key alone. A secondary profile's key can
still hold a conversation, but every board and schedule will fail with `plugin_unauthorized` and the
screen will not tell you why.

Connecting it to DeskRPG then takes four steps.

**1. Register the gateway**

Open `My Gateways` from the top-right menu and choose `New gateway`:

- `Display name` — anything you will recognise later
- `Hermes Gateway URL` — for example `http://127.0.0.1:8642`
- `Token` — the listener owner key (`API_SERVER_KEY`) for that gateway

Save, then run the connection test. A failed test tells you what went wrong rather than just
failing, so read the message before changing anything.

**2. Add Hermes profiles**

A gateway can serve several agent profiles, and each profile has its own key. Add them on the same
page — profiles are what NPCs actually bind to. Registering the gateway alone is not enough.

**3. Attach the gateway to a channel**

Enter a channel, then `Settings -> Channel Settings -> AI Connection`, pick your saved gateway, test,
and save. The header badge changes to `AI Connected` once it takes.

**4. Install the plugin for kanban and cron**

Conversations work without it. Kanban boards, the event stream and cron need
[`deskrpg-hermes-plugin`](https://github.com/dandacompany/deskrpg-hermes-plugin) on the gateway host:

```bash
hermes plugins install https://github.com/dandacompany/deskrpg-hermes-plugin --ref 8e0feded1749100910fdfa87397beb30c68246dc
hermes plugins enable deskrpg
# restart the gateway — routes are attached only at startup
```

`enable` is not optional: without it every plugin route answers 404 even though the install
succeeded. DeskRPG shows an equivalent one-line command in the board and schedule screens when it
detects the plugin is missing or out of date.

**Upgrading an installed plugin**

Running `install` again over an existing plugin fails with "already exists", and the old version
keeps running. Replace it in this order:

```bash
hermes plugins disable deskrpg
hermes plugins install https://github.com/dandacompany/deskrpg-hermes-plugin --ref 8e0feded1749100910fdfa87397beb30c68246dc --force
hermes plugins enable deskrpg
hermes gateway restart
```

- Disable first. Hermes refuses to replace an enabled plugin from a script or any other
  non-interactive shell, and leaves the old version in place.
- Do not skip `enable`. A replaced plugin stays disabled, and a disabled plugin answers 404 on every
  plugin route. This step also prepares the plugin's dependencies.
- Routes are attached only at startup, so the new version serves nothing until the gateway restarts.
- Run these in the root (default) Hermes home. A plugin installed with `-p <profile>` does not attach
  to the root listener that DeskRPG talks to.

Check the result with `hermes plugins list`: `deskrpg` should be `enabled` at version 0.30.x.

**Approval policies work on upstream Hermes.** From plugin 0.27.0 the plugin enforces card approval (capability `review_hooks_v1`) with documented Hermes hooks and a plugin-owned store, without changing Hermes core: an implementer cannot finish its own card, a card waiting for a person sits in `review` with no assignee, and the reviewer never approves work it did itself. Gateways without the capability create cards without a policy, and the board says they complete without approval. On upstream's package-manager install, set `HERMES_BIN` to the Hermes launcher so kanban workers can start (the setup wizard does this on Linux, and the gateway page shows the command otherwise). If you ran the earlier Dante Labs compatibility patch, follow the plugin's [steps for moving off the patched core](https://github.com/dandacompany/deskrpg-hermes-plugin#moving-an-install-off-the-patched-core).

### Bside browser connector

To give an NPC its own Bside personal PC/browser, open that NPC's **Connectors** tab, choose
**Manage**, then **Add → Bside browser**. Enter the Bside profile ID. `BSIDE_API_URL` (an optional
endpoint) and `BSIDE_API_TOKEN` (an optional token) are stored as MCP secrets, never in the
connector's create request. The preset creates:

```text
command: deskoffice-bside-mcp
args:    --profile <Bside profile ID>
trust:   untrusted
```

Install the separately deployed `deskoffice-bside-mcp` bridge on the **Hermes gateway host** and
make sure Bside is reachable from that host. A loopback URL such as `127.0.0.1` works only when
Bside and Hermes run on the same host. DeskRPG does not bundle or import Bside; this is MCP wiring
only. The preset begins untrusted, so write-capable browser tools require confirmation.
Because the Bside profile is that NPC's personal browser workspace, this connector cannot be copied
to another NPC; create a separate Bside profile and add the preset there instead.

Then open the same NPC's **Skills** tab, choose **Manage → Add → Bside browser**, and install
`deskoffice-bside-browser`. It is a profile-local work playbook for the scoped
`deskoffice_bside_*` MCP tools: health and tab discovery, snapshot/wait/action loops, and the
human-approval boundary for sensitive actions. It appears in the NPC's Skills menu as a normal
enabled skill; use its **Use** button (or a skill chip) when assigning browser work.

Now you can hire NPCs. Each NPC is bound to one Hermes profile at hire time, and you can rebind it
later without firing it.

## How DeskRPG Works

### 1. Characters

- Every user enters as a 3D character.
- Choose from 50 stylized complete-character GLB office looks, shared across the map, roster and meeting room.
- Character creation is required before entering a channel.

### 2. Channels

- A channel is a shared office space.
- Channels can be public or restricted depending on access and group rules.
- Channel maps come from map templates.

### 3. AI NPCs

- NPCs live inside channels.
- Each NPC is bound to one Hermes profile, and can be rebound later without being fired.
- One-on-one conversations are stored per character, so history survives a server restart.
- NPCs can be called over, sent back, edited, reset, and fired from in-app menus.

### 4. Kanban and Reports

- Assign kanban cards to the channel's Hermes profiles; Hermes owns the cards and their execution.
- Follow cards through planning, running, blocked work, review, and completion.
- Completed top-level cards and blocked cards post structured notices in office chat, with a link to the card.
- Call an NPC over through its menu to discuss the work beside your character.

### 5. Meetings

- Every office map includes a meeting space. Meeting mode enlarges and fixes that part of the live map instead of loading a separate room design.
- Walls between the camera and participants fade away, the camera follows the active speaker automatically, and manual rotation remains available.
- AI meetings are channel-scoped and orchestrated through the channel's Hermes gateway.
- Meeting notes are stored and visible from the header.

### 6. Schedules

- Create and manage Hermes cron jobs for each NPC without copying schedules into DeskRPG.
- Pause, resume or run jobs immediately, inspect recent runs, and create common schedules from blueprints.
- Completed runs post structured results to the office room that originated the schedule.

## Data DeskRPG Sends

DeskRPG sends nothing about your offices, staff or conversations. Two optional things can leave your browser:

- **Usage survey.** After about 30 minutes on the map, a short survey appears (at most once every 30 days). Nothing is sent until you press **Send**; **Don't ask again** stops it for good in that browser. A response carries your answers, the app version, the UI language and a random install ID used only to spot duplicate answers.
- **Private bug report.** From **Menu → Report a bug** you choose between a public GitHub issue and a private report. A private report carries what you typed, an optional contact, and the version, browser, screen size and recent error lines — each shown before sending and each can be unchecked.

When a survey is due, the browser first fetches the current questions (`GET /v1/survey`) from the same server, before you answer; that request carries no identifier, but it does reach the server from your IP.

Both go to `https://feedback.deskrpg.com`, run by the DeskRPG maintainer; the server stores a salted hash of your IP only for rate limiting, never the address. Set `DESKRPG_FEEDBACK_URL=` (empty) on the server to turn both off, or point it at your own collector.

The map also asks the GitHub API for the star count and the latest release through your DeskRPG server, so it can show a new-version dot. No identifier is sent.

## Product Notes

- Login is required even if you have an invite code.
- Invite codes are channel access helpers, not anonymous access tokens.
- Office layouts are assembled in code, while the live three.js renderer uses versioned GLB furniture, architecture and character models plus authored PBR surface textures.

## Licenses And Credits

- Project license: [LICENSE.md](LICENSE.md) — hosting providers may offer one-click installers onto customer-controlled servers under its "Infrastructure Provider Permission"; operating DeskRPG for others as a managed service is not permitted.
- Third-party licenses: [public/third-party-licenses.html](public/third-party-licenses.html)

## Support

- YouTube: [@dante-labs](https://youtube.com/@dante-labs)
- Email: `dante@dante-labs.com`
- Buy Me a Coffee: `https://buymeacoffee.com/dante.labs`
