"""Unit tests for the in-memory rate limiter."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.ratelimit import rate_limit, reset


class _FakeClient:
    def __init__(self, host: str) -> None:
        self.host = host


class _FakeRequest:
    def __init__(self, host: str = "10.0.0.9") -> None:
        self.headers: dict[str, str] = {}
        self.client = _FakeClient(host)


def test_rate_limit_allows_then_blocks():
    reset()
    dependency = rate_limit("unit", 2, 60)
    request = _FakeRequest()

    dependency(request)
    dependency(request)

    with pytest.raises(HTTPException) as exc:
        dependency(request)
    assert exc.value.status_code == 429
    assert exc.value.headers is not None
    assert int(exc.value.headers["Retry-After"]) >= 1


def test_rate_limit_keys_by_client():
    reset()
    dependency = rate_limit("unit", 1, 60)
    dependency(_FakeRequest("10.0.0.1"))
    # A different client still has its own budget.
    dependency(_FakeRequest("10.0.0.2"))

    with pytest.raises(HTTPException):
        dependency(_FakeRequest("10.0.0.1"))


def test_forwarded_header_identifies_client():
    reset()
    dependency = rate_limit("unit", 1, 60)

    first = _FakeRequest("10.0.0.1")
    first.headers["x-forwarded-for"] = "203.0.113.7, 10.0.0.1"
    dependency(first)

    # Same forwarded client, different socket peer: still blocked.
    second = _FakeRequest("10.0.0.2")
    second.headers["x-forwarded-for"] = "203.0.113.7"
    with pytest.raises(HTTPException):
        dependency(second)
