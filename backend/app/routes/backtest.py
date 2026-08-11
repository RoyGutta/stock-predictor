"""Backtesting endpoint.

Answers "how would this rule have done on data it was never tuned on?" — a
question about history. It does not forecast and returns no signal to act on.
"""

from __future__ import annotations

import asyncio

import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from app.analytics import backtest as bt
from app.routes.analysis import _to_frame
from app.schemas import (
    BacktestMetrics,
    BacktestResponse,
    ErrorResponse,
    Range,
    StrategyResult,
)
from app.services.market_data import MarketDataError, get_quote

router = APIRouter(prefix="/stocks", tags=["backtest"])

_FREQUENCY_BY_RANGE: dict[Range, str] = {Range.YEAR_5: "weekly", Range.MAX: "monthly"}

# Two slices of at least 60 bars each, or the statistics are noise.
_MIN_BARS = 120

METHOD = (
    "Walk-forward validation. Each rule's parameter is chosen using only the earlier "
    "portion of the history, then evaluated once on the later portion, which was not "
    "consulted during selection. Positions are entered one bar after the signal, so no "
    "rule can trade on information it would not have had. Transaction costs are charged "
    "on every position change."
)

DISCLAIMER = (
    "This is a historical exercise, not a strategy recommendation and not a prediction. "
    "It covers one stock over one window, and several parameter values were tried before "
    "one was selected — so any apparent edge may be luck. Rules that beat buy-and-hold in "
    "a backtest routinely fail afterwards. Nothing here should be traded on."
)


def _to_metrics(result: bt.BacktestResult) -> BacktestMetrics:
    def clean(value: float) -> float | None:
        return None if pd.isna(value) else float(value)

    return BacktestMetrics(
        strategy_key=result.strategy_key,
        strategy_name=result.strategy_name,
        parameter=result.parameter,
        bars=result.bars,
        total_return=result.total_return,
        annualized_return=result.annualized_return,
        annualized_volatility=clean(result.annualized_volatility),
        sharpe_ratio=clean(result.sharpe_ratio),
        max_drawdown=result.max_drawdown,
        trades=result.trades,
        win_rate=result.win_rate,
        exposure=result.exposure,
        cost_bps=result.cost_bps,
        cost_drag=result.cost_drag,
    )


@router.get(
    "/{ticker}/backtest",
    response_model=BacktestResponse,
    summary="Walk-forward backtest of common indicator rules",
    responses={
        400: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        422: {"model": ErrorResponse, "description": "Not enough history to split"},
        502: {"model": ErrorResponse},
    },
)
async def read_backtest(
    ticker: str,
    range: Range = Query(default=Range.YEAR_5),  # noqa: A002
    train_fraction: float = Query(
        default=0.6,
        ge=0.2,
        le=0.8,
        description="Share of history used to choose parameters. The rest is held out.",
    ),
    cost_bps: float = Query(
        default=bt.DEFAULT_COST_BPS,
        ge=0,
        le=200,
        description="Transaction cost per position change, in basis points.",
    ),
) -> BacktestResponse:
    """Backtest every built-in rule and report all of them.

    Every rule is returned, never just the best one: presenting the winner of
    several attempts is how backtests come to promise things they cannot deliver.
    """
    try:
        quote = await get_quote(ticker, range)
    except MarketDataError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    frame = _to_frame(quote.history)
    if len(frame) < _MIN_BARS:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Backtesting needs at least {_MIN_BARS} bars so both the training and "
                f"held-out periods are meaningful; this range has {len(frame)}. "
                "Try a longer range."
            ),
        )

    frequency = _FREQUENCY_BY_RANGE.get(range, "daily")

    # CPU-bound over the whole series for every rule and parameter; keep it off
    # the event loop so one request cannot stall other clients.
    results = await asyncio.to_thread(
        bt.compare_strategies,
        frame,
        train_fraction=train_fraction,
        cost_bps=cost_bps,
        frequency=frequency,
    )

    if not results:
        raise HTTPException(
            status_code=422,
            detail="No rule could be evaluated over this history. Try a longer range.",
        )

    strategies = [
        StrategyResult(
            strategy_key=result.strategy_key,
            strategy_name=result.strategy_name,
            description=bt.STRATEGIES[result.strategy_key].description,
            parameter_label=result.parameter_label,
            chosen_parameter=result.chosen_parameter,
            parameters_tried=result.parameters_tried,
            in_sample=_to_metrics(result.in_sample),
            out_of_sample=_to_metrics(result.out_of_sample),
            benchmark_out_of_sample=_to_metrics(result.benchmark_out_of_sample),
            excess_return=result.excess_return,
            beat_benchmark=result.beat_benchmark,
            degradation=result.degradation,
            verdict=result.verdict,
        )
        for result in results
    ]

    return BacktestResponse(
        ticker=quote.ticker,
        company_name=quote.company_name,
        range=range,
        bars=len(frame),
        split_date=results[0].split_date,
        train_fraction=train_fraction,
        cost_bps=cost_bps,
        strategies=strategies,
        strategies_beating_benchmark=sum(
            1 for s in strategies if s.beat_benchmark and s.strategy_key != "buy_and_hold"
        ),
        method=METHOD,
        disclaimer=DISCLAIMER,
    )
