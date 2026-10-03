"""Provider selection policy, normalized error translation, and credential hygiene."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.schemas import Range
from app.services import market_data
from app.services.providers import registry
from app.services.providers.base import (
    Capability,
    ProviderNotConfigured,
    ProviderRateLimited,
    ProviderTimeout,
    ProviderUnsupported,
)
from app.services.providers.prices import AdjustmentBasis, Bar, SecurityIdentity


@pytest.fixture(autouse=True)
def _fresh_settings(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    for var in ("DEMO_MODE", "MARKET_DATA_PROVIDER", "APP_ENV"):
        monkeypatch.delenv(var, raising=False)
    get_settings.cache_clear()
    registry.reset_price_provider()
    yield
    get_settings.cache_clear()
    registry.reset_price_provider()


def _settings(monkeypatch: pytest.MonkeyPatch, **env: str):
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    get_settings.cache_clear()
    return get_settings()


# --- selection policy ---------------------------------------------------------


def test_local_default_is_yfinance(monkeypatch: pytest.MonkeyPatch) -> None:
    assert registry.resolve_provider_name(_settings(monkeypatch)) == "yfinance"


def test_demo_mode_forces_the_synthetic_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    assert registry.resolve_provider_name(_settings(monkeypatch, DEMO_MODE="true")) == "demo"


def test_demo_mode_with_a_conflicting_provider_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = _settings(monkeypatch, DEMO_MODE="true", MARKET_DATA_PROVIDER="yfinance")
    with pytest.raises(registry.ProviderConfigurationError, match="conflicts"):
        registry.resolve_provider_name(settings)


def test_unknown_provider_names_the_known_ones(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = _settings(monkeypatch, MARKET_DATA_PROVIDER="bloomberg")
    with pytest.raises(registry.ProviderConfigurationError) as exc:
        registry.resolve_provider_name(settings)
    assert "demo" in str(exc.value) and "yfinance" in str(exc.value)


def test_production_refuses_yfinance_because_of_licensing(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = _settings(
        monkeypatch, APP_ENV="production", CORS_ALLOWED_ORIGINS="https://example.test"
    )
    with pytest.raises(registry.ProviderConfigurationError, match="not licensed"):
        registry.resolve_provider_name(settings)


def test_production_demo_is_allowed(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = _settings(
        monkeypatch, APP_ENV="production", DEMO_MODE="1", CORS_ALLOWED_ORIGINS="https://x.test"
    )
    assert registry.build_price_provider(settings).name == "Synthetic demo data"


def test_configuration_errors_never_echo_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    secret = "sk-test-DO-NOT-LEAK-0123456789"
    settings = _settings(monkeypatch, MARKET_DATA_PROVIDER="nope", FMP_API_KEY=secret)
    with pytest.raises(registry.ProviderConfigurationError) as exc:
        registry.resolve_provider_name(settings)
    assert secret not in str(exc.value)


# --- normalized errors reach the API as the right status, without details -----


class _FailingProvider:
    name = "Failing test provider"
    adjustment = AdjustmentBasis.UNADJUSTED
    capabilities = frozenset({Capability.PRICES})

    def __init__(self, error: Exception) -> None:
        self.error = error

    def fetch_history(self, ticker: str, range_: Range) -> list[Bar]:
        raise self.error

    def fetch_identity(self, ticker: str) -> SecurityIdentity:
        return SecurityIdentity(ticker=ticker, company_name=ticker)


@pytest.mark.parametrize(
    ("error", "status"),
    [
        (ProviderRateLimited("Vendor"), 429),
        (ProviderTimeout("Vendor"), 502),
        (ProviderUnsupported("Vendor", Capability.INTRADAY), 501),
        (ProviderNotConfigured("Vendor", Capability.PRICES), 503),
        (RuntimeError("/Users/someone/secret/creds.json: token=abc123"), 502),
    ],
)
def test_provider_errors_map_to_clean_api_errors(
    monkeypatch: pytest.MonkeyPatch, error: Exception, status: int
) -> None:
    from app.main import app

    market_data.clear_caches()
    monkeypatch.setattr(market_data, "get_price_provider", lambda: _FailingProvider(error))
    response = TestClient(app).get("/api/v1/stocks/AAPL?range=1Y")
    assert response.status_code == status, response.text
    body = response.text
    for forbidden in ("abc123", "/Users/", "Traceback", "creds.json"):
        assert forbidden not in body


# --- semantics do not depend on which provider produced the bars ----------------


def test_same_bars_give_the_same_quote_apart_from_attribution() -> None:
    bars = [
        Bar("2026-01-02", 99.0, 101.0, 98.0, 100.0, 1000),
        Bar("2026-01-03", 100.0, 111.0, 100.0, 110.0, 2000),
    ]
    identity = SecurityIdentity(ticker="AAPL", company_name="Apple Inc.")

    class A:
        name, adjustment, capabilities = "A", AdjustmentBasis.SPLIT_AND_DIVIDEND, frozenset()

    class B:
        name, adjustment, capabilities = "B", AdjustmentBasis.SYNTHETIC, frozenset()

    qa = market_data._assemble_quote("AAPL", Range.MONTH_1, bars, identity, A())
    qb = market_data._assemble_quote("AAPL", Range.MONTH_1, bars, identity, B())
    assert qa.model_dump(exclude={"source", "adjustment"}) == qb.model_dump(
        exclude={"source", "adjustment"}
    )
    assert (qa.source, qa.adjustment) == ("A", "split_and_dividend")
    assert (qb.source, qb.adjustment) == ("B", "synthetic")
    assert qa.change_percent == 10.0


def test_cache_key_is_provider_specific(monkeypatch: pytest.MonkeyPatch) -> None:
    market_data.clear_caches()
    calls: list[str] = []

    class Stub:
        adjustment = AdjustmentBasis.UNADJUSTED
        capabilities = frozenset({Capability.PRICES})

        def __init__(self, name: str) -> None:
            self.name = name

        def fetch_history(self, ticker: str, range_: Range) -> list[Bar]:
            calls.append(self.name)
            return [Bar("2026-01-02", 1.0, 1.0, 1.0, 1.0, 1)]

        def fetch_identity(self, ticker: str) -> SecurityIdentity:
            return SecurityIdentity(ticker=ticker, company_name=ticker)

    import asyncio

    monkeypatch.setattr(market_data, "get_price_provider", lambda: Stub("one"))
    asyncio.run(market_data.get_quote("AAPL", Range.MONTH_1))
    asyncio.run(market_data.get_quote("AAPL", Range.MONTH_1))
    monkeypatch.setattr(market_data, "get_price_provider", lambda: Stub("two"))
    asyncio.run(market_data.get_quote("AAPL", Range.MONTH_1))
    # One fetch per provider: the second never reads the first one's cache entry.
    assert calls == ["one", "two"]
