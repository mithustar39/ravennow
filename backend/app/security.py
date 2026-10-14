"""Token helpers.

Raven Scheduling deliberately avoids passwords and personal information. A device
registers once and receives an opaque bearer token; only its SHA-256 hash is
stored, so a database leak does not expose usable tokens.
"""

from __future__ import annotations

import hashlib
import secrets


def new_token() -> str:
    """Return a fresh, URL-safe opaque access token."""

    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """Return the hex SHA-256 digest used for storage and lookup."""

    return hashlib.sha256(token.encode("utf-8")).hexdigest()
