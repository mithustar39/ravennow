from fastapi.testclient import TestClient

from app.main import app


def _client():
    return TestClient(app)


def _register(client, label="api-test"):
    res = client.post("/api/v1/accounts", json={"device_label": label, "school": "carleton"})
    assert res.status_code == 200
    return res.json()["token"]


def _auth(token):
    return {"Authorization": "Bearer " + token}


def test_health_and_meta_and_schools():
    with _client() as client:
        assert client.get("/api/v1/health").json()["status"] == "ok"
        meta = client.get("/api/v1/meta").json()
        assert "support_email" in meta
        assert client.get("/api/v1/schools").json()["default"] == "carleton"


def test_landing_and_legal_pages_served():
    with _client() as client:
        home = client.get("/")
        assert home.status_code == 200
        assert "RavenNow" in home.text
        assert client.get("/privacy").status_code == 200
        assert client.get("/app").status_code == 200


def test_auth_is_required():
    with _client() as client:
        assert client.get("/api/v1/deadlines").status_code == 401
        assert client.get("/api/v1/me", headers=_auth("nope")).status_code == 401


def test_register_scrape_and_list():
    with _client() as client:
        token = _register(client)

        payload = {
            "school": "carleton",
            "source": "brightspace",
            "courses": [{"source": "brightspace", "external_id": "c1", "name": "COMP 1405", "code": "COMP 1405"}],
            "items": [
                {"source": "brightspace", "course_external_id": "c1", "title": "A1", "type": "assignment", "due": "2026-10-01T23:59:00Z"},
                {"source": "brightspace", "course_external_id": "c1", "title": "Quiz 1", "type": "quiz", "due": "2026-10-03T12:00:00Z"},
            ],
        }
        res = client.post("/api/v1/scrape", json=payload, headers=_auth(token))
        assert res.status_code == 200
        assert res.json()["new"] == 2

        deadlines = client.get("/api/v1/deadlines", headers=_auth(token)).json()
        assert len(deadlines) == 2
        assert deadlines[0]["title"] == "A1"  # sorted by due date
        assert deadlines[0]["course_name"] == "COMP 1405"


def test_reschedule_shows_in_deadline_and_changes():
    with _client() as client:
        token = _register(client, "api-resched")
        base = {
            "source": "brightspace",
            "courses": [{"external_id": "c1", "name": "MATH 1007", "code": "MATH 1007"}],
        }
        client.post("/api/v1/scrape", headers=_auth(token), json={
            **base,
            "items": [{"course_external_id": "c1", "title": "Quiz 2", "due": "2026-10-05T12:00:00Z"}],
        })
        client.post("/api/v1/scrape", headers=_auth(token), json={
            **base,
            "items": [{"course_external_id": "c1", "title": "Quiz 2", "due": "2026-10-09T12:00:00Z"}],
        })

        deadlines = client.get("/api/v1/deadlines", headers=_auth(token)).json()
        assert len(deadlines) == 1
        assert deadlines[0]["changed"] is True
        assert deadlines[0]["previous_due_at"] == "2026-10-05T12:00:00Z"

        changes = client.get("/api/v1/changes", headers=_auth(token)).json()
        assert any(c["kind"] == "due_changed" for c in changes)


def test_check_toggle_and_settings():
    with _client() as client:
        token = _register(client, "api-check")
        client.post("/api/v1/scrape", headers=_auth(token), json={
            "source": "brightspace",
            "items": [{"course_external_id": "c1", "title": "A1", "due": "2026-10-01T23:59:00Z"}],
        })
        deadline = client.get("/api/v1/deadlines", headers=_auth(token)).json()[0]

        res = client.post(f"/api/v1/deadlines/{deadline['id']}/check", json={"checked": True}, headers=_auth(token))
        assert res.json()["checked"] is True

        # Checked items are excluded from reminders.
        reminders = client.get("/api/v1/reminders", headers=_auth(token)).json()
        assert reminders["count"] == 0

        settings = client.put("/api/v1/settings", json={"muted_types": ["quiz"]}, headers=_auth(token)).json()
        assert "quiz" in settings["muted_types"]


def test_feedback_accepts_and_validates():
    with _client() as client:
        ok = client.post("/api/v1/feedback", json={"message": "Please add uOttawa", "email": "Student@Cmail.Carleton.ca"})
        assert ok.status_code == 200
        assert ok.json()["ok"] is True

        # Email is optional.
        assert client.post("/api/v1/feedback", json={"message": "love it"}).status_code == 200

        # Empty message and malformed email are rejected.
        assert client.post("/api/v1/feedback", json={"message": ""}).status_code == 422
        assert client.post("/api/v1/feedback", json={"message": "hi", "email": "nope"}).status_code == 422


def test_dev_seed_loads_demo_data():
    with _client() as client:
        token = _register(client, "api-seed")
        res = client.post("/api/v1/dev/seed", headers=_auth(token))
        assert res.status_code == 200
        deadlines = client.get("/api/v1/deadlines", headers=_auth(token)).json()
        assert len(deadlines) >= 5
