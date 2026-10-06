#!/bin/sh
set -eu

pin="$(python -c 'from pathlib import Path; print(Path("/pin/ref").read_text().strip())')"
current="$(git -c safe.directory='*' -C /opt/data/plugins/deskrpg rev-parse HEAD 2>/dev/null || true)"
if [ "$current" != "$pin" ]; then
  hermes plugins disable deskrpg >/dev/null 2>&1 || true
  hermes plugins install https://github.com/dandacompany/deskrpg-hermes-plugin \
    --ref "$pin" --force --no-enable
fi
hermes plugins enable deskrpg

python - <<'PY'
import logging
import os
import secrets

import yaml

from hermes_cli.profiles import create_profile, get_profile_dir


def seed_provider_profiles() -> None:
    """Create missing provider profiles while preserving existing profile state."""
    cli_key = os.environ["DESKOFFICE_CLI_API_KEY"]
    if not cli_key:
        raise ValueError("DESKOFFICE_CLI_API_KEY must be configured")

    presets = {
        "lmstudio": {
            "provider": "lmstudio",
            "default": "deskoffice-lmstudio",
            "base_url": "http://host.docker.internal:1234/v1",
        },
        "ollama": {
            "provider": "custom",
            "default": "qwen3.6:35b",
            "base_url": "http://host.docker.internal:11434/v1",
            "ollama_num_ctx": 65536,
        },
        "claude-code": {
            "provider": "custom",
            "default": "claude-code",
            "base_url": "http://host.docker.internal:17773/claude/v1",
            "key_env": "DESKOFFICE_CLI_API_KEY",
        },
        "codex-cli": {
            "provider": "custom",
            "default": "codex-cli",
            "base_url": "http://host.docker.internal:17773/codex/v1",
            "key_env": "DESKOFFICE_CLI_API_KEY",
        },
    }

    for name, model in presets.items():
        if get_profile_dir(name).exists():
            logging.info("Preserved existing Hermes profile: %s", name)
            continue

        profile_dir = create_profile(
            name, clone_from="default", clone_config=True, no_alias=True
        )
        config_path = profile_dir / "config.yaml"
        config = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
        config["model"] = {**model, "context_length": 65536}
        config_path.write_text(
            yaml.safe_dump(config, allow_unicode=True, sort_keys=False), encoding="utf-8"
        )
        config_path.chmod(0o600)

        # Each new profile owns its gateway key and provider credentials.
        env = {"API_SERVER_KEY": secrets.token_hex(32)}
        if name in {"claude-code", "codex-cli"}:
            env["DESKOFFICE_CLI_API_KEY"] = cli_key
        elif name == "lmstudio":
            env["LM_API_KEY"] = "local"
            env["LM_BASE_URL"] = model["base_url"]
        else:
            env["OPENAI_API_KEY"] = "local"
        env_path = profile_dir / ".env"
        env_path.write_text(
            "".join(f"{key}={value}\n" for key, value in env.items()), encoding="utf-8"
        )
        env_path.chmod(0o600)
        logging.info("Created Hermes provider profile: %s", name)


logging.basicConfig(level=logging.INFO, format="%(message)s")
seed_provider_profiles()
PY
