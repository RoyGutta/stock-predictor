"""Scenario dispersion and cross-asset correlation.

Both endpoints answer questions about *spread*, never about direction.

The simulation endpoint resamples an asset's own historical returns to show how
wide the range of outcomes would be if the future resembled that past. That
premise fails during regime changes and cannot contain a shock larger than any
in the sample, so the disclaimer travels inside the payload rather than living
only in the UI where a caller could drop it.
"""

from __future__ import annotations

import asyncio
import logging

import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from app.analytics import risk
from app.routes.analysis import _to_frame
from app.schemas import (
    CorrelationResponse,
    ErrorResponse,
    Range,
    SimulationResponse,
)
from app.services.market_data import MarketDataError, get_quote, normalize_ticker

logger = logging.getLogger(__name__)

router = APIRouter(tags=["simulation"])

# `monte_carlo` needs 30 return observations to resample; require the same here
# so the failure is a clear 422 rather than a ValueError from deep in analytics.
_MIN_BARS_FOR_SIMULATION = 31

# Correlation over fewer than two assets is not a matrix.
_MIN_TICKERS = 2
_MAX_TICKERS = 8


@router.get(
    "/stocks/{ticker}/simulation",
    response_model=SimulationResponse,
    summary="Bootstrapped dispersion of outcomes (not a forecast)",
    responses={
        400: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        422: {"model": ErrorResponse, "description": "Not enough history to resample"},
        502: {"model": ErrorResponse},
    },
)
async def read_simulation(
    ticker: str,
    range: Range = Query(default=Range.YEAR_1),  # noqa: A002
    horizon_days: int = Query(
        default=252, ge=1, le=1260, description="Bars to project forward. 252 ~ one trading year."
    ),
    simulations: int = Query(
        default=5_000, ge=100, le=20_000, description="Number of paths to resample."
    ),
    seed: int | None = Query(
        default=None, description="Fix for a reproducible result. Omit for a fresh draw."
    ),
) -> SimulationResponse:
    """Resample this asset's own returns to show the width of the outcome range.

    **This is not a price forecast.** It answers a narrower question: if future
    returns were drawn from the same distribution as this sample, how far apart
    would the best and worst cases be? Read it for dispersion, never as a
    probability that any particular price will be reached.
    """
    try:
        quote = await get_quote(ticker, range)
    except MarketDataError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    close = _to_frame(quote.history)["close"]
    if len(close) < _MIN_BARS_FOR_SIMULATION:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Simulating needs at least {_MIN_BARS_FOR_SIMULATION} bars of history to "
                f"resample from; this range has {len(close)}. Try a longer range."
            ),
        )

    # Resampling thousands of paths is CPU-bound; keep it off the event loop.
    result = await asyncio.to_thread(
        risk.monte_carlo, close, horizon_days, simulations, seed
    )

    return SimulationResponse(
        ticker=quote.ticker,
        company_name=quote.company_name,
        range=range,
        start_price=round(float(close.iloc[-1]), 4),
        horizon_days=result.horizon_days,
        simulations=result.simulations,
        percentiles={key: round(value, 4) for key, value in result.percentiles.items()},
        probability_of_loss=round(result.probability_of_loss, 4),
        observations=len(risk.log_returns(close)),
        method=result.method,
        disclaimer=result.disclaimer,
    )


CORRELATION_NOTE = (
    "Correlation is computed on returns, not on price levels. Two unrelated stocks that "
    "both drifted upward would look almost identical if levels were used. A value near 1 "
    "means the two moved together over this window; near 0 means they moved independently; "
    "negative means they tended to move opposite. This describes one past window and "
    "correlations shift — most notably, they tend toward 1 during a crash, which is exactly "
    "when diversification is being relied upon."
)


@router.get(
    "/market/correlation",
    response_model=CorrelationResponse,
    summary="Pairwise return correlation between tickers",
    responses={
        400: {"model": ErrorResponse},
        422: {"model": ErrorResponse, "description": "Too few resolvable tickers"},
        502: {"model": ErrorResponse},
    },
)
async def read_correlation(
    tickers: str = Query(
        min_length=1,
        max_length=120,
        description=f"Comma-separated, {_MIN_TICKERS}-{_MAX_TICKERS} symbols.",
    ),
    range: Range = Query(default=Range.YEAR_1),  # noqa: A002
) -> CorrelationResponse:
    """Correlation matrix for a small basket.

    Tickers that cannot be loaded are reported in `unavailable` and left out of
    the matrix rather than silently dropped or filled with a placeholder value.
    """
    requested: list[str] = []
    invalid: dict[str, str] = {}
    for raw in tickers.split(","):
        candidate = raw.strip()
        if not candidate:
            continue
        try:
            symbol = normalize_ticker(candidate)
        except MarketDataError as exc:
            invalid[candidate.upper()[:15]] = str(exc)
            continue
        if symbol not in requested:
            requested.append(symbol)

    if len(requested) > _MAX_TICKERS:
        raise HTTPException(
            status_code=400,
            detail=f"At most {_MAX_TICKERS} tickers can be compared at once.",
        )

    results = await asyncio.gather(
        *(get_quote(symbol, range) for symbol in requested), return_exceptions=True
    )

    closes: dict[str, pd.Series] = {}
    names: dict[str, str] = {}
    unavailable = dict(invalid)
    for symbol, result in zip(requested, results, strict=True):
        if isinstance(result, MarketDataError):
            unavailable[symbol] = str(result)
        elif isinstance(result, BaseException):
            logger.exception("Unexpected failure loading %s for correlation", symbol)
            unavailable[symbol] = "Could not load this ticker."
        else:
            closes[symbol] = _to_frame(result.history)["close"]
            names[symbol] = result.company_name

    if len(closes) < _MIN_TICKERS:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Correlation needs at least {_MIN_TICKERS} tickers with usable history; "
                f"{len(closes)} resolved. "
                + (f"Could not load: {', '.join(sorted(unavailable))}." if unavailable else "")
            ),
        )

    resolved = list(closes)
    # Inner join on date: mismatched calendars must align, not silently offset.
    # Duplicate timestamps are collapsed first, since a label join raises on them.
    price_frame = pd.concat(
        [risk.collapse_duplicate_index(closes[s]).rename(s) for s in resolved],
        axis=1,
        join="inner",
    ).dropna()
    matrix_frame = await asyncio.to_thread(risk.correlation_matrix, price_frame)

    def cell(value: object) -> float | None:
        return None if pd.isna(value) else round(float(value), 4)

    return CorrelationResponse(
        tickers=resolved,
        range=range,
        matrix=[[cell(matrix_frame.loc[row, col]) for col in resolved] for row in resolved],
        observations=max(len(price_frame) - 1, 0),
        resolved=names,
        unavailable=unavailable,
        note=CORRELATION_NOTE,
    )
