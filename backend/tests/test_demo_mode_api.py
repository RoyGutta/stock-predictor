"""DEMO_MODE end to end: every analytical route works on the synthetic dataset,
the response says so, and no live feed is reachable."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app
from app.services import market_data
from app.services.providers import demo


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("DEMO_MODE", "1")
    get_settings.cache_clear()
    # If anything reached the real provider the test must fail loudly.
    def refuse(*_: object) -> None:
        pytest.fail("the real provider must never be called in demo mode")

    monkeypatch.setattr(market_data, "_fetch_history_sync", refuse)
    monkeypatch.setattr(market_data, "_fetch_profile_sync", refuse)
    yield TestClient(app)
    get_settings.cache_clear()


def test_quote_comes_from_the_demo_source(client: TestClient) -> None:
    body = client.get("/api/v1/stocks/AAPL?range=1Y").json()
    assert body["source"] == demo.SOURCE
    assert body["company_name"] == "Apple Inc."
    assert body["as_of"] == demo.DEMO_END_DATE.isoformat()
    assert len(body["history"]) == 252


def test_capabilities_disclose_demo_and_switch_live_feeds_off(client: TestClient) -> None:
    body = client.get("/api/v1/market/capabilities").json()
    assert body["demo"] is True
    assert "synthetic" in body["demo_note"].lower()
    assert "not live market data" in body["demo_note"].lower()
    assert body["search"] is True
    for capability in ("movers", "sectors", "news", "fundamentals", "screener"):
        assert body[capability] is False
        assert body["notes"][capability]


def test_unknown_ticker_is_a_404_not_a_fabrication(client: TestClient) -> None:
    response = client.get("/api/v1/stocks/ZZZZ?range=1Y")
    assert response.status_code == 404


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/stocks/AAPL/analysis?range=1Y&period=20",
        "/api/v1/stocks/AAPL/patterns?range=5Y",
        "/api/v1/stocks/AAPL/backtest?range=5Y",
        "/api/v1/stocks/AAPL/simulation?range=1Y",
        "/api/v1/market/compare?tickers=VOO,QQQ,AAPL&range=1Y",
        "/api/v1/market/correlation?tickers=VOO,QQQ,AAPL&range=1Y",
        "/api/v1/market/momentum?tickers=AAPL,MSFT&range=1Y",
        "/api/v1/portfolio/simulation?holdings=VOO:0.6,AAPL:0.4&range=5Y&initial=10000&monthly=100",
        "/api/v1/explore/match",
        "/api/v1/market/search?q=vanguard",
    ],
)
def test_every_analytical_route_works_on_demo_data(client: TestClient, path: str) -> None:
    response = client.get(path)
    assert response.status_code == 200, (path, response.text[:200])
    assert "NaN" not in response.text


def test_explore_covers_the_whole_universe(client: TestClient) -> None:
    body = client.get("/api/v1/explore/match").json()
    assert len(body["matches"]) == 20
    assert not body["unavailable"]


def test_live_feed_panels_report_unavailable_not_errors(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Even with provider keys present, demo mode must not reach a live feed.
    monkeypatch.setenv("FMP_API_KEY", "not-a-real-key")
    monkeypatch.setenv("FINNHUB_API_KEY", "not-a-real-key")
    get_settings.cache_clear()
    paths = ("/api/v1/market/movers", "/api/v1/market/news/AAPL", "/api/v1/market/profile/AAPL")
    for path in paths:
        response = client.get(path)
        assert response.status_code == 503, (path, response.status_code)
        assert "demo" in response.json()["detail"].lower()
        assert "Traceback" not in response.text
