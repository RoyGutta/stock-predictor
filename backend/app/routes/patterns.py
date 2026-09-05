"""Historical pattern detection endpoint.

Reports when well-known technical events occurred in a ticker's history, with
the values at each moment and what historically followed similar events. It
answers "what happened?", never "what will happen?".
"""

from __future__ import annotations

import asyncio
from dataclasses import asdict

from fastapi import APIRouter, HTTPException, Query

from app.analytics.patterns import detect_patterns
from app.routes.analysis import _to_frame
from app.schemas import (
    ErrorResponse,
    PatternEventOut,
    PatternOutcomesOut,
    PatternsResponse,
    PatternSummaryOut,
    Range,
)
from app.services.market_data import MarketDataError, get_quote

router = APIRouter(prefix="/stocks", tags=["patterns"])

METHOD = (
    "Every event is detected using only bars at or before its own date: rolling "
    "statistics trail, baselines end one bar earlier, and a guard test mutates all "
    "future bars to prove past detections cannot change. Outcome tables then report "
    "what actually followed each event over 5, 20, and 60 later bars -- future bars "
    "are used only to describe history, never to decide that an event occurred. "
    "Events too close to the end of the data are excluded from a window and counted."
)

DISCLAIMER = (
    "These are descriptions of past market behavior, not signals and not forecasts. "
    "A pattern that was followed by gains in this history carries no promise of "
    "repeating, and small samples -- which are flagged wherever they occur -- can look "
    "meaningful purely by chance."
)


@router.get(
    "/{ticker}/patterns",
    response_model=PatternsResponse,
    summary="Historical technical pattern events and what followed them",
    responses={
        400: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        502: {"model": ErrorResponse},
    },
)
async def read_patterns(
    ticker: str,
    range: Range = Query(default=Range.YEAR_5),  # noqa: A002
) -> PatternsResponse:
    """Detect pattern events across the requested window.

    Insufficient history returns an honest empty report with the reason, not an
    error and not a thin answer dressed up as a full one.
    """
    try:
        quote = await get_quote(ticker, range)
    except MarketDataError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    frame = _to_frame(quote.history)
    report = await asyncio.to_thread(detect_patterns, frame)

    return PatternsResponse(
        ticker=quote.ticker,
        company_name=quote.company_name,
        range=range,
        bars=report.bars,
        start_date=report.start_date,
        end_date=report.end_date,
        events=[
            PatternEventOut(**{k: v for k, v in asdict(event).items() if k != "index"})
            for event in report.events
        ],
        summaries=[
            PatternSummaryOut(
                pattern=summary.pattern,
                label=summary.label,
                definition=summary.definition,
                caveat=summary.caveat,
                occurrences=summary.occurrences,
                outcomes=[PatternOutcomesOut(**asdict(o)) for o in summary.outcomes],
            )
            for summary in report.summaries
        ],
        insufficient=report.insufficient,
        note=report.note,
        method=METHOD,
        disclaimer=DISCLAIMER,
    )
