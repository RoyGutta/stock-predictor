"""Malformed input never produces a 500 or leaks an internal error.

Every route must answer bad input with a client-error status and a plain
`detail` string. This pins the contract for the whole surface at once so a
new parameter or route cannot quietly regress it. No provider is called:
validation rejects each request before any network path is reached, and
the one route that would reach a provider is stubbed.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import market_data

LEAK_MARKERS = ("Traceback", 'File "', "Exception", "Internal Server Error")

MALFORMED = [
    "/api/v1/stocks/bad%20ticker",
    "/api/v1/stocks/%3Bdrop",
    "/api/v1/stocks/" + "A" * 40,
    "/api/v1/stocks/AAPL?range=99Y",
    "/api/v1/stocks/AAPL/analysis?period=0",
    "/api/v1/stocks/AAPL/analysis?period=100000",
    "/api/v1/stocks/AAPL/backtest?train_fraction=1.5",
    "/api/v1/stocks/AAPL/backtest?cost_bps=-5",
    "/api/v1/stocks/AAPL/simulation?simulations=10000000",
    "/api/v1/stocks/AAPL/simulation?horizon_days=0",
    "/api/v1/market/compare?tickers=AAPL",
    "/api/v1/market/compare?tickers=A,B,C,D,E,F,G",
    "/api/v1/market/compare?tickers=,,,",
    "/api/v1/market/correlation?tickers=AAPL,AAPL",
    "/api/v1/market/momentum?tickers=",
    "/api/v1/market/movers?limit=0",
    "/api/v1/market/movers?limit=999",
    "/api/v1/market/search?q=",
    "/api/v1/market/search?q=" + "x" * 500,
    "/api/v1/market/news/AAPL?limit=-1",
    "/api/v1/portfolio/simulation?holdings=AAPL",
    "/api/v1/portfolio/simulation?holdings=AAPL:150",
    "/api/v1/portfolio/simulation?holdings=AAPL:50,MSFT:30",
    "/api/v1/portfolio/simulation?holdings=AAPL:100&initial=-100",
    "/api/v1/portfolio/simulation?holdings=AAPL:100&monthly=1e309",
    "/api/v1/explore/match?volatility=extreme",
    "/api/v1/explore/match?horizon=century",
    "/api/v1/nonexistent",
]


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    def refuse(*_: object) -> None:
        raise AssertionError("malformed input must be rejected before any provider call")

    monkeypatch.setattr(market_data, "_fetch_history_sync", refuse)
    monkeypatch.setattr(market_data, "_fetch_profile_sync", refuse)
    return TestClient(app)


@pytest.mark.parametrize("path", MALFORMED)
def test_malformed_input_is_a_client_error_without_leaks(client: TestClient, path: str) -> None:
    response = client.get(path)
    assert 400 <= response.status_code < 500, (path, response.status_code)
    body = response.text
    for marker in LEAK_MARKERS:
        assert marker not in body, (path, marker)
    if response.status_code != 404 or path != "/api/v1/nonexistent":
        assert "detail" in response.json(), path


def test_provider_failure_is_a_502_with_a_plain_message(monkeypatch: pytest.MonkeyPatch) -> None:
    """An upstream blow-up must surface as 502 and a sentence, never a traceback."""

    def explode(*_: object) -> None:
        raise RuntimeError("secret internal state: token=abc123")

    market_data.clear_caches()
    monkeypatch.setattr(market_data, "_fetch_history_sync", explode)
    response = TestClient(app).get("/api/v1/stocks/AAPL?range=1Y")
    assert response.status_code == 502
    assert "abc123" not in response.text
    assert "Traceback" not in response.text
    assert isinstance(response.json()["detail"], str)
