"""SEC frames screener, end to end over hand-built frames. No live requests.

The fixture companies are invented (CIKs 1-5); each exercises one rule:
Alpha has every figure, Beta reports only the `Revenues` tag with zero prior
revenue, Gamma reports both revenue tags in the latest year but only `Revenues`
in the prior one, Delta has a balance sheet and no revenue, Epsilon is large.
"""

from __future__ import annotations

import ast
from collections.abc import Iterator
from datetime import date
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app
from app.services.sec import frames
from app.services.sec.client import reset_sec_client
from tests.sec_fixtures import TEST_AGENT, Recorder, json_response, make_client

ROOT = Path(__file__).resolve().parents[2]
URL = "/api/v1/sec/screener"
RFCC, REVS = frames.REVENUE_TAGS

NAMES = {1: "Alpha Corp", 2: "Beta Inc", 3: "Gamma LLC", 4: "Delta Holdings", 5: "Epsilon Co"}


def frame(tag: str, period: str, values: dict[int, float]) -> dict[str, Any]:
    end = "2025-12-31" if period.startswith("CY2025") else "2024-12-31"
    return {
        "taxonomy": "us-gaap", "tag": tag, "ccp": period, "uom": "USD", "label": tag,
        "description": "hand-built", "pts": len(values),
        "data": [
            {"accn": f"0000000000-25-{cik:06d}", "cik": cik, "entityName": NAMES[cik],
             "loc": "US-DE", "end": end, "val": val}
            for cik, val in values.items()
        ],
    }


FRAMES: dict[tuple[str, str], dict[int, float]] = {
    (RFCC, "CY2025"): {1: 1_000e6, 3: 300e6, 5: 150e9},
    (REVS, "CY2025"): {2: 50e6, 3: 999e6},
    (RFCC, "CY2024"): {1: 800e6, 5: 100e9},
    (REVS, "CY2024"): {2: 0, 3: 250e6},
    (frames.NET_INCOME_TAG, "CY2025"): {1: 100e6, 2: -10e6, 3: 15e6, 5: 30e9},
    (frames.OCF_TAG, "CY2025"): {1: 200e6, 2: 5e6, 3: 100e6, 4: 10e6, 5: 40e9},
    (frames.CAPEX_TAG, "CY2025"): {1: 50e6, 3: 400e6, 5: 10e9},
    (frames.ASSETS_TAG, "CY2025Q4I"): {1: 2_000e6, 3: 1_000e6, 4: 100e6},
    (frames.LIABILITIES_TAG, "CY2025Q4I"): {1: 1_000e6, 3: 900e6, 4: 20e6},
}


def routes(skip: set[tuple[str, str]] | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for (tag, period), values in FRAMES.items():
        if skip and (tag, period) in skip:
            continue
        body = frame(tag, period, values)
        out[frames.frame_url(tag, period)] = lambda _req, body=body: json_response(body)
    return out


def install(table: dict[str, Any], **kwargs: Any) -> Recorder:
    recorder = Recorder(table)
    reset_sec_client(make_client(recorder, **kwargs))
    return recorder


@pytest.fixture(autouse=True)
def fixed_today(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(frames, "_today", lambda: date(2026, 10, 24))


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("SEC_USER_AGENT", TEST_AGENT)
    get_settings.cache_clear()
    yield TestClient(app)
    get_settings.cache_clear()
    reset_sec_client()


def by_cik(body: dict[str, Any]) -> dict[int, dict[str, Any]]:
    return {row["cik"]: row for row in body["results"]}


def screen(client: TestClient, **params: Any) -> dict[str, Any]:
    response = client.get(URL, params={"limit": 100, **params})
    assert response.status_code == 200, response.text
    return response.json()


# --- join and metrics ---------------------------------------------------------


def test_calendar_years_are_last_year_and_the_year_before() -> None:
    assert frames.calendar_years(date(2026, 10, 24)) == (2025, 2024)
    assert frames.calendar_years(date(2027, 1, 1)) == (2026, 2025)


def test_joins_by_cik_and_prefers_the_contract_revenue_tag(client: TestClient) -> None:
    install(routes())
    body = screen(client)
    rows = by_cik(body)
    assert body["universe"] == 5 and set(rows) == {1, 2, 3, 4, 5}
    assert rows[3]["revenue"] == 300e6 and rows[3]["revenue_tag"] == RFCC
    assert rows[2]["revenue"] == 50e6 and rows[2]["revenue_tag"] == REVS
    assert rows[1]["name"] == "Alpha Corp"
    assert rows[1]["edgar_url"] == "https://www.sec.gov/edgar/browse/?CIK=1"
    assert rows[1]["period_end"] == "2025-12-31"
    assert rows[4]["revenue"] is None and rows[4]["name"] == "Delta Holdings"
    assert rows[1]["net_margin_pct"] == pytest.approx(10.0)
    assert rows[1]["ocf_margin_pct"] == pytest.approx(20.0)
    assert rows[1]["liabilities_to_assets"] == pytest.approx(0.5)
    assert rows[4]["net_margin_pct"] is None  # no revenue: no margin, not zero


def test_growth_needs_both_years_the_same_tag_and_positive_prior(client: TestClient) -> None:
    install(routes())
    rows = by_cik(screen(client))
    assert rows[1]["revenue_growth_pct"] == pytest.approx(25.0)
    assert rows[5]["revenue_growth_pct"] == pytest.approx(50.0)
    assert rows[2]["revenue_prior"] == 0 and rows[2]["revenue_growth_pct"] is None
    # Gamma's prior year exists only under the other tag: no cross-tag growth.
    assert rows[3]["revenue_prior"] is None and rows[3]["revenue_growth_pct"] is None
    assert rows[4]["revenue_growth_pct"] is None


def test_free_cash_flow_uses_same_year_figures_only(client: TestClient) -> None:
    recorder = install(routes())
    rows = by_cik(screen(client))
    assert rows[1]["free_cash_flow"] == pytest.approx(150e6)
    assert rows[3]["free_cash_flow"] == pytest.approx(-300e6)
    assert rows[2]["free_cash_flow"] is None  # no capex reported: not OCF - 0
    assert rows[4]["free_cash_flow"] is None
    assert recorder.count(f"{frames.CAPEX_TAG}/USD/CY2024") == 0
    assert recorder.count(f"{frames.OCF_TAG}/USD/CY2024") == 0


def test_size_bands() -> None:
    assert frames.size_band(None) is None
    assert frames.size_band(-1) is None
    assert frames.size_band(0) == "under_100m"
    assert frames.size_band(100e6) == "100m_1b"
    assert frames.size_band(1e9) == "1b_10b"
    assert frames.size_band(99.9e9) == "10b_100b"
    assert frames.size_band(100e9) == "100b_plus"


def test_missing_frame_leaves_figures_null(client: TestClient) -> None:
    install(routes(skip={(frames.LIABILITIES_TAG, "CY2025Q4I")}))
    body = screen(client)
    assert all(row["liabilities_to_assets"] is None for row in body["results"])
    used = {f["measure"]: f for f in body["frames"]}
    assert used["liabilities"]["available"] is False
    assert used["assets"]["available"] is True and used["assets"]["companies"] == 3


# --- filters, sorting, pagination --------------------------------------------


@pytest.mark.parametrize(
    ("params", "expected"),
    [
        ({"min_revenue": 100e6}, {1, 3, 5}),
        ({"min_growth": 30}, {5}),
        ({"max_growth": 30}, {1}),
        ({"min_growth": 0, "max_growth": 100}, {1, 5}),
        ({"min_net_margin": 15}, {5}),
        ({"max_liabilities_to_assets": 0.6}, {1, 4}),
        ({"positive_fcf": "true"}, {1, 5}),
        ({"name": "  alp "}, {1}),
        ({"size_band": "100b_plus"}, {5}),
        ({"min_revenue": 100e6, "positive_fcf": "true", "max_liabilities_to_assets": 1}, {1}),
    ],
)
def test_filters_exclude_unknown_values(
    client: TestClient, params: dict[str, Any], expected: set[int]
) -> None:
    install(routes())
    body = screen(client, **params)
    assert set(by_cik(body)) == expected
    assert body["total_matches"] == len(expected)


def test_sort_puts_nulls_last_in_both_directions(client: TestClient) -> None:
    install(routes())
    asc = screen(client, sort="revenue_growth_pct", order="asc")["results"]
    desc = screen(client, sort="revenue_growth_pct", order="desc")["results"]
    assert [r["cik"] for r in asc] == [1, 5, 2, 3, 4]
    assert [r["cik"] for r in desc] == [5, 1, 2, 3, 4]
    by_name = screen(client, sort="name", order="asc")["results"]
    assert [r["name"] for r in by_name][:2] == ["Alpha Corp", "Beta Inc"]
    revenue = screen(client)["results"]  # default: revenue, descending
    assert [r["cik"] for r in revenue] == [5, 1, 3, 2, 4]


def test_pagination(client: TestClient) -> None:
    install(routes())
    body = screen(client, limit=2, offset=1)
    assert [r["cik"] for r in body["results"]] == [1, 3]
    assert body["total_matches"] == 5 and body["limit"] == 2 and body["offset"] == 1
    assert screen(client, offset=50)["results"] == []


@pytest.mark.parametrize(
    "params",
    [
        {"limit": 0},
        {"limit": 101},
        {"offset": -1},
        {"min_revenue": -1},
        {"sort": "price"},
        {"sort": "pe_ratio"},
        {"order": "up"},
        {"size_band": "huge"},
        {"min_growth": 10, "max_growth": 5},
        {"max_liabilities_to_assets": -0.1},
        {"name": "x" * 81},
        {"min_net_margin": "abc"},
    ],
)
def test_invalid_params_are_422(client: TestClient, params: dict[str, Any]) -> None:
    recorder = install(routes())
    assert client.get(URL, params=params).status_code == 422
    assert recorder.requests == []


# --- provenance, failures, limits -------------------------------------------


def test_provenance_lists_frames_and_years(client: TestClient) -> None:
    recorder = install(routes())
    body = screen(client)
    assert body["source"].startswith("U.S. Securities and Exchange Commission")
    assert body["calendar_year"] == 2025 and body["prior_calendar_year"] == 2024
    assert body["stale"] is False and body["retrieved_at"]
    urls = {f["url"] for f in body["frames"]}
    assert len(urls) == 9 and len(recorder.requests) == 9
    assert f"https://data.sec.gov/api/xbrl/frames/us-gaap/{RFCC}/USD/CY2025.json" in urls
    assert any(u.endswith("/Assets/USD/CY2025Q4I.json") for u in urls)
    assert any("not a recommendation" in note for note in body["notes"])
    assert {b["key"] for b in body["size_bands"]} == {
        "100b_plus", "10b_100b", "1b_10b", "100m_1b", "under_100m"
    }
    screen(client)
    assert len(recorder.requests) == 9  # cached for 24 hours


def test_unconfigured_agent_is_503(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SEC_USER_AGENT", raising=False)
    get_settings.cache_clear()
    reset_sec_client()
    try:
        response = TestClient(app).get(URL)
    finally:
        get_settings.cache_clear()
        reset_sec_client()
    assert response.status_code == 503
    assert "SEC_USER_AGENT" in response.json()["detail"]


def test_stale_copy_is_flagged(client: TestClient) -> None:
    now = [1_000_000.0]
    table = routes()
    target = frames.frame_url(frames.NET_INCOME_TAG, "CY2025")
    good = table[target]
    state = {"fail": False}
    table[target] = lambda req: httpx.Response(503) if state["fail"] else good(req)
    install(table, clock=lambda: now[0])
    assert screen(client)["stale"] is False
    now[0] += frames.FRAMES_TTL_SECONDS + 1
    state["fail"] = True
    body = screen(client)
    assert body["stale"] is True and body["stale_reason"]
    assert by_cik(body)[1]["net_income"] == 100e6


def test_rate_limit_maps_to_429(client: TestClient) -> None:
    table = routes()
    table[frames.frame_url(frames.ASSETS_TAG, "CY2025Q4I")] = lambda _r: httpx.Response(429)
    install(table)
    assert client.get(URL).status_code == 429


def test_oversized_frame_is_refused(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(frames, "MAX_FRAME_BYTES", 200)
    install(routes())
    response = client.get(URL)
    assert response.status_code == 502
    assert "larger than this server accepts" in response.json()["detail"]


def test_reduce_frame_drops_malformed_rows_and_tolerates_missing_fields() -> None:
    raw = {"data": [
        {"cik": 7, "val": 5},
        {"cik": "8", "val": 1},
        {"cik": 9, "val": "1"},
        {"cik": True, "val": 1},
        {"cik": 10, "val": False},
        "junk",
    ]}
    assert frames.reduce_frame(raw) == {7: (5.0, None, None, None)}
    assert frames.reduce_frame({"tag": "Assets"}) == {}
    with pytest.raises(TypeError):
        frames.reduce_frame([])


def test_no_price_data_anywhere(client: TestClient) -> None:
    app_dir = ROOT / "backend" / "app"
    paths = [
        app_dir / "services" / "sec" / "frames.py",
        app_dir / "routes" / "screener.py",
        app_dir / "schemas_screener.py",
    ]
    forbidden = ("yfinance", "providers.yahoo", "providers.registry", "market_data", "price")
    for path in paths:
        tree = ast.parse(path.read_text())
        imported = {n.module or "" for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)}
        imported |= {a.name for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names}
        assert not any(word in name for name in imported for word in forbidden), path
    recorder = install(routes())
    row = screen(client)["results"][0]
    assert not any(word in key for key in row for word in ("price", "pe_", "market_cap", "yield"))
    assert all(str(r.url).startswith("https://data.sec.gov/api/xbrl/frames/")
               for r in recorder.requests)
