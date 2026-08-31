"""Side-by-side comparison of securities' historical characteristics.

Composes the existing risk and momentum analytics per ticker over one shared
window. Deliberately returns no ranking and no winner: the response presents
the same historical measurements for each security and leaves the judgment --
and the reminder that history is not a forecast -- visible.
"""

from __future__ import annotations

import asyncio
import logging

import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from app.analytics import momentum, risk
from app.routes.analysis import _to_frame
from app.routes.simulation import _parse_tickers
from app.schemas import CompareResponse, CompareRow, ErrorResponse, Range
from app.services.market_data import MarketDataError, get_quote

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/market", tags=["market"])

_MIN_TICKERS = 2
_MAX_TICKERS = 6
# Below this, annualized statistics are noise. Momentum defines its own
# sufficiency rules and reports "insufficient" through its own state.
_MIN_BARS_FOR_STATS = 30

_FREQUENCY_BY_RANGE: dict[Range, str] = {Range.YEAR_5: "weekly", Range.MAX: "monthly"}

NOTE = (
    "Each column is measured over the same window with the same method. Differences "
    "describe how these securities behaved historically -- not which one to pick."
)

DISCLAIMER = (
    "Historical characteristics over one window. They change with the window, and "
    "none of them predict future behavior."
)


def _clean(value: float) -> float | None:
    return None if pd.isna(value) else round(float(value), 6)


def _build_row(ticker: str, quote: object, frequency: str) -> CompareRow:
    frame = _to_frame(quote.history)  # type: ignore[attr-defined]
    close = frame["close"]

    row = CompareRow(
        ticker=ticker,
        company_name=getattr(quote, "company_name", None),
        price=getattr(quote, "price", None),
        change_percent=getattr(quote, "change_percent", None),
        annualized_return=None,
        annualized_volatility=None,
        sharpe_ratio=None,
        sortino_ratio=None,
        max_drawdown=None,
        bars=len(frame),
    )

    if len(close) >= _MIN_BARS_FOR_STATS:
        returns = risk.simple_returns(close)
        row.annualized_return = _clean(risk.annualized_return(returns, frequency))
        row.annualized_volatility = _clean(risk.annualized_volatility(returns, frequency))
        row.sharpe_ratio = _clean(risk.sharpe_ratio(returns, frequency=frequency))
        row.sortino_ratio = _clean(risk.sortino_ratio(returns, frequency=frequency))
        row.max_drawdown = _clean(risk.max_drawdown(close).max_drawdown)

    reading = momentum.assess(frame)
    row.momentum_state = reading.state.value
    row.momentum_score = reading.score
    row.momentum_total = reading.total
    return row


@router.get(
    "/compare",
    response_model=CompareResponse,
    summary="Historical characteristics of several securities, side by side",
    responses={400: {"model": ErrorResponse}, 502: {"model": ErrorResponse}},
)
async def read_compare(
    tickers: str = Query(
        min_length=3,
        max_length=120,
        description="Comma-separated symbols, 2-6. Example: AAPL,MSFT,VOO",
    ),
    range: Range = Query(default=Range.YEAR_1),  # noqa: A002
) -> CompareResponse:
    """Measure each security over the same window with the same method.

    Failed tickers are reported in `unavailable` with the reason rather than
    silently dropped, so a missing column is always explained.
    """
    requested, invalid = _parse_tickers(tickers, _MAX_TICKERS)

    async def fetch(symbol: str) -> tuple[str, object | Exception]:
        try:
            return symbol, await get_quote(symbol, range)
        except MarketDataError as exc:
            return symbol, exc

    results = await asyncio.gather(*(fetch(symbol) for symbol in requested))

    frequency = _FREQUENCY_BY_RANGE.get(range, "daily")
    rows: list[CompareRow] = []
    unavailable: dict[str, str] = dict(invalid)
    source = "unknown"

    for symbol, outcome in results:
        if isinstance(outcome, Exception):
            unavailable[symbol] = str(outcome)
            continue
        source = getattr(outcome, "source", source)
        try:
            rows.append(await asyncio.to_thread(_build_row, symbol, outcome, frequency))
        except Exception:
            logger.exception("Comparison row failed for %s", symbol)
            unavailable[symbol] = "Could not compute statistics for this security."

    if len(rows) < _MIN_TICKERS:
        problems = "; ".join(f"{key}: {value}" for key, value in unavailable.items())
        raise HTTPException(
            status_code=400,
            detail=(
                f"A comparison needs at least {_MIN_TICKERS} readable securities."
                + (f" Problems: {problems}" if problems else "")
            ),
        )

    return CompareResponse(
        rows=rows,
        range=range,
        frequency=frequency,
        unavailable=unavailable,
        source=source,
        note=NOTE,
        disclaimer=DISCLAIMER,
    )
