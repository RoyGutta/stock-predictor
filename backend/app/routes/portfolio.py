"""Hypothetical portfolio simulation endpoint.

Replays a fixed-weight purchase plan over real historical prices and reports it
beside the identical cash flows into a benchmark. Historical replay only; the
response never projects forward and never recommends an allocation.
"""

from __future__ import annotations

import asyncio

import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from app.analytics import portfolio as pf
from app.schemas import (
    ErrorResponse,
    PortfolioLeg,
    PortfolioSimulationOut,
    PortfolioSimulationResponse,
    PortfolioStats,
    Range,
)
from app.services.market_data import MarketDataError, get_quote, normalize_ticker

router = APIRouter(prefix="/portfolio", tags=["portfolio"])

_MAX_LEGS = 8
_FREQUENCY_BY_RANGE: dict[Range, str] = {Range.YEAR_5: "weekly", Range.MAX: "monthly"}

METHOD = (
    "Hypothetical historical replay. The initial amount is invested at the first "
    "price bar shared by every holding, split by the target weights; optional "
    "monthly contributions are invested the same way at the first shared bar "
    "of each later month. Bars are daily up to 1Y, weekly for 5Y, monthly for MAX. "
    "Holdings are never rebalanced. A proportional cost is "
    "charged on every purchase. Return and risk statistics are computed on the "
    "flow-adjusted (time-weighted) return series, so deposits are never counted as "
    "gains and cannot hide a drawdown. The benchmark receives the identical cash "
    "flows and is measured identically."
)

DISCLAIMER = (
    "Hypothetical historical simulation, not a projection and not advice. It shows "
    "what this exact mix would have done over one past window, for securities that "
    "survived to today. Past performance does not indicate future results."
)


def _parse_holdings(raw: str) -> tuple[dict[str, float], dict[str, str]]:
    """Parse 'AAPL:0.6,MSFT:0.4' into weights, collecting invalid entries."""
    weights: dict[str, float] = {}
    invalid: dict[str, str] = {}

    for part in (piece.strip() for piece in raw.split(",")):
        if not part:
            continue
        symbol_part, _, weight_part = part.partition(":")
        label = symbol_part.strip().upper()[:15] or "?"
        try:
            symbol = normalize_ticker(symbol_part)
        except MarketDataError as exc:
            invalid[label] = str(exc)
            continue
        try:
            weight = float(weight_part)
        except ValueError:
            invalid[label] = "Weight is missing or not a number. Use TICKER:WEIGHT."
            continue
        if symbol in weights:
            raise HTTPException(
                status_code=400, detail=f"{symbol} appears more than once in the holdings."
            )
        weights[symbol] = weight

    if len(weights) > _MAX_LEGS:
        raise HTTPException(
            status_code=400, detail=f"At most {_MAX_LEGS} holdings can be simulated at once."
        )
    return weights, invalid


def _to_out(result: pf.PortfolioSimulation) -> PortfolioSimulationOut:
    return PortfolioSimulationOut(
        bars=result.bars,
        start_date=result.start_date,
        end_date=result.end_date,
        initial_investment=result.initial_investment,
        monthly_contribution=result.monthly_contribution,
        contribution_count=result.contribution_count,
        total_contributed=result.total_contributed,
        ending_value=result.ending_value,
        cost_paid=result.cost_paid,
        stats=PortfolioStats(
            total_return=result.total_return,
            annualized_return=result.annualized_return,
            annualized_volatility=result.annualized_volatility,
            sharpe_ratio=result.sharpe_ratio,
            max_drawdown=result.max_drawdown,
        ),
        largest_end_weight=result.largest_end_weight,
        dates=result.dates,
        values=result.values,
        growth_index=result.growth_index,
    )


def _closes(history: list) -> pd.Series:
    return pd.Series(
        [candle.price for candle in history],
        index=[candle.date for candle in history],
        dtype=float,
    )


@router.get(
    "/simulation",
    response_model=PortfolioSimulationResponse,
    summary="Hypothetical historical simulation of a fixed-weight portfolio",
    responses={
        400: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        422: {"model": ErrorResponse, "description": "Not enough shared history"},
        502: {"model": ErrorResponse},
    },
)
async def read_portfolio_simulation(
    holdings: str = Query(
        min_length=3,
        max_length=200,
        description="Comma-separated TICKER:WEIGHT pairs, weights summing to 1. "
        "Example: AAPL:0.5,MSFT:0.3,VOO:0.2",
    ),
    range: Range = Query(default=Range.YEAR_5),  # noqa: A002
    initial: float = Query(default=10_000, gt=0, le=100_000_000),
    monthly: float = Query(default=0, ge=0, le=10_000_000),
    cost_bps: float = Query(default=pf.DEFAULT_COST_BPS, ge=0, le=200),
    benchmark: str = Query(default="SPY", min_length=1, max_length=15),
) -> PortfolioSimulationResponse:
    """Simulate the portfolio and the same cash flows into a benchmark.

    Both legs use identical methodology, so the comparison is like for like.
    """
    weights, invalid = _parse_holdings(holdings)
    if not weights:
        raise HTTPException(
            status_code=400,
            detail="No valid holdings. Use TICKER:WEIGHT pairs such as AAPL:0.6,MSFT:0.4."
            + (f" Rejected: {', '.join(invalid)}." if invalid else ""),
        )
    if abs(sum(weights.values()) - 1.0) > pf.WEIGHT_SUM_TOLERANCE:
        raise HTTPException(
            status_code=400,
            detail=f"Weights must sum to 1.0; these sum to {sum(weights.values()):.4f}.",
        )

    try:
        benchmark_symbol = normalize_ticker(benchmark)
    except MarketDataError as exc:
        raise HTTPException(status_code=400, detail=f"Benchmark: {exc}") from exc

    tickers = list(weights)
    try:
        quotes = await asyncio.gather(
            *(get_quote(symbol, range) for symbol in [*tickers, benchmark_symbol])
        )
    except MarketDataError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    prices = {ticker: _closes(quotes[i].history) for i, ticker in enumerate(tickers)}
    benchmark_prices = {benchmark_symbol: _closes(quotes[len(tickers)].history)}

    frequency = _FREQUENCY_BY_RANGE.get(range, "daily")
    keywords = {
        "initial": initial,
        "monthly": monthly,
        "cost_bps": cost_bps,
        "frequency": frequency,
    }

    try:
        result, benchmark_result = await asyncio.gather(
            asyncio.to_thread(pf.simulate_portfolio, prices, weights, **keywords),
            asyncio.to_thread(
                pf.simulate_portfolio, benchmark_prices, {benchmark_symbol: 1.0}, **keywords
            ),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return PortfolioSimulationResponse(
        legs=[
            PortfolioLeg(
                ticker=ticker,
                weight=result.weights[ticker],
                end_weight=result.end_weights[ticker],
            )
            for ticker in result.tickers
        ],
        portfolio=_to_out(result),
        benchmark_ticker=benchmark_symbol,
        benchmark=_to_out(benchmark_result),
        excess_return=round(result.total_return - benchmark_result.total_return, 6),
        invalid_tickers=invalid,
        cost_bps=cost_bps,
        range=range,
        source=quotes[0].source,
        method=METHOD,
        disclaimer=DISCLAIMER,
    )
