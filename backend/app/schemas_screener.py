"""Response models for the SEC frames fundamentals screener.

Every figure is as reported to the SEC for a calendar-aligned period. Unknown
figures are null, never zero. No market-price field exists in these models.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas_sec import Provenance


class ScreenerProvenance(Provenance):
    retrieved_at: str | None = Field(
        default=None,
        description="Oldest UTC time SEC served any frame used. Null if no frame existed.",
    )


class FrameUsed(BaseModel):
    measure: str
    tag: str
    period: str = Field(description="CY2025 = annual duration; CY2025Q4I = year-end instant.")
    url: str
    available: bool = Field(description="False when SEC has no frame for this period yet.")
    companies: int


class SizeBand(BaseModel):
    key: str
    label: str
    min_revenue: float


class ScreenerRow(BaseModel):
    cik: int
    name: str | None
    edgar_url: str
    revenue_tag: str | None
    period_end: str | None
    revenue_accession: str | None
    revenue: float | None
    revenue_prior: float | None
    revenue_growth_pct: float | None
    net_income: float | None
    net_margin_pct: float | None
    operating_cash_flow: float | None
    ocf_margin_pct: float | None
    capital_expenditures: float | None
    free_cash_flow: float | None
    total_assets: float | None
    total_liabilities: float | None
    liabilities_to_assets: float | None
    size_band: str | None


class ScreenerResponse(ScreenerProvenance):
    calendar_year: int
    prior_calendar_year: int
    frames: list[FrameUsed]
    universe: int = Field(description="Companies present in any latest-year frame.")
    total_matches: int
    offset: int
    limit: int
    size_bands: list[SizeBand]
    notes: list[str]
    results: list[ScreenerRow]
