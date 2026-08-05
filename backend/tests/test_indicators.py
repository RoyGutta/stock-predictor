"""Indicator tests.

Where an indicator has a closed-form value on a simple series, it is checked
against a hand-computed number rather than a snapshot -- a snapshot only proves
the code still does what it did before, not that it was ever correct.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.analytics.indicators import (
    adx,
    atr,
    bollinger_bands,
    ema,
    ichimoku,
    macd,
    obv,
    rsi,
    sma,
    stochastic,
    true_range,
    vwap,
)


@pytest.fixture
def frame() -> pd.DataFrame:
    """30 bars of a gently oscillating, upward-drifting series."""
    n = 30
    close = pd.Series(100 + np.arange(n) * 0.5 + np.sin(np.arange(n)) * 2)
    return pd.DataFrame(
        {
            "open": close.shift(1).fillna(close.iloc[0]),
            "high": close + 1.0,
            "low": close - 1.0,
            "close": close,
            "volume": pd.Series(np.full(n, 1_000_000)),
        }
    )


def flat(value: float = 50.0, n: int = 40) -> pd.DataFrame:
    s = pd.Series(np.full(n, value))
    return pd.DataFrame(
        {"open": s, "high": s, "low": s, "close": s, "volume": pd.Series(np.full(n, 1000))}
    )


# --- moving averages --------------------------------------------------------


def test_sma_matches_hand_computed_mean() -> None:
    result = sma(pd.Series([1.0, 2, 3, 4, 5]), 3)
    assert result.iloc[:2].isna().all()
    assert list(result.iloc[2:]) == [2.0, 3.0, 4.0]


def test_sma_of_constant_is_the_constant() -> None:
    assert sma(pd.Series(np.full(10, 7.0)), 5).iloc[-1] == 7.0


def test_ema_seeds_and_smooths() -> None:
    # min_periods=period means the first value appears at index period-1.
    result = ema(pd.Series([1.0, 2, 3, 4, 5]), 3)
    assert result.iloc[:2].isna().all()
    assert result.notna().iloc[2:].all()


def test_ema_of_constant_is_the_constant() -> None:
    assert ema(pd.Series(np.full(20, 5.0)), 10).iloc[-1] == pytest.approx(5.0)


def test_ema_tracks_faster_than_sma() -> None:
    # On a step change, the recency-weighted mean must move further.
    prices = pd.Series([10.0] * 20 + [20.0] * 5)
    assert ema(prices, 10).iloc[-1] > sma(prices, 10).iloc[-1]


@pytest.mark.parametrize("bad", [0, -1])
def test_moving_averages_reject_bad_periods(bad: int) -> None:
    with pytest.raises(ValueError):
        sma(pd.Series([1.0, 2.0]), bad)
    with pytest.raises(ValueError):
        ema(pd.Series([1.0, 2.0]), bad)


# --- RSI --------------------------------------------------------------------


def test_rsi_is_100_when_every_bar_gains() -> None:
    """With no losses, average loss is zero and RSI saturates at 100."""
    result = rsi(pd.Series(np.arange(1.0, 40.0)), 14)
    assert result.iloc[-1] == pytest.approx(100.0)


def test_rsi_is_zero_when_every_bar_loses() -> None:
    result = rsi(pd.Series(np.arange(40.0, 1.0, -1)), 14)
    assert result.iloc[-1] == pytest.approx(0.0, abs=1e-9)


def test_rsi_is_undefined_on_a_flat_series() -> None:
    """0 gains and 0 losses is 0/0, not saturation. Reporting 100 here would
    claim maximum bullish momentum for a price that never moved."""
    assert rsi(pd.Series(np.full(40, 100.0)), 14).dropna().empty


def test_rsi_distinguishes_saturation_from_undefined() -> None:
    rising = rsi(pd.Series(np.arange(1.0, 40.0)), 14).iloc[-1]
    flat_series = rsi(pd.Series(np.full(40, 100.0)), 14).iloc[-1]
    assert rising == pytest.approx(100.0)
    assert np.isnan(flat_series)


def test_rsi_stays_within_bounds(frame: pd.DataFrame) -> None:
    result = rsi(frame["close"], 14).dropna()
    assert not result.empty
    assert result.between(0, 100).all()


def test_rsi_uses_wilder_smoothing_not_ema() -> None:
    """Wilder's alpha is 1/period; a standard EMA would use 2/(period+1) and
    produce a materially different number."""
    prices = pd.Series([44.0, 44.3, 44.1, 44.2, 44.5, 43.4, 44.3, 44.8, 45.0, 45.8,
                        46.0, 45.9, 46.3, 46.3, 46.0, 46.4, 46.2, 45.6, 46.3, 46.5])
    wilder = rsi(prices, 14).iloc[-1]

    delta = prices.diff()
    gains, losses = delta.clip(lower=0), -delta.clip(upper=0)
    wrong = 100 - 100 / (
        1 + gains.ewm(span=14, adjust=False).mean() / losses.ewm(span=14, adjust=False).mean()
    )
    assert abs(wilder - wrong.iloc[-1]) > 0.5


# --- MACD -------------------------------------------------------------------


def test_macd_histogram_is_line_minus_signal(frame: pd.DataFrame) -> None:
    result = macd(frame["close"], 3, 6, 3)
    valid = result.histogram.dropna()
    assert np.allclose(valid, (result.macd - result.signal).dropna())


def test_macd_is_zero_on_a_flat_series() -> None:
    result = macd(pd.Series(np.full(60, 25.0)), 12, 26, 9)
    assert result.macd.dropna().abs().max() == pytest.approx(0.0, abs=1e-9)


def test_macd_rejects_fast_not_less_than_slow() -> None:
    with pytest.raises(ValueError, match="must be <"):
        macd(pd.Series(np.arange(50.0)), fast=26, slow=12)


# --- volatility -------------------------------------------------------------


def test_true_range_captures_an_overnight_gap() -> None:
    """A gap up means the true range exceeds the bar's own high-low."""
    data = pd.DataFrame({"high": [10.0, 20.0], "low": [9.0, 19.0], "close": [9.5, 19.5]})
    assert true_range(data).iloc[1] == pytest.approx(20.0 - 9.5)


def test_atr_is_zero_on_a_flat_series() -> None:
    assert atr(flat(), 14).iloc[-1] == pytest.approx(0.0)


def test_atr_is_positive_and_finite(frame: pd.DataFrame) -> None:
    result = atr(frame, 14).dropna()
    assert (result > 0).all()
    assert np.isfinite(result).all()


def test_bollinger_bands_collapse_without_variance() -> None:
    result = bollinger_bands(flat()["close"], 20)
    assert result.upper.iloc[-1] == pytest.approx(50.0)
    assert result.lower.iloc[-1] == pytest.approx(50.0)


def test_bollinger_bands_are_symmetric(frame: pd.DataFrame) -> None:
    result = bollinger_bands(frame["close"], 10)
    i = -1
    assert (result.upper.iloc[i] - result.middle.iloc[i]) == pytest.approx(
        result.middle.iloc[i] - result.lower.iloc[i]
    )


def test_bollinger_uses_population_std() -> None:
    # window [2,4]: mean 3, population sd 1 -> upper 5, lower 1
    result = bollinger_bands(pd.Series([2.0, 4.0]), 2, 2.0)
    assert result.upper.iloc[-1] == pytest.approx(5.0)
    assert result.lower.iloc[-1] == pytest.approx(1.0)


def test_bollinger_rejects_non_positive_std_devs() -> None:
    with pytest.raises(ValueError):
        bollinger_bands(pd.Series(np.arange(30.0)), 10, 0)


# --- ADX --------------------------------------------------------------------


def test_adx_stays_within_bounds(frame: pd.DataFrame) -> None:
    result = adx(frame, 5)
    values = result.adx.dropna()
    assert not values.empty
    assert values.between(0, 100).all()


def test_adx_rises_in_a_strong_trend() -> None:
    n = 60
    close = pd.Series(np.arange(100.0, 100.0 + n))
    trending = pd.DataFrame(
        {"high": close + 0.5, "low": close - 0.5, "close": close, "open": close}
    )
    # A perfectly monotonic series is maximally directional.
    assert adx(trending, 14).adx.dropna().iloc[-1] > 50


def test_adx_plus_di_dominates_in_an_uptrend() -> None:
    close = pd.Series(np.arange(100.0, 160.0))
    trending = pd.DataFrame(
        {"high": close + 0.5, "low": close - 0.5, "close": close, "open": close}
    )
    result = adx(trending, 14)
    assert result.plus_di.iloc[-1] > result.minus_di.iloc[-1]


def test_adx_does_not_divide_by_zero_on_flat_data() -> None:
    result = adx(flat(), 14)
    assert not np.isinf(result.adx.dropna()).any()


# --- stochastic -------------------------------------------------------------


def test_stochastic_is_100_at_the_top_of_the_range() -> None:
    close = pd.Series(np.arange(1.0, 30.0))
    data = pd.DataFrame({"high": close, "low": close - 5, "close": close, "open": close})
    # Each close is the highest point of its own window.
    assert stochastic(data, 5, 1, 1).k.dropna().iloc[-1] == pytest.approx(100.0)


def test_stochastic_stays_within_bounds(frame: pd.DataFrame) -> None:
    values = stochastic(frame, 5).k.dropna()
    assert not values.empty
    assert values.between(0, 100).all()


def test_stochastic_handles_a_flat_window() -> None:
    """high == low would divide by zero; the value is undefined, not infinite."""
    result = stochastic(flat(), 5, 1, 1).k
    assert not np.isinf(result.dropna()).any()


# --- volume -----------------------------------------------------------------


def test_obv_accumulates_by_close_direction() -> None:
    data = pd.DataFrame({"close": [10.0, 11, 10, 12], "volume": [100.0, 200, 300, 400]})
    # first bar 0 (no prior close), then +200, -300, +400
    assert list(obv(data)) == [0.0, 200.0, -100.0, 300.0]


def test_obv_ignores_unchanged_closes() -> None:
    data = pd.DataFrame({"close": [10.0, 10.0, 10.0], "volume": [100.0, 200, 300]})
    assert obv(data).iloc[-1] == 0.0


def test_vwap_equals_typical_price_at_constant_volume() -> None:
    data = pd.DataFrame(
        {"high": [11.0, 11], "low": [9.0, 9], "close": [10.0, 10], "volume": [100.0, 100]}
    )
    assert vwap(data).iloc[-1] == pytest.approx(10.0)


def test_vwap_survives_zero_opening_volume() -> None:
    data = pd.DataFrame(
        {"high": [11.0, 11], "low": [9.0, 9], "close": [10.0, 10], "volume": [0.0, 100]}
    )
    assert not np.isinf(vwap(data).dropna()).any()


# --- ichimoku ---------------------------------------------------------------


def test_ichimoku_spans_are_shifted_forward(frame: pd.DataFrame) -> None:
    result = ichimoku(frame, 9, 26, 52)
    # span_a is shifted forward by base_period, so early bars must be empty.
    assert result.span_a.iloc[:26].isna().all()


def test_ichimoku_lagging_line_is_shifted_backward(frame: pd.DataFrame) -> None:
    result = ichimoku(frame, 9, 26, 52)
    assert result.lagging.iloc[-26:].isna().all()


def test_ichimoku_conversion_is_the_window_midpoint() -> None:
    close = pd.Series(np.arange(1.0, 30.0))
    data = pd.DataFrame({"high": close + 1, "low": close - 1, "close": close, "open": close})
    result = ichimoku(data, 9, 26, 52)
    window_high = (close + 1).iloc[-9:].max()
    window_low = (close - 1).iloc[-9:].min()
    assert result.conversion.iloc[-1] == pytest.approx((window_high + window_low) / 2)


# --- shared contracts -------------------------------------------------------


def test_indicators_reject_missing_columns() -> None:
    incomplete = pd.DataFrame({"close": [1.0, 2.0, 3.0]})
    for fn in (atr, lambda f: adx(f, 2), lambda f: stochastic(f, 2), vwap):
        with pytest.raises(KeyError):
            fn(incomplete)


def test_indicators_preserve_the_input_index(frame: pd.DataFrame) -> None:
    indexed = frame.set_index(pd.date_range("2026-01-01", periods=len(frame), freq="D"))
    assert sma(indexed["close"], 5).index.equals(indexed.index)
    assert rsi(indexed["close"], 5).index.equals(indexed.index)
    assert atr(indexed, 5).index.equals(indexed.index)
