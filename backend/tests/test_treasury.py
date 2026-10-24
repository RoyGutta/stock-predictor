"""Treasury par yield curve: parsing, metrics, fetching discipline, and the API.

Recorded fixtures: Treasury's September and October 2026 month feeds, saved
2026-10-24 unmodified. Every other case is hand-built. No test reaches Treasury.
"""

from __future__ import annotations

import asyncio
from datetime import date
from datetime import datetime as real_datetime
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.analytics import yield_curve as yc
from app.config import get_settings
from app.main import app
from app.services import treasury
from app.services.providers import yahoo
from app.services.providers.base import ProviderError, ProviderRateLimited, ProviderTimeout
from app.services.providers.registry import reset_price_provider

FIXTURES = Path(__file__).parent / "fixtures"
SEPT = (FIXTURES / "treasury_yield_curve_202609.xml").read_bytes()
OCT = (FIXTURES / "treasury_yield_curve_202610.xml").read_bytes()
TODAY = date(2026, 10, 24)  # a Saturday: the latest observation is Friday's


def feed(*entries: str) -> bytes:
    return (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<feed xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices" '
        'xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata" '
        'xmlns="http://www.w3.org/2005/Atom"><title>x</title>' + "".join(entries) + "</feed>"
    ).encode()


def entry(day: str, record_id: int = 1, **values: str | None) -> str:
    fields = "".join(
        f'<d:{k} m:null="true" />' if v is None else f'<d:{k} m:type="Edm.Double">{v}</d:{k}>'
        for k, v in values.items()
    )
    return (
        '<entry><content type="application/xml"><m:properties>'
        f'<d:Id m:type="Edm.Int32">{record_id}</d:Id>'
        f'<d:NEW_DATE m:type="Edm.DateTime">{day}T00:00:00</d:NEW_DATE>{fields}'
        "</m:properties></content></entry>"
    )


def obs(day: str, **values: float | None) -> yc.Observation:
    yields: dict[str, float | None] = {m.key: None for m in yc.MATURITIES}
    yields.update(values)
    return yc.Observation(date.fromisoformat(day), yields, 1)


# --- parsing: recorded feeds ---------------------------------------------------


def test_recorded_feeds_parse_completely_with_business_days_only():
    sept, octo = yc.parse_feed(SEPT), yc.parse_feed(OCT)
    assert (len(sept.observations), len(octo.observations)) == (21, 16)
    days = [o.day for o in sept.observations + octo.observations]
    assert all(d.weekday() < 5 for d in days)
    assert date(2026, 9, 7) not in days  # Labor Day
    assert date(2026, 10, 12) not in days  # Columbus Day: bond market closed
    assert days == sorted(days)
    assert not sept.rejected_values and not octo.unknown_fields
    latest = octo.observations[-1]
    assert latest.day == date(2026, 10, 23)
    assert all(latest.yields[k] is not None for k in yc.CORE_KEYS)


# --- parsing: schema and value validation ---------------------------------------


def test_missing_and_null_maturities_are_none_not_zero():
    raw = feed(entry("2026-10-01", BC_3MONTH="4.20", BC_10YEAR="5.00", BC_20YEAR=None))
    o = yc.parse_feed(raw).observations[0]
    assert o.yields["BC_20YEAR"] is None  # explicit null
    assert o.yields["BC_1_5MONTH"] is None  # element absent (series not yet issued)
    assert o.yields["BC_10YEAR"] == 5.0


@pytest.mark.parametrize("bad", ["abc", "NaN", "inf", "99.5", "-12"])
def test_malformed_or_implausible_values_are_rejected_and_reported(bad):
    result = yc.parse_feed(feed(entry("2026-10-01", BC_2YEAR=bad, BC_10YEAR="5.0")))
    assert result.observations[0].yields["BC_2YEAR"] is None
    assert result.rejected_values == [f"2026-10-01 BC_2YEAR={bad!r}"]


def test_na_text_is_missing_not_malformed():
    result = yc.parse_feed(feed(entry("2026-10-01", BC_2YEAR="N/A", BC_10YEAR="5.0")))
    assert result.observations[0].yields["BC_2YEAR"] is None and not result.rejected_values


def test_duplicate_dates_keep_the_later_record_and_are_reported():
    raw = feed(
        entry("2026-10-01", 7, BC_10YEAR="5.10"),
        entry("2026-10-01", 9, BC_10YEAR="5.12"),
        entry("2026-09-30", 5, BC_10YEAR="5.00"),
    )
    result = yc.parse_feed(raw)
    assert [o.day.isoformat() for o in result.observations] == ["2026-09-30", "2026-10-01"]
    assert result.observations[1].yields["BC_10YEAR"] == 5.12
    assert result.duplicate_dates == ["2026-10-01"]


def test_unknown_fields_are_reported_not_fatal():
    result = yc.parse_feed(feed(entry("2026-10-01", BC_10YEAR="5.0", BC_15YEAR="5.2")))
    assert result.unknown_fields == ["BC_15YEAR"]


@pytest.mark.parametrize(
    "raw",
    [
        b"<html>Service unavailable</html>",
        b"not xml at all",
        feed(entry("2026-10-01", BC_TEN="5.0")),  # schema change: no known maturity
        feed(
            "<entry><content><m:properties><d:BC_10YEAR>5</d:BC_10YEAR>"
            "</m:properties></content></entry>"
        ),  # no NEW_DATE
        feed(entry("10/01/2026", BC_10YEAR="5.0")),  # date format change
    ],
)
def test_structural_changes_are_errors_not_silent_data(raw):
    with pytest.raises(yc.TreasuryFeedError):
        yc.parse_feed(raw)


def test_dtd_and_entities_are_refused_before_parsing():
    bomb = (
        b'<?xml version="1.0"?><!DOCTYPE feed [<!ENTITY a "aaaa">'
        b'<!ENTITY b "&a;&a;&a;">]><feed xmlns="http://www.w3.org/2005/Atom">&b;</feed>'
    )
    with pytest.raises(yc.TreasuryFeedError, match="DTD or entity"):
        yc.parse_feed(bomb)


def test_oversized_response_is_refused():
    with pytest.raises(yc.TreasuryFeedError, match="size limit"):
        yc.parse_feed(b" " * (yc.MAX_FEED_BYTES + 1))


def test_empty_month_is_valid_and_yields_no_observations():
    assert yc.parse_feed(feed()).observations == []


# --- metrics -----------------------------------------------------------------


def test_spreads_in_points_and_basis_points_without_float_noise():
    o = obs("2026-10-23", BC_10YEAR=5.00, BC_2YEAR=4.69, BC_3MONTH=4.22)
    assert yc.spread(o, "BC_10YEAR", "BC_2YEAR") == 0.31  # 5.00 - 4.69 = 0.31000000000000005
    assert yc.to_bp(0.31) == 31
    assert yc.spread(o, "BC_10YEAR", "BC_3MONTH") == 0.78
    assert yc.to_bp(-0.14) == -14
    assert str(yc.round_pp(4.10 - 4.10)) == "0.0" and str(yc.round_pp(-0.0)) == "0.0"


def test_spread_is_none_when_either_leg_is_missing():
    assert yc.spread(obs("2026-10-23", BC_10YEAR=5.0), "BC_10YEAR", "BC_2YEAR") is None


@pytest.mark.parametrize(
    ("value", "shape"),
    [
        (-0.01, "inverted"), (-1.2, "inverted"), (0.0, "flat"), (0.49, "flat"),
        (0.50, "upward"), (2.0, "upward"), (None, None),
    ],
)
def test_shape_classification_boundaries(value, shape):
    assert yc.classify_shape(value) == shape


def test_one_month_comparison_uses_a_real_published_day():
    # Target 2026-09-23 is not published here: fall back to the previous published day.
    series = [obs("2026-09-21", BC_10YEAR=4.9), obs("2026-09-22", BC_10YEAR=4.95),
              obs("2026-10-23", BC_10YEAR=5.0)]
    match = yc.comparison_observation(series, series[-1])
    assert match is not None and match.day == date(2026, 9, 22)


def test_weekend_target_resolves_to_the_preceding_friday():
    # Latest Mon 2026-10-26 -> target Sat 2026-09-26 -> Fri 2026-09-25.
    series = [obs("2026-09-25", BC_10YEAR=4.9), obs("2026-10-26", BC_10YEAR=5.0)]
    match = yc.comparison_observation(series, series[-1])
    assert match is not None and match.day == date(2026, 9, 25)


def test_no_comparison_when_history_has_a_long_gap():
    series = [obs("2026-09-10", BC_10YEAR=4.9), obs("2026-10-23", BC_10YEAR=5.0)]
    assert yc.comparison_observation(series, series[-1]) is None
    summary = yc.summarize(series)
    assert summary is not None and summary["comparison_date"] is None
    assert all(p["change_pp"] is None for p in summary["curve"])


def test_changes_in_points_and_bp():
    series = [obs("2026-09-23", BC_10YEAR=5.11, BC_2YEAR=4.85, BC_3MONTH=4.19),
              obs("2026-10-23", BC_10YEAR=5.00, BC_2YEAR=4.69, BC_3MONTH=4.22)]
    s = yc.summarize(series)
    assert s is not None
    ten = next(p for p in s["curve"] if p["key"] == "BC_10YEAR")
    assert (ten["change_pp"], ten["change_bp"]) == (-0.11, -11)
    first = s["spreads"][0]
    assert (first["value_pp"], first["prior_value_pp"], first["change_bp"]) == (0.31, 0.26, 5)


def test_incomplete_latest_curve_reports_missing_core_maturities():
    s = yc.summarize([obs("2026-10-23", BC_10YEAR=5.0, BC_3MONTH=4.2)])
    assert s is not None and "BC_2YEAR" in s["missing_core_maturities"]
    assert s["spreads"][0]["value_pp"] is None and s["shape"] == "upward"


def test_latest_skips_a_day_with_no_values_at_all():
    series = [obs("2026-10-22", BC_10YEAR=5.0), obs("2026-10-23")]
    latest = yc.latest_observation(series)
    assert latest is not None and latest.day == date(2026, 10, 22)


# --- client and service ---------------------------------------------------------


class Clock:
    def __init__(self) -> None:
        self.now = 1_792_800_000.0

    def __call__(self) -> float:
        return self.now


def routes(**overrides):
    table = {
        "202607": lambda _r: httpx.Response(200, content=feed()),
        "202608": lambda _r: httpx.Response(200, content=feed()),
        "202609": lambda _r: httpx.Response(200, content=SEPT),
        "202610": lambda _r: httpx.Response(200, content=OCT),
    }
    table.update(overrides)
    return table


class Upstream:
    def __init__(self, table) -> None:
        self.table = table
        self.requests: list[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        ym = request.url.params["field_tdr_date_value_month"]
        self.requests.append(ym)
        return self.table[ym](request)


def install(table, clock=None) -> Upstream:
    upstream = Upstream(table)

    async def no_sleep(_s: float) -> None:
        return None

    treasury.reset_treasury_client(
        treasury.TreasuryClient(
            transport=httpx.MockTransport(upstream), clock=clock or Clock(), sleep=no_sleep
        )
    )
    return upstream


def run(coro):
    return asyncio.run(coro)


def test_months_back_crosses_the_year_boundary():
    assert treasury.months_back(date(2027, 2, 3), 4) == ["202611", "202612", "202701", "202702"]


def test_service_combines_months_and_reports_freshness():
    up = install(routes())
    out = run(treasury.get_yield_curve(92, today=TODAY))
    assert sorted(up.requests) == ["202607", "202608", "202609", "202610"]
    assert out["latest"]["date"] == "2026-10-23" and out["observation_age_days"] == 1
    assert out["latest"]["comparison_date"] == "2026-09-23"
    assert out["stale"] is False and out["notes"] == []
    assert out["history"][0]["date"] >= "2026-07-23"
    assert out["history"][-1]["date"] == "2026-10-23"


def test_cache_prevents_refetching_within_ttl():
    clock = Clock()
    up = install(routes(), clock)
    run(treasury.get_yield_curve(92, today=TODAY))
    clock.now += 600
    run(treasury.get_yield_curve(92, today=TODAY))
    assert len(up.requests) == 4


def test_concurrent_requests_share_upstream_calls():
    up = install(routes())

    async def burst():
        await asyncio.gather(*(treasury.get_yield_curve(92, today=TODAY) for _ in range(6)))

    run(burst())
    assert len(up.requests) == 4


def test_upstream_failure_serves_flagged_stale_copy_with_original_retrieval_time():
    clock = Clock()
    state = {"down": False}
    oct_ok = routes()["202610"]
    up = install(
        routes(**{"202610": lambda r: httpx.Response(503) if state["down"] else oct_ok(r)}),
        clock,
    )
    first = run(treasury.get_yield_curve(92, today=TODAY))
    state["down"] = True
    clock.now += 3_601  # current month expired; closed months still fresh
    second = run(treasury.get_yield_curve(92, today=TODAY))
    assert second["stale"] is True and "Treasury" in second["stale_reason"]
    assert second["latest"]["date"] == "2026-10-23"
    assert second["retrieved_at"] == first["retrieved_at"]
    assert len(up.requests) == 5


def test_failed_older_month_degrades_history_with_a_note():
    install(routes(**{"202609": lambda _r: httpx.Response(500)}))
    out = run(treasury.get_yield_curve(92, today=TODAY))
    assert out["latest"]["date"] == "2026-10-23"
    assert out["latest"]["comparison_date"] is None
    assert any("September 2026" in n for n in out["notes"])


def test_total_failure_raises_a_typed_error():
    install({k: (lambda _r: httpx.Response(500)) for k in routes()})
    with pytest.raises(ProviderError):
        run(treasury.get_yield_curve(92, today=TODAY))


def test_timeout_is_typed():
    def slow(_r):
        raise httpx.ReadTimeout("slow")

    install({k: slow for k in routes()})
    with pytest.raises(ProviderTimeout):
        run(treasury.get_yield_curve(92, today=TODAY))


def test_rate_limit_pauses_later_requests_and_fails_closed_without_cache():
    up = install(routes(**{"202607": lambda _r: httpx.Response(429)}))
    with pytest.raises(ProviderRateLimited):
        run(treasury.get_yield_curve(92, today=TODAY))
    assert up.requests == ["202607"]


def test_malformed_month_is_rejected_not_used():
    install(routes(**{"202610": lambda _r: httpx.Response(200, content=b"<html/>")}))
    out = run(treasury.get_yield_curve(92, today=TODAY))
    assert out["latest"]["date"] == "2026-09-30"  # October discarded, September stands
    assert any("October 2026" in n for n in out["notes"])


def test_oversized_stream_is_cut_off():
    big = b"x" * (yc.MAX_FEED_BYTES + 10)
    install(routes(**{"202610": lambda _r: httpx.Response(200, content=big)}))
    out = run(treasury.get_yield_curve(92, today=TODAY))
    assert any("October 2026" in n for n in out["notes"])


# --- API -----------------------------------------------------------------------


class _Saturday(real_datetime):
    """`datetime` inside the treasury module, frozen at the recorded Saturday."""

    @classmethod
    def now(cls, tz=None):
        return real_datetime(2026, 10, 24, 12, 0, tzinfo=tz)


@pytest.fixture
def api(monkeypatch) -> TestClient:
    monkeypatch.setattr(treasury, "datetime", _Saturday)
    return TestClient(app)


def test_endpoint_schema_and_provenance(api: TestClient):
    install(routes())
    body = api.get("/api/v1/market/treasury/yield-curve").json()
    assert body["source"].startswith("U.S. Department of the Treasury")
    assert "not live transaction prices" in body["methodology"]
    assert body["latest"]["date"] == "2026-10-23" and body["latest"]["shape"] == "upward"
    assert [s["key"] for s in body["latest"]["spreads"]] == ["10y_2y", "10y_3m"]
    assert body["latest"]["spreads"][0]["value_bp"] == 31
    assert body["observation_age_days"] == 1


@pytest.mark.parametrize("query", ["history_days=5", "history_days=1000", "history_days=abc"])
def test_endpoint_rejects_invalid_history(api: TestClient, query: str):
    assert api.get(f"/api/v1/market/treasury/yield-curve?{query}").status_code == 422


def test_endpoint_upstream_failure_is_a_clean_502(api: TestClient):
    install({k: (lambda _r: httpx.Response(500)) for k in routes()})
    response = api.get("/api/v1/market/treasury/yield-curve")
    assert response.status_code == 502
    assert "Traceback" not in response.text and "Treasury" in response.json()["detail"]


def test_treasury_is_available_in_the_public_demo_without_touching_yahoo(monkeypatch):
    monkeypatch.setenv("DEMO_MODE", "1")
    monkeypatch.setattr(treasury, "datetime", _Saturday)
    get_settings.cache_clear()
    reset_price_provider()

    def refuse(*_: object) -> None:
        pytest.fail("the Yahoo path must never be reached in the public demo")

    monkeypatch.setattr(yahoo, "_fetch_history_sync", refuse)
    install(routes())
    demo = TestClient(app)
    assert demo.get("/api/v1/market/capabilities").json()["treasury"] is True
    assert demo.get("/api/v1/market/treasury/yield-curve").status_code == 200
    assert demo.get("/api/v1/stocks/AAPL?range=1Y").json()["source"] == "Synthetic demo data"
    get_settings.cache_clear()
    reset_price_provider()
