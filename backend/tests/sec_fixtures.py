"""SEC fixtures: recorded excerpts plus hand-built facts. No live requests.

Recorded excerpts were read from sec.gov and data.sec.gov on 2026-10-18 and
trimmed to the rows these tests need; values are unchanged. Hand-built facts
exercise the cases real data contains but not on demand (IFRS-only filers,
foreign units, malformed values).
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import replace
from typing import Any

import httpx

from app.config import get_settings
from app.services.sec.client import COMPANY_FACTS_URL, SUBMISSIONS_URL, TICKERS_URL, SecClient

TEST_AGENT = "Stock Predictor test suite tests@stockpredictor.dev"

# --- company_tickers.json (recorded rows, plus hand-built name collisions)
TICKER_MAP: dict[str, dict[str, Any]] = {
    "0": {"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc."},
    "1": {"cik_str": 1652044, "ticker": "GOOGL", "title": "Alphabet Inc."},
    "2": {"cik_str": 1652044, "ticker": "GOOG", "title": "Alphabet Inc."},
    "3": {"cik_str": 1067983, "ticker": "BRK-B", "title": "BERKSHIRE HATHAWAY INC"},
    "4": {"cik_str": 1067983, "ticker": "BRK-A", "title": "BERKSHIRE HATHAWAY INC"},
    "5": {"cik_str": 884394, "ticker": "SPY", "title": "SPDR S&P 500 ETF TRUST"},
    "6": {"cik_str": 1418121, "ticker": "APLE", "title": "Apple Hospitality REIT, Inc."},
    "7": {"cik_str": 1134982, "ticker": "AAPI", "title": "Apple iSports Group, Inc."},
    "8": {"cik_str": 9000001, "ticker": "ACMA", "title": "Acme Corp"},
    "9": {"cik_str": 9000002, "ticker": "ACMB", "title": "ACME CORPORATION"},
    "10": {"cik_str": 9000003, "ticker": "IFRS", "title": "Foreign Filer PLC"},
}

# --- submissions: recorded AAPL rows; one Form 4 kept to prove filtering, and one
# hand-built 8-K with no primary document, no report date, and an unlisted item.
_SUB_ROWS = [
    ("0001140361-26-035325", "2026-09-01", "2026-04-17", "8-K/A", "5.02",
     "ef20081427_8ka.htm", "8-K/A"),
    ("0000320193-26-000020", "2026-07-31", "2026-06-27", "10-Q", "",
     "aapl-20260627.htm", "10-Q"),
    ("0000320193-26-000018", "2026-07-30", "2026-07-30", "8-K", "2.02,9.01",
     "aapl-20260730.htm", "8-K"),
    ("0001234567-26-000001", "2026-07-29", "", "4", "", "xslF345X05/form4.xml", "FORM 4"),
    ("0000320193-25-000079", "2025-10-31", "2025-09-27", "10-K", "",
     "aapl-20250927.htm", "10-K"),
    ("0000320193-25-000073", "2025-08-01", "2025-06-28", "10-Q", "",
     "aapl-20250628.htm", "10-Q"),
    ("0000320193-25-000999", "2025-07-01", "", "8-K", "5.99", "", ""),
]
_SUB_COLUMNS = ("accessionNumber", "filingDate", "reportDate", "form", "items",
                "primaryDocument", "primaryDocDescription")


def submissions(cik: int = 320193, name: str = "Apple Inc.") -> dict[str, Any]:
    recent: dict[str, list[Any]] = {
        col: [row[i] for row in _SUB_ROWS] for i, col in enumerate(_SUB_COLUMNS)
    }
    recent["acceptanceDateTime"] = ["2026-01-01T00:00:00.000Z"] * len(_SUB_ROWS)
    return {
        "cik": f"{cik:010d}",
        "entityType": "operating",
        "sicDescription": "Electronic Computers",
        "name": name,
        "tickers": ["AAPL"],
        "exchanges": ["Nasdaq"],
        "fiscalYearEnd": "0926",
        "filings": {
            "recent": recent,
            "files": [{"name": "CIK0000320193-submissions-001.json", "filingCount": 1267}],
        },
    }


def fact(start: str | None, end: str, val: Any, accn: str, form: str, filed: str,
         fy: int = 2025, fp: str = "FY") -> dict[str, Any]:
    row: dict[str, Any] = {"end": end, "val": val, "accn": accn, "fy": fy, "fp": fp,
                           "form": form, "filed": filed}
    if start is not None:
        row["start"] = start
    return row


def company_facts(tags: dict[str, dict[str, list[dict[str, Any]]]], *, cik: int = 320193,
                  name: str = "Apple Inc.", taxonomy: str = "us-gaap") -> dict[str, Any]:
    return {
        "cik": cik,
        "entityName": name,
        "facts": {
            "dei": {"EntityCommonStockSharesOutstanding": {"units": {"shares": []}}},
            taxonomy: {tag: {"label": tag, "units": units} for tag, units in tags.items()},
        },
    }


# Recorded AAPL net income facts: three filings repeat FY2022/FY2023 (duplicates),
# and the 2010 10-K/A restated FY2008 from 4,834M to 6,119M (revision).
AAPL_NET_INCOME = [
    fact("2007-09-30", "2008-09-27", 4834000000, "0001193125-09-214859", "10-K", "2009-10-27"),
    fact("2007-09-30", "2008-09-27", 6119000000, "0001193125-10-012091", "10-K/A", "2010-01-25"),
    fact("2007-09-30", "2008-09-27", 6119000000, "0001193125-10-238044", "10-K", "2010-10-27"),
    fact("2021-09-26", "2022-09-24", 99803000000, "0000320193-22-000108", "10-K", "2022-10-28"),
    fact("2021-09-26", "2022-09-24", 99803000000, "0000320193-23-000106", "10-K", "2023-11-03"),
    fact("2021-09-26", "2022-09-24", 99803000000, "0000320193-24-000123", "10-K", "2024-11-01"),
    fact("2022-09-25", "2023-09-30", 96995000000, "0000320193-23-000106", "10-K", "2023-11-03"),
    fact("2022-09-25", "2023-09-30", 96995000000, "0000320193-24-000123", "10-K", "2024-11-01"),
    fact("2022-09-25", "2023-09-30", 96995000000, "0000320193-25-000079", "10-K", "2025-10-31"),
    fact("2025-09-28", "2026-06-27", 101464000000, "0000320193-26-000020", "10-Q", "2026-07-31",
         2026, "Q3"),
    fact("2026-03-29", "2026-06-27", 29789000000, "0000320193-26-000020", "10-Q", "2026-07-31",
         2026, "Q3"),
    fact("2025-12-28", "2026-03-28", 29578000000, "0000320193-26-000013", "10-Q", "2026-05-01",
         2026, "Q2"),
]


def json_response(body: Any, status: int = 200,
                  headers: dict[str, str] | None = None) -> httpx.Response:
    return httpx.Response(
        status,
        content=json.dumps(body).encode(),
        headers={"content-type": "application/json", **(headers or {})},
    )


Handler = Callable[[httpx.Request], httpx.Response]


class Recorder:
    """A MockTransport handler whose responses are chosen per URL; logs requests."""

    def __init__(self, routes: dict[str, Handler]) -> None:
        self.routes = routes
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        handler = self.routes.get(str(request.url))
        if handler is None:
            return httpx.Response(404)
        return handler(request)

    def count(self, fragment: str) -> int:
        return sum(fragment in str(r.url) for r in self.requests)


def make_client(recorder: Recorder, *, clock: Callable[[], float] | None = None,
                agent: str = TEST_AGENT, **overrides: Any) -> SecClient:
    settings = replace(get_settings(), sec_user_agent=agent, **overrides)

    async def no_sleep(_seconds: float) -> None:
        return None

    kwargs: dict[str, Any] = {"transport": httpx.MockTransport(recorder), "sleep": no_sleep}
    if clock is not None:
        kwargs["clock"] = clock
    return SecClient(settings, **kwargs)


def standard_routes(facts: dict[str, Any] | None = None) -> dict[str, Handler]:
    routes: dict[str, Handler] = {
        TICKERS_URL: lambda _r: json_response(TICKER_MAP),
        SUBMISSIONS_URL.format(cik=320193): lambda _r: json_response(submissions()),
    }
    if facts is not None:
        routes[COMPANY_FACTS_URL.format(cik=320193)] = lambda _r: json_response(facts)
    return routes
