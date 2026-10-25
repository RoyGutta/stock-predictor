"""Official U.S. Treasury par yield curve, fetched from Treasury's XML feed.

Source: https://home.treasury.gov/treasury-daily-interest-rate-xml-feed
(`data=daily_treasury_yield_curve&field_tdr_date_value=YYYY`). No key,
no account. U.S. federal government works are not subject to copyright in the
United States (17 U.S.C. 105); Treasury's site policy page lists no restriction
on reuse of these statistics (checked 2026-10-24). Shown with attribution.

Request discipline (Treasury publishes no rate limit; this stays conservative):
- One request per calendar year of history (about 320 kB for a full year): a
  refresh needs one request, or two when the window crosses January. Requests go
  one at a time, at least `MIN_INTERVAL_SECONDS` apart. (The first version asked
  for each month separately, four requests per cold serverless start.)
- Treasury sends no ETag or Last-Modified (observed 2026-10-24), so caching is
  time-based: the current year for an hour, earlier years for a day.
- Concurrent requests for the same year share one upstream call.
- A 429, 503, or 403 pauses requests for Retry-After (5 minutes when absent). A
  403 means Treasury's edge refused this server, which was observed from the
  serverless host on 2026-10-24 while the same request succeeded elsewhere.
- Responses are read with a hard byte cap before parsing.
- On failure a cached month is served, flagged stale, with its real retrieval time.
All of this is per process; serverless instances do not share it.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from app.analytics import yield_curve as yc
from app.services.providers.base import (
    ProviderError,
    ProviderRateLimited,
    ProviderTimeout,
    ProviderUnavailable,
)
from app.services.sec.client import retry_after_seconds

logger = logging.getLogger(__name__)

PROVIDER = "U.S. Treasury"
SOURCE = "U.S. Department of the Treasury, Daily Treasury Par Yield Curve Rates"
FEED_URL = (
    "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml"
    "?data=daily_treasury_yield_curve&field_tdr_date_value={year}"
)
SOURCE_PAGE = (
    "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView"
    "?type=daily_treasury_yield_curve"
)
NEW_YORK = ZoneInfo("America/New_York")

COMPARISON_MARGIN_DAYS = 45  # history window plus room for the one-month comparison
MIN_INTERVAL_SECONDS = 1.0
CURRENT_YEAR_TTL = 3_600
PAST_YEAR_TTL = 86_400
STALE_MAX_AGE = 7 * 86_400
TIMEOUT_SECONDS = 15.0
DEFAULT_BACKOFF = 300
MAX_BACKOFF = 1_800
MAX_ENTRIES = 24

METHODOLOGY = (
    "Par yields are read by Treasury from its daily par yield curve, which is based on "
    "closing market bid prices of the most recently auctioned Treasury securities in the "
    "over-the-counter market. They are end-of-day indicative rates, not live transaction "
    "prices, and are published after the market day; weekends and market holidays have no "
    "observation."
)


@dataclass
class _Entry:
    result: yc.ParseResult
    fetched_at: float
    checked_at: float


class TreasuryClient:
    def __init__(
        self,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        clock: Callable[[], float] = time.time,
        monotonic: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], Any] = asyncio.sleep,
    ) -> None:
        self._transport = transport
        self._clock = clock
        self._monotonic = monotonic
        self._sleep = sleep
        self._cache: OrderedDict[str, _Entry] = OrderedDict()
        self._locks: dict[str, asyncio.Lock] = {}
        self._throttle_lock = asyncio.Lock()
        self._next_slot = 0.0
        self._backoff_until = 0.0
        self.requests_made = 0

    async def year(self, year: int, ttl: int) -> tuple[yc.ParseResult, float, str | None]:
        """(parsed year, retrieval time, stale reason or None)."""
        url = FEED_URL.format(year=year)
        lock = self._locks.setdefault(url, asyncio.Lock())
        async with lock:
            entry = self._cache.get(url)
            now = self._clock()
            if entry is not None and now - entry.checked_at < ttl:
                self._cache.move_to_end(url)
                return entry.result, entry.fetched_at, None
            try:
                result = await self._fetch(url)
            except ProviderError as exc:
                if entry is not None and now - entry.fetched_at <= STALE_MAX_AGE:
                    return entry.result, entry.fetched_at, str(exc)
                raise
            fetched = self._clock()
            self._store(url, _Entry(result, fetched, fetched))
            return result, fetched, None

    def _store(self, url: str, entry: _Entry) -> None:
        self._cache[url] = entry
        self._cache.move_to_end(url)
        while len(self._cache) > MAX_ENTRIES:
            self._cache.popitem(last=False)
        if len(self._locks) > MAX_ENTRIES * 2:
            idle = [k for k, v in self._locks.items() if k not in self._cache and not v.locked()]
            for key in idle:
                del self._locks[key]

    async def _throttle(self) -> None:
        async with self._throttle_lock:
            now = self._monotonic()
            if self._next_slot > now:
                await self._sleep(self._next_slot - now)
            self._next_slot = max(now, self._next_slot) + MIN_INTERVAL_SECONDS

    async def _fetch(self, url: str) -> yc.ParseResult:
        if self._clock() < self._backoff_until:
            raise ProviderRateLimited(PROVIDER)
        await self._throttle()
        self.requests_made += 1
        body = bytearray()
        try:
            async with (
                httpx.AsyncClient(
                    transport=self._transport,
                    timeout=TIMEOUT_SECONDS,
                    headers={"User-Agent": "stock-predictor/0.3 (educational)"},
                    follow_redirects=True,
                ) as client,
                client.stream("GET", url) as response,
            ):
                self._check_status(response)
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > yc.MAX_FEED_BYTES:
                        raise ProviderError("Treasury returned an unexpectedly large response.")
        except httpx.TimeoutException as exc:
            raise ProviderTimeout(PROVIDER) from exc
        except httpx.HTTPError as exc:
            raise ProviderUnavailable(PROVIDER) from exc
        try:
            result = yc.parse_feed(bytes(body))
        except yc.TreasuryFeedError as exc:
            logger.warning("Treasury feed rejected: %s", exc)
            raise ProviderError(
                "Treasury returned data in an unexpected format, so it was not used."
            ) from exc
        if result.rejected_values or result.unknown_fields:
            logger.warning(
                "Treasury feed anomalies: %d rejected values, unknown fields %s",
                len(result.rejected_values),
                result.unknown_fields,
            )
        return result

    def _check_status(self, response: httpx.Response) -> None:
        status = response.status_code
        if status in (403, 429, 503):
            wait = retry_after_seconds(response.headers.get("retry-after"), self._clock())
            if not response.headers.get("retry-after"):
                wait = DEFAULT_BACKOFF
            self._backoff_until = self._clock() + min(wait, MAX_BACKOFF)
            logger.warning("Treasury returned HTTP %s; pausing for %.0fs", status, wait)
            if status == 429:
                raise ProviderRateLimited(PROVIDER)
            if status == 403:
                raise ProviderError(
                    "Treasury's website refused this server's request (HTTP 403). This is a "
                    "block on the server's network address, not a problem with the data; "
                    "requests are paused before trying again."
                )
            raise ProviderUnavailable(PROVIDER)
        if status >= 500:
            raise ProviderUnavailable(PROVIDER)
        if status != 200:
            logger.warning("Treasury returned HTTP %s", status)
            raise ProviderError(f"Treasury returned an unexpected response (HTTP {status}).")


_client: TreasuryClient | None = None


def get_treasury_client() -> TreasuryClient:
    global _client
    if _client is None:
        _client = TreasuryClient()
    return _client


def reset_treasury_client(client: TreasuryClient | None = None) -> None:
    global _client
    _client = client


def _iso(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, UTC).isoformat(timespec="seconds")


def years_needed(today: date, history_days: int) -> list[int]:
    """Calendar years covering the history window and the comparison, oldest first."""
    earliest = today - timedelta(days=history_days + COMPARISON_MARGIN_DAYS)
    return list(range(earliest.year, today.year + 1))


async def get_yield_curve(history_days: int, *, today: date | None = None) -> dict[str, Any]:
    client = get_treasury_client()
    today = today or datetime.now(NEW_YORK).date()
    years = years_needed(today, history_days)

    observations: dict[date, yc.Observation] = {}
    retrieved: list[float] = []
    stale_reasons: list[str] = []
    failed: list[int] = []
    discarded = 0
    last_error: ProviderError | None = None
    for year in years:
        ttl = CURRENT_YEAR_TTL if year == today.year else PAST_YEAR_TTL
        try:
            result, fetched_at, stale = await client.year(year, ttl)
        except ProviderError as exc:
            failed.append(year)
            last_error = exc
            continue
        retrieved.append(fetched_at)
        if stale:
            stale_reasons.append(stale)
        discarded += len(result.rejected_values)
        for o in result.observations:
            observations[o.day] = o

    ordered = sorted(observations.values(), key=lambda o: o.day)
    summary = yc.summarize(ordered)
    if summary is None:
        raise last_error or ProviderError("Treasury published no yield-curve observations.")

    latest_day = date.fromisoformat(summary["date"])
    notes: list[str] = []
    if failed:
        years_text = ", ".join(str(y) for y in failed)
        notes.append(
            f"Treasury data for {years_text} could not be retrieved, so history and the "
            "one-month comparison may be shorter than usual."
        )
    if summary["comparison_date"] is None:
        notes.append("There is no published observation about one month earlier to compare with.")
    if summary["missing_core_maturities"]:
        labels = [m.label for m in yc.MATURITIES if m.key in summary["missing_core_maturities"]]
        notes.append(
            f"The latest observation has no value for {', '.join(labels)}. Those maturities "
            "are shown as missing, not estimated."
        )
    if discarded:
        notes.append(
            f"{discarded} malformed value(s) in Treasury's response were discarded and are "
            "shown as missing."
        )

    return {
        "source": SOURCE,
        "source_url": SOURCE_PAGE,
        "methodology": METHODOLOGY,
        "units": "percent (bond-equivalent yield); spreads in percentage points and basis points",
        "retrieved_at": _iso(min(retrieved)),
        "stale": bool(stale_reasons),
        "stale_reason": stale_reasons[0] if stale_reasons else None,
        "observation_age_days": (today - latest_day).days,
        "upward_threshold_pp": yc.UPWARD_THRESHOLD_PP,
        "latest": summary,
        "history": yc.history_rows(ordered, latest_day - timedelta(days=history_days)),
        "notes": notes,
    }
