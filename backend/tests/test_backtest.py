"""Backtest engine tests.

The important ones here are not "does it compute a number" but "is the number
honest": no lookahead, costs actually charged, benchmark actually compared, and
out-of-sample genuinely out of sample. A backtest that flatters a rule is worse
than no backtest, so those properties are pinned.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.analytics.backtest import (
    DEFAULT_COST_BPS,
    STRATEGIES,
    Strategy,
    compare_strategies,
    run_backtest,
    walk_forward,
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
    idx = pd.date_range("2024-01-01", periods=400, freq="B")
    return ohlcv(pd.Series(np.linspace(100, 200, 400), index=idx))


@pytest.fixture
def noisy() -> pd.DataFrame:
    generator = np.random.default_rng(11)
    idx = pd.date_range("2024-01-01", periods=500, freq="B")
    walk = 100 * np.exp(np.cumsum(generator.normal(0.0003, 0.015, 500)))
    return ohlcv(pd.Series(walk, index=idx))


BUY_AND_HOLD = STRATEGIES["buy_and_hold"]
SMA = STRATEGIES["sma_crossover"]


# --- the property that matters most -----------------------------------------


def test_signal_cannot_be_acted_on_in_its_own_bar() -> None:
    """A rule with perfect foresight must NOT be able to capture the move it
    predicts. If it can, the engine has lookahead bias and every result is
    worthless."""
    idx = pd.date_range("2024-01-01", periods=100, freq="B")
    # Flat, then one enormous single-bar jump.
    prices = np.full(100, 100.0)
    prices[50:] = 200.0
    frame = ohlcv(pd.Series(prices, index=idx))

    # An oracle that is long exactly on the bar the jump prints.
    def oracle(f: pd.DataFrame, period: int) -> pd.Series:
        signal = pd.Series(0.0, index=f.index)
        signal.iloc[50] = 1.0
        return signal

    cheating = Strategy("oracle", "Oracle", "", oracle, (0,), "none")
    result = run_backtest(frame, cheating, 0, cost_bps=0)

    # The +100% bar happens at index 50. A signal at 50 executes at 51, by which
    # time the price is flat again -- so the oracle must capture nothing.
    assert result.total_return == pytest.approx(0.0, abs=1e-9)


def test_buy_and_hold_captures_exactly_the_price_move() -> None:
    """Buy-and-hold must equal the close-to-close move, with no lag penalty.

    The one-bar shift is not an off-by-one: deciding at the close of bar 0 means
    holding through bar 1, and bar 1's return is measured from bar 0's close. So
    the full move is captured, while a signal still cannot reach the bar that
    produced it (see the oracle test above).
    """
    idx = pd.date_range("2024-01-01", periods=100, freq="B")
    prices = pd.Series(np.linspace(100, 200, 100), index=idx)
    result = run_backtest(ohlcv(prices), BUY_AND_HOLD, 0, cost_bps=0)

    full_move = prices.iloc[-1] / prices.iloc[0] - 1
    assert result.total_return == pytest.approx(full_move, abs=1e-6)


# --- costs ------------------------------------------------------------------


def test_costs_reduce_returns(noisy: pd.DataFrame) -> None:
    free = run_backtest(noisy, SMA, 20, cost_bps=0)
    charged = run_backtest(noisy, SMA, 20, cost_bps=50)
    assert charged.total_return < free.total_return
    assert charged.cost_drag > 0


def test_costs_are_on_by_default() -> None:
    """Frictionless trading is a fiction that flatters high-turnover rules."""
    assert DEFAULT_COST_BPS > 0


def test_buy_and_hold_pays_cost_only_once(rising: pd.DataFrame) -> None:
    result = run_backtest(rising, BUY_AND_HOLD, 0, cost_bps=100)
    # One entry, never exits: a single 1% charge.
    assert result.cost_drag == pytest.approx(0.01, abs=1e-9)
    assert result.trades == 1


def test_negative_cost_is_rejected(rising: pd.DataFrame) -> None:
    with pytest.raises(ValueError, match="cost_bps"):
        run_backtest(rising, BUY_AND_HOLD, 0, cost_bps=-1)


# --- basic mechanics --------------------------------------------------------


def test_exposure_is_a_fraction(noisy: pd.DataFrame) -> None:
    result = run_backtest(noisy, SMA, 50)
    assert 0.0 <= result.exposure <= 1.0


def test_buy_and_hold_is_always_invested(rising: pd.DataFrame) -> None:
    # Bar 0 is flat because of the entry lag, hence just under 1.0.
    assert run_backtest(rising, BUY_AND_HOLD, 0).exposure == pytest.approx(1.0, abs=0.01)


def test_a_rule_that_is_never_long_returns_nothing() -> None:
    idx = pd.date_range("2024-01-01", periods=100, freq="B")
    frame = ohlcv(pd.Series(np.linspace(100, 200, 100), index=idx))
    never = Strategy(
        "never", "Never", "", lambda f, p: pd.Series(0.0, index=f.index), (0,), "none"
    )
    result = run_backtest(frame, never, 0)
    assert result.total_return == pytest.approx(0.0, abs=1e-9)
    assert result.trades == 0
    assert result.exposure == 0.0
    assert result.win_rate is None


def test_drawdown_is_never_positive(noisy: pd.DataFrame) -> None:
    assert run_backtest(noisy, SMA, 50).max_drawdown <= 0


def test_equity_curve_is_only_built_when_requested(noisy: pd.DataFrame) -> None:
    assert run_backtest(noisy, SMA, 50).equity_curve == []
    with_curve = run_backtest(noisy, SMA, 50, include_curve=True)
    assert len(with_curve.equity_curve) == len(noisy)
    assert len(with_curve.dates) == len(noisy)


def test_short_history_is_rejected() -> None:
    idx = pd.date_range("2024-01-01", periods=20, freq="B")
    with pytest.raises(ValueError, match="at least"):
        run_backtest(ohlcv(pd.Series(np.linspace(100, 110, 20), index=idx)), BUY_AND_HOLD, 0)


def test_missing_close_column_is_rejected() -> None:
    with pytest.raises(KeyError):
        run_backtest(pd.DataFrame({"open": np.ones(100)}), BUY_AND_HOLD, 0)


# --- walk-forward -----------------------------------------------------------


def test_walk_forward_reports_both_slices(noisy: pd.DataFrame) -> None:
    result = walk_forward(noisy, SMA)
    assert result.in_sample.bars + result.out_of_sample.bars == len(noisy)


def test_walk_forward_chooses_from_the_grid(noisy: pd.DataFrame) -> None:
    result = walk_forward(noisy, SMA)
    assert result.chosen_parameter in SMA.parameter_grid
    assert result.parameters_tried == len(SMA.parameter_grid)


def test_out_of_sample_slice_never_influences_the_choice(noisy: pd.DataFrame) -> None:
    """Changing only the held-out data must not change the chosen parameter.
    If it does, the test slice has leaked into training."""
    baseline = walk_forward(noisy, SMA)

    tampered = noisy.copy()
    split = int(len(noisy) * 0.6)
    # Make the out-of-sample period wildly different.
    tampered.iloc[split:, tampered.columns.get_loc("close")] *= 3.0

    assert walk_forward(tampered, SMA).chosen_parameter == baseline.chosen_parameter


def test_walk_forward_compares_against_buy_and_hold(noisy: pd.DataFrame) -> None:
    result = walk_forward(noisy, SMA)
    expected = result.out_of_sample.total_return - result.benchmark_out_of_sample.total_return
    assert result.excess_return == pytest.approx(expected, abs=1e-9)
    assert result.beat_benchmark == (result.excess_return > 0)


def test_walk_forward_rejects_extreme_splits(noisy: pd.DataFrame) -> None:
    for bad in (0.05, 0.95, -1.0, 1.5):
        with pytest.raises(ValueError, match="train_fraction"):
            walk_forward(noisy, SMA, train_fraction=bad)


def test_walk_forward_needs_enough_history_for_both_slices() -> None:
    idx = pd.date_range("2024-01-01", periods=80, freq="B")
    with pytest.raises(ValueError, match="split"):
        walk_forward(ohlcv(pd.Series(np.linspace(100, 120, 80), index=idx)), SMA)


# --- honesty of the reported verdict ----------------------------------------


def test_verdict_never_recommends_an_action(noisy: pd.DataFrame) -> None:
    for result in compare_strategies(noisy):
        text = result.verdict.lower()
        for phrase in ("you should", "we recommend", "buy now", "will outperform", "guaranteed"):
            assert phrase not in text


def test_verdict_warns_when_a_rule_loses_to_the_benchmark(noisy: pd.DataFrame) -> None:
    losers = [
        r for r in compare_strategies(noisy)
        if not r.beat_benchmark and r.strategy_key != "buy_and_hold"
    ]
    for result in losers:
        assert "behind" in result.verdict.lower()


def test_verdict_flags_overfitting_when_performance_degrades(noisy: pd.DataFrame) -> None:
    degraded = [
        r for r in compare_strategies(noisy)
        if r.degradation < -0.05 and r.strategy_key != "buy_and_hold"
    ]
    for result in degraded:
        assert "over-fitting" in result.verdict.lower()


def test_comparison_returns_every_rule_not_just_the_winner(noisy: pd.DataFrame) -> None:
    """Reporting only the best of several rules is data mining."""
    results = compare_strategies(noisy)
    assert len(results) == len(STRATEGIES)
    assert {r.strategy_key for r in results} == set(STRATEGIES)


def test_comparison_includes_the_benchmark(noisy: pd.DataFrame) -> None:
    assert any(r.strategy_key == "buy_and_hold" for r in compare_strategies(noisy))


def test_benchmark_verdict_identifies_itself_as_the_benchmark(noisy: pd.DataFrame) -> None:
    benchmark = next(r for r in compare_strategies(noisy) if r.strategy_key == "buy_and_hold")
    assert "benchmark" in benchmark.verdict.lower()


# --- every strategy is runnable ---------------------------------------------


@pytest.mark.parametrize("key", list(STRATEGIES))
def test_every_strategy_runs_and_produces_finite_numbers(key: str, noisy: pd.DataFrame) -> None:
    strategy = STRATEGIES[key]
    result = run_backtest(noisy, strategy, strategy.parameter_grid[0])
    assert np.isfinite(result.total_return)
    assert result.bars == len(noisy)
    assert 0.0 <= result.exposure <= 1.0


@pytest.mark.parametrize("key", list(STRATEGIES))
def test_every_strategy_has_a_description_and_grid(key: str) -> None:
    strategy = STRATEGIES[key]
    assert strategy.name and strategy.description
    assert len(strategy.parameter_grid) >= 1
