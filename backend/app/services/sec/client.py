"""The only code that talks to SEC servers.

SEC's fair-access policy (sec.gov, "Accessing EDGAR Data" and the Privacy and
Security Policy, read 2026-10-18) sets three rules this module enforces:

1. Declare who you are. Every request carries `SEC_USER_AGENT`, a name plus a
   contact email supplied by the operator. Without a valid one no request is
   made at all; the caller gets a 503 that says what to set.
2. Stay under 10 requests per second across all machines. Requests are spaced
   process-wide at `SEC_MAX_REQUESTS_PER_SECOND` (default 4, capped at 9), and
   concurrent requests for the same URL share one upstream call.
3. Download only what you need. Responses are cached, reduced to the fields the
   app uses before caching, and revalidated with If-Modified-Since / If-None-Match
   where SEC supplies validators (www.sec.gov files do; data.sec.gov does not,
   so its freshness is time-based).

No retries. A failed request is reported once; when a cached copy exists it is
served with `stale=True` and the reason, never silently.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx

from app.config import Settings, get_settings, sec_user_agent_problem
from app.services.providers.base import (
    ProviderError,
    ProviderRateLimited,
    ProviderTimeout,
    ProviderUnavailable,
)

logger = logging.getLogger(__name__)

PROVIDER = "SEC EDGAR"
TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik:010d}.json"
COMPANY_FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json"
ARCHIVES_URL = "https://www.sec.gov/Archives/edgar/data"
COMPANY_PAGE_URL = "https://www.sec.gov/edgar/browse/?CIK={cik}"

_MAX_ENTRIES = 48


class SecNotConfigured(ProviderError):
    def __init__(self, problem: str) -> None:
        super().__init__(
            f"SEC filings are not enabled on this server. {problem} SEC requires automated "
            "requests to declare a name and contact email, for example "
            "SEC_USER_AGENT=\"Your Name you@yourdomain.org\" (see README).",
            status_code=503,
        )


class SecNotFound(ProviderError):
    def __init__(self, message: str = "SEC has no record at that address.") -> None:
        super().__init__(message, status_code=404)


class SecRejected(ProviderError):
    def __init__(self) -> None:
        super().__init__(
            "SEC refused the request. SEC blocks clients that do not declare a name and "
            "contact email, and briefly limits clients that exceed 10 requests per second.",
            status_code=502,
        )


@dataclass(frozen=True)
class Fetched:
    """A payload plus the facts a user needs to judge its freshness."""

    data: Any
    retrieved_at: str  # when SEC last served or confirmed this content (UTC ISO-8601)
    stale: bool = False
    stale_reason: str | None = None


@dataclass
class _Entry:
    data: Any
    fetched_at: float  # wall clock: content last received or confirmed by SEC
    checked_at: float  # wall clock: last time freshness was established
    last_modified: str | None = None
    etag: str | None = None
    not_found: bool = False


def _iso(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, UTC).isoformat(timespec="seconds")


class SecClient:
    """Rate-limited, caching JSON fetcher for sec.gov and data.sec.gov."""

    def __init__(
        self,
        settings: Settings,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        clock: Callable[[], float] = time.time,
        monotonic: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], Any] = asyncio.sleep,
    ) -> None:
        self._settings = settings
        self._transport = transport
        self._clock = clock
        self._monotonic = monotonic
        self._sleep = sleep
        self._interval = 1.0 / settings.sec_max_requests_per_second
        self._next_slot = 0.0
        self._throttle_lock = asyncio.Lock()
        self._url_locks: dict[str, asyncio.Lock] = {}
        self._cache: OrderedDict[str, _Entry] = OrderedDict()
        self.requests_made = 0  # observable by tests; never exposed by the API

    async def get(
        self, url: str, *, ttl: int, transform: Callable[[Any], Any] = lambda raw: raw
    ) -> Fetched:
        problem = sec_user_agent_problem(self._settings.sec_user_agent)
        if problem:
            raise SecNotConfigured(problem)

        lock = self._url_locks.setdefault(url, asyncio.Lock())
        async with lock:
            entry = self._cache.get(url)
            now = self._clock()
            if entry is not None and now - entry.checked_at < ttl:
                self._cache.move_to_end(url)
                return self._answer(entry)
            try:
                entry = await self._refresh(url, entry, transform)
            except SecNotFound:
                raise
            except ProviderError as exc:
                if (
                    entry is not None
                    and not entry.not_found
                    and now - entry.fetched_at <= self._settings.sec_stale_max_age
                ):
                    logger.warning("SEC request failed; serving cached copy of %s", url)
                    return Fetched(entry.data, _iso(entry.fetched_at), True, str(exc))
                raise
            return self._answer(entry)

    @staticmethod
    def _answer(entry: _Entry) -> Fetched:
        if entry.not_found:
            raise SecNotFound()
        return Fetched(entry.data, _iso(entry.fetched_at))

    async def _throttle(self) -> None:
        async with self._throttle_lock:
            now = self._monotonic()
            wait = self._next_slot - now
            if wait > 0:
                await self._sleep(wait)
            self._next_slot = max(now, self._next_slot) + self._interval

    async def _refresh(
        self, url: str, entry: _Entry | None, transform: Callable[[Any], Any]
    ) -> _Entry:
        headers = {
            "User-Agent": self._settings.sec_user_agent,
            "Accept-Encoding": "gzip, deflate",
            "Accept": "application/json",
        }
        if entry is not None and not entry.not_found:
            if entry.etag:
                headers["If-None-Match"] = entry.etag
            if entry.last_modified:
                headers["If-Modified-Since"] = entry.last_modified

        await self._throttle()
        self.requests_made += 1
        try:
            async with httpx.AsyncClient(
                transport=self._transport,
                timeout=self._settings.sec_timeout,
                follow_redirects=True,
            ) as client:
                response = await client.get(url, headers=headers)
        except httpx.TimeoutException as exc:
            logger.warning("SEC timed out for %s", url)
            raise ProviderTimeout(PROVIDER) from exc
        except httpx.HTTPError as exc:
            logger.warning("SEC transport error for %s: %s", url, type(exc).__name__)
            raise ProviderUnavailable(PROVIDER) from exc

        now = self._clock()
        status = response.status_code
        if status == 304 and entry is not None:
            entry.checked_at = now
            entry.fetched_at = now
            return entry
        if status == 404:
            negative = _Entry(None, now, now, not_found=True)
            self._store(url, negative)
            raise SecNotFound()
        if status == 403:
            raise SecRejected()
        if status == 429:
            raise ProviderRateLimited(PROVIDER)
        if status >= 500:
            raise ProviderUnavailable(PROVIDER)
        if status != 200:
            logger.warning("SEC returned HTTP %s for %s", status, url)
            raise ProviderError("SEC EDGAR returned an unexpected response.")

        try:
            data = transform(response.json())
        except (ValueError, KeyError, TypeError, AttributeError) as exc:
            logger.warning("SEC returned a malformed body for %s", url)
            raise ProviderError("SEC EDGAR returned a malformed response.") from exc

        fresh = _Entry(
            data,
            now,
            now,
            last_modified=response.headers.get("last-modified"),
            etag=response.headers.get("etag"),
        )
        self._store(url, fresh)
        return fresh

    def _store(self, url: str, entry: _Entry) -> None:
        self._cache[url] = entry
        self._cache.move_to_end(url)
        while len(self._cache) > _MAX_ENTRIES:
            self._cache.popitem(last=False)


_client: SecClient | None = None


def get_sec_client() -> SecClient:
    """The process-wide client. One instance, so one cache and one rate limiter."""
    global _client
    if _client is None:
        _client = SecClient(get_settings())
    return _client


def reset_sec_client(client: SecClient | None = None) -> None:
    """Test helper: drop the client (cache and rate-limit state), or install one."""
    global _client
    _client = client
