"""Backtesting: how would a rule have performed on data it was never tuned on?

This module exists to answer a historical question, never a predictive one. It
does not forecast, does not recommend, and does not produce a signal to act on.
Its most useful output is usually the *negative* result — showing that a rule
which looked excellent on the data used to choose it fell apart on data it had
never seen.

Most published backtests are wrong in one of a small number of ways. Each is
addressed explicitly here, because a backtest that flatters a rule is worse than
no backtest at all:

1. **Lookahead bias.** A signal derived from bar *t*'s close cannot be acted on
   until bar *t+1*. The engine shifts positions by one bar; there is no way for a
   caller to opt out of that.
2. **No costs.** Frictionless trading makes any high-turnover rule look good.
   Costs are charged on every position change and default to a non-zero value.
3. **No benchmark.** "Returned 40%" is meaningless without "buy-and-hold returned
   60%". Every result is reported alongside buy-and-hold over the same window.
4. **In-sample fitting.** Choosing the parameter that worked best on a period and
   then reporting that period's return is not evidence. `walk_forward` picks the
   parameter on an earlier slice and reports the untouched later slice.
5. **Multiple testing.** Trying twenty rules and presenting the winner is data
   mining. `compare_strategies` returns every result it computed, along with the
   number of combinations tried, so the reader can discount accordingly.

Survivorship bias is out of scope: these run on a single user-chosen ticker that
exists today, so results are conditional on the company having survived.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from app.analytics import indicators as ind
from app.analytics import risk

__all__ = [
    "Strategy",
    "BacktestResult",
    "WalkForwardResult",
    "STRATEGIES",
    "run_backtest",
    "walk_forward",
    "compare_strategies",
    "DEFAULT_COST_BPS",
]

# Round-trip cost per position change, in basis points. 10 bps (0.1%) is a
# deliberately conservative retail assumption covering commission and spread.
# Zero would be a fiction that flatters every high-turnover rule.
DEFAULT_COST_BPS = 10.0

# Below this, annualized statistics from a backtest are noise.
_MIN_BARS = 60


# --- signal generation ------------------------------------------------------
#
# A signal function maps an OHLCV frame to a desired exposure per bar: 1.0 for
# long, 0.0 for flat. The value at bar t is the decision made from information
# available *at the close of* bar t. Converting that into an actual position is
# the engine's job, not the signal's -- which is what keeps the one-bar
# execution lag impossible to bypass.

SignalFn = Callable[[pd.DataFrame, int], pd.Series]


def _sma_crossover(frame: pd.DataFrame, period: int) -> pd.Series:
    """Long while price is above its own moving average."""
    average = ind.sma(frame["close"], period)
    return (frame["close"] > average).astype(float).where(average.notna())


def _rsi_reversion(frame: pd.DataFrame, period: int) -> pd.Series:
    """Long after RSI falls below 30, flat once it recovers above 55.

    Two thresholds rather than one: a single level makes the position flip on
    every small oscillation around it, which manufactures trades and costs.
    """
    rsi = ind.rsi(frame["close"], period)
    position = pd.Series(np.nan, index=frame.index, dtype=float)
    position[rsi < 30] = 1.0
    position[rsi > 55] = 0.0
    # Hold between thresholds; before the first trigger, flat.
    return position.ffill().fillna(0.0).where(rsi.notna())


def _macd_crossover(frame: pd.DataFrame, period: int) -> pd.Series:
    """Long while the MACD line is above its signal line."""
    result = ind.macd(frame["close"], fast=period, slow=period * 2, signal=9)
    histogram = result.histogram
    return (histogram > 0).astype(float).where(histogram.notna())


def _buy_and_hold(frame: pd.DataFrame, period: int) -> pd.Series:
    """The benchmark: fully invested from the first bar, never trading."""
    return pd.Series(1.0, index=frame.index)


@dataclass(frozen=True)
class Strategy:
    key: str
    name: str
    description: str
    signal: SignalFn
    """Parameter values to search over. Buy-and-hold has none."""
    parameter_grid: tuple[int, ...]
    parameter_label: str


STRATEGIES: dict[str, Strategy] = {
    "buy_and_hold": Strategy(
        key="buy_and_hold",
        name="Buy and hold",
        description="Buy at the start of the period and never sell.",
        signal=_buy_and_hold,
        parameter_grid=(0,),
        parameter_label="none",
    ),
    "sma_crossover": Strategy(
        key="sma_crossover",
        name="Price above moving average",
        description=(
            "Hold the stock whenever its price is above its own moving average, "
            "and sit in cash otherwise."
        ),
        signal=_sma_crossover,
        parameter_grid=(20, 50, 100, 200),
        parameter_label="moving average length",
    ),
    "rsi_reversion": Strategy(
        key="rsi_reversion",
        name="Buy when RSI is low",
        description=(
            "Buy after RSI drops below 30 (conventionally 'oversold') and sell "
            "once it recovers above 55."
        ),
        signal=_rsi_reversion,
        parameter_grid=(7, 14, 21),
        parameter_label="RSI length",
    ),
    "macd_crossover": Strategy(
        key="macd_crossover",
        name="MACD above its signal line",
        description="Hold the stock whenever the MACD line is above its signal line.",
        signal=_macd_crossover,
        parameter_grid=(8, 12, 16),
        parameter_label="fast EMA length",
    ),
}


# --- engine -----------------------------------------------------------------


@dataclass(frozen=True)
class BacktestResult:
    strategy_key: str
    strategy_name: str
    parameter: int
    bars: int
    total_return: float
    annualized_return: float
    annualized_volatility: float
    sharpe_ratio: float
    max_drawdown: float
    trades: int
    win_rate: float | None
    """Fraction of time holding the stock rather than cash."""
    exposure: float
    cost_bps: float
    """Total drag from transaction costs, as a fraction of starting capital."""
    cost_drag: float
    equity_curve: list[float] = field(default_factory=list)
    dates: list[str] = field(default_factory=list)


def run_backtest(
    frame: pd.DataFrame,
    strategy: Strategy,
    parameter: int,
    *,
    cost_bps: float = DEFAULT_COST_BPS,
    frequency: str = "daily",
    include_curve: bool = False,
) -> BacktestResult:
    """Run one rule over one price series.

    Positions are shifted one bar after the signal, so a decision made from the
    close of bar *t* takes effect at bar *t+1*. This is the difference between a
    backtest and a fantasy.
    """
    if "close" not in frame.columns:
        raise KeyError("frame must contain a 'close' column")
    if len(frame) < _MIN_BARS:
        raise ValueError(f"need at least {_MIN_BARS} bars to backtest, got {len(frame)}")
    if cost_bps < 0:
        raise ValueError(f"cost_bps must be >= 0, got {cost_bps}")

    close = frame["close"].astype(float)
    bar_returns = close.pct_change().fillna(0.0)

    raw_signal = strategy.signal(frame, parameter).fillna(0.0).clip(0.0, 1.0)

    # THE critical line. Acting on a signal in the same bar that produced it
    # would mean trading on a close you could not have known until it printed.
    position = raw_signal.shift(1).fillna(0.0)

    # A cost is charged whenever exposure changes, proportional to the change.
    turnover = position.diff().abs().fillna(position.abs())
    costs = turnover * (cost_bps / 10_000.0)

    strategy_returns = position * bar_returns - costs
    equity = (1.0 + strategy_returns).cumprod()

    periods = risk.annualization_factor(frequency)
    total_return = float(equity.iloc[-1] - 1.0)
    years = len(strategy_returns) / periods
    grew = years > 0 and equity.iloc[-1] > 0
    annualized = float(equity.iloc[-1] ** (1 / years) - 1.0) if grew else -1.0

    volatility = (
        float(strategy_returns.std(ddof=1) * np.sqrt(periods))
        if len(strategy_returns) > 1
        else float("nan")
    )
    sharpe = (
        float(strategy_returns.mean() / strategy_returns.std(ddof=1) * np.sqrt(periods))
        if strategy_returns.std(ddof=1) > 0
        else float("nan")
    )

    # A "trade" is an entry: a transition from flat into the position.
    entries = (position.diff() > 0).sum()
    win_rate = _win_rate(position, bar_returns)

    return BacktestResult(
        strategy_key=strategy.key,
        strategy_name=strategy.name,
        parameter=parameter,
        bars=len(frame),
        total_return=round(total_return, 6),
        annualized_return=round(annualized, 6),
        annualized_volatility=round(volatility, 6) if volatility == volatility else float("nan"),
        sharpe_ratio=round(sharpe, 4) if sharpe == sharpe else float("nan"),
        max_drawdown=round(float(risk.drawdown_series(equity).min()), 6),
        trades=int(entries),
        win_rate=win_rate,
        exposure=round(float(position.mean()), 4),
        cost_bps=cost_bps,
        cost_drag=round(float(costs.sum()), 6),
        equity_curve=[round(float(v), 6) for v in equity] if include_curve else [],
        dates=[str(i) for i in frame.index] if include_curve else [],
    )


def _win_rate(position: pd.Series, bar_returns: pd.Series) -> float | None:
    """Fraction of completed holding periods that ended profitable."""
    holdings: list[float] = []
    current: float | None = None

    for held, bar_return in zip(position.to_numpy(), bar_returns.to_numpy(), strict=True):
        if held > 0:
            current = bar_return if current is None else (1 + current) * (1 + bar_return) - 1
        elif current is not None:
            holdings.append(current)
            current = None
    if current is not None:
        holdings.append(current)

    if not holdings:
        return None
    return round(sum(1 for h in holdings if h > 0) / len(holdings), 4)


# --- out-of-sample validation ----------------------------------------------


@dataclass(frozen=True)
class WalkForwardResult:
    strategy_key: str
    strategy_name: str
    parameter_label: str
    chosen_parameter: int
    parameters_tried: int
    in_sample: BacktestResult
    out_of_sample: BacktestResult
    benchmark_out_of_sample: BacktestResult
    """out-of-sample return minus buy-and-hold over the same slice."""
    excess_return: float
    beat_benchmark: bool
    """How much of the in-sample edge survived. Usually very little."""
    degradation: float
    split_date: str
    verdict: str


def walk_forward(
    frame: pd.DataFrame,
    strategy: Strategy,
    *,
    train_fraction: float = 0.6,
    cost_bps: float = DEFAULT_COST_BPS,
    frequency: str = "daily",
) -> WalkForwardResult:
    """Pick the best parameter on an early slice; report the untouched later one.

    This is the only number in the project that deserves to be called
    "validated out-of-sample performance". The in-sample figure is reported
    beside it precisely so the gap between them is visible — that gap is the
    lesson, and it is usually large.
    """
    if not 0.2 <= train_fraction <= 0.8:
        raise ValueError(f"train_fraction must be between 0.2 and 0.8, got {train_fraction}")
    if len(frame) < _MIN_BARS * 2:
        raise ValueError(
            f"need at least {_MIN_BARS * 2} bars to split into train and test, got {len(frame)}"
        )

    split = int(len(frame) * train_fraction)
    train, test = frame.iloc[:split], frame.iloc[split:]

    # Choose on the training slice only. The test slice is not consulted.
    best: BacktestResult | None = None
    for candidate in strategy.parameter_grid:
        try:
            result = run_backtest(
                train, strategy, candidate, cost_bps=cost_bps, frequency=frequency
            )
        except ValueError:
            continue  # parameter needs more history than the training slice has
        if best is None or result.sharpe_ratio > best.sharpe_ratio:
            best = result

    if best is None:
        raise ValueError("no parameter could be evaluated on the training window")

    out_of_sample = run_backtest(
        test, strategy, best.parameter, cost_bps=cost_bps, frequency=frequency
    )
    benchmark = run_backtest(
        test, STRATEGIES["buy_and_hold"], 0, cost_bps=cost_bps, frequency=frequency
    )

    excess = out_of_sample.total_return - benchmark.total_return
    degradation = out_of_sample.total_return - best.total_return

    return WalkForwardResult(
        strategy_key=strategy.key,
        strategy_name=strategy.name,
        parameter_label=strategy.parameter_label,
        chosen_parameter=best.parameter,
        parameters_tried=len(strategy.parameter_grid),
        in_sample=best,
        out_of_sample=out_of_sample,
        benchmark_out_of_sample=benchmark,
        excess_return=round(excess, 6),
        beat_benchmark=bool(excess > 0),
        degradation=round(degradation, 6),
        split_date=str(frame.index[split]),
        verdict=_verdict(strategy, excess, degradation),
    )


def _verdict(strategy: Strategy, excess: float, degradation: float) -> str:
    """Plain-English reading of the result. Describes history; predicts nothing."""
    if strategy.key == "buy_and_hold":
        return (
            "This is the benchmark every other rule is measured against, not a rule itself."
        )

    if excess > 0:
        lead = (
            f"Over this out-of-sample window the rule finished {abs(excess) * 100:.1f} "
            "percentage points ahead of simply buying and holding."
        )
        caution = (
            " One window on one stock is a very small sample, and several parameter "
            "values were tried before this one was chosen — some of that lead is likely "
            "luck rather than skill."
        )
    else:
        lead = (
            f"Over this out-of-sample window the rule finished {abs(excess) * 100:.1f} "
            "percentage points behind simply buying and holding."
        )
        caution = (
            " That is the usual outcome. Trading rules give up returns to transaction "
            "costs and to being out of the market on days it rises."
        )

    if degradation < -0.05:
        caution += (
            f" It also performed {abs(degradation) * 100:.1f} percentage points worse than "
            "it had on the earlier data used to pick its settings, which is what "
            "over-fitting looks like."
        )

    return lead + caution


def compare_strategies(
    frame: pd.DataFrame,
    *,
    train_fraction: float = 0.6,
    cost_bps: float = DEFAULT_COST_BPS,
    frequency: str = "daily",
) -> list[WalkForwardResult]:
    """Walk-forward every rule, including the benchmark.

    Returns all of them, never just the winner. Reporting only the best of
    several rules is how backtests come to promise things they cannot deliver.
    """
    results: list[WalkForwardResult] = []
    for strategy in STRATEGIES.values():
        try:
            results.append(
                walk_forward(
                    frame,
                    strategy,
                    train_fraction=train_fraction,
                    cost_bps=cost_bps,
                    frequency=frequency,
                )
            )
        except ValueError:
            continue  # not enough history for this rule; omit rather than guess
    return results
