"""Market-wide endpoints: movers, sectors, status, news, search, and profiles."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.config import get_settings
from app.schemas import (
    CapabilityStatus,
    CompanyProfile,
    ErrorResponse,
    MarketStatus,
    MoversResponse,
    NewsResponse,
    SearchResult,
    SectorPerformance,
)
from app.services import market
from app.services.market_data import MarketDataError, normalize_ticker
from app.services.providers.base import ProviderError

router = APIRouter(prefix="/market", tags=["market"])

_PROVIDER_RESPONSES = {
    429: {"model": ErrorResponse, "description": "Provider rate limit reached"},
    501: {"model": ErrorResponse, "description": "Not available on the provider's free tier"},
    502: {"model": ErrorResponse, "description": "Provider failed"},
    503: {"model": ErrorResponse, "description": "No API key configured for this feature"},
}

MOVERS_DISCLAIMER = (
    "These are today's largest percentage moves, not recommendations. Such lists are "
    "usually dominated by very small companies trading under $5, whose prices swing "
    "easily and which are the most common targets of promotional schemes — those rows "
    "are marked. A large move most often reflects news that is already in the price."
)

NEWS_DISCLAIMER = (
    "Headlines are supplied by the news provider and are not verified, ranked, or "
    "summarised by this application. Their presence here is not a view on the story."
)


def _handle(exc: ProviderError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=str(exc))


@router.get("/status", response_model=MarketStatus, summary="US market session")
async def read_status() -> MarketStatus:
    """Current trading session.

    Derived from the published exchange calendar rather than a data provider, so
    it works with no API key.
    """
    return MarketStatus(**market.market_status())


@router.get(
    "/capabilities",
    response_model=CapabilityStatus,
    summary="Which data features this deployment can serve",
)
async def read_capabilities() -> CapabilityStatus:
    """Report configured capabilities so the UI can explain what is missing.

    Screener is reported false regardless of key: FMP serves it only on paid
    plans, and pretending otherwise would produce an error the user cannot fix.
    """
    settings = get_settings()
    notes: dict[str, str] = {}

    if not settings.has_fmp:
        notes["movers"] = "Add FMP_API_KEY to .env to enable."
        notes["sectors"] = "Add FMP_API_KEY to .env to enable."
        notes["fundamentals"] = "Add FMP_API_KEY to .env to enable."
    if not settings.has_finnhub:
        notes["news"] = "Add FINNHUB_API_KEY to .env to enable."
        notes["search"] = "Add FINNHUB_API_KEY to .env to enable."

    notes["screener"] = (
        "Financial Modeling Prep serves its screener only on paid plans. This feature "
        "stays disabled rather than showing made-up results."
    )

    return CapabilityStatus(
        movers=settings.has_fmp,
        sectors=settings.has_fmp,
        fundamentals=settings.has_fmp,
        news=settings.has_finnhub,
        search=settings.has_finnhub,
        screener=False,
        notes=notes,
    )


@router.get(
    "/movers",
    response_model=MoversResponse,
    summary="Top gainers, losers, and most active",
    responses=_PROVIDER_RESPONSES,
)
async def read_movers(limit: int = Query(default=10, ge=1, le=50)) -> MoversResponse:
    try:
        data = await market.get_movers(limit)
    except ProviderError as exc:
        raise _handle(exc) from exc

    return MoversResponse(
        gainers=data["gainers"],
        losers=data["losers"],
        actives=data["actives"],
        errors=data["errors"],
        source="Financial Modeling Prep",
        disclaimer=MOVERS_DISCLAIMER,
    )


@router.get(
    "/sectors",
    response_model=list[SectorPerformance],
    summary="Sector performance",
    responses=_PROVIDER_RESPONSES,
)
async def read_sectors() -> list[SectorPerformance]:
    try:
        return [SectorPerformance(**row) for row in await market.get_sectors()]
    except ProviderError as exc:
        raise _handle(exc) from exc


@router.get(
    "/search",
    response_model=list[SearchResult],
    summary="Ticker search",
    responses=_PROVIDER_RESPONSES,
)
async def read_search(
    q: str = Query(min_length=1, max_length=40, description="Company name or ticker"),
    limit: int = Query(default=10, ge=1, le=25),
) -> list[SearchResult]:
    try:
        return [SearchResult(**row) for row in await market.search(q, limit)]
    except ProviderError as exc:
        raise _handle(exc) from exc


@router.get(
    "/news/{ticker}",
    response_model=NewsResponse,
    summary="Recent company news",
    responses={**_PROVIDER_RESPONSES, 400: {"model": ErrorResponse}},
)
async def read_news(
    ticker: str,
    limit: int = Query(default=12, ge=1, le=50),
) -> NewsResponse:
    try:
        symbol = normalize_ticker(ticker)
        articles = await market.get_news(symbol, limit)
    except MarketDataError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except ProviderError as exc:
        raise _handle(exc) from exc

    return NewsResponse(
        ticker=symbol,
        articles=articles,
        source="Finnhub",
        disclaimer=NEWS_DISCLAIMER,
    )


@router.get(
    "/profile/{ticker}",
    response_model=CompanyProfile,
    summary="Company fundamentals",
    responses={**_PROVIDER_RESPONSES, 400: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
)
async def read_profile(ticker: str) -> CompanyProfile:
    try:
        symbol = normalize_ticker(ticker)
        profile = await market.get_profile(symbol)
    except MarketDataError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except ProviderError as exc:
        raise _handle(exc) from exc

    if profile is None:
        raise HTTPException(status_code=404, detail=f"No company profile found for '{symbol}'.")
    return CompanyProfile(**profile)
