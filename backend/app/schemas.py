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


class BenchmarkComparison(BaseModel):
    """How the asset moved relative to a market benchmark over this window.

    `r_squared` ships alongside beta deliberately: beta computed from a
    relationship the benchmark barely explains is close to meaningless, and
    quoting it alone is the usual way that gets hidden.
    """

    benchmark_ticker: str
    beta: float | None = Field(
        default=None,
        description="Historical sensitivity to the benchmark. 1.3 means it moved ~30% more.",
    )
    alpha: float | None = Field(
        default=None, description="Annualized Jensen's alpha over this window."
    )
    r_squared: float | None = Field(
        default=None,
        description="Share of the asset's movement the benchmark explains. Low means beta is weak.",
    )
    observations: int = Field(description="Overlapping bars used. Fewer than 3 yields nulls.")


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
    benchmark: BenchmarkComparison | None = Field(
        default=None,
        description="Null when the benchmark could not be fetched or did not overlap this range.",
    )


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


# --- momentum ---------------------------------------------------------------


class MomentumCondition(BaseModel):
    label: str
    met: bool
    detail: str = Field(description="The raw comparison, so the reader sees more than a tick.")


class MomentumOut(BaseModel):
    """Moving-average alignment. A description of now, not a recommendation.

    `state` reports how the 20/50/100 averages are stacked. It deliberately does
    not collapse to a buy/sell call: the same alignment appears partway up a
    rally and immediately before a top, and nothing here can tell them apart.
    """

    state: str = Field(description="bullish | bearish | mixed | insufficient")
    score: int = Field(description="How many of the conditions hold.")
    total: int
    headline: str
    conditions: list[MomentumCondition]
    caveat: str = Field(description="What this reading cannot tell you. Never empty.")
    price: float | None = None
    fast: float | None = Field(default=None, description="20-period simple moving average.")
    medium: float | None = Field(default=None, description="50-period simple moving average.")
    slow: float | None = Field(default=None, description="100-period simple moving average.")

    @classmethod
    def from_domain(cls, momentum: object) -> MomentumOut:
        return cls(
            state=momentum.state.value,  # type: ignore[attr-defined]
            score=momentum.score,  # type: ignore[attr-defined]
            total=momentum.total,  # type: ignore[attr-defined]
            headline=momentum.headline,  # type: ignore[attr-defined]
            conditions=[
                MomentumCondition(label=c.label, met=c.met, detail=c.detail)
                for c in momentum.conditions  # type: ignore[attr-defined]
            ],
            caveat=momentum.caveat,  # type: ignore[attr-defined]
            price=momentum.price,  # type: ignore[attr-defined]
            fast=momentum.fast,  # type: ignore[attr-defined]
            medium=momentum.medium,  # type: ignore[attr-defined]
            slow=momentum.slow,  # type: ignore[attr-defined]
        )


class MomentumRanking(BaseModel):
    """One ticker's momentum, for ranking a watchlist."""

    ticker: str
    company_name: str | None = None
    state: str
    score: int
    total: int
    price: float | None = None
    change_percent: float | None = Field(
        default=None, description="Change across the window the momentum was read over."
    )
    headline: str


class MomentumRankingResponse(BaseModel):
    tickers: list[MomentumRanking] = Field(
        description="Ordered strongest to weakest by score, then by recent change."
    )
    range: Range
    unavailable: dict[str, str] = Field(
        default_factory=dict,
        description="Tickers that could not be read, with why. Never silently dropped.",
    )
    note: str


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
    sma_20: list[float | None] = Field(
        default_factory=list,
        description="Fixed 20-period average. The three fixed windows back the momentum read.",
    )
    sma_50: list[float | None] = Field(default_factory=list)
    sma_100: list[float | None] = Field(default_factory=list)


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
    momentum: MomentumOut = Field(
        description="Moving-average alignment. Reports `insufficient` rather than guessing."
    )


# --- scenario dispersion ----------------------------------------------------


class SimulationResponse(BaseModel):
    """Bootstrapped dispersion of outcomes. Explicitly not a forecast.

    Every field here answers "how wide is the range if the future resembled
    this past?" — a question about spread, not about direction. The premise is
    routinely false, and `disclaimer` says so rather than leaving it to the UI.
    """

    ticker: str
    company_name: str
    range: Range
    start_price: float = Field(description="Last close, the point every path starts from.")
    horizon_days: int
    simulations: int
    percentiles: dict[str, float] = Field(
        description="Ending values at the 5th/25th/50th/75th/95th percentile of simulated paths."
    )
    probability_of_loss: float = Field(
        description=(
            "Share of simulated paths ending below the start price. A property of the "
            "resampled sample, not a real-world probability."
        )
    )
    observations: int = Field(description="Historical returns resampled to build the paths.")
    method: str
    disclaimer: str


class CorrelationResponse(BaseModel):
    """Pairwise return correlation between tickers.

    Computed on returns, never on price levels: correlating raw prices makes
    any two assets that both drifted upward look near-identical.
    """

    tickers: list[str]
    range: Range
    matrix: list[list[float | None]] = Field(
        description="Row-major, ordered to match `tickers`. Null where a pair is not computable."
    )
    observations: int
    resolved: dict[str, str] = Field(
        default_factory=dict, description="Ticker to company name, for labeling."
    )
    unavailable: dict[str, str] = Field(
        default_factory=dict,
        description="Tickers that could not be loaded, with why. Excluded from the matrix.",
    )
    note: str


# --- backtesting ------------------------------------------------------------


class BacktestMetrics(BaseModel):
    strategy_key: str
    strategy_name: str
    parameter: int
    bars: int
    total_return: float
    annualized_return: float
    annualized_volatility: float | None
    sharpe_ratio: float | None
    max_drawdown: float
    trades: int
    win_rate: float | None
    exposure: float = Field(description="Fraction of bars spent holding rather than in cash.")
    cost_bps: float
    cost_drag: float


class StrategyResult(BaseModel):
    strategy_key: str
    strategy_name: str
    description: str
    parameter_label: str
    chosen_parameter: int
    parameters_tried: int
    in_sample: BacktestMetrics = Field(
        description="The earlier slice, used to pick the parameter. NOT evidence of skill."
    )
    out_of_sample: BacktestMetrics = Field(
        description="The held-out later slice. The only figure here that means anything."
    )
    benchmark_out_of_sample: BacktestMetrics
    excess_return: float = Field(description="Out-of-sample return minus buy-and-hold.")
    beat_benchmark: bool
    degradation: float = Field(
        description="Out-of-sample return minus in-sample. Large negatives indicate over-fitting."
    )
    verdict: str


class BacktestResponse(BaseModel):
    ticker: str
    company_name: str
    range: Range
    bars: int
    split_date: str
    train_fraction: float
    cost_bps: float
    strategies: list[StrategyResult]
    strategies_beating_benchmark: int
    method: str
    disclaimer: str


# --- portfolio simulation -----------------------------------------------------


class PortfolioLeg(BaseModel):
    ticker: str
    weight: float = Field(gt=0, le=1, description="Target weight. All weights sum to 1.")
    end_weight: float = Field(
        description="Weight at the end of the simulation. Buy-and-hold drifts toward winners."
    )


class PortfolioStats(BaseModel):
    """Statistics on the flow-adjusted (time-weighted) return series.

    Contributions are stripped out before anything is measured, so a deposit can
    neither read as a gain nor hide a drawdown.
    """

    total_return: float
    annualized_return: float
    annualized_volatility: float | None
    sharpe_ratio: float | None
    max_drawdown: float


class PortfolioSimulationOut(BaseModel):
    bars: int
    start_date: str
    end_date: str
    initial_investment: float
    monthly_contribution: float
    contribution_count: int
    total_contributed: float
    ending_value: float
    cost_paid: float
    stats: PortfolioStats
    largest_end_weight: float = Field(
        description="Concentration at the end of the window; 1.0 means a single holding."
    )
    dates: list[str]
    values: list[float] = Field(
        description="Account value including deposits. Display only -- statistics use stats."
    )
    growth_index: list[float] = Field(
        description="Time-weighted growth of 1.0. The statistically honest curve."
    )


class PortfolioSimulationResponse(BaseModel):
    legs: list[PortfolioLeg]
    portfolio: PortfolioSimulationOut
    benchmark_ticker: str
    benchmark: PortfolioSimulationOut = Field(
        description="The identical cash flows into the benchmark, measured identically."
    )
    excess_return: float = Field(
        description="Portfolio time-weighted return minus benchmark, percentage points."
    )
    invalid_tickers: dict[str, str] = Field(default_factory=dict)
    cost_bps: float
    range: Range
    source: str
    method: str
    disclaimer: str
