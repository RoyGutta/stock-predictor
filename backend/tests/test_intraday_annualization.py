"""Intraday ranges are never annualized: the risk block is null and the routes
that exist only to annualize refuse with a 422 that says why."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app
from app.services.providers.registry import reset_price_provider


@pytest.fixture
def demo_client(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("DEMO_MODE", "1")
    get_settings.cache_clear()
    reset_price_provider()
    yield TestClient(app)
    get_settings.cache_clear()
    reset_price_provider()


def test_analysis_on_one_day_of_five_minute_bars_has_no_annualized_risk(demo_client) -> None:
    body = demo_client.get("/api/v1/stocks/AAPL/analysis?range=1D&period=5").json()
    assert body["bars_analyzed"] == 78, "the sample is large enough that only policy stops it"
    assert body["risk"] is None


def test_analysis_on_daily_bars_still_reports_risk(demo_client) -> None:
    body = demo_client.get("/api/v1/stocks/AAPL/analysis?range=1Y").json()
    assert body["risk"]["frequency"] == "daily"
    assert body["risk"]["annualized_volatility"] is not None


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/stocks/AAPL/backtest?range=1D",
        "/api/v1/stocks/AAPL/backtest?range=5D",
        "/api/v1/market/compare?tickers=AAPL,MSFT&range=1D",
        "/api/v1/portfolio/simulation?holdings=AAPL:0.5,MSFT:0.5&range=5D&initial=1000",
    ],
)
def test_annualizing_routes_refuse_intraday_ranges(demo_client, path: str) -> None:
    response = demo_client.get(path)
    assert response.status_code == 422, response.text
    assert "annualized" in response.json()["detail"].lower()
