"""SEC EDGAR endpoints: company lookup, recent filings, reported fundamentals.

Served in every deployment, including the public demo: SEC content is public
information that may be redistributed (sec.gov Privacy and Security Policy,
"Website Dissemination"). These endpoints never touch a market-price provider.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

from app.schemas import ErrorResponse
from app.schemas_sec import (
    AmbiguousResponse,
    FilingsResponse,
    FundamentalsResponse,
    SecSearchResponse,
)
from app.services.providers.base import ProviderError
from app.services.sec import service
from app.services.sec.companies import AmbiguousCompany
from app.services.sec.filings import REPORT_FORMS

router = APIRouter(prefix="/sec", tags=["sec"])

_RESPONSES: dict[int | str, dict[str, Any]] = {
    400: {"model": ErrorResponse, "description": "Invalid ticker, CIK, or name"},
    404: {"model": ErrorResponse, "description": "No SEC filer matches"},
    409: {"model": AmbiguousResponse, "description": "Name matches several filers"},
    429: {"model": ErrorResponse, "description": "SEC rate limit reached"},
    502: {"model": ErrorResponse, "description": "SEC unreachable or refused"},
    503: {"model": ErrorResponse, "description": "SEC_USER_AGENT not configured"},
}


def _respond_error(exc: ProviderError) -> JSONResponse:
    """409 carries the candidate filers; every other error is {detail}."""
    if isinstance(exc, AmbiguousCompany):
        body = AmbiguousResponse(
            detail=str(exc),
            candidates=[service.company_out(c) for c in exc.candidates],
        )
        return JSONResponse(status_code=409, content=body.model_dump())
    return JSONResponse(status_code=exc.status_code, content={"detail": str(exc)})


def _forms(value: str | None) -> set[str] | None:
    if not value:
        return None
    forms = {part.strip().upper() for part in value.split(",") if part.strip()}
    if not forms or forms - set(REPORT_FORMS):
        known = ", ".join(sorted(REPORT_FORMS))
        raise HTTPException(status_code=400, detail=f"Unsupported form type. Use any of: {known}.")
    return forms


@router.get(
    "/search",
    response_model=SecSearchResponse,
    summary="Find SEC filers by ticker or company name",
    responses=_RESPONSES,
)
async def read_search(
    q: str = Query(min_length=1, max_length=80),
    limit: int = Query(default=10, ge=1, le=25),
) -> Any:
    try:
        return await service.search_companies(q, limit)
    except ProviderError as exc:
        return _respond_error(exc)


@router.get(
    "/company/{query}/filings",
    response_model=FilingsResponse,
    summary="Recent 10-K, 10-Q, 8-K and equivalent reports, linked to sec.gov",
    responses=_RESPONSES,
)
async def read_filings(
    query: str,
    forms: str | None = Query(default=None, max_length=80, description="e.g. 10-K,10-Q"),
    limit: int = Query(default=20, ge=1, le=100),
) -> Any:
    wanted = _forms(forms)
    try:
        return await service.get_filings(query, wanted, limit)
    except ProviderError as exc:
        return _respond_error(exc)


@router.get(
    "/company/{query}/fundamentals",
    response_model=FundamentalsResponse,
    summary="Reported financial measures from XBRL company facts",
    responses=_RESPONSES,
)
async def read_fundamentals(
    query: str,
    period: Literal["annual", "quarterly"] = Query(default="annual"),
) -> Any:
    try:
        return await service.get_fundamentals(query, period)
    except ProviderError as exc:
        return _respond_error(exc)
