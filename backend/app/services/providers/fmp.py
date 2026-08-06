"""Financial Modeling Prep.

Uses the `/stable` API. FMP retired its `/api/v3` endpoints, and keys issued now
receive HTTP 403 with a "Legacy Endpoint" body when calling them.

Verified against a live free-tier key on 2026-08-05:
  available  — biggest-gainers, biggest-losers, most-actives,
               sector-performance-snapshot, profile, quote
  paid only  — company-screener, stock-list (both return HTTP 402)
"""

from __future__ import annotations

from typing import Any

from app.config import get_settings
from app.services.providers.base import (
    Capability,
    ProviderNotConfigured,
    as_float,
    build_client,
    get_json,
)

BASE_URL = "https://financialmodelingprep.com/stable"
PROVIDER = "Financial Modeling Prep"


def _require_key(capability: Capability) -> str:
    settings = get_settings()
    if not settings.has_fmp:
        raise ProviderNotConfigured(PROVIDER, capability)
    return settings.fmp_api_key


async def _fetch(path: str, capability: Capability, **params: Any) -> Any:
    key = _require_key(capability)
    async with build_client() as client:
        return await get_json(
            client,
            f"{BASE_URL}/{path}",
            {**params, "apikey": key},
            provider=PROVIDER,
            capability=capability,
        )


# The SEC defines a penny stock as trading under $5. Daily "biggest movers"
# lists are dominated by them -- a live sample showed +801%, +97% and +84% at
# the top, all sub-$5 microcaps. They are the securities most exposed to
# pump-and-dump promotion, so each row carries a flag and the UI marks it.
# Flagged rather than filtered: silently removing them would misreport what the
# day's actual biggest movers were.
PENNY_STOCK_THRESHOLD = 5.0


def _normalise_mover(row: dict[str, Any]) -> dict[str, Any] | None:
    symbol = row.get("symbol")
    price = as_float(row.get("price"))
    if not symbol or price is None:
        return None  # drop rather than render a row with a blank price
    return {
        "ticker": str(symbol).upper(),
        "name": row.get("name") or str(symbol).upper(),
        "price": price,
        "change": as_float(row.get("change")),
        "change_percent": as_float(row.get("changesPercentage")),
        "exchange": row.get("exchange"),
        "low_priced": price < PENNY_STOCK_THRESHOLD,
    }


async def fetch_movers(kind: str, limit: int = 10) -> list[dict[str, Any]]:
    """Top gainers, losers, or most actively traded symbols."""
    paths = {
        "gainers": "biggest-gainers",
        "losers": "biggest-losers",
        "actives": "most-actives",
    }
    if kind not in paths:
        raise ValueError(f"unknown movers kind '{kind}'; expected one of {sorted(paths)}")

    payload = await _fetch(paths[kind], Capability.MOVERS)
    rows = payload if isinstance(payload, list) else []
    movers = [normalised for row in rows if (normalised := _normalise_mover(row))]
    return movers[:limit]


async def fetch_sector_performance(date: str) -> list[dict[str, Any]]:
    """Average change per sector for one date."""
    payload = await _fetch(
        "sector-performance-snapshot", Capability.SECTORS, date=date, exchange="NASDAQ"
    )
    rows = payload if isinstance(payload, list) else []

    sectors: list[dict[str, Any]] = []
    for row in rows:
        name = row.get("sector")
        change = as_float(row.get("averageChange"))
        if not name or change is None:
            continue
        sectors.append({"sector": str(name), "change_percent": change})

    sectors.sort(key=lambda item: item["change_percent"], reverse=True)
    return sectors


async def fetch_profile(ticker: str) -> dict[str, Any] | None:
    """Company fundamentals. Returns None when the symbol is unknown."""
    payload = await _fetch("profile", Capability.FUNDAMENTALS, symbol=ticker.upper())
    rows = payload if isinstance(payload, list) else []
    if not rows:
        return None

    row = rows[0]
    return {
        "ticker": str(row.get("symbol") or ticker).upper(),
        "name": row.get("companyName") or row.get("name"),
        "sector": row.get("sector") or None,
        "industry": row.get("industry") or None,
        "country": row.get("country") or None,
        "exchange": row.get("exchange") or row.get("exchangeFullName") or None,
        "market_cap": as_float(row.get("marketCap")),
        "beta": as_float(row.get("beta")),
        "last_dividend": as_float(row.get("lastDividend")),
        "average_volume": as_float(row.get("averageVolume")),
        "employees": as_float(row.get("fullTimeEmployees")),
        "website": row.get("website") or None,
        "description": row.get("description") or None,
        "ceo": row.get("ceo") or None,
        "is_etf": bool(row.get("isEtf")),
        "source": "Financial Modeling Prep",
    }
