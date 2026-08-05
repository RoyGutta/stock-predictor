"""Technical indicators.

Pure functions over an OHLCV frame. No I/O, no caching, no framework -- every
function takes a DataFrame and returns Series, so each one is directly testable
against hand-computed values.

A note on what these are: technical indicators are *descriptive statistics over
past prices*. An RSI of 80 says the recent up-moves have been large relative to
the down-moves. It does not say the price will fall. Every docstring here
describes what the number measures, never what it predicts -- that language
carries through to the API and the UI.

Conventions
-----------
* Every function returns a Series aligned to the input index, NaN-padded at the
  front where there is not yet enough history. Callers must not treat leading
  NaN as zero.
* Smoothing follows Wilder's method (``alpha = 1/period``) where the original
  indicator specified it -- RSI, ATR, ADX. Using a standard EMA there is a
  common and subtle error that shifts values noticeably.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

__all__ = [
    "adx",
    "atr",
    "bollinger_bands",
    "ema",
    "macd",
    "obv",
    "rsi",
    "sma",
    "stochastic",
    "vwap",
    "ichimoku",
    "BollingerBands",
    "MACD",
    "Stochastic",
    "ADX",
    "Ichimoku",
]


def _validate_period(period: int, name: str = "period") -> None:
    if period < 1:
        raise ValueError(f"{name} must be >= 1, got {period}")


def _require_columns(frame: pd.DataFrame, columns: tuple[str, ...]) -> None:
    missing = [column for column in columns if column not in frame.columns]
    if missing:
        raise KeyError(f"missing required column(s): {', '.join(missing)}")


# --- trend ------------------------------------------------------------------


def sma(series: pd.Series, period: int = 20) -> pd.Series:
    """Simple Moving Average: the unweighted mean of the last `period` values.

    Measures the average price level over the window, smoothing short-term noise.
    """
    _validate_period(period)
    return series.rolling(window=period, min_periods=period).mean()


def ema(series: pd.Series, period: int = 20) -> pd.Series:
    """Exponential Moving Average: a mean that weights recent values more heavily.

    Responds to new prices faster than an SMA of the same period, at the cost of
    being noisier.
    """
    _validate_period(period)
    return series.ewm(span=period, adjust=False, min_periods=period).mean()


def _wilder(series: pd.Series, period: int) -> pd.Series:
    """Wilder's smoothing: an EMA with alpha = 1/period.

    Distinct from ``ema(period)``, which uses alpha = 2/(period+1). RSI, ATR and
    ADX were all defined with this smoothing and are wrong without it.
    """
    return series.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()


def vwap(frame: pd.DataFrame) -> pd.Series:
    """Volume-Weighted Average Price, accumulated across the series.

    The average price paid per share so far, weighting each bar by its volume.
    Intended for intraday data, where it resets each session; on daily bars it
    is a running all-time figure and is far less meaningful.
    """
    _require_columns(frame, ("high", "low", "close", "volume"))
    typical = (frame["high"] + frame["low"] + frame["close"]) / 3
    cumulative_volume = frame["volume"].cumsum()
    # Guard the opening bar, where cumulative volume can legitimately be zero.
    return (typical * frame["volume"]).cumsum() / cumulative_volume.replace(0, np.nan)


# --- momentum ---------------------------------------------------------------


def rsi(series: pd.Series, period: int = 14) -> pd.Series:
    """Relative Strength Index, 0-100 (Wilder).

    Compares the size of recent gains to recent losses. High values mean up-moves
    have dominated the window; low values mean down-moves have. The conventional
    70/30 "overbought/oversold" reading is a heuristic, not a signal -- a strong
    trend can hold RSI above 70 for a long time.
    """
    _validate_period(period)
    delta = series.diff()
    gains = delta.clip(lower=0)
    losses = -delta.clip(upper=0)

    avg_gain = _wilder(gains, period)
    avg_loss = _wilder(losses, period)

    relative_strength = avg_gain / avg_loss
    result = 100 - (100 / (1 + relative_strength))

    # Two distinct degenerate cases, which must not be collapsed:
    #   gains > 0, losses == 0  -> RS is infinite, RSI saturates at 100.
    #   gains == 0, losses == 0 -> a perfectly flat window. RSI is 0/0, genuinely
    #     undefined. Returning 100 here would report maximum bullish momentum for
    #     a price that has not moved at all.
    saturated = (avg_loss == 0) & (avg_gain > 0)
    undefined = (avg_loss == 0) & (avg_gain == 0)
    return result.mask(saturated, 100.0).mask(undefined, np.nan).where(avg_gain.notna())


@dataclass(frozen=True)
class MACD:
    macd: pd.Series
    signal: pd.Series
    histogram: pd.Series


def macd(series: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> MACD:
    """Moving Average Convergence Divergence.

    The gap between a fast and a slow EMA, plus a signal line (an EMA of that
    gap) and a histogram (the difference between the two). Measures whether
    short-term average price is pulling away from long-term average price.
    """
    _validate_period(fast, "fast")
    _validate_period(slow, "slow")
    _validate_period(signal, "signal")
    if fast >= slow:
        raise ValueError(f"fast period ({fast}) must be < slow period ({slow})")

    macd_line = ema(series, fast) - ema(series, slow)
    signal_line = macd_line.ewm(span=signal, adjust=False, min_periods=signal).mean()
    return MACD(macd=macd_line, signal=signal_line, histogram=macd_line - signal_line)


@dataclass(frozen=True)
class Stochastic:
    k: pd.Series
    d: pd.Series


def stochastic(
    frame: pd.DataFrame, period: int = 14, smooth_k: int = 3, smooth_d: int = 3
) -> Stochastic:
    """Stochastic Oscillator, 0-100.

    Where the current close sits within the high-low range of the window: 100
    means it closed at the top of the range, 0 at the bottom.
    """
    _require_columns(frame, ("high", "low", "close"))
    _validate_period(period)

    lowest = frame["low"].rolling(period, min_periods=period).min()
    highest = frame["high"].rolling(period, min_periods=period).max()
    span = highest - lowest

    # A flat window (high == low) has no defined position within the range.
    raw_k = 100 * (frame["close"] - lowest) / span.replace(0, np.nan)
    k = raw_k.rolling(smooth_k, min_periods=smooth_k).mean()
    return Stochastic(k=k, d=k.rolling(smooth_d, min_periods=smooth_d).mean())


# --- volatility -------------------------------------------------------------


def true_range(frame: pd.DataFrame) -> pd.Series:
    """True Range: the greatest of today's high-low, and each extreme's gap from
    yesterday's close. Captures overnight gaps that a plain high-low misses."""
    _require_columns(frame, ("high", "low", "close"))
    previous_close = frame["close"].shift(1)
    return pd.concat(
        [
            frame["high"] - frame["low"],
            (frame["high"] - previous_close).abs(),
            (frame["low"] - previous_close).abs(),
        ],
        axis=1,
    ).max(axis=1)


def atr(frame: pd.DataFrame, period: int = 14) -> pd.Series:
    """Average True Range (Wilder): typical bar-to-bar movement, in price units.

    A volatility measure with no direction -- it says how far price tends to
    travel, not which way. Quoted in dollars, so it is not comparable across
    stocks at different price levels without normalising.
    """
    _validate_period(period)
    return _wilder(true_range(frame), period)


@dataclass(frozen=True)
class BollingerBands:
    upper: pd.Series
    middle: pd.Series
    lower: pd.Series
    bandwidth: pd.Series


def bollinger_bands(series: pd.Series, period: int = 20, std_devs: float = 2.0) -> BollingerBands:
    """Bollinger Bands: an SMA with bands at +/- N standard deviations.

    The bands widen when volatility rises and narrow when it falls. `bandwidth`
    expresses the gap as a fraction of the middle band, which makes it
    comparable across stocks at different prices.
    """
    _validate_period(period)
    if std_devs <= 0:
        raise ValueError(f"std_devs must be > 0, got {std_devs}")

    middle = sma(series, period)
    # ddof=0: population standard deviation, matching the original definition.
    deviation = series.rolling(period, min_periods=period).std(ddof=0)
    upper = middle + std_devs * deviation
    lower = middle - std_devs * deviation
    return BollingerBands(
        upper=upper,
        middle=middle,
        lower=lower,
        bandwidth=(upper - lower) / middle.replace(0, np.nan),
    )


@dataclass(frozen=True)
class ADX:
    adx: pd.Series
    plus_di: pd.Series
    minus_di: pd.Series


def adx(frame: pd.DataFrame, period: int = 14) -> ADX:
    """Average Directional Index (Wilder), 0-100, plus the +DI/-DI components.

    Measures how *strong* a trend is, not which direction it runs -- ADX rises
    in strong downtrends as well as strong uptrends. Direction comes from
    comparing +DI and -DI. Readings below ~20 conventionally indicate no clear
    trend.
    """
    _validate_period(period)
    _require_columns(frame, ("high", "low", "close"))

    up_move = frame["high"].diff()
    down_move = -frame["low"].diff()

    # A directional move counts only when it exceeds the opposite move.
    plus_dm = pd.Series(
        np.where((up_move > down_move) & (up_move > 0), up_move, 0.0), index=frame.index
    )
    minus_dm = pd.Series(
        np.where((down_move > up_move) & (down_move > 0), down_move, 0.0), index=frame.index
    )

    smoothed_tr = _wilder(true_range(frame), period).replace(0, np.nan)
    plus_di = 100 * _wilder(plus_dm, period) / smoothed_tr
    minus_di = 100 * _wilder(minus_dm, period) / smoothed_tr

    di_sum = (plus_di + minus_di).replace(0, np.nan)
    directional_index = 100 * (plus_di - minus_di).abs() / di_sum
    return ADX(adx=_wilder(directional_index, period), plus_di=plus_di, minus_di=minus_di)


# --- volume -----------------------------------------------------------------


def obv(frame: pd.DataFrame) -> pd.Series:
    """On-Balance Volume: a running total that adds the bar's volume on an up
    close and subtracts it on a down close.

    The absolute level is arbitrary (it depends where the series starts); only
    its direction and slope carry meaning.
    """
    _require_columns(frame, ("close", "volume"))
    direction = np.sign(frame["close"].diff()).fillna(0.0)
    return (direction * frame["volume"]).cumsum()


# --- composite --------------------------------------------------------------


@dataclass(frozen=True)
class Ichimoku:
    conversion: pd.Series
    base: pd.Series
    span_a: pd.Series
    span_b: pd.Series
    lagging: pd.Series


def ichimoku(
    frame: pd.DataFrame,
    conversion_period: int = 9,
    base_period: int = 26,
    span_b_period: int = 52,
) -> Ichimoku:
    """Ichimoku Kinko Hyo.

    Each line is the midpoint of the high-low range over its own window. The two
    spans are projected *forward* by `base_period` bars and the lagging line
    *backward* -- that shifting is part of the definition, and the forward spans
    extend past the last bar of input data.
    """
    _require_columns(frame, ("high", "low", "close"))
    for period, name in (
        (conversion_period, "conversion_period"),
        (base_period, "base_period"),
        (span_b_period, "span_b_period"),
    ):
        _validate_period(period, name)

    def midpoint(period: int) -> pd.Series:
        return (
            frame["high"].rolling(period, min_periods=period).max()
            + frame["low"].rolling(period, min_periods=period).min()
        ) / 2

    conversion = midpoint(conversion_period)
    base = midpoint(base_period)
    return Ichimoku(
        conversion=conversion,
        base=base,
        span_a=((conversion + base) / 2).shift(base_period),
        span_b=midpoint(span_b_period).shift(base_period),
        lagging=frame["close"].shift(-base_period),
    )
