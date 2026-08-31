"""Preference-matching exploration over the curated fund universe.

This is NOT a recommendation engine. It measures every fund in a small,
disclosed universe over one window, checks each against the user's *stated*
preferences, and returns every fund with every check and the measurement that
decided it. The score is a count of preferences matched -- it is not a rating,
not a probability, and not advice, and the payload says so.
"""

from __future__ import annotations

import asyncio
import logging

import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from app.analytics import momentum, risk
from app.routes.analysis import _to_frame
from app.schemas import ExploreCriterion, ExploreMatch, ExploreResponse, Range
from app.services import universe
from app.services.market_data import MarketDataError, get_quote

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/explore", tags=["explore"])

BENCHMARK = "SPY"
_MIN_BARS = 30

_WINDOW_BY_HORIZON: dict[str, Range] = {"shorter": Range.YEAR_1, "longer": Range.YEAR_5}
_FREQUENCY_BY_RANGE: dict[Range, str] = {Range.YEAR_5: "weekly", Range.MAX: "monthly"}

VOLATILITY_CHOICES = ("lower", "moderate", "higher")
DIVERSIFICATION_CHOICES = ("broad", "any")
HORIZON_CHOICES = ("shorter", "longer")

METHOD = (
    "Every fund in the disclosed universe is measured over the same window: annualized "
    "volatility, maximum drawdown, annualized return, moving-average momentum, and return "
    "correlation with SPY. Volatility and drawdown preferences are checked against thirds "
    "of this universe's own measured range (recomputed per request, so the boundaries are "
    "data, not opinion). Diversification is checked against how the fund is constructed. "
    "The score counts stated preferences matched; ties are ordered by lower measured "
    "volatility. Nothing here weighs expected performance."
)

DISCLAIMER = (
    "A preference match count, not a recommendation and not a prediction. It says how "
    "many of your stated preferences a fund's historical characteristics matched over one "
    "window. Historical characteristics change, and none of them indicate future results. "
    "This tool does not know your financial situation and is not financial advice."
)


def _tercile(value: float, sorted_values: list[float]) -> int:
    """0 = bottom third, 1 = middle, 2 = top third of the measured universe."""
    if not sorted_values:
        return 1
    position = sum(1 for other in sorted_values if other <= value)
    fraction = position / len(sorted_values)
    if fraction <= 1 / 3:
        return 0
    if fraction <= 2 / 3:
        return 1
    return 2


_TERCILE_LABEL = ("lowest third", "middle third", "highest third")


@router.get(
    "/match",
    response_model=ExploreResponse,
    summary="Match the fund universe against stated preferences",
)
async def read_explore_match(
    volatility: str = Query(default="moderate", description="lower | moderate | higher"),
    diversification: str = Query(default="any", description="broad | any"),
    horizon: str = Query(default="longer", description="shorter | longer"),
    interests: str = Query(
        default="",
        max_length=300,
        description="Optional comma-separated sector categories to look for.",
    ),
) -> ExploreResponse:
    """Measure the universe and report how each fund fits the stated preferences.

    Every fund is returned with every criterion, met or not. Filtering the
    losers out server-side would hide the comparison the page exists to teach.
    """
    if volatility not in VOLATILITY_CHOICES:
        raise HTTPException(400, f"volatility must be one of {', '.join(VOLATILITY_CHOICES)}")
    if diversification not in DIVERSIFICATION_CHOICES:
        raise HTTPException(
            400, f"diversification must be one of {', '.join(DIVERSIFICATION_CHOICES)}"
        )
    if horizon not in HORIZON_CHOICES:
        raise HTTPException(400, f"horizon must be one of {', '.join(HORIZON_CHOICES)}")

    wanted_interests: list[str] = []
    for part in interests.split(","):
        cleaned = part.strip()
        if not cleaned:
            continue
        if cleaned not in universe.SECTOR_CATEGORIES:
            raise HTTPException(
                400,
                f"Unknown interest '{cleaned}'. "
                f"Available: {', '.join(universe.SECTOR_CATEGORIES)}",
            )
        if cleaned not in wanted_interests:
            wanted_interests.append(cleaned)

    window = _WINDOW_BY_HORIZON[horizon]
    frequency = _FREQUENCY_BY_RANGE.get(window, "daily")

    async def fetch(symbol: str) -> tuple[str, object | Exception]:
        try:
            return symbol, await get_quote(symbol, window)
        except MarketDataError as exc:
            return symbol, exc

    symbols = [fund.ticker for fund in universe.UNIVERSE]
    results = await asyncio.gather(*(fetch(symbol) for symbol in [*symbols, BENCHMARK]))
    outcomes = dict(results)

    benchmark_outcome = outcomes.pop(BENCHMARK, None)
    benchmark_returns: pd.Series | None = None
    if benchmark_outcome is not None and not isinstance(benchmark_outcome, Exception):
        benchmark_frame = _to_frame(benchmark_outcome.history)  # type: ignore[attr-defined]
        benchmark_returns = benchmark_frame["close"].pct_change()

    def measure(fund: universe.Fund, quote: object) -> dict | None:
        frame = _to_frame(quote.history)  # type: ignore[attr-defined]
        if len(frame) < _MIN_BARS:
            return None
        close = frame["close"]
        returns = risk.simple_returns(close)

        correlation: float | None = None
        if benchmark_returns is not None:
            # Vendors occasionally repeat a timestamp; an index join cannot
            # align duplicate labels, so keep the first occurrence of each.
            fund_returns = close.pct_change()
            fund_returns = fund_returns[~fund_returns.index.duplicated(keep="first")]
            bench = benchmark_returns[~benchmark_returns.index.duplicated(keep="first")]
            aligned = pd.concat([fund_returns, bench], axis=1, join="inner").dropna()
            if len(aligned) >= _MIN_BARS:
                value = aligned.iloc[:, 0].corr(aligned.iloc[:, 1])
                correlation = None if pd.isna(value) else round(float(value), 3)

        volatility_value = risk.annualized_volatility(returns, frequency)
        return {
            "fund": fund,
            "bars": len(frame),
            "volatility": None if pd.isna(volatility_value) else float(volatility_value),
            "drawdown": float(risk.max_drawdown(close).max_drawdown),
            "annual_return": float(risk.annualized_return(returns, frequency)),
            "momentum_state": momentum.assess(frame).state.value,
            "correlation": correlation,
        }

    measured: list[dict] = []
    unavailable: dict[str, str] = {}
    funds = universe.by_ticker()
    for symbol, outcome in outcomes.items():
        if isinstance(outcome, Exception):
            unavailable[symbol] = str(outcome)
            continue
        try:
            row = await asyncio.to_thread(measure, funds[symbol], outcome)
        except Exception:  # one bad series must not sink the rest
            logger.exception("Exploration measurement failed for %s", symbol)
            unavailable[symbol] = "Could not compute characteristics."
            continue
        if row is None:
            unavailable[symbol] = "Not enough shared history in this window."
        else:
            measured.append(row)

    volatilities = sorted(r["volatility"] for r in measured if r["volatility"] is not None)
    drawdown_depths = sorted(abs(r["drawdown"]) for r in measured)

    def build(row: dict) -> ExploreMatch:
        fund: universe.Fund = row["fund"]
        criteria: list[ExploreCriterion] = []

        vol = row["volatility"]
        if vol is None:
            criteria.append(
                ExploreCriterion(
                    name="Volatility preference",
                    met=False,
                    detail="Volatility could not be measured over this window.",
                )
            )
        else:
            tercile = _tercile(vol, volatilities)
            met = {
                "lower": tercile == 0,
                "moderate": tercile == 1,
                "higher": tercile == 2,
            }[volatility]
            criteria.append(
                ExploreCriterion(
                    name="Volatility preference",
                    met=met,
                    detail=(
                        f"Annualized volatility {vol * 100:.1f}% -- {_TERCILE_LABEL[tercile]} "
                        f"of this list; you selected '{volatility}'."
                    ),
                )
            )

        depth = abs(row["drawdown"])
        depth_tercile = _tercile(depth, drawdown_depths)
        if volatility == "lower":
            drawdown_met = depth_tercile == 0
        elif volatility == "moderate":
            drawdown_met = depth_tercile <= 1
        else:
            drawdown_met = True
        criteria.append(
            ExploreCriterion(
                name="Drawdown depth",
                met=drawdown_met,
                detail=(
                    f"Largest historical fall {row['drawdown'] * 100:.1f}% -- "
                    f"{_TERCILE_LABEL[depth_tercile]} of this list by depth."
                ),
            )
        )

        broad = fund.breadth is universe.Breadth.BROAD
        criteria.append(
            ExploreCriterion(
                name="Diversification",
                met=broad if diversification == "broad" else True,
                detail=(
                    f"This is a {fund.breadth.value} fund: {fund.tracks} "
                    + (
                        "You asked for broadly diversified funds."
                        if diversification == "broad"
                        else "You accepted any breadth."
                    )
                ),
            )
        )

        if wanted_interests:
            in_interests = fund.category in wanted_interests
            criteria.append(
                ExploreCriterion(
                    name="Sector interests",
                    met=in_interests,
                    detail=(
                        f"Category '{fund.category}'"
                        + (
                            " matches one of your selected interests."
                            if in_interests
                            else f" is not among: {', '.join(wanted_interests)}."
                        )
                    ),
                )
            )

        return ExploreMatch(
            ticker=fund.ticker,
            name=fund.name,
            asset_class=fund.asset_class.value,
            breadth=fund.breadth.value,
            category=fund.category,
            tracks=fund.tracks,
            annualized_return=round(row["annual_return"], 6),
            annualized_volatility=None if vol is None else round(vol, 6),
            max_drawdown=round(row["drawdown"], 6),
            momentum_state=row["momentum_state"],
            correlation_to_benchmark=row["correlation"],
            bars=row["bars"],
            score=sum(1 for criterion in criteria if criterion.met),
            total=len(criteria),
            criteria=criteria,
        )

    matches = [build(row) for row in measured]
    matches.sort(
        key=lambda match: (
            -match.score,
            match.annualized_volatility if match.annualized_volatility is not None else 1e9,
        )
    )

    return ExploreResponse(
        matches=matches,
        unavailable=unavailable,
        range=window,
        frequency=frequency,
        benchmark_ticker=BENCHMARK,
        universe_note=universe.UNIVERSE_NOTE,
        available_interests=list(universe.SECTOR_CATEGORIES),
        method=METHOD,
        disclaimer=DISCLAIMER,
    )
