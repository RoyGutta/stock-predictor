"""Finnhub.

Verified against a live free-tier key on 2026-08-05: quote, stock/profile2,
company-news, and search all work. Free tier covers US equities; WebSocket
streaming is paid-only, so nothing here claims to be real-time.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlparse

from app.config import get_settings
from app.services.providers.base import (
    Capability,
    ProviderNotConfigured,
    as_float,
    build_client,
    get_json,
)

logger = logging.getLogger(__name__)

BASE_URL = "https://finnhub.io/api/v1"
PROVIDER = "Finnhub"

# Headlines shorter than this are almost always truncated feed noise.
_MIN_HEADLINE_LENGTH = 12

# Article URLs come from a third-party feed and are rendered as links. Only
# http(s) may ever reach a client: a `javascript:` or `data:` URL in an href
# executes when clicked, which would turn a compromised or careless news feed
# into stored XSS in this app. Validated here, where the untrusted data enters,
# so every consumer is protected rather than relying on each one to re-check.
_SAFE_URL_SCHEMES = frozenset({"http", "https"})


def _is_safe_url(value: object) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    try:
        parsed = urlparse(value.strip())
    except ValueError:
        return False
    # A netloc is required too: "https:evil" parses with a valid scheme but no host.
    return parsed.scheme.lower() in _SAFE_URL_SCHEMES and bool(parsed.netloc)


def _require_key(capability: Capability) -> str:
    settings = get_settings()
    if not settings.has_finnhub:
        raise ProviderNotConfigured(PROVIDER, capability)
    return settings.finnhub_api_key


async def _fetch(path: str, capability: Capability, **params: Any) -> Any:
    key = _require_key(capability)
    async with build_client() as client:
        return await get_json(
            client,
            f"{BASE_URL}/{path}",
            {**params, "token": key},
            provider=PROVIDER,
            capability=capability,
        )


async def search_symbols(query: str, limit: int = 10) -> list[dict[str, Any]]:
    """Symbol search for the ticker autocomplete."""
    payload = await _fetch("search", Capability.SEARCH, q=query, exchange="US")
    rows = payload.get("result", []) if isinstance(payload, dict) else []

    results: list[dict[str, Any]] = []
    for row in rows:
        symbol = row.get("symbol")
        if not symbol or "." in str(symbol):
            continue  # skip foreign listings the free tier cannot price
        results.append(
            {
                "ticker": str(symbol).upper(),
                "name": row.get("description") or str(symbol).upper(),
                "type": row.get("type") or None,
            }
        )
        if len(results) >= limit:
            break
    return results


async def fetch_company_news(ticker: str, days: int = 14, limit: int = 12) -> list[dict[str, Any]]:
    """Recent news for one company, newest first."""
    today = datetime.now(UTC).date()
    payload = await _fetch(
        "company-news",
        Capability.NEWS,
        symbol=ticker.upper(),
        **{"from": (today - timedelta(days=days)).isoformat(), "to": today.isoformat()},
    )
    rows = payload if isinstance(payload, list) else []

    articles: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows:
        headline = (row.get("headline") or "").strip()
        url = row.get("url")
        if not headline or len(headline) < _MIN_HEADLINE_LENGTH:
            continue
        if not _is_safe_url(url):
            # Drop rather than render a link we would not let a user click.
            logger.warning("Dropped article with unsafe or missing URL for %s", ticker)
            continue
        # Wire stories are syndicated verbatim across outlets; dedupe by headline.
        fingerprint = headline.lower()
        if fingerprint in seen:
            continue
        seen.add(fingerprint)

        published = row.get("datetime")
        articles.append(
            {
                "headline": headline,
                "summary": (row.get("summary") or "").strip() or None,
                "source": row.get("source") or None,
                "url": str(url).strip(),
                "published_at": (
                    datetime.fromtimestamp(published, UTC).isoformat()
                    if isinstance(published, int | float) and published
                    else None
                ),
                "image": (row.get("image") if _is_safe_url(row.get("image")) else None),
            }
        )
        if len(articles) >= limit:
            break

    articles.sort(key=lambda item: item["published_at"] or "", reverse=True)
    return articles


async def fetch_quote(ticker: str) -> dict[str, Any] | None:
    """Latest quote. Finnhub returns zeroes rather than an error for unknown
    symbols, so a zero current price is treated as 'no data'."""
    payload = await _fetch("quote", Capability.FUNDAMENTALS, symbol=ticker.upper())
    if not isinstance(payload, dict):
        return None

    price = as_float(payload.get("c"))
    if not price:
        return None

    return {
        "ticker": ticker.upper(),
        "price": price,
        "change": as_float(payload.get("d")),
        "change_percent": as_float(payload.get("dp")),
        "high": as_float(payload.get("h")),
        "low": as_float(payload.get("l")),
        "open": as_float(payload.get("o")),
        "previous_close": as_float(payload.get("pc")),
        "source": "Finnhub",
    }
