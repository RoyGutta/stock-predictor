"""Fundamentals screener over SEC XBRL frames. HTTP layer only.

Reads SEC data only; never touches a market-price provider.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

from app.schemas import ErrorResponse
from app.schemas_screener import ScreenerResponse
from app.services.providers.base import ProviderError
from app.services.sec import frames
from app.services.sec.frames import Criteria

router = APIRouter(prefix="/sec", tags=["sec"])

_RESPONSES: dict[int | str, dict[str, Any]] = {
    422: {"description": "Invalid screening criteria"},
    429: {"model": ErrorResponse, "description": "SEC rate limit reached"},
    502: {"model": ErrorResponse, "description": "SEC unreachable, refused, or oversized"},
    503: {"model": ErrorResponse, "description": "SEC_USER_AGENT not configured"},
}

SortKey = Literal[
    "revenue",
    "revenue_growth_pct",
    "net_income",
    "net_margin_pct",
    "operating_cash_flow",
    "ocf_margin_pct",
    "free_cash_flow",
    "liabilities_to_assets",
    "name",
]
BandKey = Literal["100b_plus", "10b_100b", "1b_10b", "100m_1b", "under_100m"]

_PCT = {"ge": -100_000.0, "le": 100_000.0}


@router.get(
    "/screener",
    response_model=ScreenerResponse,
    summary="Screen SEC filers on reported fundamentals (XBRL frames)",
    responses=_RESPONSES,
)
async def read_screener(
    min_revenue: float | None = Query(default=None, ge=0, le=1e13, description="USD"),
    min_growth: float | None = Query(default=None, **_PCT, description="Revenue growth, %"),
    max_growth: float | None = Query(default=None, **_PCT, description="Revenue growth, %"),
    min_net_margin: float | None = Query(default=None, **_PCT, description="%"),
    max_liabilities_to_assets: float | None = Query(default=None, ge=0, le=1_000),
    positive_fcf: bool = Query(default=False),
    name: str | None = Query(default=None, min_length=1, max_length=80),
    size_band: BandKey | None = Query(default=None),
    sort: SortKey = Query(default="revenue"),
    order: Literal["asc", "desc"] = Query(default="desc"),
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=100_000),
) -> Any:
    if min_growth is not None and max_growth is not None and min_growth > max_growth:
        raise HTTPException(status_code=422, detail="min_growth must not exceed max_growth.")
    criteria = Criteria(
        min_revenue=min_revenue,
        min_growth=min_growth,
        max_growth=max_growth,
        min_net_margin=min_net_margin,
        max_liabilities_to_assets=max_liabilities_to_assets,
        positive_fcf=positive_fcf,
        name=name.strip() or None if name else None,
        size_band=size_band,
        sort=sort,
        order=order,
        limit=limit,
        offset=offset,
    )
    try:
        return await frames.run_screen(criteria)
    except ProviderError as exc:
        return JSONResponse(status_code=exc.status_code, content={"detail": str(exc)})
