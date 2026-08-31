"""Portfolio simulation tests.

The ones that matter are the honesty properties: contributions must not read as
returns, deposits must not hide drawdowns, costs must actually be charged, and
alignment must never invent a price.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.analytics.portfolio import simulate_portfolio


def daily_index(n: int, start: str = "2024-01-02") -> list[str]:
    return [str(d.date()) for d in pd.bdate_range(start, periods=n)]


def series(values: list[float] | np.ndarray) -> pd.Series:
    data = np.asarray(values, dtype=float)
    return pd.Series(data, index=daily_index(len(data)))


def flat(price: float, n: int) -> pd.Series:
    return series(np.full(n, price))


# --- the honesty properties --------------------------------------------------


def test_contributions_are_not_returns() -> None:
    """Flat prices + monthly deposits: the account grows, the return is zero.

    If this fails, the simulator is reporting deposits as investment gains --
    the single most misleading thing a contribution simulator can do.
    """
    prices = {"AAA": flat(100.0, 130)}
    result = simulate_portfolio(prices, {"AAA": 1.0}, initial=10_000, monthly=500, cost_bps=0)

    assert result.contribution_count >= 4
    assert result.ending_value == pytest.approx(result.total_contributed, rel=1e-9)
    assert result.total_return == pytest.approx(0.0, abs=1e-9)
    assert result.annualized_return == pytest.approx(0.0, abs=1e-6)
    assert result.max_drawdown == pytest.approx(0.0, abs=1e-9)


def test_a_deposit_cannot_hide_a_drawdown() -> None:
    """Price halves; deposits keep the account value rising. The drawdown must
    still report the halving, because it is measured on the flow-adjusted index."""
    n = 130
    prices_down = np.linspace(100.0, 50.0, n)
    result = simulate_portfolio(
        {"AAA": series(prices_down)}, {"AAA": 1.0}, initial=1_000, monthly=5_000, cost_bps=0
    )
    assert result.max_drawdown == pytest.approx(-0.5, abs=0.01)
    assert result.total_return == pytest.approx(-0.5, abs=0.01)


def test_growth_index_matches_price_when_there_are_no_flows() -> None:
    """With a single lump sum and no contributions, time-weighted growth must
    equal the underlying price path exactly."""
    path = 100.0 * np.exp(np.cumsum(np.random.default_rng(7).normal(0.0004, 0.01, 200)))
    result = simulate_portfolio(
        {"AAA": series(path)}, {"AAA": 1.0}, initial=10_000, monthly=0, cost_bps=0
    )
    # total_return is rounded to 6 decimals in the payload; match that precision.
    assert result.total_return == pytest.approx(path[-1] / path[0] - 1.0, abs=1e-6)


def test_costs_are_charged_on_every_purchase() -> None:
    prices = {"AAA": flat(100.0, 130)}
    result = simulate_portfolio(prices, {"AAA": 1.0}, initial=10_000, monthly=1_000, cost_bps=100)

    expected_cost = 0.01 * (10_000 + 1_000 * result.contribution_count)
    assert result.cost_paid == pytest.approx(expected_cost, rel=1e-9)
    # On flat prices the only loss is the cost.
    assert result.ending_value == pytest.approx(
        result.total_contributed - expected_cost, rel=1e-9
    )


def test_costs_default_to_nonzero() -> None:
    result = simulate_portfolio({"AAA": flat(100.0, 60)}, {"AAA": 1.0}, initial=10_000)
    assert result.cost_paid > 0


# --- alignment ----------------------------------------------------------------


def test_alignment_uses_only_shared_dates() -> None:
    """One ticker missing recent bars: the simulation must shrink to the shared
    window rather than inventing prices for the gap."""
    long_history = flat(100.0, 120)
    short_history = flat(50.0, 120).iloc[:80]
    result = simulate_portfolio(
        {"LONG": long_history, "SHORT": short_history},
        {"LONG": 0.5, "SHORT": 0.5},
        initial=1_000,
    )
    assert result.bars == 80


def test_insufficient_shared_history_is_refused() -> None:
    with pytest.raises(ValueError, match="share"):
        simulate_portfolio({"AAA": flat(100.0, 10)}, {"AAA": 1.0}, initial=1_000)


# --- validation ----------------------------------------------------------------


def test_weights_must_sum_to_one() -> None:
    prices = {"AAA": flat(100.0, 60), "BBB": flat(50.0, 60)}
    with pytest.raises(ValueError, match="sum to 1.0"):
        simulate_portfolio(prices, {"AAA": 0.7, "BBB": 0.7}, initial=1_000)


def test_weights_must_match_tickers() -> None:
    with pytest.raises(ValueError, match="exactly the tickers"):
        simulate_portfolio({"AAA": flat(100.0, 60)}, {"BBB": 1.0}, initial=1_000)


@pytest.mark.parametrize(
    ("initial", "monthly", "cost", "message"),
    [
        (0, 0, 10, "initial"),
        (-5, 0, 10, "initial"),
        (100, -1, 10, "monthly"),
        (100, 0, -1, "cost"),
    ],
)
def test_invalid_amounts_are_rejected(
    initial: float, monthly: float, cost: float, message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        simulate_portfolio(
            {"AAA": flat(100.0, 60)},
            {"AAA": 1.0},
            initial=initial,
            monthly=monthly,
            cost_bps=cost,
        )


def test_zero_weight_is_rejected() -> None:
    prices = {"AAA": flat(100.0, 60), "BBB": flat(50.0, 60)}
    with pytest.raises(ValueError, match="positive"):
        simulate_portfolio(prices, {"AAA": 1.0, "BBB": 0.0}, initial=1_000)


# --- weight drift ---------------------------------------------------------------


def test_end_weights_drift_toward_the_winner() -> None:
    """No rebalancing: the appreciating holding must end overweight."""
    n = 120
    riser = series(np.linspace(100.0, 200.0, n))
    sleeper = flat(100.0, n)
    result = simulate_portfolio(
        {"UP": riser, "FLAT": sleeper}, {"UP": 0.5, "FLAT": 0.5}, initial=10_000, cost_bps=0
    )
    assert result.end_weights["UP"] > 0.6
    assert result.largest_end_weight == result.end_weights["UP"]
    assert sum(result.end_weights.values()) == pytest.approx(1.0, abs=0.01)


def test_monthly_contributions_buy_at_target_weights() -> None:
    """Contributions go in at target weights, partially pulling drift back."""
    n = 120
    riser = series(np.linspace(100.0, 200.0, n))
    sleeper = flat(100.0, n)
    without = simulate_portfolio(
        {"UP": riser, "FLAT": sleeper}, {"UP": 0.5, "FLAT": 0.5}, initial=10_000, cost_bps=0
    )
    with_contrib = simulate_portfolio(
        {"UP": riser, "FLAT": sleeper},
        {"UP": 0.5, "FLAT": 0.5},
        initial=10_000,
        monthly=5_000,
        cost_bps=0,
    )
    assert with_contrib.end_weights["UP"] < without.end_weights["UP"]


# --- output shape ----------------------------------------------------------------


def test_series_are_aligned_and_rounded() -> None:
    result = simulate_portfolio({"AAA": flat(100.0, 60)}, {"AAA": 1.0}, initial=1_000)
    assert len(result.dates) == len(result.values) == len(result.growth_index) == result.bars
    assert result.growth_index[0] == pytest.approx(1.0)
    assert result.start_date == result.dates[0]
    assert result.end_date == result.dates[-1]
