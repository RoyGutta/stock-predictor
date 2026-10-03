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

from dataclasses import dataclass
from enum import Enum
from typing import Any, Protocol, runtime_checkable

from app.schemas import Candle, Range
from app.services.providers.base import Capability


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
