"""Interpretation tests.

Beyond correctness, several of these are *safety* tests: they assert that the
output never contains buy/sell language, that every observation carries a
caveat, and that conflicting evidence is surfaced rather than averaged away.
Those properties are the whole point of this layer, so they are pinned.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.analytics.interpretation import Stance, interpret


def ohlcv(close: pd.Series) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "open": close.shift(1).fillna(close.iloc[0]),
            "high": close * 1.01,
            "low": close * 0.99,
            "close": close,
            "volume": pd.Series(np.full(len(close), 1_000_000.0), index=close.index),
        }
    )


@pytest.fixture
def rising() -> pd.DataFrame:
    return ohlcv(pd.Series(np.linspace(100, 200, 300)))


@pytest.fixture
def falling() -> pd.DataFrame:
    return ohlcv(pd.Series(np.linspace(200, 100, 300)))


@pytest.fixture
def choppy() -> pd.DataFrame:
    generator = np.random.default_rng(9)
    walk = 100 + np.cumsum(generator.normal(0, 1, 300))
    return ohlcv(pd.Series(walk))


# --- directional leaning ----------------------------------------------------


def test_sustained_rise_leans_bullish(rising: pd.DataFrame) -> None:
    result = interpret(rising)
    assert len(result.bullish) > len(result.bearish)


def test_sustained_fall_leans_bearish(falling: pd.DataFrame) -> None:
    result = interpret(falling)
    assert len(result.bearish) > len(result.bullish)


def test_observations_are_partitioned_without_loss(choppy: pd.DataFrame) -> None:
    result = interpret(choppy)
    assert len(result.bullish) + len(result.bearish) + len(result.neutral) == len(
        result.observations
    )


def test_volatility_is_always_neutral(rising: pd.DataFrame) -> None:
    """ATR has no direction; classifying it as bullish or bearish would be wrong."""
    atr_observations = [o for o in interpret(rising).observations if "ATR" in o.indicator]
    assert atr_observations
    assert all(o.stance is Stance.NEUTRAL for o in atr_observations)


# --- agreement scoring ------------------------------------------------------


def test_agreement_score_is_within_bounds(choppy: pd.DataFrame) -> None:
    assert 0.0 <= interpret(choppy).agreement_score <= 1.0


def test_unanimous_direction_scores_one(rising: pd.DataFrame) -> None:
    result = interpret(rising)
    if result.bullish and not result.bearish:
        assert result.agreement_score == pytest.approx(1.0)


def test_agreement_label_tracks_the_score(rising: pd.DataFrame) -> None:
    result = interpret(rising)
    if result.agreement_score >= 0.75:
        assert result.agreement_label == "strong agreement"


def test_agreement_is_never_described_as_probability(choppy: pd.DataFrame) -> None:
    """Guards against the score drifting into forecast language."""
    result = interpret(choppy)
    text = f"{result.summary} {result.agreement_label} {result.disclaimer}".lower()
    for forbidden in ("probability", "chance of", "likely to rise", "expected price"):
        assert forbidden not in text


# --- conflict surfacing -----------------------------------------------------


def test_conflicts_are_reported_when_evidence_is_mixed(choppy: pd.DataFrame) -> None:
    result = interpret(choppy)
    if result.bullish and result.bearish:
        assert result.conflicts, "mixed evidence must surface a conflict, not be averaged away"


def test_no_conflict_when_evidence_is_one_sided(rising: pd.DataFrame) -> None:
    result = interpret(rising)
    if not result.bearish:
        assert result.conflicts == []


def test_evenly_split_evidence_says_so() -> None:
    result = interpret(ohlcv(pd.Series(np.linspace(100, 200, 300))))
    if len(result.bullish) == len(result.bearish) and result.bullish:
        assert "evenly split" in result.summary


# --- safety properties ------------------------------------------------------


FORBIDDEN_ADVICE = (
    "you should buy",
    "you should sell",
    "we recommend",
    "guaranteed",
    "will rise",
    "will fall",
    "will go up",
    "will go down",
    "price target",
    "strong buy",
    "strong sell",
)


@pytest.mark.parametrize("fixture_name", ["rising", "falling", "choppy"])
def test_output_never_contains_advice_language(
    fixture_name: str, request: pytest.FixtureRequest
) -> None:
    result = interpret(request.getfixturevalue(fixture_name))
    corpus = " ".join(
        [result.summary, result.disclaimer, *result.conflicts]
        + [f"{o.headline} {o.detail} {o.caveat}" for o in result.observations]
    ).lower()
    for phrase in FORBIDDEN_ADVICE:
        assert phrase not in corpus, f"advice-like phrasing leaked into output: {phrase!r}"


@pytest.mark.parametrize("fixture_name", ["rising", "falling", "choppy"])
def test_every_observation_carries_a_caveat(
    fixture_name: str, request: pytest.FixtureRequest
) -> None:
    for observation in interpret(request.getfixturevalue(fixture_name)).observations:
        assert observation.caveat.strip(), f"{observation.indicator} has no caveat"
        assert observation.detail.strip()
        assert observation.headline.strip()


def test_disclaimer_is_always_present(choppy: pd.DataFrame) -> None:
    result = interpret(choppy)
    assert "not predictions" in result.disclaimer
    assert "not investment" in result.disclaimer


def test_disclaimer_names_the_shared_input_problem(choppy: pd.DataFrame) -> None:
    """Agreement between indicators is partly an artifact of shared inputs.
    Saying so is the difference between honest and impressive-sounding."""
    assert "share inputs" in interpret(choppy).disclaimer


# --- insufficient data ------------------------------------------------------


def test_short_series_does_not_invent_observations() -> None:
    tiny = ohlcv(pd.Series([100.0, 101.0, 102.0]))
    result = interpret(tiny)
    # Whatever survives must be genuinely computable, never a partial value.
    assert all(o.value is not None for o in result.observations)


def test_empty_series_reports_insufficient_data() -> None:
    empty = pd.DataFrame(
        {"open": [], "high": [], "low": [], "close": [], "volume": []}, dtype=float
    )
    result = interpret(empty)
    assert result.observations == []
    assert "Not enough price history" in result.summary
    assert result.disclaimer


def test_missing_columns_are_rejected() -> None:
    with pytest.raises(KeyError):
        interpret(pd.DataFrame({"close": [1.0, 2.0, 3.0]}))


def test_flat_series_is_neutral_not_directional() -> None:
    result = interpret(ohlcv(pd.Series(np.full(300, 100.0))))
    assert not result.bullish
    assert not result.bearish
