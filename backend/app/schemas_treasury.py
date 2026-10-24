"""Response models for the U.S. Treasury yield-curve endpoint.

Rates are percent; spreads and changes are percentage points with whole basis
points alongside. Every missing value is null, never zero.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class CurvePoint(BaseModel):
    key: str = Field(description="Treasury element name, e.g. BC_10YEAR.")
    label: str
    months: float
    value: float | None = Field(description="Percent. Null when Treasury published none.")
    prior_value: float | None = Field(description="Percent on the comparison date.")
    change_pp: float | None
    change_bp: int | None


class SpreadValue(BaseModel):
    key: str
    label: str
    long: str
    short: str
    value_pp: float | None
    value_bp: int | None
    prior_value_pp: float | None
    change_pp: float | None
    change_bp: int | None


class LatestCurve(BaseModel):
    date: str = Field(description="Treasury observation date (a business day), not today.")
    comparison_date: str | None = Field(
        description="Published observation about one month earlier; null when none qualifies."
    )
    curve: list[CurvePoint]
    spreads: list[SpreadValue]
    shape: Literal["upward", "flat", "inverted"] | None
    missing_core_maturities: list[str]


class HistoryRow(BaseModel):
    date: str
    yields: dict[str, float | None]
    spread_10y_2y: float | None
    spread_10y_3m: float | None


class YieldCurveResponse(BaseModel):
    source: str
    source_url: str
    methodology: str
    units: str
    retrieved_at: str = Field(description="UTC time Treasury served the oldest month used.")
    stale: bool
    stale_reason: str | None
    observation_age_days: int = Field(
        description="Calendar days from the observation date to today in New York."
    )
    upward_threshold_pp: float
    latest: LatestCurve
    history: list[HistoryRow]
    notes: list[str]
