#!/usr/bin/env bash
set -euo pipefail

# Build the Chrome / Edge Web Store zip from extension/ into dist/.
# The asset is named ravennow-extension.zip so it matches the URL used by the
# install page: https://github.com/<user>/<repo>/releases/latest/download/ravennow-extension.zip

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ext="$root/extension"
dist="$root/dist"
version="$(grep -o '"version"[^,]*' "$ext/manifest.json" | head -1 | sed 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/')"

mkdir -p "$dist"
zip_path="$dist/ravennow-extension.zip"
rm -f "$zip_path"
(cd "$ext" && zip -qr "$zip_path" . -x '.*')

echo "Built $zip_path (v$version)"
