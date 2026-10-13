"""Change detection between successive scrapes.

Given a canonical payload (see :mod:`app.normalize`), reconcile it against what
we already stored for an account and record any meaningful differences:
new deadlines, rescheduled ones, removed due dates, and submissions.
"""

from __future__ import annotations

from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import Account, ChangeEvent, Course, Deadline, iso, utcnow


def _get_course(
    db: Session, account_id: int, source: str, external_id: str
) -> Optional[Course]:
    if not external_id:
        return None
    return db.scalar(
        select(Course).where(
            Course.account_id == account_id,
            Course.source == source,
            Course.external_id == external_id,
        )
    )


def _get_deadline(db: Session, account_id: int, uid: str) -> Optional[Deadline]:
    return db.scalar(
        select(Deadline).where(
            Deadline.account_id == account_id, Deadline.uid == uid
        )
    )


def _change(
    db: Session,
    account: Account,
    deadline: Deadline,
    kind: str,
    old_due,
    new_due,
    when,
) -> ChangeEvent:
    event = ChangeEvent(
        account_id=account.id,
        deadline_id=deadline.id,
        kind=kind,
        title=deadline.title,
        old_due=old_due,
        new_due=new_due,
        detected_at=when,
    )
    db.add(event)
    deadline.changes.append(event)
    return event


def apply_scrape(db: Session, account: Account, payload: dict) -> dict[str, Any]:
    """Merge one canonical payload into the account's stored state.

    Returns a summary including the list of change events, which the caller
    (API layer) serializes for the extension.
    """

    captured = payload.get("captured_at") or utcnow()

    # --- Upsert courses -------------------------------------------------
    course_by_key: dict[tuple[str, str], Course] = {}
    for raw in payload.get("courses", []):
        source = raw["source"]
        external_id = raw["external_id"]
        course = _get_course(db, account.id, source, external_id)
        if course is None:
            course = Course(
                account_id=account.id,
                source=source,
                external_id=external_id,
                name=raw.get("name", ""),
                code=raw.get("code", ""),
                url=raw.get("url", ""),
                first_seen_at=captured,
                last_seen_at=captured,
            )
            db.add(course)
            db.flush()
        else:
            if raw.get("name"):
                course.name = raw["name"]
            if raw.get("code"):
                course.code = raw["code"]
            if raw.get("url"):
                course.url = raw["url"]
            course.last_seen_at = captured
        course_by_key[(source, external_id)] = course

    new_count = 0
    updated_count = 0
    changes: list[dict[str, Any]] = []

    # --- Upsert deadlines + diff ---------------------------------------
    for raw in payload.get("items", []):
        uid = raw["uid"]
        source = raw["source"]
        course = course_by_key.get((source, raw.get("course_external_id", "")))
        if course is None:
            course = _get_course(db, account.id, source, raw.get("course_external_id", ""))

        deadline = _get_deadline(db, account.id, uid)
        new_due = raw.get("due_at")
        submitted = bool(raw.get("submitted"))

        if deadline is None:
            deadline = Deadline(
                account_id=account.id,
                course_id=course.id if course else None,
                uid=uid,
                source=source,
                title=raw["title"],
                type=raw.get("type", "other"),
                url=raw.get("url", ""),
                due_at=new_due,
                submitted=submitted,
                first_seen_at=captured,
                last_seen_at=captured,
                updated_at=captured,
            )
            db.add(deadline)
            db.flush()
            new_count += 1
            if new_due is not None:
                event = _change(
                    db, account, deadline, "added", None, new_due, captured
                )
                changes.append(
                    {
                        "kind": event.kind,
                        "deadline_id": deadline.id,
                        "uid": deadline.uid,
                        "title": deadline.title,
                        "old_due": None,
                        "new_due": iso(new_due),
                        "detected_at": iso(event.detected_at),
                    }
                )
            continue

        # Existing deadline: detect meaningful changes.
        old_due = deadline.due_at
        if course is not None:
            deadline.course_id = course.id
        if raw.get("title"):
            deadline.title = raw["title"]
        if raw.get("type"):
            deadline.type = raw["type"]
        if raw.get("url"):
            deadline.url = raw["url"]

        if old_due != new_due:
            deadline.previous_due_at = old_due
            if old_due is None and new_due is not None:
                kind = "due_added"
            elif new_due is None:
                kind = "due_removed"
            else:
                kind = "due_changed"
            event = _change(db, account, deadline, kind, old_due, new_due, captured)
            changes.append(
                {
                    "kind": kind,
                    "deadline_id": deadline.id,
                    "uid": deadline.uid,
                    "title": deadline.title,
                    "old_due": iso(old_due),
                    "new_due": iso(new_due),
                    "detected_at": iso(event.detected_at),
                }
            )
            updated_count += 1

        if submitted and not deadline.submitted:
            event = _change(
                db, account, deadline, "submitted", old_due, new_due, captured
            )
            changes.append(
                {
                    "kind": "submitted",
                    "deadline_id": deadline.id,
                    "uid": deadline.uid,
                    "title": deadline.title,
                    "old_due": iso(old_due),
                    "new_due": iso(new_due),
                    "detected_at": iso(event.detected_at),
                }
            )

        deadline.submitted = submitted
        deadline.due_at = new_due
        deadline.last_seen_at = captured
        deadline.updated_at = captured

    account.last_seen_at = captured

    return {
        "captured_at": iso(captured),
        "courses_seen": len(course_by_key),
        "items_seen": len(payload.get("items", [])),
        "new": new_count,
        "updated": updated_count,
        "changes": changes,
    }
