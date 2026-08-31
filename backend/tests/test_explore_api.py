"""Exploration endpoint tests. Provider stubbed; never hits the network.

The important properties are the honest-matching ones: every criterion ships
with the measurement that decided it, losers are returned rather than hidden,
insufficient history is reported rather than scored, and the response carries
no recommendation language.
"""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import market_data, universe
from app.services.market_data import clear_caches

URL = "/api/v1/explore/match"

# Deterministic per-ticker daily volatility for the stub. Bonds calm, sector
# funds wild, broad equity in between -- so terciles are predictable.
_SIGMA = {
    "BND": 0.002, "AGG": 0.002, "SHY": 0.001, "TLT": 0.006,
    "VIG": 0.008, "SCHD": 0.008, "VOO": 0.010, "VTI": 0.010,
    "VEA": 0.011, "VXUS": 0.011, "SPY": 0.010, "GLD": 0.009,
    "QQQ": 0.014, "VWO": 0.013, "VNQ": 0.014,
    "XLK": 0.018, "XLV": 0.015, "XLF": 0.017, "XLE": 0.022,
    "XLP": 0.012, "XLU": 0.013,
}


def _candles(ticker: str, n: int = 300) -> list[dict]:
    import pandas as pd

    generator = np.random.default_rng(sum(ord(c) for c in ticker))
    sigma = _SIGMA.get(ticker, 0.012)
    prices = 100 * np.exp(np.cumsum(generator.normal(0.0003, sigma, n)))
    dates = [str(d.date()) for d in pd.bdate_range("2024-01-02", periods=n)]
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


@pytest.fixture(autouse=True)
def _clear() -> None:
    clear_caches()


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def stub_history(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        market_data, "_fetch_history_sync", lambda ticker, *a: _candles(ticker)
    )
    monkeypatch.setattr(
        market_data,
        "_fetch_profile_sync",
        lambda t: {"company_name": f"{t} Fund", "currency": "USD"},
    )


def test_returns_every_measurable_fund_not_just_winners(
    client: TestClient, stub_history: None
) -> None:
    body = client.get(f"{URL}?volatility=lower").json()
    assert len(body["matches"]) == len(universe.UNIVERSE)
    scores = {match["score"] for match in body["matches"]}
    assert len(scores) > 1, "losers must be present, not filtered out"


def test_every_criterion_carries_its_measurement(
    client: TestClient, stub_history: None
) -> None:
    body = client.get(f"{URL}?volatility=lower&diversification=broad").json()
    for match in body["matches"]:
        assert match["total"] == len(match["criteria"])
        assert match["score"] == sum(1 for c in match["criteria"] if c["met"])
        for criterion in match["criteria"]:
            assert criterion["detail"].strip(), "a bare tick hides the evidence"


def test_lower_volatility_preference_favors_calm_funds(
    client: TestClient, stub_history: None
) -> None:
    body = client.get(f"{URL}?volatility=lower&diversification=broad").json()
    by_ticker = {match["ticker"]: match for match in body["matches"]}
    # Short treasuries are the calmest series in the stub; a tech sector fund
    # is among the wildest. The volatility criterion must separate them.
    shy_vol = next(c for c in by_ticker["SHY"]["criteria"] if "Volatility" in c["name"])
    xlk_vol = next(c for c in by_ticker["XLK"]["criteria"] if "Volatility" in c["name"])
    assert shy_vol["met"] is True
    assert xlk_vol["met"] is False
    # And the sort puts the calm broad fund above the wild sector fund.
    order = [match["ticker"] for match in body["matches"]]
    assert order.index("SHY") < order.index("XLK")


def test_broad_preference_fails_sector_and_single_asset_funds(
    client: TestClient, stub_history: None
) -> None:
    body = client.get(f"{URL}?diversification=broad").json()
    by_ticker = {match["ticker"]: match for match in body["matches"]}
    for ticker, expected in (("VOO", True), ("XLE", False), ("GLD", False)):
        criterion = next(
            c for c in by_ticker[ticker]["criteria"] if c["name"] == "Diversification"
        )
        assert criterion["met"] is expected, ticker


def test_interests_add_a_criterion_only_when_given(
    client: TestClient, stub_history: None
) -> None:
    without = client.get(URL).json()
    with_interest = client.get(f"{URL}?interests=Technology").json()
    assert with_interest["matches"][0]["total"] == without["matches"][0]["total"] + 1

    by_ticker = {m["ticker"]: m for m in with_interest["matches"]}
    xlk = next(c for c in by_ticker["XLK"]["criteria"] if c["name"] == "Sector interests")
    voo = next(c for c in by_ticker["VOO"]["criteria"] if c["name"] == "Sector interests")
    assert xlk["met"] is True
    assert voo["met"] is False


def test_unknown_interest_is_rejected_with_the_available_list(
    client: TestClient, stub_history: None
) -> None:
    response = client.get(f"{URL}?interests=Crypto")
    assert response.status_code == 400
    assert "Available:" in response.json()["detail"]


@pytest.mark.parametrize(
    "query", ["volatility=extreme", "diversification=none", "horizon=forever"]
)
def test_invalid_choices_are_rejected(
    client: TestClient, stub_history: None, query: str
) -> None:
    assert client.get(f"{URL}?{query}").status_code == 400


def test_insufficient_history_is_reported_not_scored(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, stub_history: None
) -> None:
    original = market_data._fetch_history_sync

    def short_for_gld(ticker: str, *args: object) -> list[dict]:
        return _candles(ticker)[:10] if ticker == "GLD" else original(ticker, *args)

    monkeypatch.setattr(market_data, "_fetch_history_sync", short_for_gld)
    body = client.get(URL).json()
    assert "GLD" in body["unavailable"]
    assert all(match["ticker"] != "GLD" for match in body["matches"])


def test_universe_disclosure_travels_with_the_payload(
    client: TestClient, stub_history: None
) -> None:
    body = client.get(URL).json()
    assert "curated educational list" in body["universe_note"]
    assert "not the whole market" in body["universe_note"]
    assert "not a recommendation" in body["disclaimer"]
    assert "not financial advice" in body["disclaimer"]
    assert "thirds" in body["method"]


def test_no_recommendation_language(client: TestClient, stub_history: None) -> None:
    text = client.get(f"{URL}?volatility=lower&diversification=broad").text.lower()
    for phrase in (
        "you should",
        "we recommend",
        "best stock",
        "best fund",
        "buy now",
        "strong buy",
        "guaranteed",
        "will rise",
        "safe investment",
        "right investment",
        "chance of making",
    ):
        assert phrase not in text


def test_score_is_never_framed_as_probability(client: TestClient, stub_history: None) -> None:
    body = client.get(URL).json()
    assert "probability" not in body["method"].lower()
    assert "match count" in body["disclaimer"]


def test_json_contains_no_nan(client: TestClient, stub_history: None) -> None:
    assert "NaN" not in client.get(URL).text


def test_universe_facts_are_consistent() -> None:
    tickers = [fund.ticker for fund in universe.UNIVERSE]
    assert len(tickers) == len(set(tickers)), "duplicate tickers in the universe"
    for fund in universe.UNIVERSE:
        assert fund.name and fund.category and fund.tracks
    assert universe.SECTOR_CATEGORIES, "sector list drives the interests form"
