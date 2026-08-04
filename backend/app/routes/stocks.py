"""Stock data endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.schemas import ErrorResponse, Quote, Range
from app.services.market_data import MarketDataError, get_quote

router = APIRouter(prefix="/stocks", tags=["stocks"])


@router.get(
    "/{ticker}",
    response_model=Quote,
    summary="Get a quote and price history for a ticker",
    responses={
        400: {"model": ErrorResponse, "description": "Invalid ticker symbol"},
        404: {"model": ErrorResponse, "description": "No data for that ticker"},
        502: {"model": ErrorResponse, "description": "Upstream data provider failed"},
    },
)
async def read_stock(
    ticker: str,
    range: Range = Query(  # noqa: A002 - `range` is the established query name
        default=Range.MONTH_1,
        description="Chart range. Determines both the period and the candle interval.",
    ),
) -> Quote:
    """Return the latest quote plus historical candles.

    Responses are cached briefly server-side; the upstream provider is
    rate-limited and identical requests would otherwise exhaust it.
    """
    try:
        return await get_quote(ticker, range)
    except MarketDataError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
