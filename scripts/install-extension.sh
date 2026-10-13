#!/usr/bin/env bash
set -euo pipefail

# Install the RavenNow browser extension without a browser store.
# Downloads the latest release zip and unpacks it to a stable folder.

ZIP_URL="${RAVENNOW_EXTENSION_URL:-https://github.com/mithustar39/ravennow/releases/latest/download/ravennow-extension.zip}"

if [ "$(uname)" = "Darwin" ]; then
  BASE="$HOME/Library/Application Support"
else
  BASE="${XDG_DATA_HOME:-$HOME/.local/share}"
fi
DEST="${RAVENNOW_INSTALL_DIR:-$BASE/RavenNow/extension}"

echo "RavenNow installer"
echo "Downloading the extension..."

tmp="$(mktemp -t ravennow-XXXXXX.zip)"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$ZIP_URL" -o "$tmp"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$tmp" "$ZIP_URL"
else
  echo "Need curl or wget to download. Install one and try again." >&2
  exit 1
fi

echo "Unpacking to $DEST"
rm -rf "$DEST"
mkdir -p "$DEST"
unzip -oq "$tmp" -d "$DEST"
rm -f "$tmp"

if [ ! -f "$DEST/manifest.json" ]; then
  echo "manifest.json was not found after unpacking." >&2
  exit 1
fi

cat <<EOF

Done. The extension is in:
  $DEST

Now load it:
  1. Open chrome://extensions or edge://extensions
  2. Turn on Developer mode (top right)
  3. Click "Load unpacked" and pick the folder above
EOF
