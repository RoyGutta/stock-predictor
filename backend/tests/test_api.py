"""API-level tests: status codes, error shape, CORS, and rate limiting."""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.main import app
from app.middleware.rate_limit import RateLimitMiddleware
from app.routes import stocks
from app.services import market_data

STUB_CANDLES = [
    {"date": "2026-01-02", "price": 100.0, "open": 99.0, "high": 101.0, "low": 98.0, "volume": 10},
    {"date": "2026-01-03", "price": 105.0, "open": 100.0, "high": 106.0, "low": 99.0, "volume": 20},
]




@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def stub_quote(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(market_data, "_fetch_history_sync", lambda *a: list(STUB_CANDLES))
    monkeypatch.setattr(
        market_data,
        "_fetch_profile_sync",
        lambda t: {"company_name": "Test Corp", "currency": "USD"},
    )


def _app_with_rate_limit(requests_per_minute: int) -> FastAPI:
    """An isolated app instance with a low rate limit, so the shared app's
    limiter state is not polluted across tests."""
    isolated = FastAPI()
    isolated.add_middleware(RateLimitMiddleware, requests_per_minute=requests_per_minute)
    isolated.include_router(stocks.router, prefix="/api/v1")
    return isolated


# --- happy path -------------------------------------------------------------


def test_health(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_quote_returns_200_and_expected_shape(client: TestClient, stub_quote: None) -> None:
    response = client.get("/api/v1/stocks/AAPL?range=1M")
    assert response.status_code == 200
    body = response.json()
    assert body["ticker"] == "AAPL"
    assert body["company_name"] == "Test Corp"
    assert body["change_points"] == 5.0
    assert body["source"] == "yfinance"
    assert len(body["history"]) == 2


# --- error handling ---------------------------------------------------------


def test_invalid_ticker_returns_400_not_200(client: TestClient) -> None:
    """Regression: errors previously returned HTTP 200 with an error body."""
    response = client.get("/api/v1/stocks/not%20a%20ticker")
    assert response.status_code == 400
    assert "detail" in response.json()


def test_invalid_range_returns_422(client: TestClient) -> None:
    response = client.get("/api/v1/stocks/AAPL?range=17Q")
    assert response.status_code == 422


def test_unknown_ticker_returns_404(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(market_data, "_fetch_history_sync", lambda *a: [])
    response = client.get("/api/v1/stocks/ZZZZZ")
    assert response.status_code == 404


def test_upstream_failure_returns_502_without_internals(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Regression: the old handler returned str(exception) to the caller."""

    def boom(*args: object) -> None:
        raise RuntimeError("connection to internal-host:5432 refused")

    monkeypatch.setattr(market_data, "_fetch_history_sync", boom)
    response = client.get("/api/v1/stocks/AAPL")
    assert response.status_code == 502
    assert "internal-host" not in response.text


# --- CORS -------------------------------------------------------------------


def test_cors_rejects_unlisted_origin(client: TestClient, stub_quote: None) -> None:
    """Regression: allow_origins was previously ['*']."""
    response = client.get("/api/v1/stocks/AAPL", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in {k.lower() for k in response.headers}


def test_cors_allows_listed_origin(client: TestClient, stub_quote: None) -> None:
    response = client.get("/api/v1/stocks/AAPL", headers={"Origin": "http://localhost:5173"})
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"


# --- rate limiting ----------------------------------------------------------


def test_rate_limit_returns_429(stub_quote: None) -> None:
    with TestClient(_app_with_rate_limit(3)) as limited_client:
        for _ in range(3):
            assert limited_client.get("/api/v1/stocks/AAPL").status_code == 200
        blocked = limited_client.get("/api/v1/stocks/AAPL")
        assert blocked.status_code == 429
        assert blocked.headers["Retry-After"] == "60"
