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


# --- analysis ---------------------------------------------------------------


class ObservationOut(BaseModel):
    indicator: str
    stance: str = Field(description="bullish | bearish | neutral. Describes past price action.")
    value: float | None
    headline: str
    detail: str
    caveat: str = Field(description="This indicator's known failure mode. Never empty.")

    @classmethod
    def from_domain(cls, observation: object) -> ObservationOut:
        return cls(
            indicator=observation.indicator,  # type: ignore[attr-defined]
            stance=observation.stance.value,  # type: ignore[attr-defined]
            value=observation.value,  # type: ignore[attr-defined]
            headline=observation.headline,  # type: ignore[attr-defined]
            detail=observation.detail,  # type: ignore[attr-defined]
            caveat=observation.caveat,  # type: ignore[attr-defined]
        )


class TrendInterpretation(BaseModel):
    summary: str
    agreement_score: float = Field(
        ge=0.0,
        le=1.0,
        description=(
            "How much the indicators agree WITH EACH OTHER. This is not a probability "
            "and not a confidence level for any prediction."
        ),
    )
    agreement_label: str
    conflicts: list[str] = Field(
        description="Contradictions between indicators, stated rather than averaged away."
    )
    bullish: list[ObservationOut]
    bearish: list[ObservationOut]
    neutral: list[ObservationOut]
    disclaimer: str


class RiskMetrics(BaseModel):
    annualized_return: float | None
    annualized_volatility: float | None
    sharpe_ratio: float | None
    sortino_ratio: float | None
    max_drawdown: float | None = Field(
        description="Largest peak-to-trough decline, as a negative fraction."
    )
    drawdown_peak_date: str | None
    drawdown_trough_date: str | None
    drawdown_recovery_date: str | None = Field(
        description="Null if the price never regained its previous peak within this range."
    )
    value_at_risk_95: float | None
    conditional_value_at_risk_95: float | None
    observations: int
    frequency: str
    basis: str


# --- market-wide ------------------------------------------------------------


class Mover(BaseModel):
    ticker: str
    name: str
    price: float
    change: float | None
    change_percent: float | None
    exchange: str | None = None
    low_priced: bool = Field(
        default=False,
        description=(
            "Trades under $5 (the SEC's penny-stock threshold). These dominate "
            "biggest-mover lists and carry markedly higher manipulation risk."
        ),
    )


class MoversResponse(BaseModel):
    gainers: list[Mover]
    losers: list[Mover]
    actives: list[Mover]
    errors: dict[str, str] = Field(
        default_factory=dict,
        description="Per-list failures. A list that failed is empty and named here.",
    )
    source: str
    disclaimer: str


class SectorPerformance(BaseModel):
    sector: str
    change_percent: float
    as_of: str


class MarketStatus(BaseModel):
    session: str = Field(description="open | pre-market | after-hours | closed")
    reason: str
    exchange: str
    local_time: str
    timezone: str
    next_open: str
    holiday_data_through: int | None = Field(
        description="Last year covered by the holiday table. Beyond it, holidays are not applied."
    )


class NewsArticle(BaseModel):
    headline: str
    summary: str | None
    source: str | None
    url: str
    published_at: str | None
    image: str | None = None


class NewsResponse(BaseModel):
    ticker: str
    articles: list[NewsArticle]
    source: str
    disclaimer: str


class SearchResult(BaseModel):
    ticker: str
    name: str
    type: str | None = None


class CompanyProfile(BaseModel):
    ticker: str
    name: str | None
    sector: str | None
    industry: str | None
    country: str | None
    exchange: str | None
    market_cap: float | None
    beta: float | None
    last_dividend: float | None
    average_volume: float | None
    employees: float | None
    website: str | None
    description: str | None
    ceo: str | None
    is_etf: bool
    source: str


class CapabilityStatus(BaseModel):
    """What this deployment can actually serve.

    Lets the UI hide or explain features precisely rather than rendering an
    empty panel with no reason given.
    """

    movers: bool
    sectors: bool
    news: bool
    search: bool
    fundamentals: bool
    screener: bool
    notes: dict[str, str] = Field(
        description="Why a capability is unavailable, keyed by capability name."
    )


class IndicatorSeries(BaseModel):
    """Indicator values aligned index-for-index with the quote's `history`.

    `null` marks a bar where the indicator is not yet defined (its window has
    not filled). Callers must render those as gaps, never as zero.
    """

    dates: list[str]
    sma: list[float | None]
    ema: list[float | None]
    bollinger_upper: list[float | None]
    bollinger_lower: list[float | None]
    rsi: list[float | None]
    macd: list[float | None]
    macd_signal: list[float | None]
    macd_histogram: list[float | None]
    period: int = Field(description="Window used for SMA, EMA, and Bollinger Bands.")


class AnalysisResponse(BaseModel):
    ticker: str
    company_name: str
    range: Range
    as_of: str
    source: str
    bars_analyzed: int
    interpretation: TrendInterpretation
    series: IndicatorSeries = Field(
        description="Chart-ready indicator values, aligned to the quote's history."
    )
    risk: RiskMetrics | None = Field(
        default=None,
        description="Null when the range holds too few bars for the statistics to be meaningful.",
    )
