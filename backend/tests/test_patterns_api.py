"""Pattern endpoint tests. Provider stubbed; never hits the network."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import market_data
from app.services.market_data import clear_caches

URL = "/api/v1/stocks/AAPL/patterns"


@pytest.fixture(autouse=True)
def _clear() -> None:
    clear_caches()


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def _candles(n: int, seed: int = 7) -> list[dict]:
    generator = np.random.default_rng(seed)
    prices = 100 * np.exp(np.cumsum(generator.normal(0.0003, 0.015, n)))
    dates = [str(d.date()) for d in pd.bdate_range("2021-01-04", periods=n)]
    return [
        {
            "date": dates[i],
            "price": round(float(p), 4),
            "open": round(float(p) * 0.999, 4),
            "high": round(float(p) * 1.005, 4),
            "low": round(float(p) * 0.995, 4),
            "volume": 1_000_000,
        }
        for i, p in enumerate(prices)
    ]


def _stub(monkeypatch: pytest.MonkeyPatch, n: int) -> None:
    monkeypatch.setattr(market_data, "_fetch_history_sync", lambda *a: _candles(n))
    monkeypatch.setattr(
        market_data,
        "_fetch_profile_sync",
        lambda t: {"company_name": "Apple Inc.", "currency": "USD"},
    )


@pytest.fixture
def long_history(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub(monkeypatch, 700)


def test_returns_events_and_summaries(client: TestClient, long_history: None) -> None:
    body = client.get(URL).json()
    assert body["ticker"] == "AAPL"
    assert not body["insufficient"]
    assert len(body["events"]) > 0
    assert len(body["summaries"]) == 10  # every defined pattern is summarized
    for event in body["events"]:
        assert event["explanation"].strip()
        assert event["caveat"].strip()


def test_outcomes_always_disclose_sample_size(client: TestClient, long_history: None) -> None:
    body = client.get(URL).json()
    for summary in body["summaries"]:
        for outcome in summary["outcomes"]:
            assert "sample_size" in outcome
            assert outcome["small_sample"] == (outcome["sample_size"] < 10)
            if outcome["sample_size"] == 0:
                assert outcome["mean"] is None


def test_insufficient_history_is_honest_not_an_error(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _stub(monkeypatch, 40)
    response = client.get(URL)
    assert response.status_code == 200
    body = response.json()
    assert body["insufficient"] is True
    assert body["events"] == []
    assert "longer range" in body["note"]


def test_method_names_the_anti_lookahead_guarantee(
    client: TestClient, long_history: None
) -> None:
    body = client.get(URL).json()
    assert "at or before its own date" in body["method"]
    assert "never to decide" in body["method"]
    assert "not signals and not forecasts" in body["disclaimer"]


def test_no_prediction_or_advice_language(client: TestClient, long_history: None) -> None:
    text = client.get(URL).text.lower()
    for phrase in (
        "will rise",
        "will fall",
        "you should",
        "we recommend",
        "buy now",
        "strong buy",
        "winning signal",
        "successful prediction",
    ):
        assert phrase not in text


def test_invalid_ticker_returns_400(client: TestClient) -> None:
    assert client.get("/api/v1/stocks/bad%20ticker/patterns").status_code == 400


def test_json_contains_no_nan(client: TestClient, long_history: None) -> None:
    assert "NaN" not in client.get(URL).text
