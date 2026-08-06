"""Provider layer tests.

Never touch the network: httpx is driven by a MockTransport. The important
properties here are about failure handling and secret hygiene, not happy paths.
"""

from __future__ import annotations

import json
import logging

import httpx
import pytest

from app.services.providers import finnhub, fmp
from app.services.providers.base import (
    Capability,
    ProviderError,
    ProviderNotConfigured,
    ProviderPlanRequired,
    as_float,
    get_json,
)

API_KEY = "super-secret-key-value"


def transport(status: int, body: object = None, text: str | None = None) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if text is not None:
            return httpx.Response(status, text=text)
        return httpx.Response(status, content=json.dumps(body).encode())

    return httpx.MockTransport(handler)


async def call(status: int, body: object = None, text: str | None = None) -> object:
    async with httpx.AsyncClient(transport=transport(status, body, text)) as client:
        return await get_json(
            client,
            "https://example.test/endpoint",
            {"apikey": API_KEY},
            provider="TestProvider",
            capability=Capability.MOVERS,
        )


# --- failure mapping --------------------------------------------------------


async def test_success_returns_payload() -> None:
    assert await call(200, [{"symbol": "AAPL"}]) == [{"symbol": "AAPL"}]


async def test_402_means_the_plan_does_not_cover_it() -> None:
    with pytest.raises(ProviderPlanRequired) as exc:
        await call(402, {})
    assert exc.value.status_code == 501


async def test_403_legacy_body_is_a_plan_problem_not_a_bad_key() -> None:
    """FMP returns 403 for retired endpoints. Reporting that as a rejected key
    would send someone debugging a key that works perfectly."""
    with pytest.raises(ProviderPlanRequired):
        await call(403, text='{"Error Message": "Legacy Endpoint : no longer supported"}')


async def test_403_without_legacy_wording_is_a_key_problem() -> None:
    with pytest.raises(ProviderError) as exc:
        await call(403, text="forbidden")
    assert not isinstance(exc.value, ProviderPlanRequired)
    assert "API key" in str(exc.value)


async def test_429_is_surfaced_as_rate_limited() -> None:
    with pytest.raises(ProviderError) as exc:
        await call(429, {})
    assert exc.value.status_code == 429


async def test_500_is_a_generic_provider_failure() -> None:
    with pytest.raises(ProviderError) as exc:
        await call(500, {})
    assert exc.value.status_code == 502


async def test_error_in_a_200_body_still_raises() -> None:
    with pytest.raises(ProviderError):
        await call(200, {"Error Message": "something broke"})


async def test_malformed_json_raises_cleanly() -> None:
    with pytest.raises(ProviderError, match="malformed"):
        await call(200, text="<html>not json</html>")


async def test_timeout_is_reported_as_such() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("timed out")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ProviderError, match="did not respond in time"):
            await get_json(
                client,
                "https://example.test/x",
                {},
                provider="TestProvider",
                capability=Capability.NEWS,
            )


# --- secret hygiene ---------------------------------------------------------


async def test_api_key_never_appears_in_error_messages() -> None:
    for status in (402, 429, 500):
        with pytest.raises(ProviderError) as exc:
            await call(status, {})
        assert API_KEY not in str(exc.value)


async def test_api_key_never_appears_in_logs(caplog: pytest.LogCaptureFixture) -> None:
    """Regression: httpx logs full URLs (including the key) at INFO level, so
    our own logging must not add to that."""
    caplog.set_level(logging.DEBUG)
    with pytest.raises(ProviderError):
        await call(500, {})
    assert API_KEY not in caplog.text


# --- coercion ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("1.5", 1.5), (2, 2.0), (0, 0.0),
        (None, None), ("", None), ("abc", None), (float("nan"), None),
    ],
)
def test_as_float_coerces_or_returns_none(raw: object, expected: float | None) -> None:
    assert as_float(raw) == expected


# --- missing configuration --------------------------------------------------


@pytest.fixture
def _no_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setenv("FINNHUB_API_KEY", "")
    monkeypatch.setenv("FMP_API_KEY", "")
    yield
    get_settings.cache_clear()


async def test_fmp_without_a_key_says_which_key_is_missing(_no_keys: None) -> None:
    with pytest.raises(ProviderNotConfigured) as exc:
        await fmp.fetch_movers("gainers")
    assert exc.value.status_code == 503
    assert "Financial Modeling Prep" in str(exc.value)


async def test_finnhub_without_a_key_says_which_key_is_missing(_no_keys: None) -> None:
    with pytest.raises(ProviderNotConfigured) as exc:
        await finnhub.search_symbols("apple")
    assert exc.value.status_code == 503
    assert "Finnhub" in str(exc.value)


def test_unknown_movers_kind_is_rejected() -> None:
    with pytest.raises(ValueError, match="unknown movers kind"):
        import asyncio

        asyncio.run(fmp.fetch_movers("sideways"))


# --- normalisation ----------------------------------------------------------


def test_penny_stocks_are_flagged_not_dropped() -> None:
    """Biggest-mover lists are dominated by sub-$5 microcaps. Removing them
    would misreport the day's actual movers, so they are marked instead."""
    cheap = fmp._normalise_mover({"symbol": "ZYBT", "price": 2.36, "changesPercentage": 84.4})
    normal = fmp._normalise_mover({"symbol": "AAPL", "price": 230.0, "changesPercentage": 1.2})
    assert cheap is not None and cheap["low_priced"] is True
    assert normal is not None and normal["low_priced"] is False


def test_mover_without_a_price_is_dropped() -> None:
    assert fmp._normalise_mover({"symbol": "AAPL", "price": None}) is None
    assert fmp._normalise_mover({"price": 10.0}) is None
