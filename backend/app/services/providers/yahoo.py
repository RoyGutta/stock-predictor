"""yfinance adapter: one `PriceProvider` implementation, not the architecture.

`yfinance` is an unofficial client for Yahoo Finance data. It needs no key and
is adequate for local, personal, educational use, but it is **not licensed for
redistribution or public display** (TENSIONS T-3, PROVIDERS.md). The registry
refuses to select it when APP_ENV=production, and the public demo never
imports this module.

Adjustment: `Ticker.history()` defaults to `auto_adjust=True`, so the OHLC it
returns is split- and dividend-adjusted. The application has always consumed it
that way; the provider declares it so the basis is explicit downstream.
"""

from __future__ import annotations

import logging
from typing import Any

from app.schemas import Range
from app.services.providers.base import Capability, ProviderUnavailable
from app.services.providers.prices import AdjustmentBasis, Bar, SecurityIdentity

logger = logging.getLogger(__name__)

NAME = "yfinance"

# Each range needs an interval that actually produces a series. The original
# code mapped "1D" -> period=1d, interval=1d, which yields exactly one point.
_RANGE_PARAMS: dict[Range, tuple[str, str]] = {
    Range.DAY_1: ("1d", "5m"),
    Range.DAY_5: ("5d", "30m"),
    Range.MONTH_1: ("1mo", "1d"),
    Range.MONTH_3: ("3mo", "1d"),
    Range.MONTH_6: ("6mo", "1d"),
    Range.YEAR_1: ("1y", "1d"),
    Range.YEAR_5: ("5y", "1wk"),
    Range.MAX: ("max", "1mo"),
}

# Ranges finer than a day need the time component preserved in the timestamp.
_INTRADAY_INTERVALS = {"1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h"}


def _fetch_profile_sync(ticker: str) -> dict[str, str]:
    """Fetch slow-changing company metadata.

    `Ticker.info` is by far the most expensive call yfinance makes, so the
    service caches it separately with a long TTL; failure degrades to the
    symbol as the display name rather than blocking a price response.
    """
    import yfinance as yf  # lazy: only this adapter ever loads the library

    try:
        info = yf.Ticker(ticker).info
    except Exception:
        logger.warning("Profile lookup failed for %s", ticker, exc_info=True)
        return {"company_name": ticker, "currency": "USD"}

    return {
        "company_name": info.get("longName") or info.get("shortName") or ticker,
        "currency": info.get("currency") or "USD",
    }


def _fetch_history_sync(ticker: str, period: str, interval: str) -> list[dict[str, Any]]:
    """Raw transport. Tests patch this function to supply fixture candles."""
    import yfinance as yf  # lazy: only this adapter ever loads the library

    frame = yf.Ticker(ticker).history(period=period, interval=interval)
    if frame is None or frame.empty:
        return []

    intraday = interval in _INTRADAY_INTERVALS
    candles: list[dict[str, Any]] = []
    for index, row in frame.iterrows():
        close = row.get("Close")
        if close is None or close != close:  # skip NaN closes rather than zero-fill
            continue
        candles.append(
            {
                "date": index.isoformat() if intraday else index.date().isoformat(),
                "price": round(float(close), 4),
                "open": round(float(row["Open"]), 4),
                "high": round(float(row["High"]), 4),
                "low": round(float(row["Low"]), 4),
                "volume": int(row["Volume"]) if row["Volume"] == row["Volume"] else 0,
            }
        )
    return candles


class YFinancePriceProvider:
    """Normalizes yfinance into the `PriceProvider` contract."""

    name = NAME
    adjustment = AdjustmentBasis.SPLIT_AND_DIVIDEND
    capabilities = frozenset({Capability.PRICES, Capability.INTRADAY})

    def fetch_history(self, ticker: str, range_: Range) -> list[Bar]:
        period, interval = _RANGE_PARAMS[range_]
        try:
            rows = _fetch_history_sync(ticker, period, interval)
        except Exception as exc:
            # Log the real cause server-side; the caller gets an opaque message.
            logger.exception("History fetch failed for %s (%s)", ticker, range_.value)
            raise ProviderUnavailable(
                NAME, "Market data is temporarily unavailable. Please try again shortly."
            ) from exc
        return [Bar.from_candle_dict(row) for row in rows]

    def fetch_identity(self, ticker: str) -> SecurityIdentity:
        profile = _fetch_profile_sync(ticker)
        return SecurityIdentity(
            ticker=ticker, company_name=profile["company_name"], currency=profile["currency"]
        )
