"""Comparison endpoint tests. Provider stubbed; never hits the network."""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import market_data
from app.services.market_data import clear_caches

URL = "/api/v1/market/compare"


@pytest.fixture(autouse=True)
def _clear() -> None:
    clear_caches()


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def _candles(n: int, seed: int) -> list[dict]:
    generator = np.random.default_rng(seed)
    prices = 100 * np.exp(np.cumsum(generator.normal(0.0004, 0.012, n)))
    return [
        {
            "date": f"2024-{(i // 21) % 12 + 1:02d}-{i % 21 + 1:02d}",
            "price": round(float(p), 2),
            "open": round(float(p) * 0.999, 2),
            "high": round(float(p) * 1.01, 2),
            "low": round(float(p) * 0.99, 2),
            "volume": 1_000_000,
        }
        for i, p in enumerate(prices)
    ]


@pytest.fixture
def stub_history(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_history(ticker: str, period: str, interval: str) -> list[dict]:
        if ticker == "TINY":
            return _candles(10, seed=3)  # too short for risk stats
        return _candles(252, seed=sum(ord(c) for c in ticker))

    monkeypatch.setattr(market_data, "_fetch_history_sync", fake_history)
    monkeypatch.setattr(
        market_data,
        "_fetch_profile_sync",
        lambda t: {"company_name": f"{t} Corp", "currency": "USD"},
    )


def test_compares_each_ticker_with_the_same_method(
    client: TestClient, stub_history: None
) -> None:
    body = client.get(f"{URL}?tickers=AAPL,MSFT,VOO").json()
    assert {row["ticker"] for row in body["rows"]} == {"AAPL", "MSFT", "VOO"}
    for row in body["rows"]:
        assert row["annualized_volatility"] is not None
        assert row["max_drawdown"] is not None
        assert row["momentum_state"] in {"bullish", "bearish", "mixed", "insufficient"}


def test_insufficient_history_yields_nulls_not_zeros(
    client: TestClient, stub_history: None
) -> None:
    """Ten bars cannot support an annualized Sharpe. Null, never 0.00."""
    body = client.get(f"{URL}?tickers=AAPL,TINY").json()
    tiny = next(row for row in body["rows"] if row["ticker"] == "TINY")
    assert tiny["sharpe_ratio"] is None
    assert tiny["annualized_return"] is None
    assert tiny["max_drawdown"] is None
    # Insufficient history is not bearish.
    assert tiny["momentum_state"] == "insufficient"


def test_failed_tickers_are_reported_not_dropped(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, stub_history: None
) -> None:
    original = market_data._fetch_history_sync

    def flaky(ticker: str, period: str, interval: str) -> list[dict]:
        if ticker == "GONE":
            return []
        return original(ticker, period, interval)

    monkeypatch.setattr(market_data, "_fetch_history_sync", flaky)
    body = client.get(f"{URL}?tickers=AAPL,MSFT,GONE").json()
    assert {row["ticker"] for row in body["rows"]} == {"AAPL", "MSFT"}
    assert "GONE" in body["unavailable"]


def test_fewer_than_two_readable_tickers_is_a_400(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(market_data, "_fetch_history_sync", lambda *a: [])
    monkeypatch.setattr(
        market_data, "_fetch_profile_sync", lambda t: {"company_name": t, "currency": "USD"}
    )
    response = client.get(f"{URL}?tickers=AAPL,MSFT")
    assert response.status_code == 400
    assert "at least 2" in response.json()["detail"]


def test_too_many_tickers_rejected(client: TestClient, stub_history: None) -> None:
    assert client.get(f"{URL}?tickers=A,B,C,D,E,F,G").status_code == 400


def test_no_ranking_or_recommendation_language(client: TestClient, stub_history: None) -> None:
    text = client.get(f"{URL}?tickers=AAPL,MSFT").text.lower()
    for phrase in ("best pick", "winner", "you should", "we recommend", "strong buy"):
        assert phrase not in text
    body = client.get(f"{URL}?tickers=AAPL,MSFT").json()
    assert "not which one to pick" in body["note"]
    assert "predict" in body["disclaimer"]


def test_json_contains_no_nan(client: TestClient, stub_history: None) -> None:
    assert "NaN" not in client.get(f"{URL}?tickers=AAPL,MSFT,TINY").text
