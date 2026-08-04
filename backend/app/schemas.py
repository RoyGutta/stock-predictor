"""Response models for the public API.

Declaring these gives us validated output, generated OpenAPI docs, and a single
place the frontend's TypeScript types can be kept in sync with.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class Range(str, Enum):
    """Supported chart ranges.

    Each range maps to a (period, interval) pair in the market data service.
    The interval must suit the period -- requesting a 1-day period at a 1-day
    interval returns a single data point, which is what the original
    implementation did for "1D".
    """

    DAY_1 = "1D"
    DAY_5 = "5D"
    MONTH_1 = "1M"
    MONTH_3 = "3M"
    MONTH_6 = "6M"
    YEAR_1 = "1Y"
    YEAR_5 = "5Y"
    MAX = "MAX"


class Candle(BaseModel):
    date: str = Field(description="ISO-8601 timestamp. Includes time for intraday ranges.")
    price: float = Field(description="Closing price for the interval.")
    open: float
    high: float
    low: float
    volume: int


class Quote(BaseModel):
    ticker: str
    company_name: str
    price: float
    open: float
    high: float
    low: float
    volume: int
    change_points: float = Field(description="Absolute price change across the requested range.")
    change_percent: float = Field(description="Percent price change across the requested range.")
    currency: str
    range: Range
    history: list[Candle]
    as_of: str = Field(description="ISO-8601 timestamp of the most recent candle.")
    source: str = Field(description="Which data provider served this response.")


class ErrorResponse(BaseModel):
    detail: str
