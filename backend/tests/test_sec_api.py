"""SEC endpoints end to end, plus public-deployment safety.

The SEC client is replaced by one whose transport replays recorded and
hand-built responses; no test reaches sec.gov.
"""

from __future__ import annotations

import ast
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app
from app.services.providers import yahoo
from app.services.providers.registry import reset_price_provider
from app.services.sec.client import COMPANY_FACTS_URL, SUBMISSIONS_URL, reset_sec_client
from tests.sec_fixtures import (
    AAPL_NET_INCOME,
    TEST_AGENT,
    Recorder,
    company_facts,
    fact,
    json_response,
    make_client,
    standard_routes,
)

ROOT = Path(__file__).resolve().parents[2]

FACTS = company_facts({
    "NetIncomeLoss": {"USD": AAPL_NET_INCOME},
    "RevenueFromContractWithCustomerExcludingAssessedTax": {"USD": [
        fact("2022-09-25", "2023-09-30", 383285000000, "0000320193-25-000079", "10-K",
             "2025-10-31"),
    ]},
})


def _install(routes) -> Recorder:
    recorder = Recorder(routes)
    reset_sec_client(make_client(recorder))
    return recorder


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("SEC_USER_AGENT", TEST_AGENT)
    get_settings.cache_clear()
    yield TestClient(app)
    get_settings.cache_clear()


@pytest.fixture
def demo_client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("SEC_USER_AGENT", TEST_AGENT)
    monkeypatch.setenv("DEMO_MODE", "1")
    get_settings.cache_clear()
    reset_price_provider()

    def refuse(*_: object) -> None:
        pytest.fail("the Yahoo path must never be reached in the public demo")

    monkeypatch.setattr(yahoo, "_fetch_history_sync", refuse)
    monkeypatch.setattr(yahoo, "_fetch_profile_sync", refuse)
    yield TestClient(app)
    get_settings.cache_clear()
    reset_price_provider()


# --- filings ------------------------------------------------------------------


def test_filings_carry_company_links_and_provenance(client: TestClient) -> None:
    _install(standard_routes())
    body = client.get("/api/v1/sec/company/AAPL/filings").json()
    assert body["company"]["name"] == "Apple Inc."
    assert body["company"]["cik_padded"] == "0000320193"
    assert body["company"]["fiscal_year_end"] == "0926"
    assert body["company"]["edgar_url"] == "https://www.sec.gov/edgar/browse/?CIK=320193"
    assert body["source"].startswith("U.S. Securities and Exchange Commission")
    assert body["retrieved_at"].endswith("+00:00") and body["stale"] is False
    assert all(f["document_url"].startswith("https://www.sec.gov/") for f in body["filings"])
    assert "Older filings" in body["coverage_note"]


def test_filings_form_filter_and_validation(client: TestClient) -> None:
    _install(standard_routes())
    body = client.get("/api/v1/sec/company/AAPL/filings?forms=10-K,10-Q").json()
    assert {f["base_form"] for f in body["filings"]} == {"10-K", "10-Q"}
    bad = client.get("/api/v1/sec/company/AAPL/filings?forms=S-1")
    assert bad.status_code == 400 and "Unsupported form type" in bad.json()["detail"]


def test_ambiguous_name_returns_candidates(client: TestClient) -> None:
    _install(standard_routes())
    response = client.get("/api/v1/sec/company/Acme/filings")
    assert response.status_code == 409
    body = response.json()
    assert {c["cik"] for c in body["candidates"]} == {9000001, 9000002}
    assert "Use a ticker or CIK" in body["detail"]


def test_unknown_and_invalid_queries(client: TestClient) -> None:
    _install(standard_routes())
    missing = client.get("/api/v1/sec/company/ZZZZ/filings")
    assert missing.status_code == 404 and "company name" in missing.json()["detail"]
    invalid = client.get("/api/v1/sec/company/%3Cscript%3E/filings")
    assert invalid.status_code == 400


def test_search_endpoint(client: TestClient) -> None:
    _install(standard_routes())
    body = client.get("/api/v1/sec/search?q=apple").json()
    assert body["results"][0]["tickers"] == ["AAPL"]
    assert body["source"].startswith("U.S. Securities")


# --- fundamentals -----------------------------------------------------------


def test_fundamentals_report_values_provenance_and_missing_reasons(client: TestClient) -> None:
    _install(standard_routes(FACTS))
    body = client.get("/api/v1/sec/company/AAPL/fundamentals").json()
    assert body["coverage"] == "us-gaap" and "not real-time" in body["note"]
    metrics = {m["key"]: m for m in body["metrics"]}
    assert [p["value"] for p in metrics["net_income"]["points"]][-1] == 96995000000
    assert metrics["total_liabilities"]["points"] == []
    assert "left blank" in metrics["total_liabilities"]["missing_reason"]
    assert body["latest_filed"] == "2025-10-31"
    assert body["source_url"].endswith("CIK0000320193.json")
    margins = {d["key"]: d for d in body["derived"]}
    assert margins["net_margin"]["points"][0]["components"] == {
        "net_income": 96995000000.0, "revenue": 383285000000.0
    }


def test_quarterly_view(client: TestClient) -> None:
    _install(standard_routes(FACTS))
    body = client.get("/api/v1/sec/company/AAPL/fundamentals?period=quarterly").json()
    values = [p["value"] for m in body["metrics"] if m["key"] == "net_income"
              for p in m["points"]]
    assert values == [29578000000, 29789000000]
    assert client.get("/api/v1/sec/company/AAPL/fundamentals?period=monthly").status_code == 422


def test_filer_without_xbrl_facts_is_explained_not_an_error(client: TestClient) -> None:
    routes = standard_routes()
    routes[COMPANY_FACTS_URL.format(cik=884394)] = lambda _r: httpx.Response(404)
    _install(routes)
    body = client.get("/api/v1/sec/company/SPY/fundamentals").json()
    assert body["coverage"] == "none" and body["metrics"] == []
    assert "Funds, trusts" in body["coverage_note"]


def test_ifrs_only_filer_is_explained(client: TestClient) -> None:
    routes = standard_routes()
    ifrs = company_facts({"ProfitLoss": {"EUR": []}}, cik=9000003, name="Foreign Filer PLC",
                         taxonomy="ifrs-full")
    routes[COMPANY_FACTS_URL.format(cik=9000003)] = lambda _r: json_response(ifrs)
    _install(routes)
    body = client.get("/api/v1/sec/company/IFRS/fundamentals").json()
    assert body["coverage"] == "ifrs" and "IFRS" in body["coverage_note"]


def test_stale_data_is_flagged_in_the_response(client: TestClient) -> None:
    state = {"fail": False}
    routes = standard_routes()
    good = routes[SUBMISSIONS_URL.format(cik=320193)]
    routes[SUBMISSIONS_URL.format(cik=320193)] = (
        lambda r: httpx.Response(503) if state["fail"] else good(r)
    )
    clock_value = [1_800_000_000.0]
    reset_sec_client(make_client(Recorder(routes), clock=lambda: clock_value[0]))
    assert client.get("/api/v1/sec/company/AAPL/filings").json()["stale"] is False
    state["fail"] = True
    clock_value[0] += 3600
    body = client.get("/api/v1/sec/company/AAPL/filings").json()
    assert body["stale"] is True and "SEC EDGAR" in body["stale_reason"]


def test_upstream_rate_limit_without_cache_is_a_429(client: TestClient) -> None:
    routes = standard_routes()
    routes[SUBMISSIONS_URL.format(cik=320193)] = lambda _r: httpx.Response(429)
    _install(routes)
    response = client.get("/api/v1/sec/company/AAPL/filings")
    assert response.status_code == 429 and "rate limit" in response.json()["detail"]


def test_unconfigured_agent_is_a_503_that_names_the_setting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("SEC_USER_AGENT", raising=False)
    get_settings.cache_clear()
    reset_sec_client()
    response = TestClient(app).get("/api/v1/sec/company/AAPL/filings")
    assert response.status_code == 503 and "SEC_USER_AGENT" in response.json()["detail"]
    caps = TestClient(app).get("/api/v1/market/capabilities").json()
    assert caps["sec_filings"] is False and "SEC_USER_AGENT" in caps["notes"]["sec_filings"]
    get_settings.cache_clear()


# --- public demo safety --------------------------------------------------------


def test_sec_works_in_the_public_demo_and_never_reaches_yahoo(demo_client: TestClient) -> None:
    _install(standard_routes(FACTS))
    caps = demo_client.get("/api/v1/market/capabilities").json()
    assert caps["demo"] is True and caps["sec_filings"] is True
    assert caps["price_freshness"].startswith("Synthetic dataset")
    assert demo_client.get("/api/v1/sec/company/AAPL/filings").status_code == 200
    assert demo_client.get("/api/v1/sec/company/AAPL/fundamentals").status_code == 200
    assert demo_client.get("/api/v1/stocks/AAPL?range=1Y").json()["source"] != "yfinance"


def test_vercel_entry_forces_the_synthetic_price_provider() -> None:
    source = (ROOT / "api" / "index.py").read_text()
    assert 'os.environ["DEMO_MODE"] = "1"' in source
    assert 'os.environ["MARKET_DATA_PROVIDER"] = "demo"' in source
    assert "SEC_USER_AGENT" not in source  # supplied by the operator, never hard-coded


def test_sec_modules_never_import_a_price_provider() -> None:
    app_dir = ROOT / "backend" / "app"
    paths = [
        *sorted((app_dir / "services" / "sec").glob("*.py")),
        app_dir / "routes" / "sec.py",
        app_dir / "analytics" / "fundamentals.py",
        app_dir / "analytics" / "fundamentals_derived.py",
    ]
    for path in paths:
        tree = ast.parse(path.read_text())
        imported = {n.module or "" for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)}
        imported |= {
            alias.name for n in ast.walk(tree) if isinstance(n, ast.Import) for alias in n.names
        }
        forbidden = ("yfinance", "providers.yahoo", "providers.registry", "market_data")
        assert not any(word in name for name in imported for word in forbidden), path


def test_invalid_query_is_a_client_error_even_when_sec_is_not_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("SEC_USER_AGENT", raising=False)
    get_settings.cache_clear()
    reset_sec_client()
    client = TestClient(app)
    assert client.get("/api/v1/sec/company/%3Cx%3E/filings").status_code == 400
    assert client.get("/api/v1/sec/search?q=%3Cx%3E").status_code == 400
    assert client.get("/api/v1/sec/company/AAPL/filings").status_code == 503
    get_settings.cache_clear()
