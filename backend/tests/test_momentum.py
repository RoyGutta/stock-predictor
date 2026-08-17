"""Momentum engine tests.

Two kinds here. The mechanical ones check the stack is read correctly on series
whose alignment is known by construction. The safety ones check the output stays
a description: this module is the closest thing in the project to a trading
signal, so the guard against it drifting into advice is a test, not a habit.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.analytics.momentum import (
    FAST,
    MEDIUM,
    MIN_BARS,
    SLOW,
    MomentumState,
    assess,
)


def ohlcv(close: pd.Series) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "open": close.shift(1).fillna(close.iloc[0]),
            "high": close * 1.01,
            "low": close * 0.99,
            "close": close,
            "volume": pd.Series(np.full(len(close), 1e6), index=close.index),
        }
    )


@pytest.fixture
def rising() -> pd.DataFrame:
    """Steadily rising: every average stacks in uptrend order by construction."""
    return ohlcv(pd.Series(np.linspace(100, 220, 300)))


@pytest.fixture
def falling() -> pd.DataFrame:
    return ohlcv(pd.Series(np.linspace(220, 100, 300)))


@pytest.fixture
def choppy() -> pd.DataFrame:
    generator = np.random.default_rng(4)
    return ohlcv(pd.Series(100 + np.cumsum(generator.normal(0, 1.2, 300))))


# --- reading the stack ------------------------------------------------------


def test_sustained_rise_is_bullish(rising: pd.DataFrame) -> None:
    result = assess(rising)
    assert result.state is MomentumState.BULLISH
    assert result.score == result.total == 4


def test_sustained_fall_is_bearish(falling: pd.DataFrame) -> None:
    result = assess(falling)
    assert result.state is MomentumState.BEARISH
    assert result.score == 0


def test_averages_stack_in_uptrend_order(rising: pd.DataFrame) -> None:
    result = assess(rising)
    assert result.price > result.fast > result.medium > result.slow


def test_averages_stack_in_downtrend_order(falling: pd.DataFrame) -> None:
    result = assess(falling)
    assert result.price < result.fast < result.medium < result.slow


def test_score_never_exceeds_total(choppy: pd.DataFrame) -> None:
    result = assess(choppy)
    assert 0 <= result.score <= result.total


def test_every_condition_is_reported_with_its_numbers(rising: pd.DataFrame) -> None:
    """A tick with no figures behind it is not evidence."""
    result = assess(rising)
    assert len(result.conditions) == 4
    for condition in result.conditions:
        assert condition.label.strip()
        assert condition.detail.strip()


@pytest.mark.parametrize("seed", [1, 2, 3, 4, 5, 6, 7, 8])
def test_partial_stack_is_always_mixed(seed: int) -> None:
    """The invariant, stated directly: a partial stack is mixed.

    Asserted over several random walks rather than one hand-tuned series. A
    fixture crafted to produce a specific score is really testing the fixture —
    this tests the rule, which is that a partial stack is never rounded to
    whichever side happens to be ahead. Full and empty stacks are covered by
    the rising and falling cases above.
    """
    generator = np.random.default_rng(seed)
    close = pd.Series(100 + np.cumsum(generator.normal(0.05, 1.2, 300)))
    result = assess(ohlcv(close))

    if 0 < result.score < result.total:
        assert result.state is MomentumState.MIXED
    elif result.score == result.total:
        assert result.state is MomentumState.BULLISH
    else:
        assert result.state is MomentumState.BEARISH


def test_windows_are_the_conventional_trio() -> None:
    assert (FAST, MEDIUM, SLOW) == (20, 50, 100)


# --- insufficient history ---------------------------------------------------


def test_short_history_reports_insufficient_rather_than_guessing() -> None:
    result = assess(ohlcv(pd.Series(np.linspace(100, 120, 40))))
    assert result.state is MomentumState.INSUFFICIENT
    assert result.score == 0
    assert result.conditions == []


def test_insufficient_says_how_many_bars_are_needed() -> None:
    result = assess(ohlcv(pd.Series(np.linspace(100, 120, 40))))
    assert str(MIN_BARS) in result.headline or str(MIN_BARS) in result.caveat


def test_exactly_enough_history_is_readable() -> None:
    result = assess(ohlcv(pd.Series(np.linspace(100, 160, MIN_BARS))))
    assert result.state is not MomentumState.INSUFFICIENT


def test_one_bar_short_is_refused() -> None:
    """The boundary is pinned: partial averages must not be scored."""
    result = assess(ohlcv(pd.Series(np.linspace(100, 160, MIN_BARS - 1))))
    assert result.state is MomentumState.INSUFFICIENT


def test_missing_close_column_is_rejected() -> None:
    with pytest.raises(KeyError):
        assess(pd.DataFrame({"open": np.ones(200)}))


# --- safety: this must stay a description -----------------------------------

FORBIDDEN_ADVICE = (
    "you should buy",
    "you should sell",
    "time to buy",
    "we recommend",
    "strong buy",
    "strong sell",
    "guaranteed",
    "will rise",
    "will fall",
    "price target",
    "safe to buy",
    "good entry",
)


@pytest.mark.parametrize("fixture_name", ["rising", "falling", "choppy"])
def test_output_never_contains_advice_language(
    fixture_name: str, request: pytest.FixtureRequest
) -> None:
    """This module is the closest thing here to a trading signal, which is
    exactly why the guard is a test rather than a habit."""
    result = assess(request.getfixturevalue(fixture_name))
    corpus = " ".join(
        [result.headline, result.caveat]
        + [f"{c.label} {c.detail}" for c in result.conditions]
    ).lower()
    for phrase in FORBIDDEN_ADVICE:
        assert phrase not in corpus, f"advice-like phrasing leaked into momentum: {phrase!r}"


@pytest.mark.parametrize("fixture_name", ["rising", "falling", "choppy"])
def test_caveat_is_always_present(fixture_name: str, request: pytest.FixtureRequest) -> None:
    result = assess(request.getfixturevalue(fixture_name))
    assert result.caveat.strip()


def test_caveat_names_the_lag_that_makes_this_backward_looking(rising: pd.DataFrame) -> None:
    """The reading turns only after a move is underway. Saying so is the
    difference between an indicator and a promise."""
    caveat = assess(rising).caveat.lower()
    assert "past prices" in caveat
    assert "before a top" in caveat


def test_bullish_reading_still_carries_its_caveat(rising: pd.DataFrame) -> None:
    """The strongest reading is where a caveat matters most and is most likely
    to be dropped for looking discouraging."""
    result = assess(rising)
    assert result.state is MomentumState.BULLISH
    assert "backtest" in result.caveat.lower()


def test_mixed_reading_says_trend_rules_do_worst_here(choppy: pd.DataFrame) -> None:
    result = assess(choppy)
    if result.state is MomentumState.MIXED:
        assert "worst" in result.headline.lower()
