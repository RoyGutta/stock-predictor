"""Technical analysis and risk endpoints."""

from __future__ import annotations

import asyncio
import logging

import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from app.analytics import indicators as ind
from app.analytics import risk
from app.analytics.interpretation import interpret
from app.schemas import (
    AnalysisResponse,
    BenchmarkComparison,
    ErrorResponse,
    IndicatorSeries,
    ObservationOut,
    Range,
    RiskMetrics,
    TrendInterpretation,
)
from app.services.market_data import MarketDataError, get_quote

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/stocks", tags=["analysis"])

# Ranges whose bars are not daily, so annualization must not assume 252/year.
_FREQUENCY_BY_RANGE: dict[Range, str] = {
    Range.YEAR_5: "weekly",
    Range.MAX: "monthly",
}

# Below this many bars, annualized statistics are too noisy to be worth showing.
_MIN_BARS_FOR_RISK = 30

# Broad US market proxy. Beta against it is the conventional reading, and the
# quote cache means every ticker's analysis shares one upstream fetch.
DEFAULT_BENCHMARK = "SPY"


def _to_frame(candles: list) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "open": [c.open for c in candles],
            "high": [c.high for c in candles],
            "low": [c.low for c in candles],
            "close": [c.price for c in candles],
            "volume": [float(c.volume) for c in candles],
        },
        index=pd.Index([c.date for c in candles], name="date"),
    )


def _build_benchmark(
    close: pd.Series, benchmark_close: pd.Series | None, ticker: str, frequency: str
) -> BenchmarkComparison | None:
    """Beta, alpha, and R-squared against the market proxy.

    Returns None rather than raising when the benchmark is unavailable: this is
    enrichment, and losing it must not cost the caller their risk statistics.
    """
    if benchmark_close is None or benchmark_close.empty:
        return None

    result = risk.beta_alpha(
        risk.simple_returns(close), risk.simple_returns(benchmark_close), frequency=frequency
    )

    def clean(value: float) -> float | None:
        return None if pd.isna(value) else round(float(value), 6)

    return BenchmarkComparison(
        benchmark_ticker=ticker,
        beta=clean(result.beta),
        alpha=clean(result.alpha),
        r_squared=clean(result.r_squared),
        observations=result.observations,
    )


def _build_risk(
    frame: pd.DataFrame,
    frequency: str,
    benchmark_close: pd.Series | None = None,
    benchmark_ticker: str = DEFAULT_BENCHMARK,
) -> RiskMetrics | None:
    close = frame["close"]
    if len(close) < _MIN_BARS_FOR_RISK:
        return None

    returns = risk.simple_returns(close)
    drawdown = risk.max_drawdown(close)

    def clean(value: float) -> float | None:
        """JSON has no NaN. An absent statistic must be null, not 0."""
        return None if pd.isna(value) else round(float(value), 6)

    return RiskMetrics(
        annualized_return=clean(risk.annualized_return(returns, frequency)),
        annualized_volatility=clean(risk.annualized_volatility(returns, frequency)),
        sharpe_ratio=clean(risk.sharpe_ratio(returns, frequency=frequency)),
        sortino_ratio=clean(risk.sortino_ratio(returns, frequency=frequency)),
        max_drawdown=clean(drawdown.max_drawdown),
        drawdown_peak_date=drawdown.peak_date,
        drawdown_trough_date=drawdown.trough_date,
        drawdown_recovery_date=drawdown.recovery_date,
        value_at_risk_95=clean(risk.value_at_risk(returns, 0.95)),
        conditional_value_at_risk_95=clean(risk.conditional_value_at_risk(returns, 0.95)),
        observations=len(returns),
        frequency=frequency,
        basis=(
            "Computed from the price history in this range only. These describe what "
            "already happened over this window and would change with a different window."
        ),
        benchmark=_build_benchmark(close, benchmark_close, benchmark_ticker, frequency),
    )


def _to_optional_floats(series: pd.Series) -> list[float | None]:
    """Serialize a float Series, mapping NaN to null.

    NaN is not valid JSON, and coercing it to 0 would draw an indicator line
    plunging to zero across every bar where its window had not yet filled.
    """
    return [None if pd.isna(value) else round(float(value), 4) for value in series]


def _build_series(frame: pd.DataFrame, period: int) -> IndicatorSeries:
    close = frame["close"]
    bands = ind.bollinger_bands(close, period)
    macd_result = ind.macd(close)

    return IndicatorSeries(
        dates=[str(index) for index in frame.index],
        sma=_to_optional_floats(ind.sma(close, period)),
        ema=_to_optional_floats(ind.ema(close, period)),
        bollinger_upper=_to_optional_floats(bands.upper),
        bollinger_lower=_to_optional_floats(bands.lower),
        rsi=_to_optional_floats(ind.rsi(close)),
        macd=_to_optional_floats(macd_result.macd),
        macd_signal=_to_optional_floats(macd_result.signal),
        macd_histogram=_to_optional_floats(macd_result.histogram),
        period=period,
    )


async def _load_benchmark(ticker: str, range_: Range) -> pd.Series | None:
    """Close series for the market proxy, or None if it is unavailable.

    Skipped when the requested ticker *is* the benchmark: beta of an asset
    against itself is 1.0 by construction and tells the reader nothing, so
    there is no point paying for the fetch.
    """
    if ticker.upper() == DEFAULT_BENCHMARK:
        return None
    try:
        benchmark = await get_quote(DEFAULT_BENCHMARK, range_)
    except MarketDataError:
        # Enrichment only. A missing benchmark costs beta, not the whole response.
        logger.info("Benchmark %s unavailable for %s", DEFAULT_BENCHMARK, ticker)
        return None
    return _to_frame(benchmark.history)["close"]


@router.get(
    "/{ticker}/analysis",
    response_model=AnalysisResponse,
    summary="Technical indicators, risk statistics, and plain-English interpretation",
    responses={
        400: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        502: {"model": ErrorResponse},
    },
)
async def read_analysis(
    ticker: str,
    range: Range = Query(default=Range.YEAR_1),  # noqa: A002
    period: int = Query(
        default=20,
        ge=2,
        le=200,
        description="Window for SMA, EMA, and Bollinger Bands.",
    ),
) -> AnalysisResponse:
    """Analyze a ticker's price history.

    Returns computed indicators, risk statistics, and an interpretation that
    separates supporting from opposing evidence. It deliberately does not
    return a buy/sell verdict or a price target -- see the `disclaimer` field.
    """
    try:
        quote = await get_quote(ticker, range)
    except MarketDataError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    frame = _to_frame(quote.history)
    frequency = _FREQUENCY_BY_RANGE.get(range, "daily")
    benchmark_close = await _load_benchmark(quote.ticker, range)

    # Indicator and risk math is CPU-bound over the whole series; keep it off
    # the event loop so one large request cannot stall other clients.
    interpretation, risk_metrics, series = await asyncio.gather(
        asyncio.to_thread(interpret, frame),
        asyncio.to_thread(_build_risk, frame, frequency, benchmark_close, DEFAULT_BENCHMARK),
        asyncio.to_thread(_build_series, frame, period),
    )

    return AnalysisResponse(
        ticker=quote.ticker,
        company_name=quote.company_name,
        range=range,
        as_of=quote.as_of,
        source=quote.source,
        bars_analyzed=len(frame),
        interpretation=TrendInterpretation(
            summary=interpretation.summary,
            agreement_score=interpretation.agreement_score,
            agreement_label=interpretation.agreement_label,
            conflicts=interpretation.conflicts,
            bullish=[ObservationOut.from_domain(o) for o in interpretation.bullish],
            bearish=[ObservationOut.from_domain(o) for o in interpretation.bearish],
            neutral=[ObservationOut.from_domain(o) for o in interpretation.neutral],
            disclaimer=interpretation.disclaimer,
        ),
        series=series,
        risk=risk_metrics,
    )
