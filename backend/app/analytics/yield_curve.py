"""U.S. Treasury par yield curve: strict parsing and descriptive metrics. Pure.

Source: Treasury's "Daily Treasury Par Yield Curve Rates" XML feed (an Atom
feed of OData entries). Each entry is one business day: `d:NEW_DATE` plus one
`d:BC_*` element per constant maturity, in percent. Facts this module relies
on, read from Treasury's pages on 2026-10-24 and pinned by tests:

- Values are percent, bond-equivalent, on an actual/365-366 basis.
- Only business days appear. Weekends and market holidays have no entry; they
  are never filled in here.
- Some maturities did not exist for parts of history (1.5-month from
  2025-02-18, 4-month from 2022-10-19, 20-year absent 1987-1993). An absent
  or null element is `None`, never 0, and nothing is interpolated.

Interest rates are not prices; nothing here touches the stock-price types.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any
from xml.etree import ElementTree as ET

ATOM = "{http://www.w3.org/2005/Atom}"
D = "{http://schemas.microsoft.com/ado/2007/08/dataservices}"
M = "{http://schemas.microsoft.com/ado/2007/08/dataservices/metadata}"

MAX_FEED_BYTES = 2_000_000  # a month is ~35 kB; a year ~400 kB
PLAUSIBLE_RANGE = (-5.0, 30.0)  # percent; outside this a value is rejected as malformed


@dataclass(frozen=True)
class Maturity:
    key: str  # Treasury element name
    label: str
    months: float  # for ordering and chart position


MATURITIES: tuple[Maturity, ...] = (
    Maturity("BC_1MONTH", "1 Mo", 1),
    Maturity("BC_1_5MONTH", "1.5 Mo", 1.5),
    Maturity("BC_2MONTH", "2 Mo", 2),
    Maturity("BC_3MONTH", "3 Mo", 3),
    Maturity("BC_4MONTH", "4 Mo", 4),
    Maturity("BC_6MONTH", "6 Mo", 6),
    Maturity("BC_1YEAR", "1 Yr", 12),
    Maturity("BC_2YEAR", "2 Yr", 24),
    Maturity("BC_3YEAR", "3 Yr", 36),
    Maturity("BC_5YEAR", "5 Yr", 60),
    Maturity("BC_7YEAR", "7 Yr", 84),
    Maturity("BC_10YEAR", "10 Yr", 120),
    Maturity("BC_20YEAR", "20 Yr", 240),
    Maturity("BC_30YEAR", "30 Yr", 360),
)
MATURITY_KEYS = {m.key for m in MATURITIES}
# The maturities the feature requires; a curve missing any of these is incomplete.
CORE_KEYS = (
    "BC_1MONTH", "BC_3MONTH", "BC_6MONTH", "BC_1YEAR",
    "BC_2YEAR", "BC_5YEAR", "BC_10YEAR", "BC_30YEAR",
)
# Elements Treasury sends that are not separate maturities (a display copy, ids).
IGNORED_KEYS = {"BC_30YEARDISPLAY", "Id", "NEW_DATE"}


class TreasuryFeedError(ValueError):
    """The response is not a Treasury par yield curve feed this module understands."""


@dataclass(frozen=True)
class Observation:
    day: date
    yields: dict[str, float | None]  # every MATURITIES key present; absent -> None
    record_id: int | None


@dataclass(frozen=True)
class ParseResult:
    observations: list[Observation]
    rejected_values: list[str]  # "2026-10-01 BC_2YEAR='abc'"
    unknown_fields: list[str]
    duplicate_dates: list[str]


def parse_feed(raw: bytes) -> ParseResult:
    """Validate and parse one feed response. Raises TreasuryFeedError on anything structural."""
    if len(raw) > MAX_FEED_BYTES:
        raise TreasuryFeedError("Treasury response exceeds the size limit.")
    upper = raw.upper()
    if b"<!DOCTYPE" in upper or b"<!ENTITY" in upper:
        raise TreasuryFeedError("Treasury response contains a DTD or entity declaration.")
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as exc:
        raise TreasuryFeedError("Treasury response is not well-formed XML.") from exc
    if root.tag != f"{ATOM}feed":
        raise TreasuryFeedError("Treasury response is not an Atom feed.")

    by_day: dict[date, Observation] = {}
    rejected: list[str] = []
    unknown: set[str] = set()
    duplicates: list[str] = []
    entries = root.findall(f"{ATOM}entry")

    for entry in entries:
        props = entry.find(f"{ATOM}content/{M}properties")
        if props is None:
            raise TreasuryFeedError("A Treasury entry has no properties block.")
        fields = {child.tag.removeprefix(D): child for child in props}
        if "NEW_DATE" not in fields:
            raise TreasuryFeedError(
                "A Treasury entry has no NEW_DATE; the feed schema may have changed."
            )
        day = _parse_date(fields["NEW_DATE"].text)
        record_id = _parse_int(fields.get("Id"))
        yields: dict[str, float | None] = {}
        for maturity in MATURITIES:
            value, problem = _parse_rate(fields.get(maturity.key))
            if problem is not None:
                rejected.append(f"{day.isoformat()} {maturity.key}={problem!r}")
            yields[maturity.key] = value
        unknown.update(k for k in fields if k not in MATURITY_KEYS and k not in IGNORED_KEYS)
        observation = Observation(day, yields, record_id)
        if day in by_day:
            duplicates.append(day.isoformat())
            # The later Treasury record for a day supersedes the earlier one.
            if (record_id or -1) < (by_day[day].record_id or -1):
                continue
        by_day[day] = observation

    if entries and not any(v is not None for o in by_day.values() for v in o.yields.values()):
        raise TreasuryFeedError("Treasury entries carry no recognisable maturities.")
    return ParseResult(
        observations=sorted(by_day.values(), key=lambda o: o.day),
        rejected_values=rejected,
        unknown_fields=sorted(unknown),
        duplicate_dates=sorted(set(duplicates)),
    )


def _parse_date(text: str | None) -> date:
    if not text or not re.fullmatch(r"\d{4}-\d{2}-\d{2}(T00:00:00)?", text.strip()):
        raise TreasuryFeedError(f"Unexpected NEW_DATE value {text!r}.")
    return datetime.strptime(text.strip()[:10], "%Y-%m-%d").date()


def _parse_int(element: ET.Element | None) -> int | None:
    text = (element.text or "").strip() if element is not None else ""
    return int(text) if text.isdigit() else None


def _parse_rate(element: ET.Element | None) -> tuple[float | None, str | None]:
    """(value, problem). Absent, null, or empty is (None, None): missing, not malformed."""
    if element is None or element.get(f"{M}null") == "true":
        return None, None
    text = (element.text or "").strip()
    if not text or text.upper() == "N/A":
        return None, None
    try:
        value = float(text)
    except ValueError:
        return None, text[:20]
    if not math.isfinite(value) or not PLAUSIBLE_RANGE[0] <= value <= PLAUSIBLE_RANGE[1]:
        return None, text[:20]
    return value, None


# --- metrics -----------------------------------------------------------------

SPREADS = (
    ("10y_2y", "10-year minus 2-year", "BC_10YEAR", "BC_2YEAR"),
    ("10y_3m", "10-year minus 3-month", "BC_10YEAR", "BC_3MONTH"),
)
# Shape is read from the 10-year minus 3-month spread. A negative spread is an
# inversion by the standard definition; the 0.50-point boundary between "flat"
# and "upward sloping" is this application's convention, stated in the UI.
UPWARD_THRESHOLD_PP = 0.50
COMPARISON_TARGET_DAYS = 30  # "about one month": calendar days back from the latest observation
COMPARISON_MAX_GAP_DAYS = 7  # the matched observation must be within a week of that target


def round_pp(value: float) -> float:
    """Percentage points to 2 decimals (Treasury publishes 2), free of float noise."""
    return round(value, 2) + 0.0  # + 0.0 turns -0.0 into 0.0


def to_bp(value_pp: float) -> int:
    """Percentage points to whole basis points (1 percentage point = 100 bp)."""
    return int(round(value_pp * 100))


def spread(observation: Observation, long_key: str, short_key: str) -> float | None:
    long, short = observation.yields.get(long_key), observation.yields.get(short_key)
    if long is None or short is None:
        return None
    return round_pp(long - short)


def classify_shape(spread_10y_3m: float | None) -> str | None:
    if spread_10y_3m is None:
        return None
    if spread_10y_3m < 0:
        return "inverted"
    if spread_10y_3m < UPWARD_THRESHOLD_PP:
        return "flat"
    return "upward"


def comparison_observation(
    observations: list[Observation], latest: Observation
) -> Observation | None:
    """The last published observation on or before latest - 30 days, if within a week of it.

    Only real published days are candidates, so a weekend or holiday target
    resolves to the preceding business day rather than an invented date.
    """
    target = latest.day - timedelta(days=COMPARISON_TARGET_DAYS)
    candidates = [o for o in observations if o.day <= target]
    if not candidates:
        return None
    match = candidates[-1]
    if (target - match.day).days > COMPARISON_MAX_GAP_DAYS:
        return None
    return match


def latest_observation(observations: list[Observation]) -> Observation | None:
    """Most recent day carrying at least one yield."""
    for observation in reversed(observations):
        if any(v is not None for v in observation.yields.values()):
            return observation
    return None


def _change(now: float | None, before: float | None) -> float | None:
    if now is None or before is None:
        return None
    return round_pp(now - before)


def summarize(observations: list[Observation]) -> dict[str, Any] | None:
    latest = latest_observation(observations)
    if latest is None:
        return None
    prior = comparison_observation(observations, latest)

    curve = []
    for m in MATURITIES:
        now = latest.yields.get(m.key)
        before = prior.yields.get(m.key) if prior else None
        change = _change(now, before)
        curve.append({
            "key": m.key,
            "label": m.label,
            "months": m.months,
            "value": now,
            "prior_value": before,
            "change_pp": change,
            "change_bp": None if change is None else to_bp(change),
        })

    spreads = []
    for key, label, long_key, short_key in SPREADS:
        now = spread(latest, long_key, short_key)
        before = spread(prior, long_key, short_key) if prior else None
        change = _change(now, before)
        spreads.append({
            "key": key,
            "label": label,
            "long": long_key,
            "short": short_key,
            "value_pp": now,
            "value_bp": None if now is None else to_bp(now),
            "prior_value_pp": before,
            "change_pp": change,
            "change_bp": None if change is None else to_bp(change),
        })

    return {
        "date": latest.day.isoformat(),
        "comparison_date": prior.day.isoformat() if prior else None,
        "curve": curve,
        "spreads": spreads,
        "shape": classify_shape(spreads[1]["value_pp"]),
        "missing_core_maturities": [k for k in CORE_KEYS if latest.yields.get(k) is None],
    }


def history_rows(observations: list[Observation], since: date) -> list[dict[str, Any]]:
    """Observations on or after `since`, oldest first, with the two spreads."""
    return [
        {
            "date": o.day.isoformat(),
            "yields": {m.key: o.yields.get(m.key) for m in MATURITIES},
            "spread_10y_2y": spread(o, "BC_10YEAR", "BC_2YEAR"),
            "spread_10y_3m": spread(o, "BC_10YEAR", "BC_3MONTH"),
        }
        for o in observations
        if o.day >= since
    ]
