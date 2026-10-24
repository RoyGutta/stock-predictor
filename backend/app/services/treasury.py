"""Official U.S. Treasury par yield curve, fetched from Treasury's XML feed.

Source: https://home.treasury.gov/treasury-daily-interest-rate-xml-feed
(`data=daily_treasury_yield_curve&field_tdr_date_value_month=YYYYMM`). No key,
no account. U.S. federal government works are not subject to copyright in the
United States (17 U.S.C. 105); Treasury's site policy page lists no restriction
on reuse of these statistics (checked 2026-10-24). Shown with attribution.

Request discipline (Treasury publishes no rate limit; this stays conservative):
- One request per month of history; a refresh needs at most `MONTHS` requests,
  issued one at a time and at least `MIN_INTERVAL_SECONDS` apart.
- Treasury sends no ETag or Last-Modified (observed 2026-10-24), so caching is
  time-based: the current month for an hour, closed months for a day.
- Concurrent requests for the same month share one upstream call.
- A 429 or 503 pauses requests for Retry-After (5 minutes when absent).
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
    "?data=daily_treasury_yield_curve&field_tdr_date_value_month={ym}"
)
SOURCE_PAGE = (
    "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView"
    "?type=daily_treasury_yield_curve"
)
NEW_YORK = ZoneInfo("America/New_York")

MONTHS = 4  # current month plus three: ~90 days of history and a one-month comparison
MIN_INTERVAL_SECONDS = 1.0
CURRENT_MONTH_TTL = 3_600
CLOSED_MONTH_TTL = 86_400
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

    async def month(self, ym: str, ttl: int) -> tuple[yc.ParseResult, float, str | None]:
        """(parsed month, retrieval time, stale reason or None)."""
        url = FEED_URL.format(ym=ym)
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
        if status in (429, 503):
            wait = retry_after_seconds(response.headers.get("retry-after"), self._clock())
            if not response.headers.get("retry-after"):
                wait = DEFAULT_BACKOFF
            self._backoff_until = self._clock() + min(wait, MAX_BACKOFF)
            if status == 429:
                raise ProviderRateLimited(PROVIDER)
            raise ProviderUnavailable(PROVIDER)
        if status >= 500:
            raise ProviderUnavailable(PROVIDER)
        if status != 200:
            logger.warning("Treasury returned HTTP %s", status)
            raise ProviderError("Treasury returned an unexpected response.")


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


def months_back(today: date, count: int) -> list[str]:
    """YYYYMM for the current month and the `count - 1` before it, oldest first."""
    year, month = today.year, today.month
    out = []
    for _ in range(count):
        out.append(f"{year:04d}{month:02d}")
        month -= 1
        if month == 0:
            year, month = year - 1, 12
    return list(reversed(out))


def _month_label(ym: str) -> str:
    return datetime.strptime(ym, "%Y%m").strftime("%B %Y")


async def get_yield_curve(history_days: int, *, today: date | None = None) -> dict[str, Any]:
    client = get_treasury_client()
    today = today or datetime.now(NEW_YORK).date()
    months = months_back(today, MONTHS)
    current = months[-1]

    observations: dict[date, yc.Observation] = {}
    retrieved: list[float] = []
    stale_reasons: list[str] = []
    failed: list[str] = []
    discarded = 0
    last_error: ProviderError | None = None
    for ym in months:
        ttl = CURRENT_MONTH_TTL if ym == current else CLOSED_MONTH_TTL
        try:
            result, fetched_at, stale = await client.month(ym, ttl)
        except ProviderError as exc:
            failed.append(ym)
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
        months_text = ", ".join(_month_label(m) for m in failed)
        notes.append(
            f"Treasury data for {months_text} could not be retrieved, so history and the "
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
