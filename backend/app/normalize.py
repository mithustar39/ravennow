"""Normalize raw scraped data into a canonical shape.

The browser extension sends whatever it can read (Brightspace REST JSON, or
best-effort DOM text). This module turns that into a stable, deduplicated set
of courses and deadlines that the rest of the app can rely on.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import re
from typing import Any, Optional

# Deadline categories we care about. Everything else collapses to "other".
KNOWN_TYPES = {
    "assignment",
    "lab",
    "quiz",
    "exam",
    "discussion",
    "checklist",
    "content",
    "reading",
    "project",
    "other",
}

# Substring -> canonical type. Order matters: earlier keys win.
_TYPE_ALIASES: list[tuple[str, str]] = [
    ("assign", "assignment"),
    ("dropbox", "assignment"),
    ("homework", "assignment"),
    ("laborator", "lab"),
    ("lab", "lab"),
    ("quiz", "quiz"),
    ("test", "quiz"),
    ("midterm", "exam"),
    ("exam", "exam"),
    ("final", "exam"),
    ("discussion", "discussion"),
    ("forum", "discussion"),
    ("checklist", "checklist"),
    ("reading", "reading"),
    ("project", "project"),
    ("content", "content"),
]

_FORMATS = (
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%dT%H:%M",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%Y-%m-%d",
    "%m/%d/%Y %I:%M %p",
    "%m/%d/%Y %H:%M",
    "%m/%d/%Y",
    "%B %d, %Y %I:%M %p",
    "%B %d, %Y %H:%M",
    "%b %d, %Y %I:%M %p",
    "%B %d, %Y",
    "%b %d, %Y",
)


def _to_utc_naive(value: dt.datetime) -> dt.datetime:
    if value.tzinfo is not None:
        return value.astimezone(dt.timezone.utc).replace(tzinfo=None)
    # Naive timestamps are treated as UTC. The extension sends explicit offsets
    # whenever the source page exposes them.
    return value


def _from_epoch(value: float) -> dt.datetime:
    # Heuristic: values this large are milliseconds, not seconds.
    if abs(value) > 1e11:
        value = value / 1000.0
    return dt.datetime.fromtimestamp(value, tz=dt.timezone.utc).replace(tzinfo=None)


def parse_datetime(value: Any) -> Optional[dt.datetime]:
    """Parse a wide range of date/time inputs into naive UTC.

    Accepts ISO-8601 strings (with or without ``Z``/offset), common US and
    long-form date strings, ``datetime``/``date`` objects, and epoch
    seconds/milliseconds.
    """

    if value is None:
        return None
    if isinstance(value, dt.datetime):
        return _to_utc_naive(value)
    if isinstance(value, dt.date):
        return dt.datetime(value.year, value.month, value.day)
    if isinstance(value, bool):  # guard: bool is an int subclass
        return None
    if isinstance(value, (int, float)):
        return _from_epoch(float(value))

    text = str(value).strip()
    if not text:
        return None
    if text.isdigit():
        return _from_epoch(float(text))

    candidate = text.replace("Z", "+00:00")
    try:
        return _to_utc_naive(dt.datetime.fromisoformat(candidate))
    except ValueError:
        pass

    for fmt in _FORMATS:
        try:
            return dt.datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def normalize_type(raw: Any) -> str:
    """Map a human source label to one of :data:`KNOWN_TYPES`."""

    if not raw:
        return "other"
    text = str(raw).strip().lower()
    if text in KNOWN_TYPES:
        return text
    for needle, canonical in _TYPE_ALIASES:
        if needle in text:
            return canonical
    return "other"


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(text).lower()).strip("-")


def compute_uid(source: str, course_external_id: str | None, title: str) -> str:
    """Stable per-account identity for a deadline.

    Deliberately excludes the due date so that a rescheduled deadline is
    recognized as the *same* item (and can be shown as changed) rather than a
    delete + create.
    """

    basis = f"{source}|{course_external_id or ''}|{slug(title)}"
    return hashlib.sha1(basis.encode("utf-8")).hexdigest()


def normalize_payload(payload: dict) -> dict:
    """Validate and canonicalize a scrape payload."""

    default_source = str(payload.get("source") or "brightspace")

    courses: list[dict] = []
    seen_courses: set[tuple[str, str]] = set()
    for raw in payload.get("courses") or []:
        source = str(raw.get("source") or default_source)
        external_id = str(
            raw.get("external_id") or raw.get("id") or ""
        ).strip()
        if not external_id:
            continue
        key = (source, external_id)
        if key in seen_courses:
            continue
        seen_courses.add(key)
        courses.append(
            {
                "source": source,
                "external_id": external_id,
                "name": str(raw.get("name") or "").strip(),
                "code": str(raw.get("code") or "").strip(),
                "url": str(raw.get("url") or "").strip(),
            }
        )

    items: list[dict] = []
    seen_uids: set[str] = set()
    for raw in payload.get("items") or []:
        title = str(raw.get("title") or "").strip()
        if not title:
            continue
        source = str(raw.get("source") or default_source)
        course_external_id = str(
            raw.get("course_external_id") or raw.get("course_id") or ""
        ).strip()
        uid = str(raw.get("uid") or compute_uid(source, course_external_id, title))
        if uid in seen_uids:
            continue
        seen_uids.add(uid)
        items.append(
            {
                "uid": uid,
                "source": source,
                "course_external_id": course_external_id,
                "course_name": str(raw.get("course_name") or "").strip(),
                "title": title,
                "type": normalize_type(raw.get("type")),
                "due_at": parse_datetime(raw.get("due") or raw.get("due_at")),
                "url": str(raw.get("url") or "").strip(),
                "submitted": bool(raw.get("submitted")),
            }
        )

    return {
        "school": payload.get("school"),
        "captured_at": parse_datetime(payload.get("captured_at")),
        "courses": courses,
        "items": items,
    }
