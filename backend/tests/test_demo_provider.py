"""The synthetic demo dataset: deterministic, well-formed, and honest about what it is."""

from __future__ import annotations

import numpy as np

from app.schemas import Range
from app.services.providers import demo


def test_same_ticker_always_produces_the_same_series() -> None:
    first = demo.fetch_history("AAPL", Range.YEAR_1)
    second = demo.fetch_history("AAPL", Range.YEAR_1)
    assert first == second


def test_different_tickers_differ() -> None:
    assert demo.fetch_history("AAPL", Range.MONTH_1) != demo.fetch_history("MSFT", Range.MONTH_1)


def test_bar_counts_match_each_range() -> None:
    expected = {
        Range.DAY_1: 78,
        Range.DAY_5: 65,
        Range.MONTH_1: 21,
        Range.MONTH_3: 63,
        Range.MONTH_6: 126,
        Range.YEAR_1: 252,
    }
    for range_, count in expected.items():
        assert len(demo.fetch_history("SPY", range_)) == count, range_
    assert 240 <= len(demo.fetch_history("SPY", Range.YEAR_5)) <= 262
    assert 130 <= len(demo.fetch_history("SPY", Range.MAX)) <= 150


def test_every_bar_is_internally_consistent() -> None:
    for range_ in Range:
        for bar in demo.fetch_history("NVDA", range_):
            assert bar["low"] <= min(bar["open"], bar["price"]) <= max(bar["open"], bar["price"])
            assert max(bar["open"], bar["price"]) <= bar["high"]
            assert bar["volume"] > 0
            assert np.isfinite([bar["open"], bar["high"], bar["low"], bar["price"]]).all()


def test_dates_are_business_days_ending_at_the_frozen_date() -> None:
    bars = demo.fetch_history("VOO", Range.YEAR_1)
    dates = [bar["date"] for bar in bars]
    assert dates == sorted(dates)
    assert dates[-1] == demo.DEMO_END_DATE.isoformat()
    assert all(np.is_busday(d) for d in dates)


def test_intraday_bars_carry_a_time_component_and_stay_within_the_day() -> None:
    bars = demo.fetch_history("QQQ", Range.DAY_1)
    assert all("T" in bar["date"] for bar in bars)
    assert {bar["date"][:10] for bar in bars} == {demo.DEMO_END_DATE.isoformat()}
    assert bars[0]["date"].endswith("09:30:00")


def test_unknown_ticker_yields_nothing_rather_than_an_invented_series() -> None:
    assert demo.fetch_history("ZZZZ", Range.YEAR_1) == []
    assert not demo.is_demo_ticker("ZZZZ")


def test_explore_universe_and_benchmark_are_all_present() -> None:
    from app.services.universe import UNIVERSE

    symbols = {fund.ticker for fund in UNIVERSE}
    missing = {s for s in symbols | {"SPY"} if not demo.is_demo_ticker(s)}
    assert not missing, missing


def test_search_matches_symbol_or_name_and_is_bounded() -> None:
    rows = demo.search("van", limit=3)
    assert len(rows) == 3
    assert all("Vanguard" in r["name"] or "VAN" in r["ticker"] for r in rows)
    assert demo.search("", limit=5) == []
    assert demo.search("aapl")[0]["ticker"] == "AAPL"


def test_source_label_says_what_it_is() -> None:
    assert "Synthetic" in demo.SOURCE and "demo" in demo.SOURCE.lower()
