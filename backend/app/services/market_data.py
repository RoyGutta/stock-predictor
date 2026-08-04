"""Market data retrieval.

Wraps yfinance behind a narrow interface so a licensed provider can be swapped
in later without touching the routes. Adds the two things the raw library lacks
for server use: a TTL cache (yfinance is aggressively rate-limited) and
threadpool offloading (yfinance is blocking, and would otherwise stall the
event loop for every concurrent request).
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from collections.abc import Callable
from dataclasses import dataclass
from threading import Lock
from typing import Any

import yfinance as yf

from app.config import get_settings
from app.schemas import Candle, Quote, Range

logger = logging.getLogger(__name__)

SOURCE = "yfinance"

# Tickers are uppercase alphanumerics plus the few separators used by real
# exchanges: BRK.B, RDS-A, BTC-USD, and index symbols such as ^GSPC (which are
# the only ones allowed to lead with a caret). Anything else is rejected before
# it reaches an outbound network call.
_TICKER_PATTERN = re.compile(r"^\^?[A-Z0-9][A-Z0-9.\-=]{0,14}$")

# Each range needs an interval that actually produces a series. The original
# code mapped "1D" -> period=1d, interval=1d, which yields exactly one point.
_RANGE_PARAMS: dict[Range, tuple[str, str]] = {
    Range.DAY_1: ("1d", "5m"),
    Range.DAY_5: ("5d", "30m"),
    Range.MONTH_1: ("1mo", "1d"),
    Range.MONTH_3: ("3mo", "1d"),
    Range.MONTH_6: ("6mo", "1d"),
    Range.YEAR_1: ("1y", "1d"),
    Range.YEAR_5: ("5y", "1wk"),
    Range.MAX: ("max", "1mo"),
}

# Ranges finer than a day need the time component preserved in the timestamp.
_INTRADAY_INTERVALS = {"1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h"}


class MarketDataError(Exception):
    """Raised when data cannot be retrieved. Message is safe to show a user."""

    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


class UnknownTickerError(MarketDataError):
    def __init__(self, ticker: str) -> None:
        super().__init__(f"No market data found for '{ticker}'.", status_code=404)


@dataclass
class _Entry:
    value: Any
    expires_at: float


class TTLCache:
    """Small thread-safe TTL cache.

    Deliberately in-process: it removes the dominant rate-limit pressure with no
    infrastructure. Swap for Redis (REDIS_URL) when running more than one worker.
    """

    def __init__(self, maxsize: int = 512) -> None:
        self._data: dict[str, _Entry] = {}
        self._lock = Lock()
        self._maxsize = maxsize

    def get(self, key: str) -> Any | None:
        now = time.monotonic()
        with self._lock:
            entry = self._data.get(key)
            if entry is None:
                return None
            if entry.expires_at < now:
                del self._data[key]
                return None
            return entry.value

    def set(self, key: str, value: Any, ttl: int) -> None:
        with self._lock:
            if len(self._data) >= self._maxsize:
                # Evict whatever expires soonest; cheap and good enough at this size.
                oldest = min(self._data, key=lambda k: self._data[k].expires_at)
                del self._data[oldest]
            self._data[key] = _Entry(value, time.monotonic() + ttl)

    def clear(self) -> None:
        with self._lock:
            self._data.clear()


_quote_cache = TTLCache()
_profile_cache = TTLCache()


def normalize_ticker(raw: str) -> str:
    """Validate and canonicalize a ticker symbol.

    Raises MarketDataError(400) rather than passing unvalidated user input to an
    outbound HTTP call.
    """
    ticker = raw.strip().upper()
    if not ticker:
        raise MarketDataError("A ticker symbol is required.", status_code=400)
    if not _TICKER_PATTERN.match(ticker):
        raise MarketDataError(
            "Invalid ticker symbol. Use 1-15 characters: letters, digits, and . - ^ =",
            status_code=400,
        )
    return ticker


async def _to_thread(fn: Callable[..., Any], *args: Any) -> Any:
    return await asyncio.to_thread(fn, *args)


def _fetch_profile_sync(ticker: str) -> dict[str, str]:
    """Fetch slow-changing company metadata.

    `Ticker.info` is by far the most expensive call yfinance makes, so it is
    cached separately with a long TTL and never blocks a price response --
    failure here degrades to using the symbol as the display name.
    """
    try:
        info = yf.Ticker(ticker).info
    except Exception:
        logger.warning("Profile lookup failed for %s", ticker, exc_info=True)
        return {"company_name": ticker, "currency": "USD"}

    return {
        "company_name": info.get("longName") or info.get("shortName") or ticker,
        "currency": info.get("currency") or "USD",
    }


def _fetch_history_sync(ticker: str, period: str, interval: str) -> list[dict[str, Any]]:
    frame = yf.Ticker(ticker).history(period=period, interval=interval)
    if frame is None or frame.empty:
        return []

    intraday = interval in _INTRADAY_INTERVALS
    candles: list[dict[str, Any]] = []
    for index, row in frame.iterrows():
        close = row.get("Close")
        if close is None or close != close:  # skip NaN closes
            continue
        candles.append(
            {
                "date": index.isoformat() if intraday else index.date().isoformat(),
                "price": round(float(close), 4),
                "open": round(float(row["Open"]), 4),
                "high": round(float(row["High"]), 4),
                "low": round(float(row["Low"]), 4),
                "volume": int(row["Volume"]) if row["Volume"] == row["Volume"] else 0,
            }
        )
    return candles


async def get_quote(raw_ticker: str, range_: Range) -> Quote:
    """Return a full quote plus price history for the requested range."""
    settings = get_settings()
    ticker = normalize_ticker(raw_ticker)

    cache_key = f"{ticker}:{range_.value}"
    cached = _quote_cache.get(cache_key)
    if cached is not None:
        return cached

    period, interval = _RANGE_PARAMS[range_]

    try:
        candles = await _to_thread(_fetch_history_sync, ticker, period, interval)
    except Exception as exc:
        # Log the real cause server-side; return an opaque message to the client.
        logger.exception("History fetch failed for %s (%s)", ticker, range_.value)
        raise MarketDataError(
            "Market data is temporarily unavailable. Please try again shortly."
        ) from exc

    if not candles:
        raise UnknownTickerError(ticker)

    profile = _profile_cache.get(ticker)
    if profile is None:
        profile = await _to_thread(_fetch_profile_sync, ticker)
        _profile_cache.set(ticker, profile, settings.profile_cache_ttl)

    latest = candles[-1]
    first_close = candles[0]["price"]
    change_points = round(latest["price"] - first_close, 4)
    change_percent = round((change_points / first_close) * 100, 4) if first_close else 0.0

    quote = Quote(
        ticker=ticker,
        company_name=profile["company_name"],
        price=latest["price"],
        open=latest["open"],
        high=latest["high"],
        low=latest["low"],
        volume=latest["volume"],
        change_points=change_points,
        change_percent=change_percent,
        currency=profile["currency"],
        range=range_,
        history=[Candle(**candle) for candle in candles],
        as_of=latest["date"],
        source=SOURCE,
    )

    _quote_cache.set(cache_key, quote, settings.quote_cache_ttl)
    return quote


def clear_caches() -> None:
    """Test helper."""
    _quote_cache.clear()
    _profile_cache.clear()
