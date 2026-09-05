"""Pattern detection tests.

The one that matters most is future-bar mutation invariance: an event dated at
bar T must be identical no matter what happens after T. If that test fails,
the detector is using the future and every event it reports is worthless.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.analytics.patterns import (
    OUTCOME_WINDOWS,
    PATTERN_DEFINITIONS,
    SMALL_SAMPLE,
    detect_patterns,
)


def frame_from(close: np.ndarray | list[float], start: str = "2020-01-02") -> pd.DataFrame:
    values = np.asarray(close, dtype=float)
    dates = [str(d.date()) for d in pd.bdate_range(start, periods=len(values))]
    return pd.DataFrame(
        {
            "open": values,
            "high": values * 1.005,
            "low": values * 0.995,
            "close": values,
            "volume": np.full(len(values), 1e6),
        },
        index=pd.Index(dates, name="date"),
    )


def noisy_series(n: int = 700, seed: int = 7) -> np.ndarray:
    generator = np.random.default_rng(seed)
    return 100 * np.exp(np.cumsum(generator.normal(0.0003, 0.015, n)))


# --- THE anti-lookahead guard -------------------------------------------------


def test_future_mutation_does_not_change_past_detections() -> None:
    """Mutate every bar after a cutoff wildly; events at or before the cutoff
    must be byte-for-byte identical. This is the test that makes 'no lookahead'
    a property rather than a promise."""
    series = noisy_series()
    cutoff = 400

    baseline = detect_patterns(frame_from(series))
    baseline_events = [e for e in baseline.events if e.index <= cutoff]

    mutated = series.copy()
    mutated[cutoff + 1 :] = mutated[cutoff + 1 :] * 5.0  # a fake future melt-up
    mutated_report = detect_patterns(frame_from(mutated))
    mutated_events = [e for e in mutated_report.events if e.index <= cutoff]

    assert [(e.pattern, e.date, e.values, e.explanation) for e in baseline_events] == [
        (e.pattern, e.date, e.values, e.explanation) for e in mutated_events
    ]


def test_future_crash_does_not_change_past_detections() -> None:
    """Same guard, opposite direction: a fabricated future crash."""
    series = noisy_series(seed=11)
    cutoff = 350

    baseline = detect_patterns(frame_from(series))
    mutated = series.copy()
    mutated[cutoff + 1 :] = mutated[cutoff + 1 :] * 0.2
    mutated_report = detect_patterns(frame_from(mutated))

    def key(events: list) -> list:
        return [(e.pattern, e.date) for e in events if e.index <= cutoff]

    assert key(baseline.events) == key(mutated_report.events)


def test_large_move_baseline_does_not_include_the_move_itself() -> None:
    """The volatility baseline for bar T must end at T-1. A calm series with
    one huge bar must flag that bar -- which only happens if the bar is judged
    against the calm history rather than a baseline inflated by itself."""
    calm = np.full(400, 100.0) + np.sin(np.arange(400)) * 0.4  # tiny wiggle
    calm[300] = calm[299] * 1.30  # one +30% bar
    calm[301:] = calm[300]  # flat afterwards

    report = detect_patterns(frame_from(calm))
    large_moves = [e for e in report.events if e.pattern == "large_move"]
    assert any(e.index == 300 for e in large_moves)


# --- outcome windows use only bars after the event ----------------------------


def test_outcomes_measure_forward_bars_exactly() -> None:
    """Construct a series where the return after the only large move is known
    exactly, and check the 5-bar outcome equals it."""
    series = np.full(400, 100.0) + np.sin(np.arange(400)) * 0.3
    series[300] = 140.0  # the event bar
    series[301:] = 140.0
    series[305] = 154.0  # exactly +10% five bars after the event
    series[306:] = 154.0

    report = detect_patterns(frame_from(series))
    large = next(s for s in report.summaries if s.pattern == "large_move")
    five = next(o for o in large.outcomes if o.window == 5)
    assert five.sample_size >= 1
    # The event at index 300: close 140 -> close at 305 is 154 = +10%.
    assert five.best == pytest.approx(0.10, abs=1e-6)


def test_events_near_the_end_are_excluded_not_guessed() -> None:
    """An event 3 bars before the end cannot have a 60-bar outcome. It must be
    counted as excluded, never extrapolated."""
    series = np.full(400, 100.0) + np.sin(np.arange(400)) * 0.3
    series[397] = 130.0  # large move near the boundary
    series[398:] = 130.0

    report = detect_patterns(frame_from(series))
    large = next(s for s in report.summaries if s.pattern == "large_move")
    sixty = next(o for o in large.outcomes if o.window == 60)
    assert sixty.excluded >= 1
    assert sixty.sample_size + sixty.excluded == large.occurrences


def test_zero_sample_outcomes_are_null_not_zero() -> None:
    series = noisy_series(n=100, seed=3)  # too short for most 60-bar outcomes
    report = detect_patterns(frame_from(series))
    for summary in report.summaries:
        for outcome in summary.outcomes:
            if outcome.sample_size == 0:
                assert outcome.mean is None
                assert outcome.positive_share is None


def test_small_samples_are_flagged() -> None:
    series = noisy_series(n=700, seed=5)
    report = detect_patterns(frame_from(series))
    for summary in report.summaries:
        for outcome in summary.outcomes:
            assert outcome.small_sample == (outcome.sample_size < SMALL_SAMPLE)


# --- degenerate inputs ----------------------------------------------------------


def test_flat_series_detects_nothing_and_does_not_crash() -> None:
    report = detect_patterns(frame_from(np.full(300, 50.0)))
    assert report.events == []
    assert not report.insufficient


def test_monotonic_series_produces_no_death_cross() -> None:
    report = detect_patterns(frame_from(np.linspace(100, 300, 400)))
    assert all(e.pattern != "death_cross" for e in report.events)


def test_short_history_reports_insufficient() -> None:
    report = detect_patterns(frame_from(np.linspace(100, 110, 30)))
    assert report.insufficient
    assert report.events == []
    assert "60" in report.note


def test_duplicate_timestamps_are_deduplicated_and_stable() -> None:
    series = noisy_series(n=300, seed=9)
    frame = frame_from(series)
    duplicated = pd.concat([frame.iloc[:150], frame.iloc[149:150], frame.iloc[150:]])
    clean = detect_patterns(frame)
    dirty = detect_patterns(duplicated)
    assert [(e.pattern, e.date) for e in clean.events] == [
        (e.pattern, e.date) for e in dirty.events
    ]


def test_extremely_volatile_series_does_not_crash() -> None:
    generator = np.random.default_rng(13)
    wild = 100 * np.exp(np.cumsum(generator.normal(0, 0.12, 400)))
    report = detect_patterns(frame_from(wild))
    assert report.bars == 400
    for event in report.events:
        for value in event.values.values():
            assert np.isfinite(value)


def test_missing_close_column_is_rejected() -> None:
    with pytest.raises(KeyError):
        detect_patterns(pd.DataFrame({"open": np.ones(100)}))


# --- correctness of specific detectors -------------------------------------------


def test_golden_cross_is_detected_at_the_crossing_bar() -> None:
    """Down for 200 bars then up for 200: exactly one golden cross, and it must
    land on the first bar where the 20-average exceeds the 50-average."""
    series = np.concatenate([np.linspace(200, 100, 200), np.linspace(100, 250, 200)])
    report = detect_patterns(frame_from(series))
    crosses = [e for e in report.events if e.pattern == "golden_cross"]
    assert len(crosses) == 1
    event = crosses[0]
    assert event.values["fast"] > event.values["slow"]
    assert event.index > 200  # the cross happens after the turn, thanks to lag


def test_drawdown_recovery_requires_a_deep_drawdown_first() -> None:
    """A 5% dip must not produce a recovery event; a 15% dip that recovers must."""
    shallow = np.concatenate(
        [
            np.linspace(100, 110, 100),
            np.linspace(110, 104.5, 50),
            np.linspace(104.5, 115, 100),
        ]
    )
    report = detect_patterns(frame_from(shallow))
    assert all(e.pattern != "drawdown_recovery" for e in report.events)

    deep = np.concatenate(
        [np.linspace(100, 110, 100), np.linspace(110, 93, 50), np.linspace(93, 115, 100)]
    )
    report = detect_patterns(frame_from(deep))
    recoveries = [e for e in report.events if e.pattern == "drawdown_recovery"]
    assert len(recoveries) == 1
    assert recoveries[0].values["close"] >= recoveries[0].values["regained_peak"]


def test_rsi_entry_events_fire_on_the_transition_bar_only() -> None:
    """A sustained decline keeps RSI below 30 for many bars but must produce a
    single oversold-entry event per excursion, not one per bar."""
    series = np.concatenate(
        [np.linspace(90, 100, 100), np.linspace(100, 60, 60), np.full(140, 60.0)]
    )
    report = detect_patterns(frame_from(series))
    oversold = [e for e in report.events if e.pattern == "rsi_oversold"]
    assert len(oversold) == 1


# --- reporting contracts -----------------------------------------------------------


def test_every_event_has_explanation_and_caveat() -> None:
    report = detect_patterns(frame_from(noisy_series()))
    assert report.events, "the noisy fixture should produce events"
    for event in report.events:
        assert event.explanation.strip()
        assert event.caveat.strip()
        assert event.date
        assert event.pattern in PATTERN_DEFINITIONS


def test_summaries_cover_every_pattern_with_every_window() -> None:
    report = detect_patterns(frame_from(noisy_series()))
    assert {s.pattern for s in report.summaries} == set(PATTERN_DEFINITIONS)
    for summary in report.summaries:
        assert [o.window for o in summary.outcomes] == list(OUTCOME_WINDOWS)
        assert summary.occurrences == sum(
            1 for e in report.events if e.pattern == summary.pattern
        )


def test_no_prediction_language_in_definitions_or_events() -> None:
    report = detect_patterns(frame_from(noisy_series()))
    corpus = " ".join(
        [e.explanation + " " + e.caveat for e in report.events]
        + [s.definition + " " + s.caveat for s in report.summaries]
    ).lower()
    for phrase in (
        "will rise",
        "will fall",
        "you should buy",
        "you should sell",
        "buy now",
        "sell now",
        "guaranteed",
        "predicts the future",
    ):
        assert phrase not in corpus, phrase
