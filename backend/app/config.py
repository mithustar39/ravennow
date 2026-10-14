"""Application configuration.

Reads plain environment variables (and an optional ``.env`` file next to the
project) so the app stays dependency-light and deploys cleanly to Render,
Railway, Fly.io, or plain Docker.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_DIR.parent
DATA_DIR = PROJECT_ROOT / "data"


def _load_dotenv(path: Path) -> None:
    """Minimal ``.env`` loader (no external dependency).

    Existing environment variables always win, so a hosting provider's
    dashboard settings override the file.
    """

    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_dotenv(PROJECT_ROOT / ".env")


def _split(value: str | None) -> list[str]:
    if not value:
        return []
    return [part.strip() for part in value.split(",") if part.strip()]


def _database_url() -> str:
    """Resolve the DB URL, normalizing managed-Postgres URLs.

    Render, Railway and Heroku hand out ``postgres://`` URLs; SQLAlchemy's
    psycopg driver needs the ``postgresql+psycopg://`` scheme. Neon URLs already
    use ``postgresql://`` and may carry ``?sslmode=require``, which is kept.
    """

    url = os.getenv("RAVENNOW_DB")
    if not url:
        return f"sqlite:///{(DATA_DIR / 'ravennow.db').as_posix()}"
    if url.startswith("postgres://"):
        url = "postgresql+psycopg://" + url[len("postgres://") :]
    elif url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://") :]
    return url


def _public_url() -> str:
    """Public origin for robots.txt and sitemap.xml.

    Prefers an explicit ``RAVENNOW_PUBLIC_URL``, then falls back to the URL the
    host injects (Render's ``RENDER_EXTERNAL_URL``, Railway's
    ``RAILWAY_PUBLIC_DOMAIN``).
    """

    explicit = os.getenv("RAVENNOW_PUBLIC_URL", "").strip()
    if explicit:
        return explicit.rstrip("/")
    render = os.getenv("RENDER_EXTERNAL_URL", "").strip()
    if render:
        return render.rstrip("/")
    railway = os.getenv("RAILWAY_PUBLIC_DOMAIN", "").strip()
    if railway:
        return ("https://" + railway).rstrip("/")
    return ""


@dataclass(frozen=True)
class Settings:
    app_name: str = os.getenv("RAVENNOW_APP_NAME", "Raven Scheduling")
    school: str = os.getenv("RAVENNOW_SCHOOL", "carleton")
    environment: str = os.getenv("RAVENNOW_ENV", "development")
    secret_key: str = os.getenv("RAVENNOW_SECRET", "dev-insecure-change-me")

    database_url: str = field(default_factory=_database_url)

    cors_origins: list[str] = field(
        default_factory=lambda: _split(os.getenv("RAVENNOW_CORS_ORIGINS")) or ["*"]
    )

    # Branding / links surfaced on the landing page.
    support_email: str = os.getenv("RAVENNOW_SUPPORT_EMAIL", "hello@ravennow.ca")
    chrome_store_url: str = os.getenv("RAVENNOW_CHROME_STORE_URL", "")
    github_url: str = os.getenv(
        "RAVENNOW_GITHUB_URL", "https://github.com/mithustar39/ravennow"
    )
    # Direct download used by the no-store install flow (see /install).
    extension_download_url: str = os.getenv(
        "RAVENNOW_EXTENSION_URL",
        "https://github.com/mithustar39/ravennow/releases/latest/download/ravennow-extension.zip",
    )
    # Installer scripts offered on the install page.
    extension_installer_ps1_url: str = os.getenv(
        "RAVENNOW_INSTALLER_PS1_URL",
        "https://raw.githubusercontent.com/mithustar39/ravennow/main/scripts/install-extension.ps1",
    )
    extension_installer_sh_url: str = os.getenv(
        "RAVENNOW_INSTALLER_SH_URL",
        "https://raw.githubusercontent.com/mithustar39/ravennow/main/scripts/install-extension.sh",
    )
    # Admin token for reading the feedback inbox. Empty disables the endpoint.
    admin_token: str = os.getenv("RAVENNOW_ADMIN_TOKEN", "")
    # Public origin of the deployed site, used for robots.txt and sitemap.xml.
    public_url: str = field(default_factory=_public_url)

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    @property
    def is_production(self) -> bool:
        return self.environment.lower() in {"production", "prod"}


settings = Settings()
