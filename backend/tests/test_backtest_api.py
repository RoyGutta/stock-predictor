"""Backtest endpoint tests."""

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


def _candles(n: int) -> list[dict]:
    generator = np.random.default_rng(5)
    prices = 100 * np.exp(np.cumsum(generator.normal(0.0004, 0.014, n)))
    return [
        {
            "date": f"2024-{(i // 28) % 12 + 1:02d}-{i % 28 + 1:02d}T00:00:{i % 60:02d}",
            "price": round(float(p), 2),
            "open": round(float(p) * 0.998, 2),
            "high": round(float(p) * 1.01, 2),
            "low": round(float(p) * 0.99, 2),
            "volume": 1_000_000,
        }
        for i, p in enumerate(prices)
    ]


def _stub(monkeypatch: pytest.MonkeyPatch, n: int) -> None:
    monkeypatch.setattr(market_data, "_fetch_history_sync", lambda *a: _candles(n))
    monkeypatch.setattr(
        market_data,
        "_fetch_profile_sync",
        lambda t: {"company_name": "Test Corp", "currency": "USD"},
    )


@pytest.fixture
def long_history(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub(monkeypatch, 500)


def test_returns_every_strategy(client: TestClient, long_history: None) -> None:
    """Reporting only the winner of several rules is data mining."""
    body = client.get("/api/v1/stocks/AAPL/backtest").json()
    keys = {s["strategy_key"] for s in body["strategies"]}
    assert {"buy_and_hold", "sma_crossover", "rsi_reversion", "macd_crossover"} <= keys


def test_includes_the_benchmark(client: TestClient, long_history: None) -> None:
    body = client.get("/api/v1/stocks/AAPL/backtest").json()
    assert any(s["strategy_key"] == "buy_and_hold" for s in body["strategies"])


def test_reports_both_in_and_out_of_sample(client: TestClient, long_history: None) -> None:
    """The in-sample figure must be visible beside the out-of-sample one; the
    gap between them is the lesson."""
    for strategy in client.get("/api/v1/stocks/AAPL/backtest").json()["strategies"]:
        assert "in_sample" in strategy
        assert "out_of_sample" in strategy
        assert strategy["in_sample"]["bars"] > 0
        assert strategy["out_of_sample"]["bars"] > 0


def test_excess_is_measured_against_the_benchmark(client: TestClient, long_history: None) -> None:
    for s in client.get("/api/v1/stocks/AAPL/backtest").json()["strategies"]:
        expected = s["out_of_sample"]["total_return"] - s["benchmark_out_of_sample"]["total_return"]
        assert s["excess_return"] == pytest.approx(expected, abs=1e-6)


def test_costs_are_charged_by_default(client: TestClient, long_history: None) -> None:
    assert client.get("/api/v1/stocks/AAPL/backtest").json()["cost_bps"] > 0


def test_higher_costs_reduce_returns(client: TestClient, long_history: None) -> None:
    cheap = client.get("/api/v1/stocks/AAPL/backtest?cost_bps=0").json()
    dear = client.get("/api/v1/stocks/AAPL/backtest?cost_bps=200").json()

    def macd(body: dict) -> float:
        s = next(x for x in body["strategies"] if x["strategy_key"] == "macd_crossover")
        return s["out_of_sample"]["total_return"]

    assert macd(dear) < macd(cheap)


def test_short_history_is_refused_rather_than_guessed(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _stub(monkeypatch, 50)
    response = client.get("/api/v1/stocks/AAPL/backtest")
    assert response.status_code == 422
    assert "longer range" in response.json()["detail"]


@pytest.mark.parametrize("fraction", [0.1, 0.9, 1.5, -0.2])
def test_invalid_train_fraction_is_rejected(
    client: TestClient, long_history: None, fraction: float
) -> None:
    assert client.get(f"/api/v1/stocks/AAPL/backtest?train_fraction={fraction}").status_code == 422


def test_method_and_disclaimer_travel_with_the_payload(
    client: TestClient, long_history: None
) -> None:
    body = client.get("/api/v1/stocks/AAPL/backtest").json()
    assert "walk-forward" in body["method"].lower()
    assert "one bar after the signal" in body["method"]
    assert "not a prediction" in body["disclaimer"]


def test_response_contains_no_recommendation_language(
    client: TestClient, long_history: None
) -> None:
    text = client.get("/api/v1/stocks/AAPL/backtest").text.lower()
    for phrase in ("you should", "we recommend", "guaranteed", "will beat", "price target"):
        assert phrase not in text


def test_invalid_ticker_returns_400(client: TestClient) -> None:
    assert client.get("/api/v1/stocks/bad%20ticker/backtest").status_code == 400


def test_json_contains_no_nan_literals(client: TestClient, long_history: None) -> None:
    assert "NaN" not in client.get("/api/v1/stocks/AAPL/backtest").text
