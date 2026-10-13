import datetime as dt

from sqlalchemy import select

from app.db import Account, ChangeEvent, Deadline, SessionLocal
from app.normalize import normalize_payload
from app.security import hash_token
from app.tracking import apply_scrape


def _account(db, label="test"):
    account = Account(token_hash=hash_token(label + "-token"), device_label=label)
    db.add(account)
    db.commit()
    db.refresh(account)
    return account


def _payload(items, courses=None):
    return normalize_payload(
        {
            "source": "brightspace",
            "courses": courses
            or [{"external_id": "c1", "name": "COMP 1405", "code": "COMP 1405"}],
            "items": items,
        }
    )


def test_new_deadline_is_created():
    db = SessionLocal()
    try:
        account = _account(db, "new")
        result = apply_scrape(
            db,
            account,
            _payload([{"course_external_id": "c1", "title": "A1", "due": "2026-10-01T23:59:00Z"}]),
        )
        db.commit()
        assert result["new"] == 1
        stored = db.scalars(select(Deadline).where(Deadline.account_id == account.id)).all()
        assert len(stored) == 1
        assert stored[0].due_at == dt.datetime(2026, 10, 1, 23, 59)
    finally:
        db.close()


def test_reschedule_is_detected_as_same_deadline():
    db = SessionLocal()
    try:
        account = _account(db, "resched")
        apply_scrape(
            db,
            account,
            _payload([{"course_external_id": "c1", "title": "Quiz 2", "due": "2026-10-05T12:00:00Z"}]),
        )
        db.commit()

        result = apply_scrape(
            db,
            account,
            _payload([{"course_external_id": "c1", "title": "Quiz 2", "due": "2026-10-08T12:00:00Z"}]),
        )
        db.commit()

        assert result["updated"] == 1
        assert result["changes"][0]["kind"] == "due_changed"
        assert result["changes"][0]["old_due"] == "2026-10-05T12:00:00Z"

        deadlines = db.scalars(select(Deadline).where(Deadline.account_id == account.id)).all()
        assert len(deadlines) == 1  # not a duplicate
        assert deadlines[0].previous_due_at == dt.datetime(2026, 10, 5, 12, 0)
        assert deadlines[0].due_at == dt.datetime(2026, 10, 8, 12, 0)

        events = db.scalars(select(ChangeEvent).where(ChangeEvent.account_id == account.id)).all()
        assert any(e.kind == "due_changed" for e in events)
    finally:
        db.close()


def test_submission_is_recorded_once():
    db = SessionLocal()
    try:
        account = _account(db, "submit")
        item = {"course_external_id": "c1", "title": "A1", "due": "2026-10-01T23:59:00Z", "submitted": False}
        apply_scrape(db, account, _payload([item]))
        db.commit()

        item["submitted"] = True
        result = apply_scrape(db, account, _payload([item]))
        db.commit()
        assert any(c["kind"] == "submitted" for c in result["changes"])

        # Submitting again is not a new event.
        result2 = apply_scrape(db, account, _payload([item]))
        db.commit()
        assert not any(c["kind"] == "submitted" for c in result2["changes"])
    finally:
        db.close()


def test_due_date_removal_detected():
    db = SessionLocal()
    try:
        account = _account(db, "remove")
        apply_scrape(
            db,
            account,
            _payload([{"course_external_id": "c1", "title": "Reading", "due": "2026-10-01T23:59:00Z"}]),
        )
        db.commit()

        result = apply_scrape(
            db,
            account,
            _payload([{"course_external_id": "c1", "title": "Reading"}]),
        )
        db.commit()
        assert result["changes"][0]["kind"] == "due_removed"
    finally:
        db.close()
