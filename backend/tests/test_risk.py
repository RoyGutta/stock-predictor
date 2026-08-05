"""Risk statistic tests.

Several of these pin down conventions that are easy to get subtly wrong and
that no snapshot test would catch: sample vs population standard deviation,
whether the risk-free rate is de-annualized, and whether Sortino divides by the
full sample length or only the losing periods.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.analytics.risk import (
    annualization_factor,
    annualized_return,
    annualized_volatility,
    beta_alpha,
    conditional_value_at_risk,
    correlation_matrix,
    drawdown_series,
    log_returns,
    max_drawdown,
    monte_carlo,
    sharpe_ratio,
    simple_returns,
    sortino_ratio,
    value_at_risk,
)

TRADING_DAYS = 252


@pytest.fixture
def prices() -> pd.Series:
    """A reproducible random walk with mild upward drift."""
    generator = np.random.default_rng(42)
    returns = generator.normal(0.0005, 0.012, 500)
    return pd.Series(100 * np.exp(np.cumsum(returns)))


# --- plumbing ---------------------------------------------------------------


def test_annualization_factors() -> None:
    assert annualization_factor("daily") == 252
    assert annualization_factor("weekly") == 52
    assert annualization_factor("monthly") == 12


def test_unknown_frequency_is_rejected() -> None:
    with pytest.raises(ValueError, match="unknown frequency"):
        annualization_factor("hourly")


def test_simple_returns_drop_the_leading_nan() -> None:
    result = simple_returns(pd.Series([100.0, 110.0, 99.0]))
    assert len(result) == 2
    assert result.iloc[0] == pytest.approx(0.10)


def test_log_returns_sum_to_total_log_growth() -> None:
    series = pd.Series([100.0, 110.0, 121.0])
    assert log_returns(series).sum() == pytest.approx(np.log(121 / 100))


# --- return and volatility --------------------------------------------------


def test_annualized_return_recovers_a_known_rate() -> None:
    """A constant daily rate compounding over exactly one year of trading days."""
    daily = 0.0004
    returns = pd.Series(np.full(TRADING_DAYS, daily))
    expected = (1 + daily) ** TRADING_DAYS - 1
    assert annualized_return(returns) == pytest.approx(expected, rel=1e-9)


def test_annualized_return_is_zero_for_flat_returns() -> None:
    assert annualized_return(pd.Series(np.zeros(TRADING_DAYS))) == pytest.approx(0.0)


def test_annualized_return_handles_a_wipeout() -> None:
    assert annualized_return(pd.Series([-1.0, 0.05, 0.05])) == -1.0


def test_annualized_volatility_scales_by_sqrt_time() -> None:
    generator = np.random.default_rng(7)
    returns = pd.Series(generator.normal(0, 0.01, 5000))
    assert annualized_volatility(returns) == pytest.approx(
        returns.std(ddof=1) * np.sqrt(TRADING_DAYS)
    )


def test_annualized_volatility_uses_sample_std() -> None:
    """ddof=1, not ddof=0 -- observed returns are a sample, not a population."""
    returns = pd.Series([0.01, -0.01, 0.02, -0.02])
    assert annualized_volatility(returns) == pytest.approx(
        returns.std(ddof=1) * np.sqrt(TRADING_DAYS)
    )


def test_volatility_of_a_constant_series_is_zero() -> None:
    assert annualized_volatility(pd.Series(np.full(100, 0.001))) == pytest.approx(0.0)


def test_statistics_are_nan_with_insufficient_data() -> None:
    assert np.isnan(annualized_volatility(pd.Series([0.01])))
    assert np.isnan(sharpe_ratio(pd.Series([0.01])))
    assert np.isnan(sortino_ratio(pd.Series([0.01])))


# --- risk-adjusted ratios ---------------------------------------------------


def test_sharpe_matches_definition(prices: pd.Series) -> None:
    returns = simple_returns(prices)
    expected = returns.mean() / returns.std(ddof=1) * np.sqrt(TRADING_DAYS)
    assert sharpe_ratio(returns) == pytest.approx(expected)


def test_sharpe_falls_when_the_risk_free_rate_rises(prices: pd.Series) -> None:
    returns = simple_returns(prices)
    assert sharpe_ratio(returns, 0.05) < sharpe_ratio(returns, 0.0)


def test_sharpe_deannualizes_the_risk_free_rate(prices: pd.Series) -> None:
    """A 4% *annual* rate must be converted to a per-period rate before being
    subtracted. Subtracting 4% from every daily return instead would drive the
    ratio deeply negative."""
    returns = simple_returns(prices)
    daily_rf = 1.04 ** (1 / TRADING_DAYS) - 1

    excess = returns - daily_rf
    expected = excess.mean() / excess.std(ddof=1) * np.sqrt(TRADING_DAYS)
    assert sharpe_ratio(returns, 0.04) == pytest.approx(expected)

    naive = returns - 0.04
    naive_ratio = naive.mean() / naive.std(ddof=1) * np.sqrt(TRADING_DAYS)
    assert sharpe_ratio(returns, 0.04) > naive_ratio


def test_sharpe_is_nan_without_variance() -> None:
    assert np.isnan(sharpe_ratio(pd.Series(np.full(50, 0.001))))


def test_sortino_exceeds_sharpe_when_upside_dominates() -> None:
    """Sortino ignores upside deviation, so a series with big gains and small
    losses scores better on Sortino than on Sharpe."""
    returns = pd.Series([0.05, 0.06, -0.005, 0.07, -0.004, 0.08, -0.003] * 10)
    assert sortino_ratio(returns) > sharpe_ratio(returns)


def test_sortino_is_nan_without_any_losing_period() -> None:
    """Reporting infinity here would imply riskless return -- it must not."""
    assert np.isnan(sortino_ratio(pd.Series(np.full(50, 0.01))))


def test_sortino_divides_by_full_sample_length() -> None:
    """Non-losing periods contribute zero downside; they are not excluded from
    the denominator. Excluding them would inflate the ratio."""
    returns = pd.Series([0.02] * 90 + [-0.01] * 10)
    excess = returns - 0.0
    downside = excess[excess < 0]
    expected_dd = np.sqrt((downside**2).sum() / len(excess))
    expected = excess.mean() / expected_dd * np.sqrt(TRADING_DAYS)
    assert sortino_ratio(returns) == pytest.approx(expected)


# --- drawdown ---------------------------------------------------------------


def test_drawdown_series_is_zero_at_new_highs() -> None:
    assert drawdown_series(pd.Series([1.0, 2, 3, 4])).eq(0).all()


def test_max_drawdown_measures_peak_to_trough() -> None:
    # 100 -> 50 is a 50% decline.
    result = max_drawdown(pd.Series([100.0, 120, 60, 80, 130]))
    assert result.max_drawdown == pytest.approx(0.5 - 1.0)  # -0.5


def test_max_drawdown_reports_peak_trough_and_recovery() -> None:
    result = max_drawdown(pd.Series([100.0, 120, 60, 80, 130]))
    assert result.peak_date == "1"     # index 1, value 120
    assert result.trough_date == "2"   # index 2, value 60
    assert result.recovery_date == "4" # index 4, value 130 >= 120


def test_max_drawdown_reports_no_recovery_when_never_regained() -> None:
    result = max_drawdown(pd.Series([100.0, 120, 60, 80, 90]))
    assert result.recovery_date is None


def test_max_drawdown_is_zero_for_a_monotonic_rise() -> None:
    assert max_drawdown(pd.Series([1.0, 2, 3, 4, 5])).max_drawdown == pytest.approx(0.0)


def test_max_drawdown_handles_an_empty_series() -> None:
    assert np.isnan(max_drawdown(pd.Series([], dtype=float)).max_drawdown)


# --- tail risk --------------------------------------------------------------


def test_value_at_risk_is_the_lower_percentile() -> None:
    returns = pd.Series(np.linspace(-0.10, 0.10, 101))
    assert value_at_risk(returns, 0.95) == pytest.approx(np.percentile(returns, 5))


def test_value_at_risk_is_negative_for_a_symmetric_distribution() -> None:
    generator = np.random.default_rng(3)
    assert value_at_risk(pd.Series(generator.normal(0, 0.02, 5000)), 0.95) < 0


def test_var_rejects_confidence_outside_the_open_unit_interval() -> None:
    returns = pd.Series([0.01, -0.01])
    for bad in (0.0, 1.0, 1.5, -0.2):
        with pytest.raises(ValueError):
            value_at_risk(returns, bad)


def test_cvar_is_at_least_as_severe_as_var(prices: pd.Series) -> None:
    returns = simple_returns(prices)
    assert conditional_value_at_risk(returns, 0.95) <= value_at_risk(returns, 0.95)


# --- benchmark-relative -----------------------------------------------------


def test_beta_of_an_asset_against_itself_is_one(prices: pd.Series) -> None:
    returns = simple_returns(prices)
    result = beta_alpha(returns, returns)
    assert result.beta == pytest.approx(1.0)
    assert result.r_squared == pytest.approx(1.0)


def test_beta_of_a_doubled_series_is_two(prices: pd.Series) -> None:
    returns = simple_returns(prices)
    assert beta_alpha(returns * 2, returns).beta == pytest.approx(2.0)


def test_beta_alpha_aligns_mismatched_indexes() -> None:
    """Differing calendars must be inner-joined, not silently misaligned."""
    asset = pd.Series([0.01, 0.02, -0.01, 0.03], index=[1, 2, 3, 4])
    benchmark = pd.Series([0.01, 0.02, -0.01], index=[2, 3, 4])
    assert beta_alpha(asset, benchmark).observations == 3


def test_beta_alpha_is_nan_with_too_few_overlapping_points() -> None:
    asset = pd.Series([0.01, 0.02], index=[1, 2])
    benchmark = pd.Series([0.01], index=[2])
    assert np.isnan(beta_alpha(asset, benchmark).beta)


def test_beta_alpha_is_nan_against_a_constant_benchmark() -> None:
    asset = pd.Series([0.01, 0.02, -0.01, 0.03])
    assert np.isnan(beta_alpha(asset, pd.Series(np.zeros(4))).beta)


def test_r_squared_is_low_for_unrelated_series() -> None:
    generator = np.random.default_rng(11)
    a = pd.Series(generator.normal(0, 0.01, 1000))
    b = pd.Series(generator.normal(0, 0.01, 1000))
    assert beta_alpha(a, b).r_squared < 0.05


def test_correlation_matrix_is_computed_on_returns_not_levels() -> None:
    """Two independent upward-drifting price series would correlate near 1 if
    correlation were taken on levels."""
    generator = np.random.default_rng(5)
    a = 100 * np.exp(np.cumsum(generator.normal(0.001, 0.01, 2000)))
    b = 100 * np.exp(np.cumsum(generator.normal(0.001, 0.01, 2000)))
    frame = pd.DataFrame({"a": a, "b": b})

    level_correlation = abs(frame.corr().loc["a", "b"])
    return_correlation = abs(correlation_matrix(frame).loc["a", "b"])
    assert return_correlation < level_correlation
    assert return_correlation < 0.15


def test_correlation_matrix_diagonal_is_one(prices: pd.Series) -> None:
    frame = pd.DataFrame({"x": prices, "y": prices * 1.5})
    result = correlation_matrix(frame)
    assert result.loc["x", "x"] == pytest.approx(1.0)


# --- monte carlo ------------------------------------------------------------


def test_monte_carlo_is_reproducible_with_a_seed(prices: pd.Series) -> None:
    a = monte_carlo(prices, 30, 500, seed=1)
    b = monte_carlo(prices, 30, 500, seed=1)
    assert a.percentiles == b.percentiles


def test_monte_carlo_percentiles_are_ordered(prices: pd.Series) -> None:
    result = monte_carlo(prices, 60, 2000, seed=2)
    values = [result.percentiles[f"p{p}"] for p in (5, 25, 50, 75, 95)]
    assert values == sorted(values)


def test_monte_carlo_probability_of_loss_is_a_probability(prices: pd.Series) -> None:
    assert 0.0 <= monte_carlo(prices, 60, 1000, seed=3).probability_of_loss <= 1.0


def test_monte_carlo_widens_with_a_longer_horizon(prices: pd.Series) -> None:
    """Dispersion grows with horizon -- this is the property the chart exists to show."""
    short = monte_carlo(prices, 20, 3000, seed=4)
    long = monte_carlo(prices, 250, 3000, seed=4)
    assert (long.percentiles["p95"] - long.percentiles["p5"]) > (
        short.percentiles["p95"] - short.percentiles["p5"]
    )


def test_monte_carlo_requires_enough_history() -> None:
    with pytest.raises(ValueError, match="at least 30"):
        monte_carlo(pd.Series(np.linspace(100, 110, 10)), 30, 100)


@pytest.mark.parametrize(("horizon", "sims"), [(0, 100), (-1, 100), (30, 0)])
def test_monte_carlo_rejects_invalid_parameters(prices: pd.Series, horizon: int, sims: int) -> None:
    with pytest.raises(ValueError):
        monte_carlo(prices, horizon, sims)


def test_monte_carlo_carries_its_disclaimer(prices: pd.Series) -> None:
    """The disclaimer travels with the payload rather than living only in the UI,
    so it cannot be dropped by a caller."""
    result = monte_carlo(prices, 30, 200, seed=6)
    assert "Not a forecast" in result.disclaimer
    assert "bootstrap" in result.method
