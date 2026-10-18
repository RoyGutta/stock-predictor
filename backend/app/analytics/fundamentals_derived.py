"""Ratios and differences computed from reported measures. Pure functions.

A derived figure is produced only when both components describe the identical
period (same start and end dates) and come from the same filing. Mixing an
original value with a later restatement, or a 13-week quarter with a 14-week
one, would yield a number no filing ever supported. When the rule blocks a
value the point is absent and the reason is given; nothing is approximated.

Both components are returned with every value so the arithmetic is checkable.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from app.analytics.fundamentals import attach_yoy


@dataclass(frozen=True)
class DerivedSpec:
    key: str
    label: str
    operation: Literal["ratio", "difference"]
    numerator: str  # metric key; for a difference, the minuend
    denominator: str  # metric key; for a difference, the subtrahend
    unit: str
    definition: str
    caveat: str


DERIVED: tuple[DerivedSpec, ...] = (
    DerivedSpec(
        "gross_margin", "Gross margin", "ratio", "gross_profit", "revenue", "ratio",
        "Gross profit divided by revenue for the same period.",
        "Margins differ structurally across industries; compare a company with its own "
        "history rather than with unrelated businesses.",
    ),
    DerivedSpec(
        "operating_margin", "Operating margin", "ratio", "operating_income", "revenue", "ratio",
        "Operating income divided by revenue for the same period.",
        "One-off charges in a single period can move it sharply; read it across several "
        "periods.",
    ),
    DerivedSpec(
        "net_margin", "Net margin", "ratio", "net_income", "revenue", "ratio",
        "Net income divided by revenue for the same period.",
        "Includes taxes, interest, and non-operating items, which can dominate in some years.",
    ),
    DerivedSpec(
        "free_cash_flow", "Free cash flow", "difference",
        "operating_cash_flow", "capital_expenditures", "USD",
        "Operating cash flow minus capital expenditures, both as reported for the same period.",
        "A common non-GAAP measure that companies define differently; this is the plain "
        "difference of the two reported lines, not any company's own figure.",
    ),
    DerivedSpec(
        "liabilities_to_assets", "Liabilities / assets", "ratio",
        "total_liabilities", "total_assets", "ratio",
        "Total liabilities divided by total assets at the same balance-sheet date.",
        "Shows how much of the balance sheet is funded by obligations rather than equity; "
        "banks and insurers run structurally high ratios.",
    ),
)


def _index(points: list[dict[str, Any]]) -> dict[tuple[str | None, str], dict[str, Any]]:
    return {(p["period_start"], p["period_end"]): p for p in points}


def build_derived(series_by_key: dict[str, dict[str, Any]], spec: DerivedSpec) -> dict[str, Any]:
    first = series_by_key.get(spec.numerator)
    second = series_by_key.get(spec.denominator)
    points: list[dict[str, Any]] = []
    blocked_filing = 0
    blocked_denominator = 0

    if first and second:
        other = _index(second["points"])
        for a in first["points"]:
            b = other.get((a["period_start"], a["period_end"]))
            if b is None:
                continue
            if a["accession_number"] != b["accession_number"]:
                blocked_filing += 1
                continue
            if spec.operation == "ratio":
                if b["value"] <= 0:
                    blocked_denominator += 1
                    continue
                value = round(a["value"] / b["value"], 6)
            else:
                value = a["value"] - b["value"]
            points.append(
                {
                    "period_start": a["period_start"],
                    "period_end": a["period_end"],
                    "duration_days": a["duration_days"],
                    "value": value,
                    "tag": spec.key,
                    "components": {spec.numerator: a["value"], spec.denominator: b["value"]},
                    "form": a["form"],
                    "filed": a["filed"],
                    "accession_number": a["accession_number"],
                    "filing_url": a["filing_url"],
                    "yoy": None,
                }
            )
    points.sort(key=lambda p: (p["period_end"], p["period_start"] or ""))
    attach_yoy(points, percent=spec.operation == "difference")

    reason: str | None = None
    if not points:
        missing = [
            key.replace("_", " ")
            for key in (spec.numerator, spec.denominator)
            if not (series_by_key.get(key) or {}).get("points")
        ]
        if missing:
            reason = f"Needs {' and '.join(missing)}, which this view does not have."
        elif blocked_filing:
            reason = "The components were reported in different filings for every period."
        elif blocked_denominator:
            reason = "The denominator is zero or negative in every period."
        else:
            reason = "The components were never reported for the same period."

    return {
        "key": spec.key,
        "label": spec.label,
        "unit": spec.unit,
        "definition": spec.definition,
        "caveat": spec.caveat,
        "components": [spec.numerator, spec.denominator],
        "points": points,
        "missing_reason": reason,
        "periods_blocked_different_filing": blocked_filing,
    }
