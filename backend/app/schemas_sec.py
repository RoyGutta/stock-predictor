"""Response models for SEC EDGAR endpoints.

Kept apart from `schemas.py` (price and analytics models) because the two
describe different kinds of data: market prices versus figures a company
reported about a past period. Every response carries provenance fields.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Provenance(BaseModel):
    source: str = Field(description="Always the SEC. Shown next to every SEC figure.")
    retrieved_at: str = Field(
        description="UTC time SEC last served or confirmed this data to this server."
    )
    stale: bool = Field(
        description="True when SEC could not be reached and a cached copy was served."
    )
    stale_reason: str | None = None


class SecCompany(BaseModel):
    cik: int
    cik_padded: str
    name: str | None
    tickers: list[str]
    edgar_url: str


class SecCompanyDetail(SecCompany):
    entity_type: str | None = None
    fiscal_year_end: str | None = Field(
        default=None, description="MMDD as SEC records it, e.g. 0926 for late September."
    )
    industry: str | None = None


class SecSearchResponse(Provenance):
    query: str
    results: list[SecCompany]


class FilingItem(BaseModel):
    code: str
    description: str | None = Field(description="Null when the item has no standard label here.")


class Filing(BaseModel):
    form: str
    base_form: str
    form_description: str
    amendment: bool
    filing_date: str
    report_date: str | None = Field(
        description="Period covered (10-K/10-Q) or event date (8-K); null when SEC records none."
    )
    accession_number: str
    items: list[FilingItem]
    description: str | None
    document_url: str = Field(description="The original document on sec.gov.")
    index_url: str = Field(description="The filing's index page on sec.gov.")


class FilingsResponse(Provenance):
    company: SecCompanyDetail
    filings: list[Filing]
    coverage_note: str | None


class YearOverYear(BaseModel):
    prior_period_end: str
    prior_value: float
    change: float
    change_pct: float | None = Field(
        description="Null when the earlier value is zero or negative."
    )
    note: str | None


class FactPoint(BaseModel):
    period_start: str | None = Field(description="Null for balance-sheet (point-in-time) values.")
    period_end: str
    duration_days: int | None
    value: float
    tag: str = Field(description="The US GAAP tag the value was reported under.")
    form: str
    filed: str
    accession_number: str
    filing_url: str
    amended: bool = Field(description="The chosen value comes from an amended filing.")
    revised: bool = Field(description="Later filings reported a different value for this period.")
    first_reported_value: float | None
    yoy: YearOverYear | None


class MetricSeries(BaseModel):
    key: str
    label: str
    unit: str
    kind: Literal["duration", "instant"]
    definition: str
    tags_considered: list[str]
    points: list[FactPoint]
    missing_reason: str | None = Field(description="Why there are no points. Never zero-filled.")
    ignored_units: list[str]


class DerivedPoint(BaseModel):
    period_start: str | None
    period_end: str
    duration_days: int | None
    value: float
    components: dict[str, float]
    form: str
    filed: str
    accession_number: str
    filing_url: str
    yoy: YearOverYear | None


class DerivedSeries(BaseModel):
    key: str
    label: str
    unit: str
    definition: str
    caveat: str
    components: list[str]
    points: list[DerivedPoint]
    missing_reason: str | None
    periods_blocked_different_filing: int


class FundamentalsResponse(Provenance):
    company: SecCompany
    period: Literal["annual", "quarterly"]
    coverage: Literal["us-gaap", "ifrs", "none"]
    coverage_note: str | None
    note: str
    metrics: list[MetricSeries]
    derived: list[DerivedSeries]
    latest_filed: str | None = Field(description="Most recent filing date among values shown.")
    source_url: str | None


class AmbiguousResponse(BaseModel):
    detail: str
    candidates: list[SecCompany]
