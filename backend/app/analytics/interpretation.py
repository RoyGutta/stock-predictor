"""Turning computed indicators into honest, plain-English observations.

Design rules, in priority order:

1. **Never output a buy or sell verdict.** Each indicator produces an
   *observation* about what prices have already done. Observations are grouped
   into supporting and opposing evidence and shown side by side.

2. **"Agreement" is not "confidence in a prediction."** The score this module
   produces measures how much the indicators agree *with each other* -- nothing
   more. Indicators are largely derived from the same price series, so agreement
   is partly an artifact of shared inputs, not independent confirmation. That
   caveat ships with the payload.

3. **Conflicts are surfaced, not resolved.** When momentum and trend disagree,
   that disagreement is the most informative thing available, and hiding it
   behind a single score would be the dishonest move.

4. **Every observation carries a caveat.** Each indicator has known failure
   modes -- RSI stays "overbought" through strong trends, moving-average
   crossovers lag by construction. The caveat is part of the observation, not
   fine print.

This layer is deterministic on purpose. Generated prose can be layered on top
and labeled as such, but the substance is computed, reproducible, and testable.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

import pandas as pd

from app.analytics import indicators as ind


class Stance(str, Enum):
    """Which direction the historical evidence leans. Not a recommendation."""

    BULLISH = "bullish"
    BEARISH = "bearish"
    NEUTRAL = "neutral"


@dataclass(frozen=True)
class Observation:
    indicator: str
    stance: Stance
    value: float | None
    headline: str
    """One sentence, plain English, no jargon beyond the indicator's own name."""
    detail: str
    """What the number actually measures."""
    caveat: str
    """This indicator's known failure mode. Always populated."""


@dataclass(frozen=True)
class Interpretation:
    observations: list[Observation]
    bullish: list[Observation] = field(default_factory=list)
    bearish: list[Observation] = field(default_factory=list)
    neutral: list[Observation] = field(default_factory=list)
    agreement_score: float = 0.0
    """0-1. How much the indicators agree with each other. NOT a probability."""
    agreement_label: str = ""
    conflicts: list[str] = field(default_factory=list)
    summary: str = ""
    disclaimer: str = ""


_INSUFFICIENT = "Not enough price history in this range to compute this indicator."


def _latest(series: pd.Series) -> float | None:
    """Most recent non-NaN value, or None if the series never became valid."""
    valid = series.dropna()
    return float(valid.iloc[-1]) if not valid.empty else None


# --- per-indicator observations ---------------------------------------------


def _observe_rsi(frame: pd.DataFrame, period: int = 14) -> Observation | None:
    value = _latest(ind.rsi(frame["close"], period))
    if value is None:
        return None

    if value >= 70:
        stance = Stance.BEARISH
        headline = f"RSI is {value:.0f}, in the conventional 'overbought' zone."
    elif value <= 30:
        stance = Stance.BULLISH
        headline = f"RSI is {value:.0f}, in the conventional 'oversold' zone."
    else:
        stance = Stance.NEUTRAL
        headline = f"RSI is {value:.0f}, in the neutral middle of its range."

    return Observation(
        indicator="RSI",
        stance=stance,
        value=value,
        headline=headline,
        detail=(
            f"Over the last {period} bars, RSI compares the size of up-moves to down-moves "
            "on a 0-100 scale. Above 70 means gains have dominated; below 30 means losses have."
        ),
        caveat=(
            "'Overbought' does not mean 'about to fall'. In a strong trend RSI can sit above 70 "
            "for months while the price keeps rising. It describes what already happened."
        ),
    )


def _observe_macd(frame: pd.DataFrame) -> Observation | None:
    result = ind.macd(frame["close"])
    histogram = _latest(result.histogram)
    if histogram is None:
        return None

    if histogram > 0:
        stance = Stance.BULLISH
        headline = "MACD is above its signal line — short-term average price is pulling ahead."
    elif histogram < 0:
        stance = Stance.BEARISH
        headline = "MACD is below its signal line — short-term average price is falling behind."
    else:
        stance = Stance.NEUTRAL
        headline = "MACD is sitting exactly on its signal line."

    return Observation(
        indicator="MACD",
        stance=stance,
        value=histogram,
        headline=headline,
        detail=(
            "MACD tracks the gap between a 12-period and a 26-period exponential moving average. "
            "The histogram shown here is that gap minus its own 9-period average."
        ),
        caveat=(
            "MACD is built from moving averages, so it lags by construction — it confirms moves "
            "that have already begun. It also produces frequent false crossovers in sideways "
            "markets."
        ),
    )


def _observe_trend(frame: pd.DataFrame, short: int = 50, long: int = 200) -> Observation | None:
    """Where price sits relative to its own long-run average."""
    close = frame["close"]
    if len(close.dropna()) < long:
        short, long = 20, 50  # fall back for shorter ranges
    if len(close.dropna()) < long:
        return None

    short_ma = _latest(ind.sma(close, short))
    long_ma = _latest(ind.sma(close, long))
    price = _latest(close)
    if short_ma is None or long_ma is None or price is None:
        return None

    if short_ma > long_ma:
        stance = Stance.BULLISH
        headline = f"The {short}-period average is above the {long}-period average."
    elif short_ma < long_ma:
        stance = Stance.BEARISH
        headline = f"The {short}-period average is below the {long}-period average."
    else:
        stance = Stance.NEUTRAL
        headline = "The two moving averages are level."

    return Observation(
        indicator=f"Moving averages ({short}/{long})",
        stance=stance,
        value=short_ma - long_ma,
        headline=headline,
        detail=(
            f"Comparing the average price over the last {short} bars against the last {long}. "
            "When the shorter average is higher, recent prices have been above the longer-run "
            "level."
        ),
        caveat=(
            "This is one of the laggiest signals there is. By the time the averages cross, a large "
            "part of the move has already happened. It says nothing about what comes next."
        ),
    )


def _observe_adx(frame: pd.DataFrame, period: int = 14) -> Observation | None:
    result = ind.adx(frame, period)
    value = _latest(result.adx)
    plus_di = _latest(result.plus_di)
    minus_di = _latest(result.minus_di)
    if value is None or plus_di is None or minus_di is None:
        return None

    if value < 20:
        stance = Stance.NEUTRAL
        headline = f"ADX is {value:.0f} — there is no strong trend in either direction."
    elif plus_di > minus_di:
        stance = Stance.BULLISH
        headline = f"ADX is {value:.0f} with upward pressure dominating — a strong uptrend."
    else:
        stance = Stance.BEARISH
        headline = f"ADX is {value:.0f} with downward pressure dominating — a strong downtrend."

    return Observation(
        indicator="ADX",
        stance=stance,
        value=value,
        headline=headline,
        detail=(
            "ADX measures how strong a trend is, from 0 to 100, regardless of direction. "
            "Below 20 conventionally means 'no clear trend'. Direction comes from comparing "
            "the +DI and -DI components."
        ),
        caveat=(
            "ADX rises in strong downtrends exactly as it does in strong uptrends. A high "
            "reading on its own says a trend exists, not that it is a good one — or that it "
            "will last."
        ),
    )


def _observe_bollinger(frame: pd.DataFrame, period: int = 20) -> Observation | None:
    bands = ind.bollinger_bands(frame["close"], period)
    price = _latest(frame["close"])
    upper, lower = _latest(bands.upper), _latest(bands.lower)
    if price is None or upper is None or lower is None:
        return None

    if price > upper:
        stance = Stance.BEARISH
        headline = "Price has closed above the upper Bollinger Band — an unusually large move up."
    elif price < lower:
        stance = Stance.BULLISH
        headline = "Price has closed below the lower Bollinger Band — an unusually large move down."
    else:
        stance = Stance.NEUTRAL
        headline = "Price is within its normal volatility range."

    return Observation(
        indicator="Bollinger Bands",
        stance=stance,
        value=price,
        headline=headline,
        detail=(
            f"The bands sit two standard deviations above and below the {period}-period average. "
            "Roughly 95% of recent closes fall inside them, so a close outside is statistically "
            "unusual."
        ),
        caveat=(
            "'Unusual' is not 'wrong'. Prices ride the upper band throughout strong rallies. "
            "Treating a band touch as a reversal signal is a common and expensive mistake."
        ),
    )


def _observe_volatility(frame: pd.DataFrame, period: int = 14) -> Observation | None:
    value = _latest(ind.atr(frame, period))
    price = _latest(frame["close"])
    if value is None or price is None or price == 0:
        return None

    percent = value / price * 100
    return Observation(
        indicator="Volatility (ATR)",
        stance=Stance.NEUTRAL,  # volatility has no direction
        value=percent,
        headline=f"Typical daily movement is about {percent:.1f}% of the share price.",
        detail=(
            "Average True Range measures how far the price typically travels in a bar, including "
            "overnight gaps. Shown as a percentage so it is comparable across different share "
            "prices."
        ),
        caveat=(
            "Volatility has no direction — it says how much the price moves, not which way. "
            "High volatility means larger swings in both directions."
        ),
    )


_OBSERVERS = (
    _observe_trend,
    _observe_macd,
    _observe_rsi,
    _observe_adx,
    _observe_bollinger,
    _observe_volatility,
)


# --- aggregation ------------------------------------------------------------

_DISCLAIMER = (
    "These are descriptions of past price movement, not predictions and not investment "
    "advice. Technical indicators are recomputed from the same price history, so when they "
    "agree it is partly because they share inputs — not because several independent sources "
    "reached the same conclusion."
)


def _agreement_label(score: float) -> str:
    if score >= 0.75:
        return "strong agreement"
    if score >= 0.5:
        return "moderate agreement"
    if score >= 0.25:
        return "weak agreement"
    return "no clear agreement"


def _find_conflicts(bullish: list[Observation], bearish: list[Observation]) -> list[str]:
    if not bullish or not bearish:
        return []

    conflicts = [
        f"{len(bullish)} indicator(s) lean bullish while {len(bearish)} lean bearish. "
        "Neither side is 'right' — this is what a genuinely mixed picture looks like."
    ]

    bullish_names = {observation.indicator for observation in bullish}
    bearish_names = {observation.indicator for observation in bearish}

    # The classic momentum-vs-trend disagreement is worth naming explicitly,
    # because it is the case beginners most often misread.
    trend_names = {name for name in bullish_names | bearish_names if "Moving averages" in name}
    if trend_names & bearish_names and {"RSI", "MACD"} & bullish_names:
        conflicts.append(
            "Momentum is turning up while the longer-term trend is still down. This can mean an "
            "early reversal or a temporary bounce within a continuing decline — the indicators "
            "cannot distinguish between the two."
        )
    if trend_names & bullish_names and "RSI" in bearish_names:
        conflicts.append(
            "The trend is up but RSI reads overbought. In sustained rallies this combination "
            "persists for long stretches and is not by itself a sign of a top."
        )
    return conflicts


def interpret(frame: pd.DataFrame) -> Interpretation:
    """Build a full interpretation from an OHLCV frame.

    Indicators that lack enough history are omitted rather than reported with a
    misleading partial value.
    """
    required = ("open", "high", "low", "close", "volume")
    missing = [column for column in required if column not in frame.columns]
    if missing:
        raise KeyError(f"missing required column(s): {', '.join(missing)}")

    observations = [
        observation for observer in _OBSERVERS if (observation := observer(frame)) is not None
    ]

    if not observations:
        return Interpretation(
            observations=[],
            summary=_INSUFFICIENT,
            agreement_label="not enough data",
            disclaimer=_DISCLAIMER,
        )

    bullish = [o for o in observations if o.stance is Stance.BULLISH]
    bearish = [o for o in observations if o.stance is Stance.BEARISH]
    neutral = [o for o in observations if o.stance is Stance.NEUTRAL]

    directional = len(bullish) + len(bearish)
    if directional == 0:
        score = 0.0
        summary = (
            f"All {len(observations)} indicators examined are neutral — recent price action has "
            "not been decisive in either direction."
        )
    else:
        # How lopsided the directional indicators are: 1.0 = unanimous, 0.0 = evenly split.
        score = abs(len(bullish) - len(bearish)) / directional
        leaning = "bullish" if len(bullish) > len(bearish) else "bearish"
        if len(bullish) == len(bearish):
            summary = (
                f"The evidence is evenly split: {len(bullish)} indicator(s) lean bullish and "
                f"{len(bearish)} lean bearish. There is no consistent story in this data."
            )
        else:
            summary = (
                f"{max(len(bullish), len(bearish))} of {directional} directional indicators lean "
                f"{leaning}, with {len(neutral)} neutral. This describes what prices have already "
                "done over this window; it carries no information about what they will do next."
            )

    return Interpretation(
        observations=observations,
        bullish=bullish,
        bearish=bearish,
        neutral=neutral,
        agreement_score=round(score, 3),
        agreement_label=_agreement_label(score),
        conflicts=_find_conflicts(bullish, bearish),
        summary=summary,
        disclaimer=_DISCLAIMER,
    )
