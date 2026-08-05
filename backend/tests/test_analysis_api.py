"""Analysis endpoint tests."""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import market_data
from app.services.market_data import clear_caches


@pytest.fixture(autouse=True)
def _clear() -> None:
    clear_caches()


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def _candles(n: int, start: float = 100.0, drift: float = 0.4) -> list[dict]:
    prices = start + np.arange(n) * drift
    return [
        {
            "date": f"2026-01-{(i % 28) + 1:02d}",
            "price": round(float(p), 2),
            "open": round(float(p) - 0.2, 2),
            "high": round(float(p) + 1, 2),
            "low": round(float(p) - 1, 2),
            "volume": 1_000_000,
        }
        for i, p in enumerate(prices)
    ]


@pytest.fixture
def stub_long_history(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(market_data, "_fetch_history_sync", lambda *a: _candles(300))
    monkeypatch.setattr(
        market_data,
        "_fetch_profile_sync",
        lambda t: {"company_name": "Test Corp", "currency": "USD"},
    )


@pytest.fixture
def stub_short_history(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(market_data, "_fetch_history_sync", lambda *a: _candles(10))
    monkeypatch.setattr(
        market_data,
        "_fetch_profile_sync",
        lambda t: {"company_name": "Test Corp", "currency": "USD"},
    )


def test_analysis_returns_expected_shape(client: TestClient, stub_long_history: None) -> None:
    response = client.get("/api/v1/stocks/AAPL/analysis?range=1Y")
    assert response.status_code == 200
    body = response.json()
    assert body["ticker"] == "AAPL"
    assert body["bars_analyzed"] == 300
    assert body["risk"] is not None
    assert body["interpretation"]["disclaimer"]


def test_observations_are_partitioned_by_stance(
    client: TestClient, stub_long_history: None
) -> None:
    interpretation = client.get("/api/v1/stocks/AAPL/analysis").json()["interpretation"]
    for stance, key in (("bullish", "bullish"), ("bearish", "bearish"), ("neutral", "neutral")):
        for observation in interpretation[key]:
            assert observation["stance"] == stance


def test_every_observation_has_a_caveat(client: TestClient, stub_long_history: None) -> None:
    interpretation = client.get("/api/v1/stocks/AAPL/analysis").json()["interpretation"]
    everything = interpretation["bullish"] + interpretation["bearish"] + interpretation["neutral"]
    assert everything
    for observation in everything:
        assert observation["caveat"].strip()


def test_agreement_score_is_bounded(client: TestClient, stub_long_history: None) -> None:
    score = client.get("/api/v1/stocks/AAPL/analysis").json()["interpretation"]["agreement_score"]
    assert 0.0 <= score <= 1.0


def test_response_contains_no_price_target_or_verdict(
    client: TestClient, stub_long_history: None
) -> None:
    """The endpoint must never emit a recommendation, however the data looks."""
    text = client.get("/api/v1/stocks/AAPL/analysis").text.lower()
    for phrase in ("price target", "strong buy", "we recommend", "guaranteed", "will rise"):
        assert phrase not in text


def test_risk_is_null_when_history_is_too_short(
    client: TestClient, stub_short_history: None
) -> None:
    """Ten bars cannot support an annualized Sharpe ratio; null beats a fake number."""
    body = client.get("/api/v1/stocks/AAPL/analysis").json()
    assert body["risk"] is None


def test_risk_payload_states_its_basis(client: TestClient, stub_long_history: None) -> None:
    assert "this range" in client.get("/api/v1/stocks/AAPL/analysis").json()["risk"]["basis"]


def test_long_ranges_do_not_annualize_as_daily(client: TestClient, stub_long_history: None) -> None:
    """5Y data is weekly; annualizing it at 252 periods/year would be wrong."""
    body = client.get("/api/v1/stocks/AAPL/analysis?range=5Y").json()
    assert body["risk"]["frequency"] == "weekly"
    max_body = client.get("/api/v1/stocks/AAPL/analysis?range=MAX").json()
    assert max_body["risk"]["frequency"] == "monthly"


def test_invalid_ticker_returns_400(client: TestClient) -> None:
    assert client.get("/api/v1/stocks/bad%20ticker/analysis").status_code == 400


def test_unknown_ticker_returns_404(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(market_data, "_fetch_history_sync", lambda *a: [])
    assert client.get("/api/v1/stocks/ZZZZZ/analysis").status_code == 404


def test_json_contains_no_nan_literals(client: TestClient, stub_long_history: None) -> None:
    """NaN is not valid JSON; absent statistics must serialize as null."""
    assert "NaN" not in client.get("/api/v1/stocks/AAPL/analysis").text
