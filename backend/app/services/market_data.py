"""Price history service: validation, caching, and quote assembly.

Vendor-neutral. Prices come from whichever `PriceProvider` the registry selected
from configuration (`providers/registry.py`); this module never names a vendor.
It adds what every provider needs for server use: a TTL cache keyed by provider,
ticker, and range, threadpool offloading so a blocking client never stalls the
event loop, and translation of normalized provider errors into the API's error
format.

Cache contract: key `{provider}:{ticker}:{range}`, lifetime `CACHE_TTL_SECONDS`
(default 60 s) for quotes and `PROFILE_CACHE_TTL_SECONDS` (default 24 h) for
identity. Switching providers changes the key, so no stale series from one
source can be served under another's label.
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

from app.config import get_settings
from app.schemas import Quote, Range
from app.services.providers.base import ProviderError
from app.services.providers.prices import Bar, PriceProvider, SecurityIdentity, validate_bars
from app.services.providers.registry import get_price_provider

logger = logging.getLogger(__name__)

# Tickers are uppercase alphanumerics plus the few separators used by real
# exchanges: BRK.B, RDS-A, BTC-USD, and index symbols such as ^GSPC (which are
# the only ones allowed to lead with a caret). Anything else is rejected before
# it reaches an outbound network call.
_TICKER_PATTERN = re.compile(r"^\^?[A-Z0-9][A-Z0-9.\-=]{0,14}$")


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


async def get_quote(raw_ticker: str, range_: Range) -> Quote:
    """Return a full quote plus price history for the requested range."""
    settings = get_settings()
    ticker = normalize_ticker(raw_ticker)
    provider: PriceProvider = get_price_provider()

    cache_key = f"{provider.name}:{ticker}:{range_.value}"
    cached = _quote_cache.get(cache_key)
    if cached is not None:
        return cached

    try:
        bars: list[Bar] = await _to_thread(provider.fetch_history, ticker, range_)
    except ProviderError as exc:
        # Already normalized and user-safe; keep its status code.
        raise MarketDataError(str(exc), status_code=exc.status_code) from exc
    except Exception as exc:
        # A provider that leaks a raw exception still must not leak it further.
        logger.exception("Provider %s failed for %s (%s)", provider.name, ticker, range_.value)
        raise MarketDataError(
            "Market data is temporarily unavailable. Please try again shortly."
        ) from exc

    if not bars:
        raise UnknownTickerError(ticker)
    try:
        bars = validate_bars(bars, provider.name)
    except ProviderError as exc:
        logger.warning("Rejected %s bars for %s: %s", provider.name, ticker, exc)
        raise MarketDataError(str(exc), status_code=exc.status_code) from exc

    identity_key = f"{provider.name}:{ticker}"
    identity: SecurityIdentity | None = _profile_cache.get(identity_key)
    if identity is None:
        try:
            identity = await _to_thread(provider.fetch_identity, ticker)
        except Exception:
            # Identity is decoration; a failure degrades to the symbol.
            logger.warning("Identity lookup failed for %s via %s", ticker, provider.name)
            identity = SecurityIdentity(ticker=ticker, company_name=ticker)
        _profile_cache.set(identity_key, identity, settings.profile_cache_ttl)

    quote = _assemble_quote(ticker, range_, bars, identity, provider)
    _quote_cache.set(cache_key, quote, settings.quote_cache_ttl)
    return quote


def _assemble_quote(
    ticker: str,
    range_: Range,
    bars: list[Bar],
    identity: SecurityIdentity,
    provider: PriceProvider,
) -> Quote:
    """Pure: the same bars give the same quote whichever provider produced them,
    apart from the attribution fields, which say where they came from."""
    latest = bars[-1]
    first_close = bars[0].close
    change_points = round(latest.close - first_close, 4)
    change_percent = round((change_points / first_close) * 100, 4) if first_close else 0.0

    return Quote(
        ticker=ticker,
        company_name=identity.company_name,
        price=latest.close,
        open=latest.open,
        high=latest.high,
        low=latest.low,
        volume=latest.volume,
        change_points=change_points,
        change_percent=change_percent,
        currency=identity.currency,
        range=range_,
        history=[bar.to_candle() for bar in bars],
        as_of=latest.date,
        source=provider.name,
        adjustment=provider.adjustment.value,
    )


def clear_caches() -> None:
    """Test helper."""
    _quote_cache.clear()
    _profile_cache.clear()
