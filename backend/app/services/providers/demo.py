"""Synthetic demonstration data for the public demo.

The application's real price path reads from `yfinance`, whose data is not
licensed for public display (TENSIONS T-3, PROVIDERS.md). A public demo
therefore cannot redistribute real quotes. Instead, when `DEMO_MODE` is on,
this module supplies a deterministic, clearly labeled synthetic dataset with
the statistical shape of equity prices -- fat-ish tails, volatility regimes,
drift, gaps -- so every analytical feature can be exercised on it.

What this is not: it is not a model of any real security, it is not calibrated
to any real series, and nothing about it is current. The dataset is frozen at
`DEMO_END_DATE`, the source label says "Synthetic demo data", and the UI shows
a standing banner whenever this provider is active. Company names are public
facts and are used only so the interface reads naturally.

Determinism matters: the same ticker always produces the same series, so the
demo is reproducible, cache-friendly, and testable to the byte.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Any

import numpy as np
import pandas as pd

from app.schemas import Range

SOURCE = "Synthetic demo data"
DEMO_END_DATE = date(2025, 12, 31)
_YEARS = 12
_TRADING_DAYS = 252 * _YEARS
_SESSION_OPEN = time(9, 30)
_INTRADAY_MINUTES = 390  # 09:30 to 16:00


@dataclass(frozen=True)
class DemoSecurity:
    name: str
    start_price: float
    drift: float  # annualized log drift
    volatility: float  # annualized volatility in the calm regime
    volume: float  # typical daily shares
    seed: int


# 20 ETFs from the Explore universe, the SPY benchmark, and a handful of widely
# recognized stocks. Parameters are stylized, not estimates of the real assets.
DEMO_UNIVERSE: dict[str, DemoSecurity] = {
    "SPY": DemoSecurity("SPDR S&P 500 ETF Trust", 240.0, 0.09, 0.15, 70_000_000, 1),
    "VOO": DemoSecurity("Vanguard S&P 500 ETF", 220.0, 0.09, 0.15, 5_000_000, 2),
    "VTI": DemoSecurity("Vanguard Total Stock Market ETF", 120.0, 0.09, 0.155, 4_000_000, 3),
    "QQQ": DemoSecurity("Invesco QQQ Trust", 140.0, 0.12, 0.21, 40_000_000, 4),
    "VIG": DemoSecurity("Vanguard Dividend Appreciation ETF", 90.0, 0.08, 0.13, 1_500_000, 5),
    "SCHD": DemoSecurity("Schwab US Dividend Equity ETF", 40.0, 0.08, 0.13, 3_000_000, 6),
    "VEA": DemoSecurity("Vanguard FTSE Developed Markets ETF", 38.0, 0.05, 0.14, 9_000_000, 7),
    "VWO": DemoSecurity("Vanguard FTSE Emerging Markets ETF", 40.0, 0.04, 0.18, 12_000_000, 8),
    "VXUS": DemoSecurity("Vanguard Total International Stock ETF", 48.0, 0.05, 0.14, 3_500_000, 9),
    "BND": DemoSecurity("Vanguard Total Bond Market ETF", 82.0, 0.01, 0.05, 6_000_000, 10),
    "AGG": DemoSecurity("iShares Core US Aggregate Bond ETF", 108.0, 0.01, 0.05, 7_000_000, 11),
    "SHY": DemoSecurity("iShares 1-3 Year Treasury Bond ETF", 84.0, 0.005, 0.015, 3_000_000, 12),
    "TLT": DemoSecurity("iShares 20+ Year Treasury Bond ETF", 120.0, 0.0, 0.14, 20_000_000, 13),
    "VNQ": DemoSecurity("Vanguard Real Estate ETF", 80.0, 0.04, 0.19, 4_500_000, 14),
    "GLD": DemoSecurity("SPDR Gold Shares", 120.0, 0.05, 0.14, 8_000_000, 15),
    "XLK": DemoSecurity("Technology Select Sector SPDR", 60.0, 0.13, 0.22, 7_000_000, 16),
    "XLV": DemoSecurity("Health Care Select Sector SPDR", 80.0, 0.07, 0.14, 9_000_000, 17),
    "XLF": DemoSecurity("Financial Select Sector SPDR", 25.0, 0.07, 0.19, 40_000_000, 18),
    "XLE": DemoSecurity("Energy Select Sector SPDR", 70.0, 0.02, 0.26, 20_000_000, 19),
    "XLP": DemoSecurity("Consumer Staples Select Sector SPDR", 50.0, 0.06, 0.12, 12_000_000, 20),
    "XLU": DemoSecurity("Utilities Select Sector SPDR", 50.0, 0.05, 0.15, 12_000_000, 21),
    "AAPL": DemoSecurity("Apple Inc.", 28.0, 0.18, 0.27, 90_000_000, 101),
    "MSFT": DemoSecurity("Microsoft Corporation", 45.0, 0.17, 0.24, 30_000_000, 102),
    "NVDA": DemoSecurity("NVIDIA Corporation", 5.0, 0.30, 0.45, 300_000_000, 103),
    "AMZN": DemoSecurity("Amazon.com, Inc.", 20.0, 0.16, 0.30, 60_000_000, 104),
    "GOOGL": DemoSecurity("Alphabet Inc.", 30.0, 0.14, 0.26, 30_000_000, 105),
    "META": DemoSecurity("Meta Platforms, Inc.", 80.0, 0.12, 0.35, 20_000_000, 106),
    "TSLA": DemoSecurity("Tesla, Inc.", 15.0, 0.25, 0.55, 120_000_000, 107),
    "JPM": DemoSecurity("JPMorgan Chase & Co.", 60.0, 0.10, 0.24, 12_000_000, 108),
    "JNJ": DemoSecurity("Johnson & Johnson", 100.0, 0.06, 0.16, 8_000_000, 109),
    "XOM": DemoSecurity("Exxon Mobil Corporation", 85.0, 0.03, 0.26, 18_000_000, 110),
    "KO": DemoSecurity("The Coca-Cola Company", 40.0, 0.06, 0.15, 14_000_000, 111),
    "WMT": DemoSecurity("Walmart Inc.", 25.0, 0.09, 0.19, 9_000_000, 112),
    "DIS": DemoSecurity("The Walt Disney Company", 90.0, 0.03, 0.27, 10_000_000, 113),
    "PFE": DemoSecurity("Pfizer Inc.", 32.0, 0.01, 0.22, 30_000_000, 114),
}

# Bars per range for daily-resolution windows; weekly and monthly are resampled.
_DAILY_BARS: dict[Range, int] = {
    Range.MONTH_1: 21,
    Range.MONTH_3: 63,
    Range.MONTH_6: 126,
    Range.YEAR_1: 252,
}


def is_demo_ticker(ticker: str) -> bool:
    return ticker.upper() in DEMO_UNIVERSE


def _daily_frame(ticker: str) -> pd.DataFrame:
    """Deterministic daily OHLCV for one demo security, oldest first."""
    spec = DEMO_UNIVERSE[ticker]
    rng = np.random.default_rng(spec.seed * 7919 + 17)
    n = _TRADING_DAYS

    # Two-state volatility regime (calm / stressed) with sticky transitions, so
    # drawdowns, volatility clustering, and outsized bars all occur naturally.
    stressed = np.zeros(n, dtype=bool)
    state = False
    for i in range(n):
        flip = rng.random() < (0.08 if state else 0.015)
        state = not state if flip else state
        stressed[i] = state
    daily_vol = np.where(stressed, spec.volatility * 2.2, spec.volatility) / np.sqrt(252)
    daily_drift = np.where(stressed, -0.10, spec.drift) / 252

    # Student-t shocks (5 dof) give fatter tails than a normal without exploding.
    shocks = rng.standard_t(5, size=n) / np.sqrt(5 / 3)
    log_returns = daily_drift - 0.5 * daily_vol**2 + daily_vol * shocks
    close = spec.start_price * np.exp(np.cumsum(log_returns))

    prev_close = np.concatenate([[spec.start_price], close[:-1]])
    gap = rng.normal(0, daily_vol * 0.35)
    open_ = prev_close * np.exp(gap)
    intrabar = np.abs(rng.normal(0, daily_vol * 0.6, size=n))
    high = np.maximum(open_, close) * (1 + intrabar)
    low = np.minimum(open_, close) * (1 - intrabar)
    volume = spec.volume * np.exp(rng.normal(0, 0.35, size=n)) * np.where(stressed, 1.6, 1.0)

    dates = pd.bdate_range(end=DEMO_END_DATE, periods=n)
    return pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "volume": volume},
        index=dates,
    )


def _resample(frame: pd.DataFrame, rule: str) -> pd.DataFrame:
    grouped = frame.resample(rule)
    out = pd.DataFrame(
        {
            "open": grouped["open"].first(),
            "high": grouped["high"].max(),
            "low": grouped["low"].min(),
            "close": grouped["close"].last(),
            "volume": grouped["volume"].sum(),
        }
    ).dropna()
    # Label each bar with the last trading day it actually contains.
    out.index = grouped["close"].apply(lambda s: s.index[-1] if len(s) else pd.NaT).dropna()
    return out


def _intraday(frame: pd.DataFrame, ticker: str, days: int, minutes: int) -> list[dict[str, Any]]:
    """Synthetic bars inside the last `days` sessions, consistent with each day's OHLC."""
    spec = DEMO_UNIVERSE[ticker]
    bars: list[dict[str, Any]] = []
    per_day = _INTRADAY_MINUTES // minutes
    for day_ts, row in frame.tail(days).iterrows():
        rng = np.random.default_rng(spec.seed * 104_729 + int(day_ts.strftime("%Y%m%d")))
        # A bridge from open to close, then scaled so its extremes match high/low.
        steps = rng.normal(0, 1, size=per_day).cumsum()
        steps -= np.linspace(steps[0], steps[-1], per_day)  # zero at both ends
        span = row["high"] - row["low"]
        path = np.linspace(row["open"], row["close"], per_day) + steps * span / 6
        path = np.clip(path, row["low"], row["high"])
        path[0], path[-1] = row["open"], row["close"]
        vols = rng.dirichlet(np.ones(per_day) * 2) * row["volume"]
        start = datetime.combine(day_ts.date(), _SESSION_OPEN)
        for i in range(per_day):
            o = path[i - 1] if i else row["open"]
            c = path[i]
            wiggle = abs(c - o) * 0.3 + (row["high"] - row["low"]) * 0.02
            bars.append(
                {
                    "date": (start + timedelta(minutes=minutes * i)).isoformat(),
                    "price": round(float(c), 4),
                    "open": round(float(o), 4),
                    "high": round(float(max(o, c) + wiggle), 4),
                    "low": round(float(min(o, c) - wiggle), 4),
                    "volume": int(vols[i]),
                }
            )
    return bars


def fetch_history(ticker: str, range_: Range) -> list[dict[str, Any]]:
    """Candles for one demo security. Empty list when the ticker is not in the demo set."""
    ticker = ticker.upper()
    if ticker not in DEMO_UNIVERSE:
        return []
    daily = _daily_frame(ticker)

    if range_ is Range.DAY_1:
        return _intraday(daily, ticker, days=1, minutes=5)
    if range_ is Range.DAY_5:
        return _intraday(daily, ticker, days=5, minutes=30)
    if range_ is Range.YEAR_5:
        frame = _resample(daily.tail(252 * 5), "W-FRI")
    elif range_ is Range.MAX:
        frame = _resample(daily, "MS")
    else:
        frame = daily.tail(_DAILY_BARS[range_])

    return [
        {
            "date": index.date().isoformat(),
            "price": round(float(row["close"]), 4),
            "open": round(float(row["open"]), 4),
            "high": round(float(row["high"]), 4),
            "low": round(float(row["low"]), 4),
            "volume": int(row["volume"]),
        }
        for index, row in frame.iterrows()
    ]


def fetch_identity(ticker: str) -> dict[str, str]:
    spec = DEMO_UNIVERSE.get(ticker.upper())
    return {"company_name": spec.name if spec else ticker.upper(), "currency": "USD"}


def search(query: str, limit: int = 10) -> list[dict[str, Any]]:
    """Symbol search over the demo universe, same shape as the Finnhub adapter."""
    needle = query.strip().lower()
    if not needle:
        return []
    rows = [
        {
            "ticker": symbol,
            "name": spec.name,
            "type": "ETF" if symbol in _ETFS else "Common Stock",
        }
        for symbol, spec in DEMO_UNIVERSE.items()
        if needle in symbol.lower() or needle in spec.name.lower()
    ]
    rows.sort(key=lambda row: (not row["ticker"].lower().startswith(needle), row["ticker"]))
    return rows[:limit]


_ETFS = frozenset(
    {
        "SPY", "VOO", "VTI", "QQQ", "VIG", "SCHD", "VEA", "VWO", "VXUS", "BND", "AGG",
        "SHY", "TLT", "VNQ", "GLD", "XLK", "XLV", "XLF", "XLE", "XLP", "XLU",
    }
)
