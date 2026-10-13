"""A tiny in-memory rate limiter.

Enough to blunt accidental retry loops and casual abuse on a small deployment.
It is per-process, so it does not coordinate across multiple instances. If the
service ever scales out, swap this for a Redis-backed limiter.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from typing import Callable

from fastapi import HTTPException, Request

# name -> client key -> sliding window of hit timestamps (monotonic seconds)
_HITS: dict[str, deque[float]] = defaultdict(deque)


def client_key(request: Request) -> str:
    """Best-effort client identity.

    Behind Render/Fly/nginx the socket peer is the proxy, so prefer the first
    entry of ``X-Forwarded-For`` when it is present.
    """

    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def rate_limit(name: str, times: int, seconds: int) -> Callable[[Request], None]:
    """Build a FastAPI dependency that allows ``times`` hits per ``seconds``."""

    def dependency(request: Request) -> None:
        key = f"{name}:{client_key(request)}"
        now = time.monotonic()
        bucket = _HITS[key]
        cutoff = now - seconds
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if len(bucket) >= times:
            retry_after = max(1, int(bucket[0] + seconds - now) + 1)
            raise HTTPException(
                status_code=429,
                detail="Too many requests. Try again in a moment.",
                headers={"Retry-After": str(retry_after)},
            )
        bucket.append(now)

    return dependency


def reset() -> None:
    """Clear all counters. Used by tests."""

    _HITS.clear()
