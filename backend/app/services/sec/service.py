"""SEC features as the API serves them: lookup, filings, fundamentals.

Every response carries its provenance -- source, SEC URL, when SEC last served
the data to this server, and whether a stale cached copy stood in for a failed
request -- because reported financials are only as useful as the reader's
knowledge of which filing and which period they describe.
"""

from __future__ import annotations

from typing import Any

from app.analytics.fundamentals import METRICS, Period, build_series, reduce_company_facts
from app.analytics.fundamentals_derived import DERIVED, build_derived
from app.config import get_settings
from app.services.sec.client import (
    COMPANY_FACTS_URL,
    COMPANY_PAGE_URL,
    SUBMISSIONS_URL,
    Fetched,
    SecNotFound,
    get_sec_client,
)
from app.services.sec.companies import Company, load_ticker_map, resolve, search
from app.services.sec.filings import reduce_submissions, select_filings

SOURCE = "U.S. Securities and Exchange Commission (EDGAR)"

NO_FACTS_NOTE = (
    "SEC has no XBRL financial statements for this filer. Funds, trusts, and some "
    "foreign or newly registered companies do not file them."
)
IFRS_NOTE = (
    "This company reports under IFRS. This view reads US GAAP tags only, so its "
    "figures are not shown here; its filings are listed in the filings panel."
)
REPORTED_NOTE = (
    "Figures are as reported in the company's own filings and describe the periods "
    "shown, not the present. SEC publishes them within about a minute of a filing; "
    "they are not real-time data."
)


def _provenance(primary: Fetched, *others: Fetched) -> dict[str, Any]:
    stale = [item for item in (primary, *others) if item.stale]
    return {
        "source": SOURCE,
        "retrieved_at": primary.retrieved_at,
        "stale": bool(stale),
        "stale_reason": stale[0].stale_reason if stale else None,
    }


def company_out(company: Company, name: str | None = None) -> dict[str, Any]:
    return {
        "cik": company.cik,
        "cik_padded": f"{company.cik:010d}",
        "name": name or company.name,
        "tickers": list(company.tickers),
        "edgar_url": COMPANY_PAGE_URL.format(cik=company.cik),
    }


async def _resolve(query: str) -> tuple[Company, Fetched]:
    mapping = await load_ticker_map()
    return resolve(mapping.data, query), mapping


async def search_companies(query: str, limit: int) -> dict[str, Any]:
    mapping = await load_ticker_map()
    matches = search(mapping.data, query, limit)
    return {
        "query": query.strip(),
        "results": [company_out(company) for company in matches],
        **_provenance(mapping),
    }


async def get_filings(query: str, forms: set[str] | None, limit: int) -> dict[str, Any]:
    company, mapping = await _resolve(query)
    settings = get_settings()
    try:
        fetched = await get_sec_client().get(
            SUBMISSIONS_URL.format(cik=company.cik),
            ttl=settings.sec_submissions_ttl,
            transform=reduce_submissions,
        )
    except SecNotFound as exc:
        raise SecNotFound(f"SEC has no filing history for CIK {company.cik}.") from exc
    reduced = fetched.data
    resolved = Company(
        cik=company.cik,
        name=reduced["name"] or company.name,
        tickers=tuple(reduced["tickers"]) or company.tickers,
    )
    return {
        "company": {
            **company_out(resolved),
            "entity_type": reduced["entity_type"],
            "fiscal_year_end": reduced["fiscal_year_end"],
            "industry": reduced["sic_description"],
        },
        "filings": select_filings(reduced, forms, limit),
        "coverage_note": (
            "Shows reports from SEC's recent-filings index, which covers at least the last "
            "year. Older filings are on the company's EDGAR page."
            if reduced["has_older_pages"]
            else None
        ),
        **_provenance(fetched, mapping),
    }


async def get_fundamentals(query: str, period: Period) -> dict[str, Any]:
    company, mapping = await _resolve(query)
    settings = get_settings()
    base = {"period": period, "note": REPORTED_NOTE}
    try:
        fetched = await get_sec_client().get(
            COMPANY_FACTS_URL.format(cik=company.cik),
            ttl=settings.sec_facts_ttl,
            transform=reduce_company_facts,
        )
    except SecNotFound:
        return {
            **base,
            "company": company_out(company),
            "coverage": "none",
            "coverage_note": NO_FACTS_NOTE,
            "metrics": [],
            "derived": [],
            "latest_filed": None,
            "source_url": None,
            **_provenance(mapping),
        }

    facts = fetched.data
    company_info = company_out(company, facts["entity_name"] or company.name)
    source_url = COMPANY_FACTS_URL.format(cik=company.cik)
    if "us-gaap" not in facts["taxonomies"]:
        coverage = "ifrs" if "ifrs-full" in facts["taxonomies"] else "none"
        return {
            **base,
            "company": company_info,
            "coverage": coverage,
            "coverage_note": IFRS_NOTE if coverage == "ifrs" else NO_FACTS_NOTE,
            "metrics": [],
            "derived": [],
            "latest_filed": None,
            "source_url": source_url,
            **_provenance(fetched, mapping),
        }

    series = [build_series(facts, spec, period) for spec in METRICS]
    by_key = {item["key"]: item for item in series}
    derived = [build_derived(by_key, spec) for spec in DERIVED]
    filed = [p["filed"] for item in series for p in item["points"]]
    return {
        **base,
        "company": company_info,
        "coverage": "us-gaap",
        "coverage_note": None,
        "metrics": series,
        "derived": derived,
        "latest_filed": max(filed) if filed else None,
        "source_url": source_url,
        **_provenance(fetched, mapping),
    }
