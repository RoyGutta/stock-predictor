"""Simulation and correlation endpoint tests.

The safety properties here matter more than the arithmetic: a dispersion
simulation is the single easiest thing in this project to misread as a
forecast, so the tests pin that it never presents itself as one.
"""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import market_data


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def _candles(n: int, seed: int = 5, drift: float = 0.0004) -> list[dict]:
    generator = np.random.default_rng(seed)
    prices = 100 * np.exp(np.cumsum(generator.normal(drift, 0.014, n)))
    return [
        {
            "date": f"2024-{(i // 28) % 12 + 1:02d}-{i % 28 + 1:02d}",
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
    _stub(monkeypatch, 300)


# --- simulation -------------------------------------------------------------


def test_simulation_returns_ordered_percentiles(client: TestClient, long_history: None) -> None:
    body = client.get("/api/v1/stocks/AAPL/simulation?seed=1").json()
    values = [body["percentiles"][f"p{p}"] for p in (5, 25, 50, 75, 95)]
    assert values == sorted(values)


def test_simulation_is_reproducible_with_a_seed(client: TestClient, long_history: None) -> None:
    first = client.get("/api/v1/stocks/AAPL/simulation?seed=7").json()
    second = client.get("/api/v1/stocks/AAPL/simulation?seed=7").json()
    assert first["percentiles"] == second["percentiles"]


def test_probability_of_loss_is_a_probability(client: TestClient, long_history: None) -> None:
    value = client.get("/api/v1/stocks/AAPL/simulation?seed=2").json()["probability_of_loss"]
    assert 0.0 <= value <= 1.0


def test_dispersion_widens_with_a_longer_horizon(client: TestClient, long_history: None) -> None:
    """The whole point of showing this: uncertainty compounds with time."""

    def spread(days: int) -> float:
        body = client.get(f"/api/v1/stocks/AAPL/simulation?seed=3&horizon_days={days}").json()
        return body["percentiles"]["p95"] - body["percentiles"]["p5"]

    assert spread(500) > spread(20)


def test_simulation_carries_its_disclaimer(client: TestClient, long_history: None) -> None:
    """The caveat travels in the payload so a caller cannot drop it."""
    body = client.get("/api/v1/stocks/AAPL/simulation?seed=4").json()
    assert "Not a forecast" in body["disclaimer"]
    assert "bootstrap" in body["method"]


def test_simulation_never_uses_forecast_language(client: TestClient, long_history: None) -> None:
    text = client.get("/api/v1/stocks/AAPL/simulation?seed=5").text.lower()
    for phrase in ("will reach", "price target", "we predict", "expected price", "guaranteed"):
        assert phrase not in text


def test_short_history_is_refused_rather_than_guessed(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _stub(monkeypatch, 20)
    response = client.get("/api/v1/stocks/AAPL/simulation")
    assert response.status_code == 422
    assert "longer range" in response.json()["detail"]


def test_simulation_rejects_invalid_ticker(client: TestClient) -> None:
    assert client.get("/api/v1/stocks/bad%20ticker/simulation").status_code == 400


@pytest.mark.parametrize(
    "query",
    ["horizon_days=0", "horizon_days=99999", "simulations=1", "simulations=999999"],
)
def test_simulation_rejects_out_of_range_parameters(
    client: TestClient, long_history: None, query: str
) -> None:
    assert client.get(f"/api/v1/stocks/AAPL/simulation?{query}").status_code == 422


def test_simulation_json_contains_no_nan_literals(client: TestClient, long_history: None) -> None:
    assert "NaN" not in client.get("/api/v1/stocks/AAPL/simulation?seed=6").text


# --- correlation ------------------------------------------------------------


def test_correlation_diagonal_is_one(client: TestClient, long_history: None) -> None:
    body = client.get("/api/v1/market/correlation?tickers=AAPL,MSFT").json()
    for i in range(len(body["tickers"])):
        assert body["matrix"][i][i] == pytest.approx(1.0)


def test_correlation_matrix_is_symmetric(client: TestClient, long_history: None) -> None:
    body = client.get("/api/v1/market/correlation?tickers=AAPL,MSFT,GOOG").json()
    matrix = body["matrix"]
    for i in range(len(matrix)):
        for j in range(len(matrix)):
            assert matrix[i][j] == pytest.approx(matrix[j][i])


def test_correlation_matrix_matches_ticker_order(client: TestClient, long_history: None) -> None:
    body = client.get("/api/v1/market/correlation?tickers=AAPL,MSFT,GOOG").json()
    assert len(body["matrix"]) == len(body["tickers"])
    assert all(len(row) == len(body["tickers"]) for row in body["matrix"])


def test_correlation_deduplicates_repeated_tickers(client: TestClient, long_history: None) -> None:
    body = client.get("/api/v1/market/correlation?tickers=AAPL,AAPL,MSFT").json()
    assert body["tickers"] == ["AAPL", "MSFT"]


def test_correlation_explains_it_uses_returns_not_levels(
    client: TestClient, long_history: None
) -> None:
    """Correlating price levels is the classic error; the payload says so."""
    note = client.get("/api/v1/market/correlation?tickers=AAPL,MSFT").json()["note"]
    assert "not on price levels" in note


def test_correlation_warns_that_correlations_shift(client: TestClient, long_history: None) -> None:
    note = client.get("/api/v1/market/correlation?tickers=AAPL,MSFT").json()["note"]
    assert "crash" in note.lower()


def test_correlation_reports_unloadable_tickers_rather_than_dropping_them(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A ticker that failed must be named, not silently missing from the matrix."""
    calls = {"n": 0}

    def selective(ticker: str, period: str, interval: str) -> list[dict]:
        calls["n"] += 1
        return [] if ticker == "ZZZZ" else _candles(200)

    monkeypatch.setattr(market_data, "_fetch_history_sync", selective)
    monkeypatch.setattr(
        market_data,
        "_fetch_profile_sync",
        lambda t: {"company_name": "Test Corp", "currency": "USD"},
    )

    body = client.get("/api/v1/market/correlation?tickers=AAPL,MSFT,ZZZZ").json()
    assert "ZZZZ" in body["unavailable"]
    assert "ZZZZ" not in body["tickers"]
    assert len(body["tickers"]) == 2


def test_correlation_needs_at_least_two_usable_tickers(
    client: TestClient, long_history: None
) -> None:
    response = client.get("/api/v1/market/correlation?tickers=AAPL")
    assert response.status_code == 422
    assert "at least 2" in response.json()["detail"]


def test_correlation_rejects_an_oversized_basket(client: TestClient, long_history: None) -> None:
    many = ",".join(f"TK{i}" for i in range(12))
    assert client.get(f"/api/v1/market/correlation?tickers={many}").status_code == 400


def test_correlation_reports_invalid_symbols_without_failing(
    client: TestClient, long_history: None
) -> None:
    body = client.get("/api/v1/market/correlation?tickers=AAPL,MSFT,<script>").json()
    assert body["tickers"] == ["AAPL", "MSFT"]
    assert body["unavailable"]


def test_correlation_json_contains_no_nan_literals(client: TestClient, long_history: None) -> None:
    assert "NaN" not in client.get("/api/v1/market/correlation?tickers=AAPL,MSFT").text
