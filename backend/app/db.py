"""Database engine, session factory, and ORM models.

Defaults to SQLite for local use; set ``RAVENNOW_DB`` to a Postgres URL for
production. All datetimes are stored as *naive UTC* for portability across
backends (SQLite has no real timezone support).
"""

from __future__ import annotations

import datetime as dt
from typing import Iterator, Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    create_engine,
)
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    Session,
    mapped_column,
    relationship,
    sessionmaker,
)

from .config import DATA_DIR, settings


class Base(DeclarativeBase):
    pass


def utcnow() -> dt.datetime:
    """Current time as a naive UTC datetime."""

    return dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)


def iso(value: Optional[dt.datetime]) -> Optional[str]:
    """Render a stored naive-UTC datetime as an ISO-8601 ``...Z`` string."""

    if value is None:
        return None
    return value.replace(tzinfo=dt.timezone.utc).isoformat().replace("+00:00", "Z")


DATA_DIR.mkdir(parents=True, exist_ok=True)

_connect_args = {"check_same_thread": False} if settings.is_sqlite else {}
engine = create_engine(
    settings.database_url,
    connect_args=_connect_args,
    pool_pre_ping=True,
    future=True,
)
SessionLocal = sessionmaker(
    bind=engine, autoflush=False, expire_on_commit=False, future=True
)


class Account(Base):
    """An anonymous device/installation. No PII is collected."""

    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    device_label: Mapped[str] = mapped_column(String(120), default="")
    school: Mapped[str] = mapped_column(String(40), default="carleton")
    settings_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)
    last_seen_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)

    courses: Mapped[list["Course"]] = relationship(
        back_populates="account", cascade="all, delete-orphan"
    )
    deadlines: Mapped[list["Deadline"]] = relationship(
        back_populates="account", cascade="all, delete-orphan"
    )


class Course(Base):
    __tablename__ = "courses"
    __table_args__ = (
        UniqueConstraint("account_id", "source", "external_id", name="uq_course"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    source: Mapped[str] = mapped_column(String(40), default="brightspace")
    external_id: Mapped[str] = mapped_column(String(120))
    name: Mapped[str] = mapped_column(String(240), default="")
    code: Mapped[str] = mapped_column(String(80), default="")
    url: Mapped[str] = mapped_column(String(600), default="")
    first_seen_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)
    last_seen_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)

    account: Mapped[Account] = relationship(back_populates="courses")
    deadlines: Mapped[list["Deadline"]] = relationship(back_populates="course")


class Deadline(Base):
    __tablename__ = "deadlines"
    __table_args__ = (
        UniqueConstraint("account_id", "uid", name="uq_deadline"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    course_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("courses.id", ondelete="SET NULL"), nullable=True, index=True
    )
    uid: Mapped[str] = mapped_column(String(120), index=True)
    source: Mapped[str] = mapped_column(String(40), default="brightspace")
    title: Mapped[str] = mapped_column(String(400), default="")
    type: Mapped[str] = mapped_column(String(40), default="other")
    url: Mapped[str] = mapped_column(String(600), default="")

    due_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime, nullable=True)
    previous_due_at: Mapped[Optional[dt.datetime]] = mapped_column(
        DateTime, nullable=True
    )
    submitted: Mapped[bool] = mapped_column(Boolean, default=False)
    checked: Mapped[bool] = mapped_column(Boolean, default=False)

    first_seen_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)
    last_seen_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow
    )

    account: Mapped[Account] = relationship(back_populates="deadlines")
    course: Mapped[Optional[Course]] = relationship(back_populates="deadlines")
    changes: Mapped[list["ChangeEvent"]] = relationship(
        back_populates="deadline", cascade="all, delete-orphan"
    )


class ChangeEvent(Base):
    """A detected change between two syncs of the same deadline."""

    __tablename__ = "change_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    deadline_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("deadlines.id", ondelete="CASCADE"), nullable=True, index=True
    )
    kind: Mapped[str] = mapped_column(String(40))
    title: Mapped[str] = mapped_column(String(400), default="")
    old_due: Mapped[Optional[dt.datetime]] = mapped_column(DateTime, nullable=True)
    new_due: Mapped[Optional[dt.datetime]] = mapped_column(DateTime, nullable=True)
    detected_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)

    deadline: Mapped[Optional[Deadline]] = relationship(back_populates="changes")


class FeedbackEntry(Base):
    """A feedback message or feature request from a visitor."""

    __tablename__ = "feedback"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(320), default="", index=True)
    message: Mapped[str] = mapped_column(Text, default="")
    school: Mapped[str] = mapped_column(String(80), default="carleton")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)


def get_db() -> Iterator[Session]:
    """FastAPI dependency yielding a scoped session."""

    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create tables if they do not exist."""

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)
