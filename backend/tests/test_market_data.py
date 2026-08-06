"""Unit tests for market data validation, caching, and range mapping.

These tests never hit the network -- the provider layer is stubbed. Live
provider behavior is covered separately in test_integration.py.
"""

from __future__ import annotations

import pytest

from app.schemas import Range
from app.services import market_data
from app.services.market_data import (
    MarketDataError,
    TTLCache,
    UnknownTickerError,
    clear_caches,
    get_quote,
    normalize_ticker,
)


@pytest.fixture(autouse=True)
def _clear() -> None:
    clear_caches()


# --- ticker validation ------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("aapl", "AAPL"),
        ("  msft  ", "MSFT"),
        ("BRK.B", "BRK.B"),
        ("RDS-A", "RDS-A"),
        ("^GSPC", "^GSPC"),
        ("BTC-USD", "BTC-USD"),
    ],
)
def test_normalize_ticker_accepts_real_symbols(raw: str, expected: str) -> None:
    assert normalize_ticker(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "   ",
        "A" * 16,               # too long
        "AAPL; DROP TABLE",     # injection-shaped
        "../../etc/passwd",     # traversal-shaped
        "http://evil.test",     # URL-shaped (SSRF-adjacent)
        "AA PL",                # whitespace inside
        "<script>",
    ],
)
def test_normalize_ticker_rejects_bad_input(raw: str) -> None:
    with pytest.raises(MarketDataError) as exc:
        normalize_ticker(raw)
    assert exc.value.status_code == 400


# --- range -> (period, interval) mapping ------------------------------------


def test_every_range_has_params() -> None:
    for range_ in Range:
        assert range_ in market_data._RANGE_PARAMS


def test_one_day_uses_intraday_interval() -> None:
    """Regression: 1D previously mapped to interval='1d', yielding one point."""
    period, interval = market_data._RANGE_PARAMS[Range.DAY_1]
    assert period == "1d"
    assert interval in market_data._INTRADAY_INTERVALS


def test_long_ranges_use_coarse_intervals() -> None:
    # A 5-year daily series would be ~1250 points before downsampling.
    assert market_data._RANGE_PARAMS[Range.YEAR_5][1] == "1wk"
    assert market_data._RANGE_PARAMS[Range.MAX][1] == "1mo"


# --- TTL cache --------------------------------------------------------------


def test_cache_returns_value_within_ttl() -> None:
    cache = TTLCache()
    cache.set("k", "v", ttl=60)
    assert cache.get("k") == "v"


def test_cache_expires_value(monkeypatch: pytest.MonkeyPatch) -> None:
    cache = TTLCache()
    clock = [1000.0]
    monkeypatch.setattr(market_data.time, "monotonic", lambda: clock[0])
    cache.set("k", "v", ttl=60)
    clock[0] += 61
    assert cache.get("k") is None


def test_cache_evicts_when_full() -> None:
    cache = TTLCache(maxsize=2)
    cache.set("a", 1, ttl=60)
    cache.set("b", 2, ttl=60)
    cache.set("c", 3, ttl=60)
    assert len(cache._data) <= 2


# --- quote assembly ---------------------------------------------------------


def _candles() -> list[dict]:
    return [
        {
            "date": "2026-01-02",
            "price": 100.0, "open": 99.0, "high": 101.0, "low": 98.0, "volume": 1000,
        },
        {
            "date": "2026-01-03",
            "price": 110.0, "open": 100.0, "high": 111.0, "low": 100.0, "volume": 2000,
        },
    ]


@pytest.fixture
def _stub_provider(monkeypatch: pytest.MonkeyPatch) -> dict[str, int]:
    calls = {"history": 0, "profile": 0}

    def fake_history(ticker: str, period: str, interval: str) -> list[dict]:
        calls["history"] += 1
        return _candles()

    def fake_profile(ticker: str) -> dict[str, str]:
        calls["profile"] += 1
        return {"company_name": "Test Corp", "currency": "USD"}

    monkeypatch.setattr(market_data, "_fetch_history_sync", fake_history)
    monkeypatch.setattr(market_data, "_fetch_profile_sync", fake_profile)
    return calls


@pytest.mark.asyncio
async def test_quote_computes_change_across_range(_stub_provider: dict[str, int]) -> None:
    quote = await get_quote("aapl", Range.MONTH_1)
    assert quote.ticker == "AAPL"
    assert quote.company_name == "Test Corp"
    assert quote.price == 110.0
    assert quote.change_points == 10.0
    assert quote.change_percent == 10.0
    assert quote.as_of == "2026-01-03"
    assert len(quote.history) == 2


@pytest.mark.asyncio
async def test_quote_is_cached(_stub_provider: dict[str, int]) -> None:
    await get_quote("AAPL", Range.MONTH_1)
    await get_quote("AAPL", Range.MONTH_1)
    assert _stub_provider["history"] == 1, "second identical request should hit the cache"


@pytest.mark.asyncio
async def test_cache_key_includes_range(_stub_provider: dict[str, int]) -> None:
    await get_quote("AAPL", Range.MONTH_1)
    await get_quote("AAPL", Range.YEAR_1)
    assert _stub_provider["history"] == 2, "different ranges must not share a cache entry"


@pytest.mark.asyncio
async def test_empty_history_raises_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(market_data, "_fetch_history_sync", lambda *a: [])
    with pytest.raises(UnknownTickerError) as exc:
        await get_quote("ZZZZ", Range.MONTH_1)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_provider_failure_does_not_leak_details(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*args: object) -> None:
        raise RuntimeError("/secret/path/creds.json not found")

    monkeypatch.setattr(market_data, "_fetch_history_sync", boom)
    with pytest.raises(MarketDataError) as exc:
        await get_quote("AAPL", Range.MONTH_1)
    assert "secret" not in str(exc.value)
    assert exc.value.status_code == 502
