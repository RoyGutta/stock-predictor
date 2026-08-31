"""Hypothetical portfolio simulation over historical prices.

Answers one question: if this mix of securities had been bought in the past and
held, what would have happened? It is a historical replay, not a projection.
Every result it produces is labeled hypothetical, and none of it says anything
about what the same mix will do next.

Methodology, stated once and shown to the user verbatim:

- The initial amount is invested at the first price bar shared by every holding, split
  by the target weights. Fractional shares are assumed.
- Optional monthly contributions are invested at the first shared price bar of
  each subsequent calendar month, again split by the target weights. Existing
  holdings are never rebalanced, so actual weights drift with prices -- exactly
  as they would for someone who buys and holds.
- A proportional cost is charged on every purchase (default 10 bps), matching
  the backtest engine's default. Frictionless investing flatters every result.
- The benchmark receives the identical cash flows into a single security and is
  measured the same way.

The honesty-critical detail is how returns are measured. A value curve that
includes contributions rises even when every holding is flat, and a deposit can
paper over a drawdown. All return and risk statistics are therefore computed on
the *flow-adjusted* (time-weighted) return series::

    r_t = (V_t - flow_t) / V_{t-1} - 1

where ``flow_t`` is the cash deposited at bar *t*. The raw value curve is kept
only for the "what the account would have held" display, never for statistics.
A test pins this: flat prices plus monthly contributions must show a 0% return
and zero drawdown even though the account value grows every month.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from app.analytics import risk

__all__ = [
    "PortfolioSimulation",
    "simulate_portfolio",
    "WEIGHT_SUM_TOLERANCE",
    "DEFAULT_COST_BPS",
]

# Matches the backtest engine's default retail cost assumption.
DEFAULT_COST_BPS = 10.0

WEIGHT_SUM_TOLERANCE = 1e-3

# Below this many shared bars, annualized statistics are noise.
_MIN_BARS = 40


@dataclass(frozen=True)
class PortfolioSimulation:
    tickers: list[str]
    weights: dict[str, float]
    bars: int
    start_date: str
    end_date: str

    initial_investment: float
    monthly_contribution: float
    total_contributed: float
    ending_value: float
    cost_paid: float
    contribution_count: int

    # Statistics on the flow-adjusted return series (contributions removed).
    total_return: float
    annualized_return: float
    annualized_volatility: float | None
    sharpe_ratio: float | None
    max_drawdown: float

    # Weight drift: buy-and-hold portfolios concentrate on their winners.
    end_weights: dict[str, float]
    largest_end_weight: float

    # Display series (contribution-inflated by construction; not for statistics).
    dates: list[str] = field(default_factory=list)
    values: list[float] = field(default_factory=list)
    # Time-weighted growth of 1.0, the statistically honest curve.
    growth_index: list[float] = field(default_factory=list)


def _validate(
    prices: dict[str, pd.Series],
    weights: dict[str, float],
    initial: float,
    monthly: float,
    cost_bps: float,
) -> None:
    if not prices:
        raise ValueError("at least one holding is required")
    if set(prices) != set(weights):
        raise ValueError("weights must name exactly the tickers in prices")
    if any(weight <= 0 for weight in weights.values()):
        raise ValueError("every weight must be positive")
    if abs(sum(weights.values()) - 1.0) > WEIGHT_SUM_TOLERANCE:
        raise ValueError(f"weights must sum to 1.0 (got {sum(weights.values()):.4f})")
    if initial <= 0:
        raise ValueError(f"initial investment must be positive, got {initial}")
    if monthly < 0:
        raise ValueError(f"monthly contribution must be >= 0, got {monthly}")
    if cost_bps < 0:
        raise ValueError(f"cost_bps must be >= 0, got {cost_bps}")


def _align(prices: dict[str, pd.Series]) -> pd.DataFrame:
    """Inner-join every series on shared dates, dropping bars any ticker lacks.

    An outer join would need invented prices for the gaps; refusing to align on
    anything but genuinely shared bars keeps every number real.
    """
    frame = pd.DataFrame(prices).dropna()
    if len(frame) < _MIN_BARS:
        raise ValueError(
            f"the holdings share only {len(frame)} price bars of history; "
            f"at least {_MIN_BARS} are needed for meaningful statistics"
        )
    return frame


def _month_key(label: str) -> str:
    """YYYY-MM of an ISO-ish date label. Falls back to the label itself."""
    return label[:7] if len(label) >= 7 else label


def simulate_portfolio(
    prices: dict[str, pd.Series],
    weights: dict[str, float],
    *,
    initial: float = 10_000.0,
    monthly: float = 0.0,
    cost_bps: float = DEFAULT_COST_BPS,
    frequency: str = "daily",
) -> PortfolioSimulation:
    """Replay a fixed-weight purchase plan over shared price history."""
    _validate(prices, weights, initial, monthly, cost_bps)
    frame = _align(prices)
    tickers = list(frame.columns)
    cost_rate = cost_bps / 10_000.0

    shares = dict.fromkeys(tickers, 0.0)
    cost_paid = 0.0
    contribution_count = 0

    def buy(amount: float, bar: pd.Series) -> None:
        """Invest `amount` at this bar's prices, split by target weights."""
        nonlocal cost_paid
        charge = amount * cost_rate
        investable = amount - charge
        for ticker in tickers:
            shares[ticker] += investable * weights[ticker] / bar[ticker]
        cost_paid += charge

    dates = [str(index) for index in frame.index]
    values: list[float] = []
    flows: list[float] = []

    previous_month = _month_key(dates[0])
    for position, (_index, bar) in enumerate(frame.iterrows()):
        flow = 0.0
        if position == 0:
            buy(initial, bar)
            flow = initial
        else:
            month = _month_key(dates[position])
            if monthly > 0 and month != previous_month:
                buy(monthly, bar)
                flow = monthly
                contribution_count += 1
            previous_month = month

        flows.append(flow)
        values.append(sum(shares[t] * bar[t] for t in tickers))

    value_series = pd.Series(values, index=frame.index)
    flow_series = pd.Series(flows, index=frame.index)

    # Time-weighted returns: strip the deposits out before measuring anything.
    # Bar 0 has no prior value; its "return" is defined as zero.
    previous_values = value_series.shift(1)
    flow_adjusted = (value_series - flow_series) / previous_values - 1.0
    flow_adjusted.iloc[0] = 0.0

    growth = (1.0 + flow_adjusted).cumprod()

    total_return = float(growth.iloc[-1] - 1.0)
    periods = risk.annualization_factor(frequency)
    years = len(growth) / periods
    annualized = float(growth.iloc[-1] ** (1 / years) - 1.0) if growth.iloc[-1] > 0 else -1.0

    returns_after_first = flow_adjusted.iloc[1:]
    volatility = (
        float(returns_after_first.std(ddof=1) * np.sqrt(periods))
        if len(returns_after_first) > 1
        else None
    )
    deviation = returns_after_first.std(ddof=1) if len(returns_after_first) > 1 else 0.0
    sharpe = (
        float(returns_after_first.mean() / deviation * np.sqrt(periods))
        if deviation and deviation > 0
        else None
    )

    ending_value = float(value_series.iloc[-1])
    end_weights = {
        ticker: round(float(shares[ticker] * frame[ticker].iloc[-1] / ending_value), 4)
        for ticker in tickers
    }

    return PortfolioSimulation(
        tickers=tickers,
        weights={t: round(float(w), 4) for t, w in weights.items()},
        bars=len(frame),
        start_date=dates[0],
        end_date=dates[-1],
        initial_investment=initial,
        monthly_contribution=monthly,
        total_contributed=round(initial + monthly * contribution_count, 2),
        ending_value=round(ending_value, 2),
        cost_paid=round(cost_paid, 2),
        contribution_count=contribution_count,
        total_return=round(total_return, 6),
        annualized_return=round(annualized, 6),
        annualized_volatility=round(volatility, 6) if volatility is not None else None,
        sharpe_ratio=round(sharpe, 4) if sharpe is not None else None,
        # Drawdown on the time-weighted index: a deposit must not hide a fall.
        max_drawdown=round(float(risk.drawdown_series(growth).min()), 6),
        end_weights=end_weights,
        largest_end_weight=round(max(end_weights.values()), 4),
        dates=dates,
        values=[round(float(v), 2) for v in values],
        growth_index=[round(float(g), 6) for g in growth],
    )
