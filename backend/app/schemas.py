"""Pydantic request/response schemas for the RavenNow API."""

from __future__ import annotations

import re
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class RegisterRequest(BaseModel):
    device_label: str = Field(default="", max_length=120)
    school: str = Field(default="carleton", max_length=40)


class RegisterResponse(BaseModel):
    token: str
    account_id: int
    school: str


class AccountOut(BaseModel):
    account_id: int
    school: str
    device_label: str
    created_at: str
    last_seen_at: str
    settings: dict[str, Any] = {}


class CourseIn(BaseModel):
    source: str = "brightspace"
    external_id: str
    name: str = ""
    code: str = ""
    url: str = ""


class ItemIn(BaseModel):
    source: str = "brightspace"
    uid: Optional[str] = None
    course_external_id: Optional[str] = None
    course_id: Optional[str] = None
    course_name: Optional[str] = None
    title: str
    type: str = "other"
    due: Any = None
    due_at: Any = None
    url: str = ""
    submitted: bool = False


class ScrapeIn(BaseModel):
    school: str = "carleton"
    source: str = "brightspace"
    captured_at: Any = None
    courses: list[CourseIn] = []
    items: list[ItemIn] = []


class DeadlineOut(BaseModel):
    id: int
    uid: str
    source: str
    title: str
    type: str
    url: str
    course_id: Optional[int] = None
    course_name: str = ""
    course_code: str = ""
    due_at: Optional[str] = None
    previous_due_at: Optional[str] = None
    changed: bool = False
    submitted: bool = False
    checked: bool = False
    last_seen_at: Optional[str] = None


class ChangeOut(BaseModel):
    kind: str
    deadline_id: Optional[int] = None
    uid: Optional[str] = None
    title: str = ""
    old_due: Optional[str] = None
    new_due: Optional[str] = None
    detected_at: Optional[str] = None


class CheckRequest(BaseModel):
    checked: bool = True


class SettingsIn(BaseModel):
    reminder_offsets: Optional[dict[str, list[int]]] = None
    muted_courses: Optional[list[int]] = None
    muted_types: Optional[list[str]] = None


class FeedbackIn(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    email: str = Field(default="", max_length=320)
    school: str = Field(default="carleton", max_length=80)

    @field_validator("email")
    @classmethod
    def _valid_optional_email(cls, value: str) -> str:
        value = value.strip()
        if value and not _EMAIL_RE.match(value):
            raise ValueError("invalid email address")
        return value.lower()


class FeedbackResponse(BaseModel):
    ok: bool = True
    message: str = "Thanks. We got your message."
