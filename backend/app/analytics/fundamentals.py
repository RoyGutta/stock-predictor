"""Reported financial measures from SEC XBRL company facts. Pure functions.

Company facts are every value a company tagged in every periodic report. The
same number appears many times (each 10-K repeats two prior years), the same
tag carries quarterly, year-to-date, and annual durations, and companies move
between tags as the taxonomy changes. Rules applied here, each pinned by a test:

- Periods are classified by their own start and end dates, never by the
  filing's `fy`/`fp` labels (those describe the report, not the fact).
  Annual: 350-380 days (covers 52/53-week years). Quarterly: 80-100 days.
  Year-to-date durations (about 180 and 270 days) are excluded, not converted.
- Fourth quarters are not derived. Most companies report Q4 only inside the
  annual total; subtracting nine months from twelve would mix facts from
  different filings, so the quarterly view simply has no Q4 point.
- One value per period: the most recently filed fact wins, which is how
  amendments and restatements take effect. A period whose value changed
  between filings is marked `revised`, with the first-reported value kept.
- Units must match exactly (USD, or USD per share). Facts in other units are
  ignored and named, never converted.
- Only periodic reports (10-K, 10-Q, 20-F, 40-F and transition/amended forms)
  are read; registration statements also carry facts but are not reports.
- A missing measure is `None` with a reason, never zero.
- Year-over-year compares a period only with the period ending 350-380 days
  earlier under the same concept. Percent change is withheld when the earlier
  value is zero or negative.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Literal

Period = Literal["annual", "quarterly"]

ANNUAL_DAYS = (350, 380)
QUARTER_DAYS = (80, 100)
YOY_GAP_DAYS = (350, 380)
SERIES_LIMIT: dict[str, int] = {"annual": 10, "quarterly": 12}

ANNUAL_FORMS = {"10-K", "10-KT", "20-F", "40-F"}
PERIODIC_FORMS = ANNUAL_FORMS | {"10-Q", "10-QT"}

ARCHIVES_URL = "https://www.sec.gov/Archives/edgar/data"


@dataclass(frozen=True)
class MetricSpec:
    key: str
    label: str
    unit: str
    kind: Literal["duration", "instant"]
    tags: tuple[str, ...]
    definition: str
    # True only where the tags are successive names for the same concept
    # (revenue across the 2018 taxonomy change). Otherwise one tag per series.
    merge_tags: bool = False


METRICS: tuple[MetricSpec, ...] = (
    MetricSpec(
        "revenue", "Revenue", "USD", "duration",
        (
            "RevenueFromContractWithCustomerExcludingAssessedTax",
            "Revenues",
            "SalesRevenueNet",
            "RevenueFromContractWithCustomerIncludingAssessedTax",
        ),
        "Total revenue as reported. The tag changed with the 2018 revenue standard; "
        "each value names the tag it came from.",
        merge_tags=True,
    ),
    MetricSpec(
        "gross_profit", "Gross profit", "USD", "duration", ("GrossProfit",),
        "Revenue minus cost of revenue, as reported. Many service and financial "
        "companies do not report it.",
    ),
    MetricSpec(
        "operating_income", "Operating income", "USD", "duration", ("OperatingIncomeLoss",),
        "Profit from operations before interest and taxes, as reported.",
    ),
    MetricSpec(
        "net_income", "Net income", "USD", "duration", ("NetIncomeLoss",),
        "Net income attributable to the parent company's shareholders.",
    ),
    MetricSpec(
        "eps_basic", "EPS (basic)", "USD/shares", "duration", ("EarningsPerShareBasic",),
        "Net income per weighted-average share outstanding.",
    ),
    MetricSpec(
        "eps_diluted", "EPS (diluted)", "USD/shares", "duration",
        ("EarningsPerShareDiluted",),
        "Net income per share including the effect of options and convertibles.",
    ),
    MetricSpec(
        "cash", "Cash and equivalents", "USD", "instant",
        (
            "CashAndCashEquivalentsAtCarryingValue",
            "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
        ),
        "Balance at period end. When only the second tag is reported, the figure "
        "includes restricted cash; the tag is shown with every value.",
    ),
    MetricSpec(
        "total_assets", "Total assets", "USD", "instant", ("Assets",),
        "Balance at period end.",
    ),
    MetricSpec(
        "total_liabilities", "Total liabilities", "USD", "instant", ("Liabilities",),
        "Balance at period end. Some companies never report a total; it is not "
        "derived from other lines here.",
    ),
    MetricSpec(
        "operating_cash_flow", "Operating cash flow", "USD", "duration",
        ("NetCashProvidedByUsedInOperatingActivities",),
        "Net cash provided by (used in) operating activities.",
    ),
    MetricSpec(
        "capital_expenditures", "Capital expenditures", "USD", "duration",
        ("PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"),
        "Cash paid for property, plant, and equipment, reported as a positive "
        "payment. The second tag is broader and is used only when the first is absent.",
    ),
)

METRICS_BY_KEY = {spec.key: spec for spec in METRICS}
ALL_TAGS: tuple[str, ...] = tuple(dict.fromkeys(tag for spec in METRICS for tag in spec.tags))


@dataclass(frozen=True)
class Fact:
    tag: str
    start: date | None
    end: date
    value: float
    accession: str
    form: str
    filed: date

    @property
    def duration_days(self) -> int | None:
        return None if self.start is None else (self.end - self.start).days

    @property
    def key(self) -> tuple[date | None, date]:
        return (self.start, self.end)


def reduce_company_facts(raw: Any) -> dict[str, Any]:
    """Keep the tags this app reads, in every unit; validated shape."""
    facts = raw["facts"]
    if not isinstance(facts, dict):
        raise ValueError("facts is not an object")
    gaap = facts.get("us-gaap") or {}
    tags: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for tag in ALL_TAGS:
        concept = gaap.get(tag)
        if not concept:
            continue
        tags[tag] = {
            str(unit): [
                {k: row.get(k) for k in ("start", "end", "val", "accn", "form", "filed")}
                for row in rows
                if isinstance(row, dict)
            ]
            for unit, rows in concept["units"].items()
        }
    return {
        "cik": int(raw["cik"]),
        "entity_name": str(raw.get("entityName") or ""),
        "taxonomies": sorted(str(name) for name in facts),
        "tags": tags,
    }


def _date(value: Any) -> date | None:
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def parse_fact(tag: str, row: dict[str, Any]) -> Fact | None:
    """A validated fact, or None. Booleans, NaN, and unparseable dates are rejected."""
    value = row.get("val")
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    if not math.isfinite(value):
        return None
    end, filed = _date(row.get("end")), _date(row.get("filed"))
    start = _date(row.get("start")) if row.get("start") else None
    if end is None or filed is None or (row.get("start") and start is None):
        return None
    if start is not None and start > end:
        return None
    accession = str(row.get("accn") or "")
    if not accession:
        return None
    return Fact(tag, start, end, float(value), accession, str(row.get("form") or ""), filed)


def base_form(form: str) -> str:
    return form[:-2] if form.endswith("/A") else form


def fits(fact: Fact, spec: MetricSpec, period: Period) -> bool:
    """Whether a fact belongs in this view of this metric."""
    form = base_form(fact.form)
    if form not in PERIODIC_FORMS:
        return False
    if spec.kind == "instant":
        if fact.start is not None:
            return False
        return form in ANNUAL_FORMS if period == "annual" else True
    days = fact.duration_days
    if days is None:
        return False
    low, high = ANNUAL_DAYS if period == "annual" else QUARTER_DAYS
    return low <= days <= high


def _is_year_to_date(fact: Fact) -> bool:
    days = fact.duration_days
    return (
        days is not None
        and QUARTER_DAYS[1] < days < ANNUAL_DAYS[0]
        and base_form(fact.form) in PERIODIC_FORMS
    )


def filing_index_url(cik: int, accession: str) -> str:
    return f"{ARCHIVES_URL}/{cik}/{accession.replace('-', '')}/{accession}-index.htm"


def _collect(
    tags: dict[str, dict[str, list[dict[str, Any]]]], spec: MetricSpec, period: Period
) -> tuple[list[Fact], list[str], int]:
    """(facts that fit, units ignored, year-to-date facts excluded).

    Year-to-date means a duration between a quarter and a year (about 6 or 9
    months). Annual facts seen in the quarterly view are not counted: a company
    that reports only annually has no year-to-date figures to explain.
    """
    fitting: list[Fact] = []
    ignored_units: set[str] = set()
    excluded = 0
    for tag in spec.tags:
        for unit, rows in tags.get(tag, {}).items():
            if unit != spec.unit:
                ignored_units.add(unit)
                continue
            for row in rows:
                fact = parse_fact(tag, row)
                if fact is None:
                    continue
                if fits(fact, spec, period):
                    fitting.append(fact)
                elif _is_year_to_date(fact):
                    excluded += 1
    return fitting, sorted(ignored_units), excluded


def _choose_tag_facts(facts: list[Fact], spec: MetricSpec) -> list[Fact]:
    if spec.merge_tags:
        return facts
    for tag in spec.tags:
        chosen = [fact for fact in facts if fact.tag == tag]
        if chosen:
            return chosen
    return []


def _pick(group: list[Fact], spec: MetricSpec) -> Fact:
    """Highest-priority tag, then latest filing, then highest accession (deterministic)."""
    priority = {tag: index for index, tag in enumerate(spec.tags)}
    best = group[0]
    for fact in group[1:]:
        a = (priority[fact.tag], -fact.filed.toordinal())
        b = (priority[best.tag], -best.filed.toordinal())
        if a < b or (a == b and fact.accession > best.accession):
            best = fact
    return best


def build_series(
    company_facts: dict[str, Any], spec: MetricSpec, period: Period
) -> dict[str, Any]:
    tags = company_facts["tags"]
    cik = int(company_facts["cik"])
    facts, ignored_units, excluded = _collect(tags, spec, period)
    facts = _choose_tag_facts(facts, spec)

    groups: dict[tuple[date | None, date], list[Fact]] = {}
    for fact in facts:
        groups.setdefault(fact.key, []).append(fact)

    points: list[dict[str, Any]] = []
    for group in groups.values():
        chosen = _pick(group, spec)
        same_tag = sorted((f for f in group if f.tag == chosen.tag), key=lambda f: f.filed)
        revised = len({f.value for f in same_tag}) > 1
        points.append(
            {
                "period_start": chosen.start.isoformat() if chosen.start else None,
                "period_end": chosen.end.isoformat(),
                "duration_days": chosen.duration_days,
                "value": chosen.value,
                "tag": chosen.tag,
                "form": chosen.form,
                "filed": chosen.filed.isoformat(),
                "accession_number": chosen.accession,
                "filing_url": filing_index_url(cik, chosen.accession),
                "amended": chosen.form.endswith("/A"),
                "revised": revised,
                "first_reported_value": same_tag[0].value if revised else None,
                "yoy": None,
            }
        )
    points, conflicts = _one_point_per_end(points)
    attach_yoy(points, cross_tag=spec.merge_tags)
    shown = points[-SERIES_LIMIT[period]:]

    return {
        "key": spec.key,
        "label": spec.label,
        "unit": spec.unit,
        "kind": spec.kind,
        "definition": spec.definition,
        "tags_considered": list(spec.tags),
        "points": shown,
        "missing_reason": (
            None if shown else _missing_reason(tags, spec, period, ignored_units, excluded)
        ),
        "ignored_units": ignored_units,
        "period_conflicts": conflicts,
    }


def _one_point_per_end(points: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str]]:
    """One value per period end within a view; the most recently filed wins.

    Two periods of the same kind ending on the same day but starting on different
    days (a fiscal-calendar change, a re-presented 53-week year) cannot both be
    shown in one column. The superseded one is named rather than silently lost.
    """
    by_end: dict[str, list[dict[str, Any]]] = {}
    for point in points:
        by_end.setdefault(point["period_end"], []).append(point)
    kept: list[dict[str, Any]] = []
    conflicts: list[str] = []
    for end, group in by_end.items():
        group.sort(key=lambda p: (p["filed"], p["accession_number"]))
        winner = group[-1]
        kept.append(winner)
        for loser in group[:-1]:
            conflicts.append(
                f"Two periods end on {end}: {loser['period_start']} to {end} "
                f"({loser['form']} filed {loser['filed']}) was replaced by "
                f"{winner['period_start']} to {end} ({winner['form']} filed {winner['filed']})."
            )
    kept.sort(key=lambda p: p["period_end"])
    return kept, conflicts


def _missing_reason(
    tags: dict[str, Any], spec: MetricSpec, period: Period, ignored: list[str], excluded: int
) -> str:
    if not any(tag in tags for tag in spec.tags):
        plural = "s" if len(spec.tags) > 1 else ""
        return (
            f"Not reported under the US GAAP tag{plural} this view reads "
            f"({', '.join(spec.tags)}). The company may use a different or custom tag, or "
            "not report it. It is left blank rather than estimated."
        )
    if ignored and not excluded:
        return (
            f"Reported only in units this view does not use ({', '.join(ignored)}); values "
            "are not converted."
        )
    if period == "quarterly" and spec.kind == "duration" and excluded:
        return (
            "Quarterly reports give this only as year-to-date totals. This view does not "
            "subtract periods to derive single quarters; see the annual view."
        )
    return f"No {period} values were found in the company's periodic reports."


def attach_yoy(
    points: list[dict[str, Any]], *, cross_tag: bool = False, percent: bool = True
) -> None:
    """Compare each point with the comparable point ending one year earlier.

    `percent=False` is for ratios: their change is reported in points (a margin
    from 40% to 42% is +2 points), and a percent of a percent would mislead.
    """
    for index, point in enumerate(points):
        end = date.fromisoformat(point["period_end"])
        earliest = end - timedelta(days=YOY_GAP_DAYS[1])
        latest = end - timedelta(days=YOY_GAP_DAYS[0])
        candidates = [
            other
            for other in points[:index]
            if (cross_tag or other["tag"] == point["tag"])
            and earliest <= date.fromisoformat(other["period_end"]) <= latest
        ]
        if not candidates:
            continue
        prior = min(
            candidates,
            key=lambda o: abs((end - date.fromisoformat(o["period_end"])).days - 364),
        )
        change = point["value"] - prior["value"]
        notes: list[str] = []
        pct: float | None = None
        if not percent:
            pass
        elif prior["value"] > 0:
            pct = round(change / prior["value"], 6)
        else:
            notes.append(
                "Percent change is not meaningful when the earlier value is zero or negative."
            )
        a, b = point["duration_days"], prior["duration_days"]
        if a is not None and b is not None and abs(a - b) > 3:
            notes.append(
                f"The periods differ in length ({a} vs {b} days), for example a 53-week year."
            )
        point["yoy"] = {
            "prior_period_end": prior["period_end"],
            "prior_value": prior["value"],
            "change": change,
            "change_pct": pct,
            "note": " ".join(notes) or None,
        }
