"""RavenNow FastAPI application.

Serves the marketing site + web dashboard and exposes the JSON API the browser
extension talks to. Run with:

    uvicorn app.main:app --reload --app-dir backend
"""

from __future__ import annotations

import datetime as dt
import json
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import schemas as S
from .config import BACKEND_DIR, settings
from .db import (
    Account,
    ChangeEvent,
    Deadline,
    FeedbackEntry,
    get_db,
    init_db,
    iso,
    utcnow,
)
from .normalize import normalize_payload
from .security import hash_token, new_token
from .tracking import apply_scrape

STATIC_DIR = BACKEND_DIR / "static"

DEFAULT_REMINDER_OFFSETS: dict[str, list[int]] = {
    "assignment": [7, 3, 1, 0],
    "lab": [3, 1, 0],
    "quiz": [3, 1, 0],
    "exam": [14, 7, 3, 1, 0],
    "discussion": [1, 0],
    "other": [3, 1, 0],
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


# --------------------------------------------------------------------------
# Auth
# --------------------------------------------------------------------------
def current_account(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> Account:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    account = db.scalar(select(Account).where(Account.token_hash == hash_token(token)))
    if account is None:
        raise HTTPException(status_code=401, detail="Invalid token")
    account.last_seen_at = utcnow()
    return account


# --------------------------------------------------------------------------
# Serialization helpers
# --------------------------------------------------------------------------
def _account_settings(account: Account) -> dict:
    try:
        data = json.loads(account.settings_json or "{}")
    except json.JSONDecodeError:
        data = {}
    data.setdefault("reminder_offsets", DEFAULT_REMINDER_OFFSETS)
    data.setdefault("muted_courses", [])
    data.setdefault("muted_types", [])
    return data


def _deadline_out(deadline: Deadline) -> dict:
    return {
        "id": deadline.id,
        "uid": deadline.uid,
        "source": deadline.source,
        "title": deadline.title,
        "type": deadline.type,
        "url": deadline.url,
        "course_id": deadline.course_id,
        "course_name": deadline.course.name if deadline.course else "",
        "course_code": deadline.course.code if deadline.course else "",
        "due_at": iso(deadline.due_at),
        "previous_due_at": iso(deadline.previous_due_at),
        "changed": deadline.previous_due_at is not None
        and deadline.previous_due_at != deadline.due_at,
        "submitted": deadline.submitted,
        "checked": deadline.checked,
        "last_seen_at": iso(deadline.last_seen_at),
    }


# --------------------------------------------------------------------------
# API routes
# --------------------------------------------------------------------------
api = APIRouter(prefix="/api/v1")


@api.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "app": settings.app_name,
        "school": settings.school,
        "environment": settings.environment,
    }


@api.get("/meta")
def meta() -> dict:
    """Public, non-secret config the landing page uses to fill itself in."""

    return {
        "app_name": settings.app_name,
        "school": settings.school,
        "environment": settings.environment,
        "support_email": settings.support_email,
        "chrome_store_url": settings.chrome_store_url,
        "github_url": settings.github_url,
        "reminder_offsets": DEFAULT_REMINDER_OFFSETS,
    }


@api.get("/schools")
def schools() -> dict:
    return {
        "schools": [
            {"id": "carleton", "name": "Carleton University", "lms": "Brightspace", "status": "live"},
            {"id": "waterloo", "name": "University of Waterloo", "lms": "Brightspace", "status": "later"},
            {"id": "ottawa", "name": "University of Ottawa", "lms": "Brightspace", "status": "later"},
        ],
        "default": settings.school,
    }


@api.post("/accounts", response_model=S.RegisterResponse)
def register(body: S.RegisterRequest, db: Session = Depends(get_db)) -> S.RegisterResponse:
    token = new_token()
    account = Account(
        token_hash=hash_token(token),
        device_label=body.device_label,
        school=body.school or settings.school,
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    return S.RegisterResponse(token=token, account_id=account.id, school=account.school)


@api.get("/me", response_model=S.AccountOut)
def me(account: Account = Depends(current_account)) -> S.AccountOut:
    return S.AccountOut(
        account_id=account.id,
        school=account.school,
        device_label=account.device_label,
        created_at=iso(account.created_at) or "",
        last_seen_at=iso(account.last_seen_at) or "",
        settings=_account_settings(account),
    )


@api.post("/scrape")
def scrape(
    body: S.ScrapeIn,
    account: Account = Depends(current_account),
    db: Session = Depends(get_db),
) -> dict:
    normalized = normalize_payload(body.model_dump())
    result = apply_scrape(db, account, normalized)
    db.commit()
    return result


@api.get("/deadlines", response_model=list[S.DeadlineOut])
def list_deadlines(
    include_submitted: bool = Query(default=False),
    only_upcoming: bool = Query(default=False),
    account: Account = Depends(current_account),
    db: Session = Depends(get_db),
) -> list[dict]:
    stmt = select(Deadline).where(Deadline.account_id == account.id)
    if not include_submitted:
        stmt = stmt.where(Deadline.submitted.is_(False))
    if only_upcoming:
        stmt = stmt.where(Deadline.due_at.is_not(None), Deadline.due_at >= utcnow())
    stmt = stmt.order_by(Deadline.due_at.is_(None), Deadline.due_at)
    return [_deadline_out(d) for d in db.scalars(stmt).all()]


@api.post("/deadlines/{deadline_id}/check", response_model=S.DeadlineOut)
def check_deadline(
    deadline_id: int,
    body: S.CheckRequest,
    account: Account = Depends(current_account),
    db: Session = Depends(get_db),
) -> dict:
    deadline = db.scalar(
        select(Deadline).where(
            Deadline.id == deadline_id, Deadline.account_id == account.id
        )
    )
    if deadline is None:
        raise HTTPException(status_code=404, detail="Deadline not found")
    deadline.checked = body.checked
    db.commit()
    return _deadline_out(deadline)


@api.get("/changes", response_model=list[S.ChangeOut])
def list_changes(
    limit: int = Query(default=50, ge=1, le=200),
    account: Account = Depends(current_account),
    db: Session = Depends(get_db),
) -> list[dict]:
    stmt = (
        select(ChangeEvent)
        .where(ChangeEvent.account_id == account.id)
        .order_by(ChangeEvent.detected_at.desc())
        .limit(limit)
    )
    return [
        {
            "kind": e.kind,
            "deadline_id": e.deadline_id,
            "uid": e.deadline.uid if e.deadline else None,
            "title": e.title,
            "old_due": iso(e.old_due),
            "new_due": iso(e.new_due),
            "detected_at": iso(e.detected_at),
        }
        for e in db.scalars(stmt).all()
    ]


@api.get("/settings")
def get_settings(account: Account = Depends(current_account)) -> dict:
    return _account_settings(account)


@api.put("/settings")
def put_settings(
    body: S.SettingsIn,
    account: Account = Depends(current_account),
    db: Session = Depends(get_db),
) -> dict:
    data = _account_settings(account)
    patch = body.model_dump(exclude_none=True)
    data.update(patch)
    account.settings_json = json.dumps(data)
    db.commit()
    return data


@api.get("/reminders")
def reminders(
    horizon_days: int = Query(default=14, ge=1, le=90),
    account: Account = Depends(current_account),
    db: Session = Depends(get_db),
) -> dict:
    config = _account_settings(account)
    offsets = config.get("reminder_offsets") or DEFAULT_REMINDER_OFFSETS
    muted_courses = set(config.get("muted_courses") or [])
    muted_types = set(config.get("muted_types") or [])

    now = utcnow()
    horizon = now + dt.timedelta(days=horizon_days)

    stmt = select(Deadline).where(
        Deadline.account_id == account.id,
        Deadline.submitted.is_(False),
        Deadline.checked.is_(False),
        Deadline.due_at.is_not(None),
    )
    out: list[dict] = []
    for deadline in db.scalars(stmt).all():
        if deadline.course_id in muted_courses or deadline.type in muted_types:
            continue
        for days in offsets.get(deadline.type, offsets.get("other", [])):
            remind_at = deadline.due_at - dt.timedelta(days=days)
            if now <= remind_at <= horizon:
                out.append(
                    {
                        "deadline_id": deadline.id,
                        "title": deadline.title,
                        "type": deadline.type,
                        "course_name": deadline.course.name if deadline.course else "",
                        "due_at": iso(deadline.due_at),
                        "remind_at": iso(remind_at),
                        "days_before": days,
                    }
                )
    out.sort(key=lambda item: item["remind_at"] or "")
    return {"reminders": out, "count": len(out)}


@api.post("/feedback", response_model=S.FeedbackResponse)
def feedback(body: S.FeedbackIn, db: Session = Depends(get_db)) -> S.FeedbackResponse:
    db.add(
        FeedbackEntry(
            email=body.email,
            message=body.message.strip(),
            school=body.school or settings.school,
        )
    )
    db.commit()
    return S.FeedbackResponse()


@api.post("/dev/seed")
def dev_seed(
    account: Account = Depends(current_account),
    db: Session = Depends(get_db),
) -> dict:
    """Load believable demo data. Disabled in production."""

    if settings.is_production:
        raise HTTPException(status_code=403, detail="Not available in production")

    now = utcnow()
    demo_courses = [
        {"external_id": "carleton-brightspace-COMP1405", "name": "COMP 1405 A: Intro to Computer Science", "code": "COMP 1405"},
        {"external_id": "carleton-brightspace-MATH1007", "name": "MATH 1007 B: Elementary Calculus", "code": "MATH 1007"},
        {"external_id": "carleton-brightspace-ECON1001", "name": "ECON 1001 C: Intro to Economics", "code": "ECON 1001"},
    ]
    demo_items = [
        {"course_external_id": demo_courses[0]["external_id"], "title": "Assignment 3: Recursion", "type": "assignment", "due": (now + dt.timedelta(days=2)).replace(hour=23, minute=59), "source": "brightspace"},
        {"course_external_id": demo_courses[0]["external_id"], "title": "Lab 4", "type": "lab", "due": (now + dt.timedelta(days=1)).replace(hour=23, minute=59), "source": "brightspace"},
        {"course_external_id": demo_courses[1]["external_id"], "title": "Quiz 2", "type": "quiz", "due": (now + dt.timedelta(days=5, hours=12)), "source": "brightspace"},
        {"course_external_id": demo_courses[1]["external_id"], "title": "Midterm", "type": "exam", "due": (now + dt.timedelta(days=12, hours=9)), "source": "brightspace"},
        {"course_external_id": demo_courses[2]["external_id"], "title": "Problem Set 5", "type": "assignment", "due": (now + dt.timedelta(days=8, hours=17)), "source": "brightspace"},
        {"course_external_id": demo_courses[2]["external_id"], "title": "Discussion Post 3", "type": "discussion", "due": (now + dt.timedelta(days=3, hours=20)), "source": "brightspace"},
    ]
    payload = normalize_payload(
        {
            "school": account.school,
            "source": "brightspace",
            "courses": [{"source": c["external_id"].split("-")[1], **c} for c in demo_courses],
            "items": demo_items,
        }
    )
    result = apply_scrape(db, account, payload)

    # Simulate a reschedule so the "strikethrough changed date" UI has content.
    target = db.scalar(
        select(Deadline).where(
            Deadline.account_id == account.id,
            Deadline.title == "Quiz 2",
        )
    )
    if target is not None:
        moved = (target.due_at or utcnow()) + dt.timedelta(days=3)
        rescheduled = normalize_payload(
            {
                "source": "brightspace",
                "courses": [{"source": c["external_id"].split("-")[1], **c} for c in demo_courses],
                "items": [
                    {**demo_items[2], "due": moved},
                ],
            }
        )
        result = apply_scrape(db, account, rescheduled)

    db.commit()
    return result


# --------------------------------------------------------------------------
# Frontend
# --------------------------------------------------------------------------
def _mount_frontend(app: FastAPI) -> None:
    """Serve the built shadcn/ui frontend (see ``frontend/``).

    Run ``npm --prefix frontend run build`` to produce ``backend/static``.
    """

    assets_dir = STATIC_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    def _page(name: str) -> FileResponse:
        path = STATIC_DIR / name
        if not path.exists():
            raise HTTPException(
                status_code=503,
                detail=(
                    "Frontend not built. Run `npm --prefix frontend install` "
                    "and `npm --prefix frontend run build`."
                ),
            )
        return FileResponse(path)

    @app.get("/", include_in_schema=False)
    def index() -> FileResponse:
        return _page("index.html")

    @app.get("/privacy", include_in_schema=False)
    def privacy() -> FileResponse:
        return _page("privacy.html")

    @app.get("/app", include_in_schema=False)
    def dashboard() -> FileResponse:
        return _page("dashboard.html")

    @app.get("/favicon.svg", include_in_schema=False)
    def favicon() -> FileResponse:
        return _page("favicon.svg")


def create_app() -> FastAPI:
    application = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        lifespan=lifespan,
        description="Deadline tracking for Carleton students.",
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.include_router(api)
    _mount_frontend(application)
    return application


app = create_app()
