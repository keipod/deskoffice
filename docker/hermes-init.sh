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
