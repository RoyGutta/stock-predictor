"""Contract tests every PriceProvider must pass.

The same assertions run against the synthetic provider and the yfinance adapter
(with its transport stubbed), so a third implementation can be dropped into the
parametrization and judged by the identical rules.
"""

from __future__ import annotations

import math

import pytest

from app.schemas import Range
from app.services.providers import demo, yahoo
from app.services.providers.base import Capability
from app.services.providers.prices import (
    FREQUENCY_BY_RANGE,
    AdjustmentBasis,
    Bar,
    PriceProvider,
    SecurityIdentity,
)


def _fixture_rows(n: int, intraday: bool = False) -> list[dict]:
    import numpy as np
    import pandas as pd

    rng = np.random.default_rng(3)
    prices = 100 * np.exp(np.cumsum(rng.normal(0.0003, 0.01, n)))
    if intraday:
        idx = pd.date_range("2026-01-05 09:30", periods=n, freq="5min")
        dates = [d.isoformat() for d in idx]
    else:
        dates = [str(d.date()) for d in pd.bdate_range("2021-01-04", periods=n)]
    return [
        {"date": dates[i], "price": round(float(p), 4), "open": round(float(p) * 0.998, 4),
         "high": round(float(p) * 1.004, 4), "low": round(float(p) * 0.995, 4), "volume": 1_000_000}
        for i, p in enumerate(prices)
    ]


@pytest.fixture(params=["demo", "yfinance"])
def provider(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch) -> PriceProvider:
    if request.param == "demo":
        return demo.DemoPriceProvider()

    def fake_history(ticker: str, period: str, interval: str) -> list[dict]:
        if ticker == "ZZZZ":
            return []
        n = {"1d": 78, "5d": 65}.get(period, 300)
        return _fixture_rows(n, intraday=interval in yahoo._INTRADAY_INTERVALS)

    monkeypatch.setattr(yahoo, "_fetch_history_sync", fake_history)
    monkeypatch.setattr(
        yahoo, "_fetch_profile_sync", lambda t: {"company_name": "Fixture Corp", "currency": "USD"}
    )
    return yahoo.YFinancePriceProvider()


def test_satisfies_the_protocol(provider: PriceProvider) -> None:
    assert isinstance(provider, PriceProvider)
    assert provider.name.strip()
    assert isinstance(provider.adjustment, AdjustmentBasis)
    assert Capability.PRICES in provider.capabilities


@pytest.mark.parametrize("range_", list(Range))
def test_bars_are_normalized_for_every_range(provider: PriceProvider, range_: Range) -> None:
    bars = provider.fetch_history("AAPL", range_)
    assert bars, range_
    assert all(isinstance(bar, Bar) for bar in bars)
    dates = [bar.date for bar in bars]
    assert dates == sorted(dates), "bars must be oldest first"
    assert len(set(dates)) == len(dates), "no duplicate timestamps"
    intraday = range_ in (Range.DAY_1, Range.DAY_5)
    assert all(("T" in d) == intraday for d in dates), FREQUENCY_BY_RANGE[range_]
    for bar in bars:
        values = (bar.open, bar.high, bar.low, bar.close)
        assert all(math.isfinite(v) for v in values)
        assert bar.low <= min(bar.open, bar.close) <= max(bar.open, bar.close) <= bar.high
        assert isinstance(bar.volume, int) and bar.volume >= 0


def test_unknown_ticker_is_empty_not_invented(provider: PriceProvider) -> None:
    assert provider.fetch_history("ZZZZ", Range.YEAR_1) == []


def test_identity_has_the_two_strings_the_ui_needs(provider: PriceProvider) -> None:
    identity = provider.fetch_identity("AAPL")
    assert isinstance(identity, SecurityIdentity)
    assert identity.ticker == "AAPL"
    assert identity.company_name.strip()
    assert identity.currency.strip()


def test_adjustment_basis_is_declared_and_specific() -> None:
    assert yahoo.YFinancePriceProvider.adjustment is AdjustmentBasis.SPLIT_AND_DIVIDEND
    assert demo.DemoPriceProvider.adjustment is AdjustmentBasis.SYNTHETIC


def test_bar_never_zero_fills_a_missing_price() -> None:
    with pytest.raises((KeyError, TypeError, ValueError)):
        Bar.from_candle_dict(
            {"date": "2026-01-02", "open": 1.0, "high": 1.0, "low": 1.0, "volume": 1}
        )
