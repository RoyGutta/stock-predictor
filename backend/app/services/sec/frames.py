"""Fundamentals screener built on SEC's XBRL "frames" API.

A frame is one US GAAP concept for one calendar period across every filer:
https://data.sec.gov/api/xbrl/frames/us-gaap/{Tag}/{Unit}/CY{YYYY}.json holds
annual (about 365-day) durations, CY{YYYY}Q4I the year-end instants.

SEC builds frames by calendar-aligning each filer's facts: a fiscal year that
ends in, say, June is placed in the calendar year it most overlaps. Figures in
one frame therefore cover broadly comparable, not identical, twelve months.

The screen reads the two most recent complete calendar years (last year and
the year before, from today's date). Each response is reduced in the client's
transform to {cik: (val, end, accn, entityName)} before caching for 24 hours.
Industry (SIC) is not part of frames -- it would take one submissions request
per company -- so the screen offers revenue size bands instead.

No market price is read anywhere here; valuation ratios are not computed.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from datetime import date
from typing import Any

from app.services.providers.base import ProviderError
from app.services.sec.client import COMPANY_PAGE_URL, Fetched, SecNotFound, get_sec_client
from app.services.sec.service import SOURCE

FRAMES_URL = "https://data.sec.gov/api/xbrl/frames/us-gaap/{tag}/{unit}/{period}.json"
FRAMES_TTL_SECONDS = 86_400
MAX_FRAME_BYTES = 25 * 1024 * 1024

REVENUE_TAGS = ("RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues")
NET_INCOME_TAG = "NetIncomeLoss"
OCF_TAG = "NetCashProvidedByUsedInOperatingActivities"
CAPEX_TAG = "PaymentsToAcquirePropertyPlantAndEquipment"
ASSETS_TAG = "Assets"
LIABILITIES_TAG = "Liabilities"

# Lower bound (USD, inclusive) of each revenue size band, largest first.
SIZE_BANDS: tuple[tuple[str, str, float], ...] = (
    ("100b_plus", "$100B or more", 100e9),
    ("10b_100b", "$10B to $100B", 10e9),
    ("1b_10b", "$1B to $10B", 1e9),
    ("100m_1b", "$100M to $1B", 100e6),
    ("under_100m", "Under $100M", 0.0),
)

METRICS = (
    "revenue",
    "revenue_growth_pct",
    "net_income",
    "net_margin_pct",
    "operating_cash_flow",
    "ocf_margin_pct",
    "free_cash_flow",
    "liabilities_to_assets",
    "name",
)

Point = tuple[float, str | None, str | None, str | None]  # val, end, accn, entityName
Frame = dict[int, Point]


NOTES = (
    "A research screen on figures companies reported to the SEC. It is not a "
    "recommendation and says nothing about whether a company is a good investment.",
    "SEC frames calendar-align fiscal years: each company's fiscal year is placed in "
    "the calendar year it most overlaps, so periods are comparable but not identical.",
    "No valuation metrics (P/E, EV/EBITDA, yields) are shown: they need market prices, "
    "and this screen uses no price data.",
    "Industry (SIC code) is not in frames and would need one SEC request per company, "
    "so peers are grouped by revenue size band instead.",
    "A missing figure means the company did not report that US GAAP tag for the "
    "period; it is shown as blank, never as zero. A filter on a figure excludes "
    "companies for which it is unknown.",
    "Revenue uses RevenueFromContractWithCustomerExcludingAssessedTax, else Revenues. "
    "Growth compares the same tag in both years and needs positive prior revenue.",
)


class FrameTooLarge(ProviderError):
    def __init__(self) -> None:
        super().__init__(
            "SEC returned a frames response larger than this server accepts "
            f"({MAX_FRAME_BYTES // (1024 * 1024)} MB). It was not used.",
            status_code=502,
        )


def _today() -> date:
    return date.today()


def calendar_years(today: date) -> tuple[int, int]:
    """(latest, prior): the two most recent complete calendar years."""
    return today.year - 1, today.year - 2


def frame_url(tag: str, period: str, unit: str = "USD") -> str:
    return FRAMES_URL.format(tag=tag, unit=unit, period=period)


def _text(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def reduce_frame(raw: Any) -> Frame:
    """Keep {cik: (val, end, accn, entityName)}; drop malformed rows, refuse huge bodies."""
    if not isinstance(raw, dict):
        raise TypeError("frames body is not an object")
    if len(json.dumps(raw, separators=(",", ":"))) > MAX_FRAME_BYTES:
        raise FrameTooLarge()
    rows = raw.get("data") or []
    if not isinstance(rows, list):
        raise TypeError("frames data is not a list")
    out: Frame = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        cik, val = row.get("cik"), row.get("val")
        if isinstance(cik, bool) or isinstance(val, bool):
            continue
        if not isinstance(cik, int) or cik <= 0 or not isinstance(val, int | float):
            continue
        out[cik] = (float(val), _text(row.get("end")), _text(row.get("accn")),
                    _text(row.get("entityName")))
    return out


@dataclass(frozen=True)
class FrameResult:
    key: str
    tag: str
    period: str
    url: str
    fetched: Fetched | None  # None when SEC has no such frame (404)

    @property
    def data(self) -> Frame:
        return self.fetched.data if self.fetched is not None else {}


async def _fetch(key: str, tag: str, period: str) -> FrameResult:
    url = frame_url(tag, period)
    try:
        fetched = await get_sec_client().get(url, ttl=FRAMES_TTL_SECONDS, transform=reduce_frame)
    except SecNotFound:
        fetched = None
    return FrameResult(key, tag, period, url, fetched)


async def load_frames(latest: int, prior: int) -> list[FrameResult]:
    """Only what the metrics need: revenue for both years, the rest for the latest."""
    plan = [
        *(("revenue", tag, f"CY{latest}") for tag in REVENUE_TAGS),
        *(("revenue_prior", tag, f"CY{prior}") for tag in REVENUE_TAGS),
        ("net_income", NET_INCOME_TAG, f"CY{latest}"),
        ("operating_cash_flow", OCF_TAG, f"CY{latest}"),
        ("capex", CAPEX_TAG, f"CY{latest}"),
        ("assets", ASSETS_TAG, f"CY{latest}Q4I"),
        ("liabilities", LIABILITIES_TAG, f"CY{latest}Q4I"),
    ]
    return list(await asyncio.gather(*(_fetch(*step) for step in plan)))


def size_band(revenue: float | None) -> str | None:
    if revenue is None or revenue < 0:
        return None
    return next(key for key, _, low in SIZE_BANDS if revenue >= low)


def _pct(numerator: float | None, denominator: float | None) -> float | None:
    if numerator is None or denominator is None or denominator <= 0:
        return None
    return numerator / denominator * 100


def _val(frame: Frame, cik: int) -> float | None:
    point = frame.get(cik)
    return point[0] if point is not None else None


def join_companies(frames: list[FrameResult]) -> list[dict[str, Any]]:
    """One row per CIK seen in any latest-year frame. Missing figures stay None."""
    by_key: dict[str, list[FrameResult]] = {}
    for result in frames:
        by_key.setdefault(result.key, []).append(result)

    def single(key: str) -> Frame:
        return by_key[key][0].data if key in by_key else {}

    revenue_now = {r.tag: r.data for r in by_key.get("revenue", [])}
    revenue_prior = {r.tag: r.data for r in by_key.get("revenue_prior", [])}
    net_income, ocf, capex = single("net_income"), single("operating_cash_flow"), single("capex")
    assets, liabilities = single("assets"), single("liabilities")

    ciks: set[int] = set()
    for frame in (*revenue_now.values(), net_income, ocf, capex, assets, liabilities):
        ciks.update(frame)

    rows: list[dict[str, Any]] = []
    for cik in ciks:
        # The first preferred revenue tag the company reported for the latest year.
        tag = next((t for t in REVENUE_TAGS if cik in revenue_now.get(t, {})), None)
        rev_point = revenue_now[tag][cik] if tag else None
        revenue = rev_point[0] if rev_point else None
        # Growth compares the same tag in both years, never one tag against another.
        prior = _val(revenue_prior.get(tag, {}), cik) if tag else None
        growth = (
            (revenue - prior) / prior * 100
            if revenue is not None and prior is not None and prior > 0
            else None
        )
        ni, cash, spend = _val(net_income, cik), _val(ocf, cik), _val(capex, cik)
        total_assets, total_liabilities = _val(assets, cik), _val(liabilities, cik)
        fcf = cash - spend if cash is not None and spend is not None else None
        leverage = (
            total_liabilities / total_assets
            if total_liabilities is not None and total_assets is not None and total_assets > 0
            else None
        )
        name = next(
            (point[3] for frame in (*revenue_now.values(), net_income, ocf, assets, liabilities,
                                    capex)
             if (point := frame.get(cik)) is not None and point[3]),
            None,
        )
        rows.append({
            "cik": cik,
            "name": name,
            "edgar_url": COMPANY_PAGE_URL.format(cik=cik),
            "revenue_tag": tag,
            "period_end": rev_point[1] if rev_point else None,
            "revenue_accession": rev_point[2] if rev_point else None,
            "revenue": revenue,
            "revenue_prior": prior,
            "revenue_growth_pct": growth,
            "net_income": ni,
            "net_margin_pct": _pct(ni, revenue),
            "operating_cash_flow": cash,
            "ocf_margin_pct": _pct(cash, revenue),
            "capital_expenditures": spend,
            "free_cash_flow": fcf,
            "total_assets": total_assets,
            "total_liabilities": total_liabilities,
            "liabilities_to_assets": leverage,
            "size_band": size_band(revenue),
        })
    return rows


@dataclass(frozen=True)
class Criteria:
    min_revenue: float | None = None
    min_growth: float | None = None
    max_growth: float | None = None
    min_net_margin: float | None = None
    max_liabilities_to_assets: float | None = None
    positive_fcf: bool = False
    name: str | None = None
    size_band: str | None = None
    sort: str = "revenue"
    order: str = "desc"
    limit: int = 25
    offset: int = 0


def _at_least(value: float | None, bound: float | None) -> bool:
    return bound is None or (value is not None and value >= bound)


def _at_most(value: float | None, bound: float | None) -> bool:
    return bound is None or (value is not None and value <= bound)


def matches(row: dict[str, Any], c: Criteria) -> bool:
    """A bound on a metric excludes companies whose metric is unknown."""
    if c.name and c.name.casefold() not in (row["name"] or "").casefold():
        return False
    if c.size_band and row["size_band"] != c.size_band:
        return False
    if c.positive_fcf and not (row["free_cash_flow"] is not None and row["free_cash_flow"] > 0):
        return False
    return (
        _at_least(row["revenue"], c.min_revenue)
        and _at_least(row["revenue_growth_pct"], c.min_growth)
        and _at_most(row["revenue_growth_pct"], c.max_growth)
        and _at_least(row["net_margin_pct"], c.min_net_margin)
        and _at_most(row["liabilities_to_assets"], c.max_liabilities_to_assets)
    )


def sort_rows(rows: list[dict[str, Any]], key: str, order: str) -> list[dict[str, Any]]:
    """Sort by one field; rows without it always come last, ties by CIK."""
    known = [r for r in rows if r.get(key) is not None]
    unknown = sorted((r for r in rows if r.get(key) is None), key=lambda r: r["cik"])
    if key == "name":
        known.sort(key=lambda r: (r["name"].casefold(), r["cik"]), reverse=order == "desc")
    else:
        known.sort(key=lambda r: r["cik"])
        known.sort(key=lambda r: r[key], reverse=order == "desc")
    return known + unknown


def _provenance(frames: list[FrameResult]) -> dict[str, Any]:
    fetched = [f.fetched for f in frames if f.fetched is not None]
    stale = [f for f in fetched if f.stale]
    return {
        "source": SOURCE,
        "retrieved_at": min((f.retrieved_at for f in fetched), default=None),
        "stale": bool(stale),
        "stale_reason": stale[0].stale_reason if stale else None,
    }


async def run_screen(criteria: Criteria) -> dict[str, Any]:
    latest, prior = calendar_years(_today())
    frames = await load_frames(latest, prior)
    rows = join_companies(frames)
    selected = sort_rows([r for r in rows if matches(r, criteria)], criteria.sort, criteria.order)
    page = selected[criteria.offset : criteria.offset + criteria.limit]
    return {
        **_provenance(frames),
        "calendar_year": latest,
        "prior_calendar_year": prior,
        "frames": [
            {
                "measure": f.key,
                "tag": f.tag,
                "period": f.period,
                "url": f.url,
                "available": f.fetched is not None,
                "companies": len(f.data),
            }
            for f in frames
        ],
        "universe": len(rows),
        "total_matches": len(selected),
        "offset": criteria.offset,
        "limit": criteria.limit,
        "size_bands": [{"key": k, "label": label, "min_revenue": low}
                       for k, label, low in SIZE_BANDS],
        "notes": list(NOTES),
        "results": page,
    }
