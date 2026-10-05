"""The data-quality contract, the shared resampler, and the one frequency source."""

from __future__ import annotations

import math

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas import Range
from app.services.providers import yahoo
from app.services.providers.prices import (
    FREQUENCY_BY_RANGE,
    Bar,
    Frequency,
    ProviderDataError,
    annualization_frequency,
    resample_bars,
    validate_bars,
)


def bar(date: str, o: float, h: float, lo: float, c: float, v: int = 100) -> Bar:
    return Bar(date, o, h, lo, c, v)


# --- validate_bars: normalized safely ---------------------------------------------


def test_unsorted_bars_are_sorted_by_timestamp() -> None:
    out = validate_bars([bar("2026-01-03", 1, 2, 1, 2), bar("2026-01-02", 1, 2, 1, 1.5)], "t")
    assert [b.date for b in out] == ["2026-01-02", "2026-01-03"]


def test_repeated_timestamps_keep_the_last_bar() -> None:
    out = validate_bars([bar("2026-01-02", 1, 2, 1, 1.5), bar("2026-01-02", 1, 3, 1, 2.5)], "t")
    assert len(out) == 1 and out[0].close == 2.5


def test_high_low_are_widened_to_bracket_open_and_close_without_touching_close() -> None:
    out = validate_bars([bar("2026-01-02", 10.0, 9.9, 9.0, 9.5)], "t")  # high below open
    assert out[0].high == 10.0 and out[0].close == 9.5 and out[0].low == 9.0


def test_sorting_is_stable_for_ties() -> None:
    a, b = bar("2026-01-02", 1, 2, 1, 1), bar("2026-01-02", 1, 2, 1, 2)
    assert validate_bars([a, b], "t")[0].close == 2  # last wins, so order mattered


# --- validate_bars: rejected --------------------------------------------------------


@pytest.mark.parametrize(
    ("bad", "reason"),
    [
        (bar("2026-01-02", 1, math.nan, 1, 1), "non-finite"),
        (bar("2026-01-02", 1, math.inf, 1, 1), "non-finite"),
        (bar("2026-01-02", 0.0, 2, 0.0, 1), "non-positive"),
        (bar("2026-01-02", 1, 2, 1, -1), "non-positive"),
        (bar("2026-01-02", 1, 1, 2, 1), "high below low"),
        (bar("2026-01-02", 1, 2, 1, 1, v=-5), "negative volume"),
    ],
)
def test_impossible_bars_reject_the_series_rather_than_being_repaired(
    bad: Bar, reason: str
) -> None:
    good = bar("2026-01-01", 1, 2, 1, 1.5)
    with pytest.raises(ProviderDataError) as exc:
        validate_bars([good, bad], "Vendor")
    assert reason in exc.value.reason
    assert exc.value.status_code == 502
    assert "Vendor" in str(exc.value)


def test_rejection_reaches_the_api_as_a_clean_502(monkeypatch: pytest.MonkeyPatch) -> None:
    rows = [
        {"date": "2026-01-02", "price": 1.0, "open": 1.0, "high": 2.0, "low": 1.0, "volume": 1},
        {"date": "2026-01-03", "price": -1.0, "open": 1.0, "high": 2.0, "low": 1.0, "volume": 1},
    ]
    monkeypatch.setattr(yahoo, "_fetch_history_sync", lambda *a: rows)
    response = TestClient(app).get("/api/v1/stocks/AAPL?range=1M")
    assert response.status_code == 502
    assert "inconsistent" in response.json()["detail"]
    assert "Traceback" not in response.text


# --- resample_bars -------------------------------------------------------------------


def _daily(dates: list[str]) -> list[Bar]:
    return [bar(d, 10 + i, 11 + i, 9 + i, 10.5 + i, 100) for i, d in enumerate(dates)]


def test_weekly_bars_are_labeled_by_the_last_session_they_contain() -> None:
    # Mon 2026-01-05 .. Thu 2026-01-08 (Friday missing, as on a holiday), then Mon 01-12.
    daily = _daily(["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-12"])
    weekly = resample_bars(daily, Frequency.WEEKLY)
    assert [b.date for b in weekly] == ["2026-01-08", "2026-01-12"]
    first = weekly[0]
    assert first.open == 10 and first.close == 13.5 and first.high == 14 and first.low == 9
    assert first.volume == 400


def test_monthly_bars_aggregate_a_whole_month() -> None:
    daily = _daily(["2026-01-29", "2026-01-30", "2026-02-02", "2026-02-27"])
    monthly = resample_bars(daily, Frequency.MONTHLY)
    assert [b.date for b in monthly] == ["2026-01-30", "2026-02-27"]
    assert monthly[1].open == 12 and monthly[1].close == 13.5


def test_resample_refuses_a_non_aggregate_frequency() -> None:
    with pytest.raises(ValueError):
        resample_bars(_daily(["2026-01-05"]), Frequency.DAILY)


def test_yfinance_adapter_resamples_weekly_and_monthly_from_daily(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import pandas as pd

    dates = [str(d.date()) for d in pd.bdate_range("2021-01-04", periods=400)]
    rows = [
        {
            "date": d,
            "price": 100.0 + i,
            "open": 100.0 + i,
            "high": 101.0 + i,
            "low": 99.0 + i,
            "volume": 1,
        }
        for i, d in enumerate(dates)
    ]
    seen: list[tuple[str, str]] = []

    def fake(ticker: str, period: str, interval: str) -> list[dict]:
        seen.append((period, interval))
        return rows

    monkeypatch.setattr(yahoo, "_fetch_history_sync", fake)
    weekly = yahoo.YFinancePriceProvider().fetch_history("AAPL", Range.YEAR_5)
    assert seen[-1] == ("5y", "1d"), "weekly bars come from daily bars, not Yahoo's 1wk"
    assert 75 <= len(weekly) <= 82
    assert all(pd.Timestamp(b.date).dayofweek <= 4 for b in weekly)
    monthly = yahoo.YFinancePriceProvider().fetch_history("AAPL", Range.MAX)
    assert seen[-1] == ("max", "1d")
    assert 18 <= len(monthly) <= 20


# --- one frequency source -------------------------------------------------------------


def test_every_range_has_a_frequency_and_intraday_has_no_annualization() -> None:
    for range_ in Range:
        assert range_ in FREQUENCY_BY_RANGE
    assert annualization_frequency(Range.DAY_1) is None
    assert annualization_frequency(Range.DAY_5) is None
    assert annualization_frequency(Range.YEAR_1) == "daily"
    assert annualization_frequency(Range.YEAR_5) == "weekly"
    assert annualization_frequency(Range.MAX) == "monthly"


def test_no_route_keeps_a_private_frequency_table() -> None:
    from pathlib import Path

    routes = Path(__file__).resolve().parents[1] / "app" / "routes"
    offenders = [p.name for p in routes.glob("*.py") if "_FREQUENCY_BY_RANGE" in p.read_text()]
    assert offenders == []
