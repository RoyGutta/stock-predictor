"""The normalized market-data contract every price provider must satisfy.

Analytics, routes, and the frontend never see a vendor. They see `Bar`s with an
explicit frequency and adjustment basis, a `SecurityIdentity`, and a provider
that declares which `Capability` values it supports. A new licensed provider is
one module implementing `PriceProvider` and one line in the registry.

Semantics fixed here, on purpose, so they cannot drift per vendor:

- Bars are oldest first. `date` is an ISO-8601 calendar day for daily and
  coarser bars and a full timestamp for intraday bars.
- `close` is the bar's closing price. No NaN ever reaches a `Bar`; a bar with a
  missing close is dropped by the adapter, never zero-filled.
- `volume` is an integer; a missing volume is 0 only because the API contract
  predates this module and the frontend treats 0 volume as "no volume", not as
  a price. Prices are never defaulted.
- `adjustment` says what the prices already include. The yfinance adapter
  returns split- and dividend-adjusted OHLC (its `auto_adjust=True` default,
  which the application has always relied on), so every return, drawdown,
  backtest, and replay is total-return-style. A provider that cannot supply
  that must say so through this field; the application states the basis to the
  user rather than silently changing methodology.
- Weekly and monthly bars are the provider's or a resample of daily bars; which
  one is a provider detail. The bar's `date` is the last trading day it covers.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from enum import Enum
from typing import Any, Protocol, runtime_checkable

import pandas as pd

from app.schemas import Candle, Range
from app.services.providers.base import Capability, ProviderUnavailable

logger = logging.getLogger(__name__)


class AdjustmentBasis(str, Enum):
    """What the prices in a series already account for."""

    SPLIT_AND_DIVIDEND = "split_and_dividend"
    SPLIT = "split"
    UNADJUSTED = "unadjusted"
    # Synthetic series have no corporate actions to adjust for.
    SYNTHETIC = "synthetic"


class Frequency(str, Enum):
    """Bar frequency. Drives annualization downstream and the UI's basis text."""

    MINUTE_5 = "5m"
    MINUTE_30 = "30m"
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"


# The application's range-to-frequency decision lives here, not in any vendor:
# every provider must serve these frequencies for these ranges (resampling
# daily bars server-side is acceptable for weekly and monthly).
FREQUENCY_BY_RANGE: dict[Range, Frequency] = {
    Range.DAY_1: Frequency.MINUTE_5,
    Range.DAY_5: Frequency.MINUTE_30,
    Range.MONTH_1: Frequency.DAILY,
    Range.MONTH_3: Frequency.DAILY,
    Range.MONTH_6: Frequency.DAILY,
    Range.YEAR_1: Frequency.DAILY,
    Range.YEAR_5: Frequency.WEEKLY,
    Range.MAX: Frequency.MONTHLY,
}

INTRADAY_RANGES = frozenset({Range.DAY_1, Range.DAY_5})

# Annualization is defined for daily, weekly, and monthly bars only. Intraday
# bars have no honest periods-per-year (overnight gaps are excluded, session
# lengths vary), so routes that annualize must refuse or omit for these ranges
# rather than scale 5-minute returns by sqrt(252).
_ANNUALIZATION: dict[Frequency, str] = {
    Frequency.DAILY: "daily",
    Frequency.WEEKLY: "weekly",
    Frequency.MONTHLY: "monthly",
}


def annualization_frequency(range_: Range) -> str | None:
    """The `risk` frequency label for a range, or None when annualization is undefined."""
    return _ANNUALIZATION.get(FREQUENCY_BY_RANGE[range_])


@dataclass(frozen=True, slots=True)
class Bar:
    """One normalized OHLCV bar."""

    date: str
    open: float
    high: float
    low: float
    close: float
    volume: int

    @classmethod
    def from_candle_dict(cls, row: dict[str, Any]) -> Bar:
        """Build from the adapter-level dict shape (`price` is the close)."""
        return cls(
            date=str(row["date"]),
            open=float(row["open"]),
            high=float(row["high"]),
            low=float(row["low"]),
            close=float(row["price"] if "price" in row else row["close"]),
            volume=int(row.get("volume") or 0),
        )

    def to_candle(self) -> Candle:
        return Candle(
            date=self.date,
            price=self.close,
            open=self.open,
            high=self.high,
            low=self.low,
            volume=self.volume,
        )


@dataclass(frozen=True, slots=True)
class SecurityIdentity:
    """The two strings the UI needs to name a security."""

    ticker: str
    company_name: str
    currency: str = "USD"


@runtime_checkable
class PriceProvider(Protocol):
    """A source of normalized price history and security identity.

    Methods are synchronous; the service runs them in a worker thread so a
    blocking vendor client never stalls the event loop. Implementations raise
    `ProviderError` subclasses from `providers.base` for anything that goes
    wrong and return an empty list for an unknown ticker -- they never guess.
    """

    @property
    def name(self) -> str:
        """Attribution label shown to users as the data source."""
        ...

    @property
    def adjustment(self) -> AdjustmentBasis: ...

    @property
    def capabilities(self) -> frozenset[Capability]: ...

    def fetch_history(self, ticker: str, range_: Range) -> list[Bar]: ...

    def fetch_identity(self, ticker: str) -> SecurityIdentity: ...


def supports(provider: PriceProvider, capability: Capability) -> bool:
    return capability in provider.capabilities


class ProviderDataError(ProviderUnavailable):
    """The provider answered, but with bars that cannot be true."""

    def __init__(self, provider: str, reason: str) -> None:
        super().__init__(provider, f"{provider} returned inconsistent price data ({reason}).")
        self.reason = reason


def validate_bars(bars: list[Bar], provider: str) -> list[Bar]:
    """Apply the data-quality contract to a provider's bars.

    Normalized safely (deterministic, information-preserving):
      - unsorted bars are sorted by timestamp (stable);
      - repeated timestamps keep the LAST bar -- the final print for a period
        is the conventional resolution, and it is the same rule `risk` and
        `patterns` apply, so no module can disagree with another;
      - a high below the open or close, or a low above them, is widened to
        bracket them; this is rounding noise in real feeds, it is logged, and
        it never changes a close.

    Rejected with ProviderDataError (the whole series, never a silent repair):
      - a non-finite open, high, low, or close;
      - a zero or negative price;
      - a high below the low;
      - a negative volume.
    Nothing is interpolated: a missing bar stays missing.
    """
    for bar in bars:
        values = (bar.open, bar.high, bar.low, bar.close)
        if not all(math.isfinite(v) for v in values):
            raise ProviderDataError(provider, f"non-finite price at {bar.date}")
        if min(values) <= 0:
            raise ProviderDataError(provider, f"non-positive price at {bar.date}")
        if bar.high < bar.low:
            raise ProviderDataError(provider, f"high below low at {bar.date}")
        if bar.volume < 0:
            raise ProviderDataError(provider, f"negative volume at {bar.date}")

    ordered = sorted(bars, key=lambda bar: bar.date)  # stable: ties keep input order
    deduped: dict[str, Bar] = {}
    for bar in ordered:
        deduped[bar.date] = bar  # last wins
    if len(deduped) != len(ordered):
        logger.info("%s: collapsed %d repeated timestamps", provider, len(ordered) - len(deduped))

    out: list[Bar] = []
    widened = 0
    for bar in deduped.values():
        body_high, body_low = max(bar.open, bar.close), min(bar.open, bar.close)
        if bar.high < body_high or bar.low > body_low:
            widened += 1
            bar = Bar(
                bar.date,
                bar.open,
                max(bar.high, body_high),
                min(bar.low, body_low),
                bar.close,
                bar.volume,
            )
        out.append(bar)
    if widened:
        logger.info("%s: widened high/low on %d bars to bracket open/close", provider, widened)
    return out


_RESAMPLE_RULE: dict[Frequency, str] = {Frequency.WEEKLY: "W-FRI", Frequency.MONTHLY: "MS"}


def resample_bars(daily: list[Bar], frequency: Frequency) -> list[Bar]:
    """Aggregate daily bars to weekly or monthly, labeling each bar with the
    last trading day it actually contains.

    Shared by every provider so weekly and monthly semantics cannot differ by
    vendor: open = first daily open, high = max, low = min, close = last close,
    volume = sum. A week ending on a holiday is labeled by its last session, not
    by a calendar Friday that never traded.
    """
    if frequency not in _RESAMPLE_RULE:
        raise ValueError(f"resample_bars only aggregates to weekly or monthly, got {frequency}")
    if not daily:
        return []
    frame = pd.DataFrame(
        {
            "open": [b.open for b in daily],
            "high": [b.high for b in daily],
            "low": [b.low for b in daily],
            "close": [b.close for b in daily],
            "volume": [b.volume for b in daily],
        },
        index=pd.to_datetime([b.date for b in daily]),
    )
    grouped = frame.resample(_RESAMPLE_RULE[frequency])
    out: list[Bar] = []
    for _, group in grouped:
        if group.empty:
            continue
        out.append(
            Bar(
                date=group.index[-1].date().isoformat(),
                open=float(group["open"].iloc[0]),
                high=float(group["high"].max()),
                low=float(group["low"].min()),
                close=float(group["close"].iloc[-1]),
                volume=int(group["volume"].sum()),
            )
        )
    return out
