#!/usr/bin/env bash
# Point the extension at your deployed RavenNow server.
#
#   bash scripts/configure-extension.sh https://ravennow.example.com
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

python="$here/../.venv/bin/python"
[ -x "$python" ] || python="python3"

exec "$python" "$here/configure-extension.py" "$@"
