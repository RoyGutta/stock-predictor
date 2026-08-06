"""Market-wide data: movers, sectors, news, search, and session status.

Everything here is cached. The free provider tiers allow 60 calls/minute
(Finnhub) and 250 calls/day (FMP), so uncached market panels would exhaust the
daily budget within minutes of more than one person using the app.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, date, datetime, time, timedelta
from typing import Any, TypeVar
from zoneinfo import ZoneInfo

from app.config import get_settings
from app.services.market_data import TTLCache
from app.services.providers import finnhub, fmp
from app.services.providers.base import ProviderError

logger = logging.getLogger(__name__)

_cache = TTLCache(maxsize=256)

T = TypeVar("T")

# --- market session ---------------------------------------------------------

_EXCHANGE_TZ = ZoneInfo("America/New_York")
_OPEN = time(9, 30)
_CLOSE = time(16, 0)
_PRE_OPEN = time(4, 0)
_AFTER_CLOSE = time(20, 0)

# US market holidays. A fixed table rather than a library: it is a handful of
# dates a year, and it must be visible and auditable rather than hidden in a
# dependency. Extend annually — the API reports when the table runs out rather
# than silently reporting a holiday as a trading day.
_HOLIDAYS: dict[int, set[str]] = {
    2026: {
        "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
        "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
    },
    2027: {
        "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
        "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
    },
}


def market_status(now: datetime | None = None) -> dict[str, Any]:
    """Current US equity market session, derived from the exchange calendar.

    This is a published schedule rather than market data, so it needs no
    provider. `holiday_data_through` is returned so a stale holiday table is
    visible to the caller instead of quietly producing wrong answers.
    """
    moment = (now or datetime.now(UTC)).astimezone(_EXCHANGE_TZ)
    today = moment.date()
    known_years = sorted(_HOLIDAYS)

    is_weekend = moment.weekday() >= 5
    is_holiday = today.isoformat() in _HOLIDAYS.get(today.year, set())
    clock = moment.time()

    if is_weekend or is_holiday:
        session = "closed"
    elif _OPEN <= clock < _CLOSE:
        session = "open"
    elif _PRE_OPEN <= clock < _OPEN:
        session = "pre-market"
    elif _CLOSE <= clock < _AFTER_CLOSE:
        session = "after-hours"
    else:
        session = "closed"

    reason = (
        "Weekend" if is_weekend
        else "Market holiday" if is_holiday
        else {
            "open": "Regular trading hours",
            "pre-market": "Pre-market trading",
            "after-hours": "After-hours trading",
            "closed": "Outside trading hours",
        }[session]
    )

    return {
        "session": session,
        "reason": reason,
        "exchange": "US equities (NYSE/NASDAQ)",
        "local_time": moment.isoformat(),
        "timezone": "America/New_York",
        "next_open": _next_open(moment).isoformat(),
        "holiday_data_through": known_years[-1] if known_years else None,
    }


def _next_open(moment: datetime) -> datetime:
    """Next regular-session open at or after `moment`."""
    candidate = moment
    if candidate.time() >= _OPEN:
        candidate = candidate + timedelta(days=1)

    for _ in range(14):  # a fortnight covers any holiday run
        day: date = candidate.date()
        if candidate.weekday() < 5 and day.isoformat() not in _HOLIDAYS.get(day.year, set()):
            return candidate.replace(
                hour=_OPEN.hour, minute=_OPEN.minute, second=0, microsecond=0
            )
        candidate = candidate + timedelta(days=1)
    return candidate


# --- cached provider access -------------------------------------------------


async def _cached(key: str, ttl: int, loader: Callable[[], Awaitable[T]]) -> T:
    hit = _cache.get(key)
    if hit is not None:
        return hit
    value = await loader()
    _cache.set(key, value, ttl)
    return value


async def get_movers(limit: int = 10) -> dict[str, Any]:
    """Gainers, losers, and most active, fetched together.

    Uses gather(return_exceptions=True) so one failing list does not blank the
    whole panel; each list reports its own error.
    """
    settings = get_settings()

    async def load() -> dict[str, Any]:
        kinds = ("gainers", "losers", "actives")
        results = await asyncio.gather(
            *(fmp.fetch_movers(kind, limit) for kind in kinds),
            return_exceptions=True,
        )

        payload: dict[str, Any] = {"errors": {}}
        for kind, result in zip(kinds, results, strict=True):
            if isinstance(result, ProviderError):
                payload[kind] = []
                payload["errors"][kind] = str(result)
            elif isinstance(result, BaseException):
                logger.exception("Unexpected failure loading %s", kind)
                payload[kind] = []
                payload["errors"][kind] = "Could not load this list."
            else:
                payload[kind] = result
        return payload

    return await _cached(f"movers:{limit}", settings.market_cache_ttl, load)


async def get_sectors() -> list[dict[str, Any]]:
    """Sector performance for the most recent session with data.

    FMP's snapshot is dated; on a weekend or before the current session settles
    the latest date returns nothing, so walk back a few days rather than
    reporting an empty heatmap.
    """
    settings = get_settings()

    async def load() -> list[dict[str, Any]]:
        today = datetime.now(_EXCHANGE_TZ).date()
        for offset in range(0, 6):
            day = today - timedelta(days=offset)
            sectors = await fmp.fetch_sector_performance(day.isoformat())
            if sectors:
                for sector in sectors:
                    sector["as_of"] = day.isoformat()
                return sectors
        return []

    return await _cached("sectors", settings.market_cache_ttl, load)


async def get_news(ticker: str, limit: int = 12) -> list[dict[str, Any]]:
    settings = get_settings()
    key = f"news:{ticker.upper()}:{limit}"
    return await _cached(
        key, settings.news_cache_ttl, lambda: finnhub.fetch_company_news(ticker, limit=limit)
    )


async def search(query: str, limit: int = 10) -> list[dict[str, Any]]:
    settings = get_settings()
    normalized = query.strip().lower()
    key = f"search:{normalized}:{limit}"
    return await _cached(
        key, settings.market_cache_ttl, lambda: finnhub.search_symbols(normalized, limit)
    )


async def get_profile(ticker: str) -> dict[str, Any] | None:
    settings = get_settings()
    key = f"profile:{ticker.upper()}"
    return await _cached(key, settings.profile_cache_ttl, lambda: fmp.fetch_profile(ticker))


def clear_cache() -> None:
    """Test helper."""
    _cache.clear()
