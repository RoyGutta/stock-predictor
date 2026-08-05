"""Risk and performance statistics.

Pure functions over a return series. As with the indicators, these are
*descriptions of what already happened*. A Sharpe ratio of 1.4 is a fact about
a historical window; it is not an expectation for the next one, and the
docstrings and API field names are worded to keep that distinction visible.

The one function here that projects forward -- `monte_carlo` -- is explicitly a
resampling of the observed return distribution. It answers "if the future
resembled this past, how wide is the range of outcomes?", which is a statement
about dispersion, not a forecast of price. See its docstring.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

__all__ = [
    "annualization_factor",
    "simple_returns",
    "log_returns",
    "annualized_return",
    "annualized_volatility",
    "sharpe_ratio",
    "sortino_ratio",
    "max_drawdown",
    "drawdown_series",
    "value_at_risk",
    "conditional_value_at_risk",
    "beta_alpha",
    "correlation_matrix",
    "monte_carlo",
    "Drawdown",
    "BetaAlpha",
    "MonteCarloResult",
]

# Trading periods per year, by bar frequency. Used to annualize.
PERIODS_PER_YEAR: dict[str, int] = {
    "daily": 252,
    "weekly": 52,
    "monthly": 12,
}


def annualization_factor(frequency: str) -> int:
    try:
        return PERIODS_PER_YEAR[frequency]
    except KeyError:
        raise ValueError(
            f"unknown frequency '{frequency}'; expected one of {sorted(PERIODS_PER_YEAR)}"
        ) from None


def simple_returns(prices: pd.Series) -> pd.Series:
    """Period-over-period percentage change, with the leading NaN dropped."""
    return prices.pct_change().dropna()


def log_returns(prices: pd.Series) -> pd.Series:
    """Continuously-compounded returns. Additive across time, which is why the
    Monte Carlo resampling below works in log space."""
    return np.log(prices / prices.shift(1)).dropna()


# --- return and volatility --------------------------------------------------


def annualized_return(returns: pd.Series, frequency: str = "daily") -> float:
    """Compound annual growth rate implied by the observed returns.

    This is the realized rate over the sample window, restated per year. It is
    not an expected return.
    """
    if returns.empty:
        return float("nan")
    periods = annualization_factor(frequency)
    total_growth = float((1 + returns).prod())
    if total_growth <= 0:
        return -1.0  # position was wiped out
    return total_growth ** (periods / len(returns)) - 1


def annualized_volatility(returns: pd.Series, frequency: str = "daily") -> float:
    """Standard deviation of returns, scaled to a yearly figure.

    Uses the sample standard deviation (ddof=1) because the observed returns are
    a sample of the return-generating process, not the whole population.
    """
    if len(returns) < 2:
        return float("nan")
    return float(returns.std(ddof=1) * np.sqrt(annualization_factor(frequency)))


def sharpe_ratio(
    returns: pd.Series, risk_free_rate: float = 0.0, frequency: str = "daily"
) -> float:
    """Excess return per unit of total volatility.

    `risk_free_rate` is an annual rate and is de-annualized internally, so pass
    e.g. 0.04 for 4%. Sharpe treats upside and downside swings as equally bad --
    Sortino below does not.
    """
    if len(returns) < 2:
        return float("nan")
    periods = annualization_factor(frequency)
    period_rf = (1 + risk_free_rate) ** (1 / periods) - 1
    excess = returns - period_rf
    deviation = excess.std(ddof=1)
    if deviation == 0:
        return float("nan")
    return float(excess.mean() / deviation * np.sqrt(periods))


def sortino_ratio(
    returns: pd.Series, risk_free_rate: float = 0.0, frequency: str = "daily"
) -> float:
    """Excess return per unit of *downside* volatility.

    Penalizes only returns below the target, so a strategy is not punished for
    large gains the way Sharpe punishes it.
    """
    if len(returns) < 2:
        return float("nan")
    periods = annualization_factor(frequency)
    period_rf = (1 + risk_free_rate) ** (1 / periods) - 1
    excess = returns - period_rf

    downside = excess[excess < 0]
    if downside.empty:
        # No losing period in the sample. Undefined rather than infinite -- and
        # reporting "infinite risk-adjusted return" would badly mislead.
        return float("nan")

    # Root-mean-square of shortfalls, divided by the full sample length: periods
    # at or above target contribute zero downside, they are not excluded.
    downside_deviation = float(np.sqrt((downside**2).sum() / len(excess)))
    if downside_deviation == 0:
        return float("nan")
    return float(excess.mean() / downside_deviation * np.sqrt(periods))


# --- drawdown ---------------------------------------------------------------


def drawdown_series(prices: pd.Series) -> pd.Series:
    """Percentage below the running peak at every point (0 at a new high)."""
    running_peak = prices.cummax()
    return prices / running_peak - 1


@dataclass(frozen=True)
class Drawdown:
    max_drawdown: float
    peak_date: str | None
    trough_date: str | None
    recovery_date: str | None
    """None if the series never regained its previous peak within the window."""


def max_drawdown(prices: pd.Series) -> Drawdown:
    """Largest peak-to-trough decline in the window, with its dates.

    This is the worst loss an investor who bought at the worst moment would have
    lived through -- historically the most useful single risk number for a
    beginner, because it is the one that actually causes people to sell.
    """
    if prices.empty:
        return Drawdown(float("nan"), None, None, None)

    drawdowns = drawdown_series(prices)
    trough_index = drawdowns.idxmin()
    worst = float(drawdowns.loc[trough_index])

    # The peak is the last high before the trough.
    peak_index = prices.loc[:trough_index].idxmax()
    peak_value = prices.loc[peak_index]

    after_trough = prices.loc[trough_index:]
    recovered = after_trough[after_trough >= peak_value]
    recovery_index = recovered.index[0] if not recovered.empty else None

    def label(index: object) -> str | None:
        return None if index is None else str(index)

    return Drawdown(
        max_drawdown=worst,
        peak_date=label(peak_index),
        trough_date=label(trough_index),
        recovery_date=label(recovery_index),
    )


# --- tail risk --------------------------------------------------------------


def value_at_risk(returns: pd.Series, confidence: float = 0.95) -> float:
    """Historical VaR: the loss threshold that was exceeded only
    (1 - confidence) of the time in this sample.

    Returned as a negative number. Purely historical -- it says nothing about
    losses larger than any that appear in the window.
    """
    if returns.empty:
        return float("nan")
    if not 0 < confidence < 1:
        raise ValueError(f"confidence must be in (0, 1), got {confidence}")
    return float(np.percentile(returns, (1 - confidence) * 100))


def conditional_value_at_risk(returns: pd.Series, confidence: float = 0.95) -> float:
    """Expected shortfall: the average loss on the days that were worse than VaR.

    More informative than VaR about how bad the tail actually gets.
    """
    if returns.empty:
        return float("nan")
    threshold = value_at_risk(returns, confidence)
    tail = returns[returns <= threshold]
    return float(tail.mean()) if not tail.empty else threshold


# --- relative to a benchmark ------------------------------------------------


@dataclass(frozen=True)
class BetaAlpha:
    beta: float
    alpha: float
    r_squared: float
    observations: int


def beta_alpha(
    returns: pd.Series,
    benchmark_returns: pd.Series,
    risk_free_rate: float = 0.0,
    frequency: str = "daily",
) -> BetaAlpha:
    """Beta, annualized Jensen's alpha, and the R-squared of the fit.

    Beta is sensitivity to the benchmark: 1.3 means the asset historically moved
    about 30% more than the market, in both directions.

    `r_squared` matters as much as beta and is usually omitted: it says how much
    of the asset's movement the benchmark explains at all. A beta computed from
    a low-R-squared relationship is close to meaningless, so it is returned
    alongside rather than buried.

    The two series are inner-joined on their index, so mismatched calendars or
    differing histories are handled rather than silently misaligned.
    """
    aligned = pd.concat([returns, benchmark_returns], axis=1, join="inner").dropna()
    aligned.columns = ["asset", "benchmark"]
    if len(aligned) < 3:
        return BetaAlpha(float("nan"), float("nan"), float("nan"), len(aligned))

    periods = annualization_factor(frequency)
    period_rf = (1 + risk_free_rate) ** (1 / periods) - 1
    asset_excess = aligned["asset"] - period_rf
    benchmark_excess = aligned["benchmark"] - period_rf

    benchmark_variance = benchmark_excess.var(ddof=1)
    if benchmark_variance == 0:
        return BetaAlpha(float("nan"), float("nan"), float("nan"), len(aligned))

    covariance = asset_excess.cov(benchmark_excess)
    beta = float(covariance / benchmark_variance)

    period_alpha = asset_excess.mean() - beta * benchmark_excess.mean()
    alpha = float((1 + period_alpha) ** periods - 1)

    correlation = aligned["asset"].corr(aligned["benchmark"])
    r_squared = float(correlation**2) if pd.notna(correlation) else float("nan")

    return BetaAlpha(beta=beta, alpha=alpha, r_squared=r_squared, observations=len(aligned))


def correlation_matrix(price_frame: pd.DataFrame) -> pd.DataFrame:
    """Pairwise correlation of returns between columns of a price frame.

    Correlations are computed on returns, never on price levels -- correlating
    raw prices produces spuriously high values for any two assets that both
    happened to drift upward.
    """
    return price_frame.pct_change().dropna(how="all").corr()


# --- scenario dispersion ----------------------------------------------------


@dataclass(frozen=True)
class MonteCarloResult:
    horizon_days: int
    simulations: int
    percentiles: dict[str, float]
    """Ending values at the 5th/25th/50th/75th/95th percentile of simulated paths."""
    probability_of_loss: float
    method: str
    disclaimer: str


def monte_carlo(
    prices: pd.Series,
    horizon_days: int = 252,
    simulations: int = 10_000,
    seed: int | None = None,
) -> MonteCarloResult:
    """Bootstrap the observed return distribution forward to show dispersion.

    **This is not a price forecast.** It resamples the asset's own historical
    daily returns, with replacement, to answer a narrower question: *if future
    returns were drawn from the same distribution as this sample, how wide would
    the range of outcomes be?*

    That premise is routinely false. Volatility clusters, correlations shift in
    crashes, and the sample cannot contain a shock larger than any it observed.
    The output is therefore useful for comparing the *dispersion* of two assets,
    and misleading if read as a probability of any particular price.

    Bootstrapping the empirical distribution is deliberate: assuming normally
    distributed returns would understate tail risk, since real returns have
    fatter tails than a normal distribution.
    """
    if horizon_days < 1:
        raise ValueError(f"horizon_days must be >= 1, got {horizon_days}")
    if simulations < 1:
        raise ValueError(f"simulations must be >= 1, got {simulations}")

    observed = log_returns(prices)
    if len(observed) < 30:
        raise ValueError(
            f"need at least 30 return observations to resample, got {len(observed)}"
        )

    generator = np.random.default_rng(seed)
    # Work in log space so a path's total return is the sum of its draws.
    draws = generator.choice(observed.to_numpy(), size=(simulations, horizon_days), replace=True)
    ending_values = float(prices.iloc[-1]) * np.exp(draws.sum(axis=1))

    return MonteCarloResult(
        horizon_days=horizon_days,
        simulations=simulations,
        percentiles={
            f"p{p}": float(np.percentile(ending_values, p)) for p in (5, 25, 50, 75, 95)
        },
        probability_of_loss=float((ending_values < float(prices.iloc[-1])).mean()),
        method="historical bootstrap (resampled log returns, with replacement)",
        disclaimer=(
            "Not a forecast. Shows how wide the range of outcomes would be if future "
            "returns resembled this asset's own past returns -- an assumption that "
            "fails during regime changes and cannot capture shocks larger than any "
            "in the sample."
        ),
    )
