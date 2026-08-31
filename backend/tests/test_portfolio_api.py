"""Portfolio simulation endpoint tests. Provider stubbed; never hits the network."""

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


def _candles(n: int, drift: float, seed: int) -> list[dict]:
    generator = np.random.default_rng(seed)
    prices = 100 * np.exp(np.cumsum(generator.normal(drift, 0.012, n)))
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
        # Deterministic per ticker, so AAPL and MSFT differ but repeat.
        return _candles(252, 0.0004, seed=sum(ord(c) for c in ticker))

    monkeypatch.setattr(market_data, "_fetch_history_sync", fake_history)
    monkeypatch.setattr(
        market_data,
        "_fetch_profile_sync",
        lambda t: {"company_name": f"{t} Corp", "currency": "USD"},
    )


URL = "/api/v1/portfolio/simulation"


def test_simulates_portfolio_and_benchmark(client: TestClient, stub_history: None) -> None:
    body = client.get(f"{URL}?holdings=AAPL:0.6,MSFT:0.4&initial=10000&monthly=500").json()
    assert {leg["ticker"] for leg in body["legs"]} == {"AAPL", "MSFT"}
    assert body["benchmark_ticker"] == "SPY"
    assert body["portfolio"]["bars"] > 0
    assert body["benchmark"]["bars"] > 0
    assert body["portfolio"]["total_contributed"] > 10_000  # contributions happened


def test_benchmark_receives_identical_cashflows(client: TestClient, stub_history: None) -> None:
    body = client.get(f"{URL}?holdings=AAPL:1.0&initial=5000&monthly=250").json()
    assert body["portfolio"]["initial_investment"] == body["benchmark"]["initial_investment"]
    assert body["portfolio"]["monthly_contribution"] == body["benchmark"]["monthly_contribution"]


def test_excess_return_is_portfolio_minus_benchmark(
    client: TestClient, stub_history: None
) -> None:
    body = client.get(f"{URL}?holdings=AAPL:0.5,MSFT:0.5").json()
    expected = (
        body["portfolio"]["stats"]["total_return"] - body["benchmark"]["stats"]["total_return"]
    )
    assert body["excess_return"] == pytest.approx(expected, abs=1e-6)


def test_weights_not_summing_to_one_are_rejected(client: TestClient, stub_history: None) -> None:
    response = client.get(f"{URL}?holdings=AAPL:0.6,MSFT:0.6")
    assert response.status_code == 400
    assert "sum to 1.0" in response.json()["detail"]


def test_duplicate_ticker_is_rejected(client: TestClient, stub_history: None) -> None:
    response = client.get(f"{URL}?holdings=AAPL:0.5,AAPL:0.5")
    assert response.status_code == 400
    assert "more than once" in response.json()["detail"]


def test_invalid_symbols_are_reported_not_silently_dropped(
    client: TestClient, stub_history: None
) -> None:
    body = client.get(f"{URL}?holdings=AAPL:0.5,NOT!OK:0.2,MSFT:0.5").json()
    assert "NOT!OK" in body["invalid_tickers"]


def test_all_invalid_holdings_is_a_400(client: TestClient, stub_history: None) -> None:
    assert client.get(f"{URL}?holdings=$$$:1.0").status_code == 400


def test_too_many_holdings_rejected(client: TestClient, stub_history: None) -> None:
    holdings = ",".join(f"T{i:02d}:0.111" for i in range(9))
    assert client.get(f"{URL}?holdings={holdings}").status_code == 400


def test_insufficient_history_is_422(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(market_data, "_fetch_history_sync", lambda *a: _candles(10, 0.0, seed=1))
    monkeypatch.setattr(
        market_data, "_fetch_profile_sync", lambda t: {"company_name": t, "currency": "USD"}
    )
    response = client.get(f"{URL}?holdings=AAPL:1.0")
    assert response.status_code == 422
    assert "share" in response.json()["detail"]


def test_method_and_disclaimer_travel_with_the_payload(
    client: TestClient, stub_history: None
) -> None:
    body = client.get(f"{URL}?holdings=AAPL:1.0").json()
    assert "time-weighted" in body["method"]
    assert "Hypothetical historical simulation" in body["disclaimer"]
    assert "not a projection" in body["disclaimer"]


def test_no_recommendation_language(client: TestClient, stub_history: None) -> None:
    text = client.get(f"{URL}?holdings=AAPL:0.5,MSFT:0.5").text.lower()
    for phrase in ("you should", "we recommend", "guaranteed", "will rise", "safe investment"):
        assert phrase not in text


def test_json_contains_no_nan(client: TestClient, stub_history: None) -> None:
    assert "NaN" not in client.get(f"{URL}?holdings=AAPL:1.0").text
