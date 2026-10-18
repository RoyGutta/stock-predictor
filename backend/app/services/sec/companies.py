"""Ticker / CIK / company-name resolution against SEC's official ticker map.

SEC identifies filers by CIK (Central Index Key), not by ticker. The mapping
used here is SEC's own `company_tickers.json`. Three facts shape the rules:

- One CIK can have several tickers (GOOGL, GOOG; BRK-A, BRK-B). A ticker
  resolves to its CIK; the CIK's full ticker list is reported.
- SEC writes share classes with a hyphen (BRK-B); "BRK.B" is accepted and
  mapped, nothing else is rewritten.
- A company name is not an identifier. A name resolves only when exactly one
  filer's normalized name equals it; anything else is reported as ambiguous
  with the candidates, never resolved by guessing the "most likely" one.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from app.config import get_settings
from app.services.providers.base import ProviderError
from app.services.sec.client import TICKERS_URL, Fetched, SecNotFound, get_sec_client

_QUERY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 .,&'\-()/]{0,79}$")
_TICKER = re.compile(r"^[A-Z0-9]{1,6}(-[A-Z0-9]{1,3})?$")
_CIK = re.compile(r"^(CIK)?0*(\d{1,10})$", re.IGNORECASE)
# Legal-form words carry no identity; "Apple Inc." and "APPLE INC" are one name.
_SUFFIXES = {
    "inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "limited",
    "plc", "llc", "lp", "sa", "nv", "ag", "the", "holdings", "group",
}


class InvalidCompanyQuery(ProviderError):
    def __init__(self) -> None:
        super().__init__(
            "Enter a ticker (AAPL), an SEC CIK number (CIK320193), or a company name.",
            status_code=400,
        )


@dataclass(frozen=True)
class Company:
    cik: int
    name: str | None
    tickers: tuple[str, ...] = field(default_factory=tuple)


class AmbiguousCompany(ProviderError):
    def __init__(self, query: str, candidates: list[Company]) -> None:
        names = "; ".join(f"{c.name} (CIK {c.cik})" for c in candidates[:5])
        super().__init__(
            f"'{query}' matches more than one SEC filer: {names}. Use a ticker or CIK "
            "to choose one.",
            status_code=409,
        )
        self.candidates = candidates


@dataclass(frozen=True)
class TickerMap:
    by_ticker: dict[str, int]
    by_cik: dict[int, Company]


def normalize_name(name: str) -> str:
    words = re.sub(r"[^a-z0-9 ]+", " ", name.lower()).split()
    return " ".join(word for word in words if word not in _SUFFIXES)


def normalize_ticker(value: str) -> str:
    return value.strip().upper().replace(".", "-")


def parse_ticker_map(raw: Any) -> TickerMap:
    """Reduce SEC's {"0": {"cik_str", "ticker", "title"}, ...} to two indexes."""
    if not isinstance(raw, dict) or not raw:
        raise ValueError("ticker map is not a non-empty object")
    tickers: dict[int, list[str]] = {}
    names: dict[int, str] = {}
    by_ticker: dict[str, int] = {}
    for row in raw.values():
        cik = int(row["cik_str"])
        ticker = str(row["ticker"]).strip().upper()
        if not ticker:
            continue
        by_ticker[ticker] = cik
        tickers.setdefault(cik, []).append(ticker)
        names.setdefault(cik, str(row["title"]).strip())
    by_cik = {
        cik: Company(cik=cik, name=names[cik], tickers=tuple(symbols))
        for cik, symbols in tickers.items()
    }
    return TickerMap(by_ticker=by_ticker, by_cik=by_cik)


async def load_ticker_map() -> Fetched:
    return await get_sec_client().get(
        TICKERS_URL, ttl=get_settings().sec_tickers_ttl, transform=parse_ticker_map
    )


def _validated(query: str) -> str:
    text = query.strip()
    if not _QUERY.match(text):
        raise InvalidCompanyQuery()
    return text


def search(mapping: TickerMap, query: str, limit: int = 10) -> list[Company]:
    """Candidates ranked: exact ticker, exact name, name prefix, name contains."""
    text = _validated(query)
    ticker = normalize_ticker(text)
    target = normalize_name(text)
    ranked: list[tuple[int, str, Company]] = []
    for company in mapping.by_cik.values():
        name = normalize_name(company.name or "")
        if ticker in company.tickers:
            rank = 0
        elif target and name == target:
            rank = 1
        elif target and name.startswith(target):
            rank = 2
        elif len(target) >= 3 and target in name:
            rank = 3
        else:
            continue
        ranked.append((rank, company.name or "", company))
    ranked.sort(key=lambda item: (item[0], item[1]))
    return [company for _, _, company in ranked[:limit]]


def resolve(mapping: TickerMap, query: str) -> Company:
    """One filer for a ticker, CIK, or exact company name -- or a precise error."""
    text = _validated(query)

    cik_match = _CIK.match(text.replace(" ", ""))
    # Short digit strings could be numeric tickers, so a bare number is read as
    # a CIK only when prefixed "CIK" or longer than any listed ticker.
    if cik_match and (text.upper().startswith("CIK") or len(text) > 6):
        cik = int(cik_match.group(2))
        return mapping.by_cik.get(cik, Company(cik=cik, name=None))

    ticker = normalize_ticker(text)
    if _TICKER.match(ticker) and ticker in mapping.by_ticker:
        return mapping.by_cik[mapping.by_ticker[ticker]]

    target = normalize_name(text)
    exact = [
        c for c in mapping.by_cik.values() if target and normalize_name(c.name or "") == target
    ]
    if len(exact) == 1:
        return exact[0]
    if len(exact) > 1:
        raise AmbiguousCompany(text, exact)
    candidates = search(mapping, text, limit=10)
    if candidates:
        raise AmbiguousCompany(text, candidates)
    if cik_match:
        cik = int(cik_match.group(2))
        return mapping.by_cik.get(cik, Company(cik=cik, name=None))
    raise SecNotFound(
        f"SEC's ticker list has no filer matching '{text}'. Funds, recent listings, and "
        "companies that do not file with the SEC may be absent; try the company name."
    )
