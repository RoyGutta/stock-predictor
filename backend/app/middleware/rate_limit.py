"""Fixed-window per-client rate limiting.

Prevents a single caller from exhausting the shared upstream data quota, which
would take the app down for every other user. In-process by design -- move to
Redis when running more than one worker.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from threading import Lock

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

_WINDOW_SECONDS = 60

# Live instances, so a test can reset counters between cases. Without this the
# limiter accumulates across every test sharing the app and cases begin failing
# on ordering alone -- the flaky-signal problem CHANGELOG SM-2 exists to avoid.
_instances: list[RateLimitMiddleware] = []


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, requests_per_minute: int) -> None:
        super().__init__(app)
        self._limit = requests_per_minute
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()
        _instances.append(self)

    def reset(self) -> None:
        """Test helper. Drops every recorded hit."""
        with self._lock:
            self._hits.clear()

    @staticmethod
    def _client_key(request: Request) -> str:
        # Honour the first hop in X-Forwarded-For when behind a proxy, since
        # request.client.host would otherwise be the proxy for every caller.
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    def _is_allowed(self, key: str) -> bool:
        now = time.monotonic()
        cutoff = now - _WINDOW_SECONDS
        with self._lock:
            hits = self._hits[key]
            while hits and hits[0] < cutoff:
                hits.popleft()
            if len(hits) >= self._limit:
                return False
            hits.append(now)
            return True

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.url.path in ("/health", "/api/v1/health"):
            return await call_next(request)

        if not self._is_allowed(self._client_key(request)):
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Please slow down and try again shortly."},
                headers={"Retry-After": str(_WINDOW_SECONDS)},
            )

        return await call_next(request)


def reset_rate_limits() -> None:
    """Test helper. Clears counters on every live limiter."""
    for instance in _instances:
        instance.reset()
