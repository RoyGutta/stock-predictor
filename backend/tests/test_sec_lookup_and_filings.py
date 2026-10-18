"""Ticker/CIK/name resolution and filing selection. Pure, no network."""

from __future__ import annotations

import pytest

from app.services.sec.client import SecNotFound
from app.services.sec.companies import (
    AmbiguousCompany,
    InvalidCompanyQuery,
    parse_ticker_map,
    resolve,
    search,
)
from app.services.sec.filings import reduce_submissions, select_filings
from tests.sec_fixtures import TICKER_MAP, submissions

MAP = parse_ticker_map(TICKER_MAP)


# --- resolution --------------------------------------------------------------


def test_ticker_resolves_to_cik_with_all_share_classes():
    company = resolve(MAP, "googl")
    assert company.cik == 1652044
    assert set(company.tickers) == {"GOOGL", "GOOG"}


def test_dotted_share_class_maps_to_sec_hyphen():
    assert resolve(MAP, "BRK.B").cik == 1067983
    assert resolve(MAP, "brk-a").cik == 1067983


def test_cik_resolves_with_prefix_or_padding():
    assert resolve(MAP, "CIK320193").name == "Apple Inc."
    assert resolve(MAP, "0000320193").cik == 320193


def test_unlisted_cik_resolves_without_a_name():
    company = resolve(MAP, "CIK1234567")
    assert company.cik == 1234567 and company.name is None and company.tickers == ()


def test_exact_company_name_resolves_ignoring_legal_suffix_and_case():
    assert resolve(MAP, "apple inc").cik == 320193
    assert resolve(MAP, "Apple").cik == 320193  # "Apple Inc." normalizes to "apple"


def test_names_that_normalize_identically_are_ambiguous_not_guessed():
    with pytest.raises(AmbiguousCompany) as info:
        resolve(MAP, "Acme")
    assert {c.cik for c in info.value.candidates} == {9000001, 9000002}
    assert info.value.status_code == 409


def test_partial_name_lists_candidates_instead_of_picking_one():
    with pytest.raises(AmbiguousCompany) as info:
        resolve(MAP, "Alph")
    assert [c.cik for c in info.value.candidates] == [1652044]


def test_unknown_ticker_is_not_found_with_guidance():
    with pytest.raises(SecNotFound) as info:
        resolve(MAP, "ZZZZ")
    assert "try the company name" in str(info.value)


@pytest.mark.parametrize("bad", ["", " ", "AAPL;DROP", "<script>", "a" * 81, "-AAPL"])
def test_invalid_queries_are_rejected(bad):
    with pytest.raises(InvalidCompanyQuery):
        resolve(MAP, bad)


def test_search_ranks_exact_name_then_prefix_matches():
    results = search(MAP, "apple")
    assert [c.cik for c in results][:3] == [320193, 1418121, 1134982]


def test_search_returns_fund_entries_too():
    assert search(MAP, "SPY")[0].name == "SPDR S&P 500 ETF TRUST"


def test_ticker_map_rejects_malformed_payload():
    with pytest.raises((ValueError, KeyError, TypeError)):
        parse_ticker_map({"0": {"ticker": "AAPL"}})
    with pytest.raises(ValueError):
        parse_ticker_map([])


# --- filings -----------------------------------------------------------------


def _filings(**kwargs):
    return select_filings(reduce_submissions(submissions()), **kwargs)


def test_filings_keep_reports_and_drop_ownership_forms():
    forms = [f["form"] for f in _filings()]
    assert "4" not in forms
    assert forms[:4] == ["8-K/A", "10-Q", "8-K", "10-K"]


def test_filings_are_newest_first_and_limited():
    dates = [f["filing_date"] for f in _filings(limit=3)]
    assert dates == sorted(dates, reverse=True) and len(dates) == 3


def test_amendment_is_flagged_and_filtered_with_its_base_form():
    rows = _filings(forms={"8-K"})
    assert {r["base_form"] for r in rows} == {"8-K"}
    assert rows[0]["amendment"] is True and rows[0]["form"] == "8-K/A"


def test_document_link_is_the_original_primary_document_on_sec_gov():
    tenk = next(f for f in _filings() if f["form"] == "10-K")
    assert tenk["document_url"] == (
        "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm"
    )
    assert tenk["index_url"].endswith("/000032019325000079/0000320193-25-000079-index.htm")
    assert tenk["report_date"] == "2025-09-27"


def test_missing_primary_document_falls_back_to_index_and_blank_report_date_is_null():
    edge = next(f for f in _filings() if f["accession_number"] == "0000320193-25-000999")
    assert edge["document_url"] == edge["index_url"]
    assert edge["report_date"] is None
    assert edge["items"] == [{"code": "5.99", "description": None}]


def test_eight_k_items_are_labelled_only_when_known():
    earnings = next(f for f in _filings() if f["accession_number"] == "0000320193-26-000018")
    assert earnings["items"][0] == {
        "code": "2.02", "description": "Results of operations and financial condition"
    }


def test_submissions_with_mismatched_columns_are_rejected():
    raw = submissions()
    raw["filings"]["recent"]["filingDate"].pop()
    with pytest.raises(ValueError):
        reduce_submissions(raw)


def test_older_pages_are_reported_so_the_ui_can_say_so():
    assert reduce_submissions(submissions())["has_older_pages"] is True
