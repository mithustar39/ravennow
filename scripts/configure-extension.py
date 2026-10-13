"""Point the extension at a deployed RavenNow server.

Rewrites the default API base in the extension source, refreshes the example URL
on the options page, and makes sure the deployed origin sits in the manifest's
``host_permissions``. Local development URLs stay in place so the load-unpacked
flow still works against ``http://localhost:8000``.

Usage:
    python scripts/configure-extension.py https://ravennow.example.com
"""

from __future__ import annotations

import argparse
import pathlib
import re
from urllib.parse import urlsplit

ROOT = pathlib.Path(__file__).resolve().parent.parent
EXT = ROOT / "extension"


def origin_of(url: str) -> str:
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise SystemExit(f"Not a usable URL: {url}")
    return f"{parts.scheme}://{parts.netloc}"


def replace_once(path: pathlib.Path, pattern: str, replacement: str) -> bool:
    text = path.read_text(encoding="utf-8")
    new_text, count = re.subn(pattern, replacement, text, count=1)
    if count == 0:
        return False
    path.write_text(new_text, encoding="utf-8")
    return True


def patch_manifest(origin: str) -> None:
    """Insert the deployed origin into host_permissions without reformatting."""

    path = EXT / "manifest.json"
    text = path.read_text(encoding="utf-8")
    match = re.search(r'"host_permissions":\s*\[(.*?)\]', text, re.DOTALL)
    if match is None:
        raise SystemExit("Could not find host_permissions in extension/manifest.json")

    wanted = origin + "/*"
    hosts = [h for h in re.findall(r'"([^"]+)"', match.group(1)) if h != wanted]
    insert_at = 0
    for index, host in enumerate(hosts):
        if "brightspace" in host:
            insert_at = index + 1
    hosts.insert(insert_at, wanted)

    block = '"host_permissions": [\n' + ",\n".join(f'    "{h}"' for h in hosts) + "\n  ]"
    path.write_text(text[: match.start()] + block + text[match.end() :], encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "api_base",
        help="Deployed base URL, for example https://ravennow.example.com",
    )
    args = parser.parse_args()

    base = args.api_base.strip().rstrip("/")
    origin = origin_of(base)
    touched: list[str] = []

    background = EXT / "src" / "background.js"
    if replace_once(background, r'api_base:\s*"[^"]*"', f'api_base: "{base}"'):
        touched.append("src/background.js")

    panel = EXT / "src" / "sidepanel" / "panel.js"
    if replace_once(panel, r'"https?://[^"]*/app"', f'"{base}/app"'):
        touched.append("src/sidepanel/panel.js")

    options_html = EXT / "src" / "options" / "options.html"
    text = options_html.read_text(encoding="utf-8")
    text = re.sub(r"<code>https?://[^<]*</code>", f"<code>{base}</code>", text)
    text = re.sub(
        r'placeholder="https?://[^"]*"', f'placeholder="{base}"', text
    )
    options_html.write_text(text, encoding="utf-8")
    touched.append("src/options/options.html")

    patch_manifest(origin)
    touched.append("manifest.json")

    print(f"RavenNow extension now points at {base}")
    for name in touched:
        print(f"  updated {name}")
    print("Rebuild the zip with scripts/build-extension-zip" + (" (ps1/sh)."))


if __name__ == "__main__":
    main()
