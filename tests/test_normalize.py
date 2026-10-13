import datetime as dt

from app.normalize import compute_uid, normalize_payload, normalize_type, parse_datetime


def test_parse_iso_with_z():
    assert parse_datetime("2026-10-20T23:59:00Z") == dt.datetime(2026, 10, 20, 23, 59)


def test_parse_iso_with_offset_is_converted_to_utc():
    # 19:59 -04:00 == 23:59 UTC
    assert parse_datetime("2026-10-20T19:59:00-04:00") == dt.datetime(2026, 10, 20, 23, 59)


def test_parse_epoch_milliseconds():
    expected = dt.datetime(2026, 1, 1, 0, 0)
    ms = int(expected.replace(tzinfo=dt.timezone.utc).timestamp() * 1000)
    assert parse_datetime(ms) == expected


def test_parse_common_formats():
    assert parse_datetime("10/20/2026") == dt.datetime(2026, 10, 20)
    assert parse_datetime("October 20, 2026 11:59 PM") == dt.datetime(2026, 10, 20, 23, 59)


def test_parse_invalid_returns_none():
    assert parse_datetime("not a date") is None
    assert parse_datetime(None) is None
    assert parse_datetime("") is None


def test_normalize_type_aliases():
    assert normalize_type("Assignment") == "assignment"
    assert normalize_type("Lab 3") == "lab"
    assert normalize_type("Midterm Exam") == "exam"
    assert normalize_type("Discussion Board") == "discussion"
    assert normalize_type("whatever") == "other"


def test_uid_is_stable_regardless_of_due_date():
    a = compute_uid("brightspace", "course-1", "Assignment 3")
    b = compute_uid("brightspace", "course-1", "assignment 3")
    assert a == b


def test_uid_differs_across_courses_and_sources():
    assert compute_uid("brightspace", "c1", "Quiz") != compute_uid("brightspace", "c2", "Quiz")
    assert compute_uid("brightspace", "c1", "Quiz") != compute_uid("moodle", "c1", "Quiz")


def test_normalize_payload_dedupes_and_fills_uid():
    payload = {
        "source": "brightspace",
        "courses": [{"external_id": "c1", "name": "COMP 1405"}],
        "items": [
            {"course_external_id": "c1", "title": "Assignment 1", "due": "2026-10-01T23:59:00Z"},
            {"course_external_id": "c1", "title": "Assignment 1", "due": "2026-10-01T23:59:00Z"},
            {"course_external_id": "c1", "title": ""},
        ],
    }
    out = normalize_payload(payload)
    assert len(out["courses"]) == 1
    assert len(out["items"]) == 1
    assert out["items"][0]["uid"]
    assert out["items"][0]["due_at"] == dt.datetime(2026, 10, 1, 23, 59)
