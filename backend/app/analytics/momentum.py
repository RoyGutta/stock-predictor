"""Short-term momentum from moving-average alignment.

The question this answers is narrow and mechanical: *are the short, medium and
long averages stacked in the order that defines an uptrend, and is price above
them?* That is the classic trend-following read, and it is genuinely useful as
a filter — most trend strategies refuse to buy anything not in this state.

What it is not is a reason to buy. Two things are true at once and both belong
in the output:

* Momentum persists more often than chance. Stacked averages really do tend to
  stay stacked for a while, which is why the setup is worth seeing.
* The alignment is built from averages of past prices, so it turns *after* the
  move. By the time all four conditions are met, a large part of the move has
  usually already happened, and the same setup precedes both continuations and
  tops. It cannot distinguish between them.

So the module reports a state and the conditions behind it, never a verdict.
`app/analytics/backtest.py` is where a caller finds out whether acting on this
state would actually have worked on a given stock — which is the honest answer
to "should I buy", and usually a humbling one.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

import pandas as pd

from app.analytics import indicators as ind

__all__ = [
    "MomentumState",
    "Condition",
    "Momentum",
    "assess",
    "FAST",
    "MEDIUM",
    "SLOW",
    "MIN_BARS",
]

# The three windows the trend-following convention is built on. 20 is roughly a
# trading month, 50 a quarter, 100 half a year.
FAST = 20
MEDIUM = 50
SLOW = 100

# SLOW bars fill the longest average; a handful more give the slope something
# to measure. Below this the state is not computable and must not be guessed.
MIN_BARS = SLOW + 5

# Bars used to decide whether the fast average is rising. One bar is noise; a
# week of them is a direction.
_SLOPE_LOOKBACK = 5


class MomentumState(str, Enum):
    """Which way the averages are stacked. Describes now, predicts nothing."""

    BULLISH = "bullish"
    BEARISH = "bearish"
    MIXED = "mixed"
    INSUFFICIENT = "insufficient"


@dataclass(frozen=True)
class Condition:
    label: str
    met: bool
    detail: str
    """Present so the reader sees the raw comparison, not just a tick."""
    values: tuple[float | None, float | None] = (None, None)


@dataclass(frozen=True)
class Momentum:
    state: MomentumState
    score: int
    """How many of the four conditions hold, 0-4."""
    total: int
    headline: str
    conditions: list[Condition]
    caveat: str
    fast: float | None = None
    medium: float | None = None
    slow: float | None = None
    price: float | None = None


_CAVEAT = (
    "This describes how the averages are stacked right now, not what happens next. "
    "Moving averages are built from past prices, so this state turns only after a move "
    "is underway — the same alignment appears partway up a long rally and immediately "
    "before a top, and it cannot tell the two apart. Run the backtest to see whether "
    "trading this rule would actually have beaten simply holding this stock."
)

_INSUFFICIENT_CAVEAT = (
    f"At least {MIN_BARS} bars are needed to fill a {SLOW}-period average and measure its "
    "direction. A shorter range cannot produce this reading, and estimating it from "
    "partial data would be inventing a number."
)


def _latest(series: pd.Series) -> float | None:
    valid = series.dropna()
    return float(valid.iloc[-1]) if not valid.empty else None


def assess(frame: pd.DataFrame) -> Momentum:
    """Grade short-term momentum from the 20/50/100 alignment.

    Four conditions, each independently visible to the caller:

    1. Price is above the fast average — the current bar is leading.
    2. Fast is above medium — the recent month beats the recent quarter.
    3. Medium is above slow — the quarter beats the half-year.
    4. The fast average is rising — the leadership is still building, not fading.

    All four is the textbook uptrend stack. None is its mirror. Anything between
    is reported as mixed rather than rounded to whichever side is ahead, because
    a partial stack is genuinely a different situation from a complete one.
    """
    if "close" not in frame.columns:
        raise KeyError("frame must contain a 'close' column")

    close = frame["close"].astype(float)

    if len(close.dropna()) < MIN_BARS:
        return Momentum(
            state=MomentumState.INSUFFICIENT,
            score=0,
            total=4,
            headline=(
                f"Not enough price history to read momentum — {len(close.dropna())} bars "
                f"available, {MIN_BARS} needed."
            ),
            conditions=[],
            caveat=_INSUFFICIENT_CAVEAT,
        )

    fast_series = ind.sma(close, FAST)
    fast = _latest(fast_series)
    medium = _latest(ind.sma(close, MEDIUM))
    slow = _latest(ind.sma(close, SLOW))
    price = _latest(close)

    if fast is None or medium is None or slow is None or price is None:
        return Momentum(
            state=MomentumState.INSUFFICIENT,
            score=0,
            total=4,
            headline="Momentum could not be computed from this price history.",
            conditions=[],
            caveat=_INSUFFICIENT_CAVEAT,
        )

    # Slope of the fast average over the lookback, as a percentage of its own
    # level so it is comparable across stocks at different prices.
    valid_fast = fast_series.dropna()
    has_lookback = len(valid_fast) > _SLOPE_LOOKBACK
    earlier = float(valid_fast.iloc[-_SLOPE_LOOKBACK]) if has_lookback else None
    slope = None if not earlier else (fast - earlier) / abs(earlier) * 100

    conditions = [
        Condition(
            label=f"Price above the {FAST}-day average",
            met=price > fast,
            detail=(
                f"Last close {price:,.2f} vs {FAST}-day average {fast:,.2f}. "
                "Price leading its own recent average is what a short-term uptrend "
                "looks like from the inside."
            ),
            values=(price, fast),
        ),
        Condition(
            label=f"{FAST}-day above the {MEDIUM}-day",
            met=fast > medium,
            detail=(
                f"{fast:,.2f} vs {medium:,.2f}. The last month of prices is averaging "
                "higher than the last quarter."
            ),
            values=(fast, medium),
        ),
        Condition(
            label=f"{MEDIUM}-day above the {SLOW}-day",
            met=medium > slow,
            detail=(
                f"{medium:,.2f} vs {slow:,.2f}. The quarter is averaging higher than the "
                "half-year — the slowest and most stubborn part of the stack."
            ),
            values=(medium, slow),
        ),
        Condition(
            label=f"{FAST}-day average still rising",
            met=slope is not None and slope > 0,
            detail=(
                f"Moved {slope:+.2f}% over the last {_SLOPE_LOOKBACK} bars. "
                "A flattening fast average is the first part of the stack to give way."
                if slope is not None
                else "Not enough history to measure the direction of the fast average."
            ),
            values=(slope, None),
        ),
    ]

    score = sum(1 for condition in conditions if condition.met)

    if score == len(conditions):
        state = MomentumState.BULLISH
        headline = (
            f"All four conditions hold: price sits above the {FAST}-day average, the "
            f"averages are stacked {FAST} > {MEDIUM} > {SLOW}, and the fast average is "
            "still rising. This is the textbook short-term uptrend."
        )
    elif score == 0:
        state = MomentumState.BEARISH
        headline = (
            f"None of the four conditions hold. The averages are stacked in the opposite "
            f"order ({SLOW} > {MEDIUM} > {FAST}) with price below them — the mirror image "
            "of an uptrend."
        )
    else:
        state = MomentumState.MIXED
        headline = (
            f"{score} of 4 conditions hold. The averages are not cleanly stacked either "
            "way, which is what most stocks look like most of the time — and the state "
            "in which trend-following rules perform worst."
        )

    return Momentum(
        state=state,
        score=score,
        total=len(conditions),
        headline=headline,
        conditions=conditions,
        caveat=_CAVEAT,
        fast=round(fast, 4),
        medium=round(medium, 4),
        slow=round(slow, 4),
        price=round(price, 4),
    )
