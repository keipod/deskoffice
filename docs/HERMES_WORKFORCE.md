# Hermes workforce preview — 2026-10-09

## Architecture and provenance

DeskOffice is the **game-like control UI**. Hermes Agent is the **only live employee execution engine** on the preview. Five persistent named profiles (`chief`, `mina`, `rin`, `bora`, `jay`) belong to Hermes; DeskOffice's `agents` are UI bindings. Hermes retains the real session, memory, skills and tool execution. The legacy DeskOffice meeting view is not an official Hermes Bot Group Chat; use the native Hermes Desktop plugin for true Bot Groups until a supported integration is available.

## Tested hosts and services

- Hermes upstream clone: `~/git_repo/hermes-agent`; primary home: `~/.hermes`.
- Persistent user gateway: `systemctl --user status hermes-gateway` on loopback `127.0.0.1:38642`.
- Preview DeskOffice: `127.0.0.1:32184`; production DeskOffice on `32180` is unchanged.
- Credential exports: `~/.hermes/deskoffice-integration.env`, `~/.hermes/deskoffice-preview.env` (mode `0600`; do not commit).
- Trial text inference only: CPU `llama-server` on `127.0.0.1:39010`, actual 65,536-token context, Qwen3-VL 8B quantized. This is an integration-test fallback, not a recommended 5-agent production model.

## Access

Use an authenticated SSH tunnel; the preview intentionally listens on loopback rather than the LAN.

```bash
ssh -L 32184:127.0.0.1:32184 whitefield
# Open http://127.0.0.1:32184; HTTP Basic user = admin
# Retrieve the Basic password in an authenticated local shell:
source ~/.hermes/deskoffice-preview.env
printf '%s\n' "$DESKOFFICE_BASIC_PASSWORD"
```

Do not embed Basic credentials in web URLs or logs. The backend enforces Basic authentication and same-origin mutation requests; startup fails closed when asked to listen on non-loopback without a password.

## Employee checks

```bash
hermes profile list
hermes gateway status
hermes -p chief computer-use screen status
hermes -p chief chat --oneshot --safe-mode --max-turns 2 -q 'Say READY without using tools.'
```

The DeskOffice `/api/hermes/screens` endpoint invokes the **official Hermes CLI** for each registered profile. The Screen Wall is real state and a start/stop control, **not** yet a native live RFB display. Observe, take over, and return control in the native Hermes Desktop Bot Screen until a secure `display.observe` ticket / `/api/display/ws` bridge is implemented.

## To enable real Bot Screens on Ubuntu

Install the **official native prerequisites**, requiring a machine administrator:

```bash
sudo apt-get update
sudo apt-get install -y --no-install-recommends tigervnc-standalone-server xfce4-panel xfwm4 xfdesktop4 xfce4-settings xfce4-terminal dbus-x11 x11-xserver-utils x11-utils x11-xkb-utils xauth fonts-dejavu-core
hermes -p chief computer-use screen start
hermes -p chief computer-use screen status
```

The preview returns `missing_packages` until this succeeds. Don't claim to show or control desktops before it does. Do not use fake thumbnails or scripted "live" indicators.

## Meeting-mode distinction

Hermes Desktop Bot Mode supports real multi-profile group conversations and Bot Group Chat orchestration. Current DeskOffice `Meetings` is its *existing* round-robin workflow that invokes each bound Hermes profile separately and injects the common transcript; it is **not** the native Hermes Desktop group room. Do not claim equivalence. In production the meeting must generate decisions, named owners, deadlines and verifiable tasks, with human approval for external actions. Native group meeting integration into this web GUI needs an upstream-supported room API or a carefully authenticated desktop bridge.

## Safety and business operations

- Server startup defaults to `127.0.0.1`; no unauthenticated LAN interface.
- Profiles have independent identity, separate SOUL.md and secrets stored under `~/.hermes/profiles`.
- Emails, publishing, money movement, deleting customer resources and credentials require human confirmation. Prompt instructions are not themselves a hard authorization boundary; wire tool-level gates before external autonomy.
- No external messages, publications, payments or destructive actions were performed during this preview setup.
- After moving to a stronger agent model, run tool-use and outcome-verification tests before claiming autonomous business operations.
