"""Historical pattern detection.

Finds well-known technical events in a price history and reports *when they
happened and what the numbers were at that moment*. Nothing here is a signal:
a detected pattern is a description of past market behavior, and every event
carries that caveat.

THE ANTI-LOOKAHEAD RULE
-----------------------
An event dated at bar *T* may use information from bars at or before *T* and
nothing else. Every statistic in this module is therefore *trailing*: rolling
windows end at the bar they describe, baselines are computed from prior bars
only, and nothing is centered, forward-filled backwards, or revised once later
bars arrive. The guard test mutates every bar after a cutoff and asserts that
detections at or before the cutoff are byte-for-byte identical. If a change
here breaks that test, the change is wrong, not the test.

Outcome analysis is the one deliberate exception: *after* an event is detected,
the module reports what actually happened over the following bars. That uses
future bars by definition -- but only to describe history, never to decide
whether the event occurred, and always with the sample size attached.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from app.analytics import indicators as ind

__all__ = [
    "PatternEvent",
    "PatternOutcomes",
    "PatternSummary",
    "PatternReport",
    "detect_patterns",
    "OUTCOME_WINDOWS",
    "PATTERN_DEFINITIONS",
]

# Forward windows (in bars) for historical-outcome reporting.
OUTCOME_WINDOWS: tuple[int, ...] = (5, 20, 60)

# Fewer occurrences than this and outcome statistics are anecdotes; the payload
# still shows them but flags the sample as small.
SMALL_SAMPLE = 10

_MIN_BARS = 60

# The moving-average pair used for crossover events.
_FAST, _SLOW = 20, 50
# Trailing window for the volatility baseline behind "large move".
_BASELINE_WINDOW = 252
_LARGE_MOVE_SIGMAS = 3.0
_DRAWDOWN_THRESHOLD = 0.10


@dataclass(frozen=True)
class PatternEvent:
    pattern: str
    label: str
    date: str
    """Position of the event bar in the analyzed frame."""
    index: int
    values: dict[str, float]
    explanation: str
    caveat: str


@dataclass(frozen=True)
class PatternOutcomes:
    """What historically happened after events of one type, per window.

    Percent change from the event bar's close to the close `window` bars later.
    Events too close to the end of the data are excluded from that window and
    counted in `excluded`, so the sample size is always explicit.
    """

    window: int
    sample_size: int
    excluded: int
    mean: float | None
    median: float | None
    positive_share: float | None
    worst: float | None
    best: float | None
    small_sample: bool


@dataclass(frozen=True)
class PatternSummary:
    pattern: str
    label: str
    definition: str
    caveat: str
    occurrences: int
    outcomes: list[PatternOutcomes] = field(default_factory=list)


@dataclass(frozen=True)
class PatternReport:
    events: list[PatternEvent]
    summaries: list[PatternSummary]
    bars: int
    start_date: str
    end_date: str
    insufficient: bool = False
    note: str = ""


PATTERN_DEFINITIONS: dict[str, dict[str, str]] = {
    "golden_cross": {
        "label": "Golden cross (20/50)",
        "definition": (
            f"The {_FAST}-bar average closed above the {_SLOW}-bar average after being "
            "at or below it the bar before."
        ),
        "caveat": (
            "Moving averages lag by construction: by the time they cross, much of the "
            "move that caused the cross has already happened. A cross describes the "
            "recent past, not the future."
        ),
    },
    "death_cross": {
        "label": "Death cross (20/50)",
        "definition": (
            f"The {_FAST}-bar average closed below the {_SLOW}-bar average after being "
            "at or above it the bar before."
        ),
        "caveat": (
            "The dramatic name is marketing, not mathematics. It is the same lagging "
            "average comparison as the golden cross, pointed the other way."
        ),
    },
    "rsi_oversold": {
        "label": "RSI entered oversold",
        "definition": "RSI(14) closed below 30 after being at or above 30 the bar before.",
        "caveat": (
            "'Oversold' means recent losses dominated recent gains -- it does not mean "
            "'due for a bounce'. In persistent declines RSI can stay below 30 for weeks."
        ),
    },
    "rsi_overbought": {
        "label": "RSI entered overbought",
        "definition": "RSI(14) closed above 70 after being at or below 70 the bar before.",
        "caveat": (
            "'Overbought' means recent gains dominated recent losses. Strong uptrends "
            "hold RSI above 70 for long stretches; this is not a sell signal."
        ),
    },
    "macd_bull_cross": {
        "label": "MACD crossed above signal",
        "definition": "The MACD line closed above its signal line after being at or below it.",
        "caveat": (
            "Built entirely from moving averages, so it confirms moves already underway "
            "and produces frequent false crossings in sideways markets."
        ),
    },
    "macd_bear_cross": {
        "label": "MACD crossed below signal",
        "definition": "The MACD line closed below its signal line after being at or above it.",
        "caveat": (
            "The mirror of the bullish cross, with the same lag and the same tendency "
            "to whipsaw when the price is drifting sideways."
        ),
    },
    "bollinger_break_upper": {
        "label": "Closed above upper Bollinger band",
        "definition": (
            "The close finished above the 20-bar average plus two standard deviations, "
            "having been inside the band the bar before."
        ),
        "caveat": (
            "Statistically unusual is not wrong: prices ride the upper band through "
            "strong rallies. Treating a band touch as a reversal is a common and "
            "expensive mistake."
        ),
    },
    "bollinger_break_lower": {
        "label": "Closed below lower Bollinger band",
        "definition": (
            "The close finished below the 20-bar average minus two standard deviations, "
            "having been inside the band the bar before."
        ),
        "caveat": (
            "An unusually large decline relative to recent volatility. It describes the "
            "size of the fall, not whether it is finished."
        ),
    },
    "large_move": {
        "label": "Unusually large single-bar move",
        "definition": (
            f"The bar's return exceeded {_LARGE_MOVE_SIGMAS:.0f} standard deviations of "
            f"the trailing {_BASELINE_WINDOW}-bar return distribution (computed from "
            "prior bars only)."
        ),
        "caveat": (
            "Large moves cluster: one outsized bar often sits inside a volatile stretch "
            "rather than ending one. The threshold uses only history available before "
            "the bar, so early data has no baseline and is skipped."
        ),
    },
    "drawdown_recovery": {
        "label": "Recovered a 10%+ drawdown",
        "definition": (
            f"The close regained its prior running peak after having fallen at least "
            f"{_DRAWDOWN_THRESHOLD:.0%} below it."
        ),
        "caveat": (
            "Recovery marks the round trip back to a previous high -- the money lost in "
            "between was real, and nothing about recovering one drawdown prevents the "
            "next."
        ),
    },
}


def _crossings(fast: pd.Series, slow: pd.Series) -> tuple[np.ndarray, np.ndarray]:
    """Indices where `fast` crosses above / below `slow`.

    A crossing at bar T compares the sign of (fast - slow) at T with the sign
    at T-1: strictly trailing information.
    """
    diff = (fast - slow).to_numpy(dtype=float)
    previous = np.roll(diff, 1)
    previous[0] = np.nan
    valid = ~np.isnan(diff) & ~np.isnan(previous)
    up = valid & (previous <= 0) & (diff > 0)
    down = valid & (previous >= 0) & (diff < 0)
    return np.flatnonzero(up), np.flatnonzero(down)


def _threshold_entries(series: pd.Series, threshold: float, above: bool) -> np.ndarray:
    """Bars where `series` enters the region beyond `threshold`."""
    values = series.to_numpy(dtype=float)
    previous = np.roll(values, 1)
    previous[0] = np.nan
    valid = ~np.isnan(values) & ~np.isnan(previous)
    if above:
        entered = valid & (previous <= threshold) & (values > threshold)
    else:
        entered = valid & (previous >= threshold) & (values < threshold)
    return np.flatnonzero(entered)


def _band_entries(close: pd.Series, band: pd.Series, above: bool) -> np.ndarray:
    """Bars where the close moves outside a band, having been inside before."""
    close_values = close.to_numpy(dtype=float)
    band_values = band.to_numpy(dtype=float)
    previous_close = np.roll(close_values, 1)
    previous_band = np.roll(band_values, 1)
    previous_close[0] = np.nan
    previous_band[0] = np.nan
    valid = (
        ~np.isnan(close_values)
        & ~np.isnan(band_values)
        & ~np.isnan(previous_close)
        & ~np.isnan(previous_band)
    )
    if above:
        entered = valid & (close_values > band_values) & (previous_close <= previous_band)
    else:
        entered = valid & (close_values < band_values) & (previous_close >= previous_band)
    return np.flatnonzero(entered)


def detect_patterns(frame: pd.DataFrame) -> PatternReport:
    """Detect all pattern events in an OHLCV frame.

    Duplicate timestamps are dropped (first kept) before any computation:
    trailing windows are meaningless over repeated bars, and the drawdown and
    crossing logic assume one row per timestamp.
    """
    if "close" not in frame.columns:
        raise KeyError("frame must contain a 'close' column")

    deduped = frame[~frame.index.duplicated(keep="first")]
    dates = [str(label) for label in deduped.index]

    if len(deduped) < _MIN_BARS:
        return PatternReport(
            events=[],
            summaries=[],
            bars=len(deduped),
            start_date=dates[0] if dates else "",
            end_date=dates[-1] if dates else "",
            insufficient=True,
            note=(
                f"Pattern detection needs at least {_MIN_BARS} bars; this window has "
                f"{len(deduped)}. Try a longer range."
            ),
        )

    close = deduped["close"].astype(float)
    events: list[PatternEvent] = []

    def add(pattern: str, index: int, values: dict[str, float], explanation: str) -> None:
        meta = PATTERN_DEFINITIONS[pattern]
        events.append(
            PatternEvent(
                pattern=pattern,
                label=meta["label"],
                date=dates[index],
                index=int(index),
                values={key: round(float(value), 4) for key, value in values.items()},
                explanation=explanation,
                caveat=meta["caveat"],
            )
        )

    # --- moving-average crossovers -------------------------------------------
    fast = ind.sma(close, _FAST)
    slow = ind.sma(close, _SLOW)
    golden, death = _crossings(fast, slow)
    for i in golden:
        add(
            "golden_cross",
            i,
            {"fast": fast.iloc[i], "slow": slow.iloc[i], "close": close.iloc[i]},
            f"The {_FAST}-bar average ({fast.iloc[i]:.2f}) moved above the "
            f"{_SLOW}-bar average ({slow.iloc[i]:.2f}).",
        )
    for i in death:
        add(
            "death_cross",
            i,
            {"fast": fast.iloc[i], "slow": slow.iloc[i], "close": close.iloc[i]},
            f"The {_FAST}-bar average ({fast.iloc[i]:.2f}) moved below the "
            f"{_SLOW}-bar average ({slow.iloc[i]:.2f}).",
        )

    # --- RSI regime entries ---------------------------------------------------
    rsi = ind.rsi(close, 14)
    for i in _threshold_entries(rsi, 30.0, above=False):
        add(
            "rsi_oversold",
            i,
            {"rsi": rsi.iloc[i]},
            f"RSI(14) fell to {rsi.iloc[i]:.1f}, entering the conventional oversold zone.",
        )
    for i in _threshold_entries(rsi, 70.0, above=True):
        add(
            "rsi_overbought",
            i,
            {"rsi": rsi.iloc[i]},
            f"RSI(14) rose to {rsi.iloc[i]:.1f}, entering the conventional overbought zone.",
        )

    # --- MACD signal crossovers -----------------------------------------------
    macd = ind.macd(close)
    bull, bear = _crossings(macd.macd, macd.signal)
    for i in bull:
        add(
            "macd_bull_cross",
            i,
            {"macd": macd.macd.iloc[i], "signal": macd.signal.iloc[i]},
            f"MACD ({macd.macd.iloc[i]:.3f}) crossed above its signal line "
            f"({macd.signal.iloc[i]:.3f}).",
        )
    for i in bear:
        add(
            "macd_bear_cross",
            i,
            {"macd": macd.macd.iloc[i], "signal": macd.signal.iloc[i]},
            f"MACD ({macd.macd.iloc[i]:.3f}) crossed below its signal line "
            f"({macd.signal.iloc[i]:.3f}).",
        )

    # --- Bollinger excursions ---------------------------------------------------
    bands = ind.bollinger_bands(close, 20)
    for i in _band_entries(close, bands.upper, above=True):
        add(
            "bollinger_break_upper",
            i,
            {"close": close.iloc[i], "upper_band": bands.upper.iloc[i]},
            f"The close ({close.iloc[i]:.2f}) finished above the upper band "
            f"({bands.upper.iloc[i]:.2f}).",
        )
    for i in _band_entries(close, bands.lower, above=False):
        add(
            "bollinger_break_lower",
            i,
            {"close": close.iloc[i], "lower_band": bands.lower.iloc[i]},
            f"The close ({close.iloc[i]:.2f}) finished below the lower band "
            f"({bands.lower.iloc[i]:.2f}).",
        )

    # --- unusually large single-bar moves ----------------------------------------
    # The baseline standard deviation is computed over the trailing window and
    # then SHIFTED one bar, so bar T is judged against a distribution that ends
    # at T-1. Without the shift a huge move would inflate its own baseline --
    # and, worse, the baseline would peek at the bar being judged.
    returns = close.pct_change()
    baseline = returns.rolling(_BASELINE_WINDOW, min_periods=_MIN_BARS).std(ddof=1).shift(1)
    ratio = returns / baseline.replace(0.0, np.nan)
    zscores = ratio.to_numpy(dtype=float)
    for i in np.flatnonzero(np.abs(np.nan_to_num(zscores, nan=0.0)) > _LARGE_MOVE_SIGMAS):
        add(
            "large_move",
            i,
            {"return_pct": returns.iloc[i] * 100, "sigmas": zscores[i]},
            f"A single-bar move of {returns.iloc[i] * 100:+.1f}%, about "
            f"{abs(zscores[i]):.1f} standard deviations of the trailing year's bars.",
        )

    # --- drawdown recoveries -------------------------------------------------------
    running_peak = close.cummax()
    drawdown = close / running_peak - 1.0
    in_deep_drawdown = False
    for i in range(1, len(close)):
        if drawdown.iloc[i] <= -_DRAWDOWN_THRESHOLD:
            in_deep_drawdown = True
        elif in_deep_drawdown and drawdown.iloc[i] >= 0:
            in_deep_drawdown = False
            add(
                "drawdown_recovery",
                i,
                {"close": close.iloc[i], "regained_peak": running_peak.iloc[i - 1]},
                f"The close ({close.iloc[i]:.2f}) regained the prior peak "
                f"({running_peak.iloc[i - 1]:.2f}) after a fall of at least "
                f"{_DRAWDOWN_THRESHOLD:.0%}.",
            )

    events.sort(key=lambda event: event.index)

    # --- historical outcomes (uses future bars ONLY to describe history) ----------
    close_values = close.to_numpy(dtype=float)
    summaries: list[PatternSummary] = []
    for pattern, meta in PATTERN_DEFINITIONS.items():
        pattern_events = [event for event in events if event.pattern == pattern]
        outcomes: list[PatternOutcomes] = []
        for window in OUTCOME_WINDOWS:
            forward: list[float] = []
            excluded = 0
            for event in pattern_events:
                end = event.index + window
                if end >= len(close_values):
                    excluded += 1
                    continue
                forward.append(close_values[end] / close_values[event.index] - 1.0)
            if forward:
                array = np.asarray(forward)
                outcomes.append(
                    PatternOutcomes(
                        window=window,
                        sample_size=len(forward),
                        excluded=excluded,
                        mean=round(float(array.mean()), 6),
                        median=round(float(np.median(array)), 6),
                        positive_share=round(float((array > 0).mean()), 4),
                        worst=round(float(array.min()), 6),
                        best=round(float(array.max()), 6),
                        small_sample=len(forward) < SMALL_SAMPLE,
                    )
                )
            else:
                outcomes.append(
                    PatternOutcomes(
                        window=window,
                        sample_size=0,
                        excluded=excluded,
                        mean=None,
                        median=None,
                        positive_share=None,
                        worst=None,
                        best=None,
                        small_sample=True,
                    )
                )
        summaries.append(
            PatternSummary(
                pattern=pattern,
                label=meta["label"],
                definition=meta["definition"],
                caveat=meta["caveat"],
                occurrences=len(pattern_events),
                outcomes=outcomes,
            )
        )

    return PatternReport(
        events=events,
        summaries=summaries,
        bars=len(deduped),
        start_date=dates[0],
        end_date=dates[-1],
    )
