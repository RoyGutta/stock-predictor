"""XBRL fact selection: durations, fiscal years, duplicates, amendments, units, YoY.

Each test names the rule from `app/analytics/fundamentals.py` it pins.
"""

from __future__ import annotations

import pytest

from app.analytics.fundamentals import (
    METRICS_BY_KEY,
    build_series,
    parse_fact,
    reduce_company_facts,
)
from app.analytics.fundamentals_derived import DERIVED, build_derived
from tests.sec_fixtures import AAPL_NET_INCOME, company_facts, fact


def series(tags, key, period="annual"):
    reduced = reduce_company_facts(company_facts(tags))
    return build_series(reduced, METRICS_BY_KEY[key], period)


# --- recorded data ----------------------------------------------------------


def test_recorded_duplicates_collapse_to_one_value_per_period():
    out = series({"NetIncomeLoss": {"USD": AAPL_NET_INCOME}}, "net_income")
    ends = [p["period_end"] for p in out["points"]]
    assert ends == ["2008-09-27", "2022-09-24", "2023-09-30"]
    fy23 = out["points"][-1]
    assert fy23["value"] == 96995000000
    # Latest filing wins among identical repeats; nothing is marked revised.
    assert fy23["accession_number"] == "0000320193-25-000079"
    assert fy23["revised"] is False and fy23["first_reported_value"] is None


def test_recorded_amendment_restatement_wins_and_is_flagged():
    out = series({"NetIncomeLoss": {"USD": AAPL_NET_INCOME}}, "net_income")
    fy08 = out["points"][0]
    assert fy08["value"] == 6119000000  # the 10-K/A restatement, then repeated
    assert fy08["revised"] is True
    assert fy08["first_reported_value"] == 4834000000
    # The most recent filing reporting the period is the 2010 10-K, not the 10-K/A.
    assert fy08["form"] == "10-K" and fy08["amended"] is False


def test_amended_flag_when_the_amendment_is_the_latest_filing():
    rows = [
        fact("2024-01-01", "2024-12-31", 100.0, "0000000001-25-000001", "10-K", "2025-02-01"),
        fact("2024-01-01", "2024-12-31", 90.0, "0000000001-25-000002", "10-K/A", "2025-05-01"),
    ]
    point = series({"NetIncomeLoss": {"USD": rows}}, "net_income")["points"][0]
    assert point["value"] == 90.0 and point["amended"] is True and point["revised"] is True


def test_recorded_quarterly_keeps_three_month_and_drops_year_to_date():
    out = series({"NetIncomeLoss": {"USD": AAPL_NET_INCOME}}, "net_income", "quarterly")
    values = [p["value"] for p in out["points"]]
    assert values == [29578000000, 29789000000]  # 90-day quarters only
    assert 101464000000 not in values  # the 272-day nine-month total
    assert all(80 <= p["duration_days"] <= 100 for p in out["points"])


# --- period classification ----------------------------------------------------


def test_fiscal_year_ending_september_and_53_week_year_are_annual():
    rows = [
        fact("2022-09-25", "2023-09-30", 1.0, "a-1", "10-K", "2023-11-01"),  # 370 days
        fact("2023-10-01", "2024-09-28", 2.0, "a-2", "10-K", "2024-11-01"),  # 363 days
    ]
    out = series({"NetIncomeLoss": {"USD": rows}}, "net_income")
    assert [p["duration_days"] for p in out["points"]] == [370, 363]
    yoy = out["points"][1]["yoy"]
    assert yoy["prior_period_end"] == "2023-09-30"
    assert yoy["change_pct"] == pytest.approx(1.0)
    assert "differ in length" in yoy["note"]


def test_fiscal_labels_in_the_filing_are_ignored():
    # fy/fp describe the report. A 10-K labelled fp=FY that carries a Q4
    # three-month fact must land in the quarterly view, not the annual one.
    rows = [fact("2018-07-01", "2018-09-29", 62.9, "q4", "10-K", "2018-11-05", 2018, "FY")]
    assert series({"Revenues": {"USD": rows}}, "revenue")["points"] == []
    quarterly = series({"Revenues": {"USD": rows}}, "revenue", "quarterly")["points"]
    assert [p["value"] for p in quarterly] == [62.9]


def test_quarterly_cash_flow_reported_only_as_ytd_is_missing_with_reason():
    rows = [
        fact("2025-01-01", "2025-06-30", 50.0, "x-1", "10-Q", "2025-08-01"),
        fact("2025-01-01", "2025-09-30", 80.0, "x-2", "10-Q", "2025-11-01"),
    ]
    out = series({"NetCashProvidedByUsedInOperatingActivities": {"USD": rows}},
                 "operating_cash_flow", "quarterly")
    assert out["points"] == []
    assert "year-to-date" in out["missing_reason"]
    assert "does not subtract" in out["missing_reason"]


def test_no_fourth_quarter_is_derived():
    rows = [
        fact("2024-01-01", "2024-12-31", 400.0, "k", "10-K", "2025-02-01"),
        fact("2024-01-01", "2024-03-31", 100.0, "q1", "10-Q", "2024-05-01"),
        fact("2024-04-01", "2024-06-30", 100.0, "q2", "10-Q", "2024-08-01"),
        fact("2024-07-01", "2024-09-30", 100.0, "q3", "10-Q", "2024-11-01"),
    ]
    quarterly = series({"NetIncomeLoss": {"USD": rows}}, "net_income", "quarterly")
    assert [p["period_end"] for p in quarterly["points"]] == [
        "2024-03-31", "2024-06-30", "2024-09-30"
    ]


def test_instants_annual_view_uses_annual_reports_only():
    rows = [
        fact(None, "2024-12-31", 10.0, "k", "10-K", "2025-02-01"),
        fact(None, "2025-03-31", 11.0, "q", "10-Q", "2025-05-01"),
    ]
    annual = series({"Assets": {"USD": rows}}, "total_assets")
    quarterly = series({"Assets": {"USD": rows}}, "total_assets", "quarterly")
    assert [p["period_end"] for p in annual["points"]] == ["2024-12-31"]
    assert [p["period_end"] for p in quarterly["points"]] == ["2024-12-31", "2025-03-31"]
    assert annual["points"][0]["period_start"] is None


def test_registration_statement_facts_are_ignored():
    rows = [fact("2024-01-01", "2024-12-31", 5.0, "s1", "S-1", "2025-03-01")]
    assert series({"NetIncomeLoss": {"USD": rows}}, "net_income")["points"] == []


# --- units, tags, and missing data ------------------------------------------


def test_incompatible_units_are_ignored_and_named_not_converted():
    rows = [fact("2024-01-01", "2024-12-31", 9.0, "k", "10-K", "2025-02-01")]
    out = series({"NetIncomeLoss": {"EUR": rows}}, "net_income")
    assert out["points"] == [] and out["ignored_units"] == ["EUR"]
    assert "EUR" in out["missing_reason"] and "not converted" in out["missing_reason"]


def test_eps_requires_per_share_unit():
    good = [fact("2024-01-01", "2024-12-31", 6.1, "k", "10-K", "2025-02-01")]
    out = series({"EarningsPerShareBasic": {"USD/shares": good, "USD": good}}, "eps_basic")
    assert [p["value"] for p in out["points"]] == [6.1]
    assert out["ignored_units"] == ["USD"]


def test_missing_tag_is_null_with_reason_never_zero():
    out = series({}, "total_liabilities")
    assert out["points"] == []
    assert "left blank rather than estimated" in out["missing_reason"]


def test_revenue_merges_successive_tags_with_priority_and_names_each():
    rows_old = [fact("2016-09-25", "2017-09-30", 229.0, "old", "10-K", "2017-11-01")]
    rows_new = [
        fact("2016-09-25", "2017-09-30", 229.2, "new", "10-K", "2019-10-31"),
        fact("2017-10-01", "2018-09-29", 265.6, "new2", "10-K", "2019-10-31"),
    ]
    out = series({"SalesRevenueNet": {"USD": rows_old},
                  "RevenueFromContractWithCustomerExcludingAssessedTax": {"USD": rows_new}},
                 "revenue")
    tags = [p["tag"] for p in out["points"]]
    assert tags == ["RevenueFromContractWithCustomerExcludingAssessedTax"] * 2
    assert out["points"][0]["value"] == 229.2
    assert out["points"][1]["yoy"] is not None


def test_revenue_falls_back_to_older_tag_where_the_new_one_is_absent():
    rows_old = [fact("2015-09-27", "2016-09-24", 215.6, "old", "10-K", "2016-10-26")]
    rows_new = [fact("2016-09-25", "2017-09-30", 229.2, "new", "10-K", "2019-10-31")]
    out = series({"SalesRevenueNet": {"USD": rows_old},
                  "RevenueFromContractWithCustomerExcludingAssessedTax": {"USD": rows_new}},
                 "revenue")
    assert [p["tag"] for p in out["points"]] == [
        "SalesRevenueNet", "RevenueFromContractWithCustomerExcludingAssessedTax"
    ]
    # Successive names of one concept: year-over-year spans the tag change.
    assert out["points"][1]["yoy"]["prior_value"] == 215.6


def test_cash_uses_one_tag_per_series():
    primary = [fact(None, "2024-12-31", 10.0, "k1", "10-K", "2025-02-01")]
    broader = [fact(None, "2023-12-31", 99.0, "k0", "10-K", "2024-02-01")]
    out = series({"CashAndCashEquivalentsAtCarryingValue": {"USD": primary},
                  "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents":
                      {"USD": broader}}, "cash")
    assert [p["value"] for p in out["points"]] == [10.0]


@pytest.mark.parametrize("bad", [True, None, "12", float("nan"), float("inf")])
def test_malformed_values_are_rejected(bad):
    assert parse_fact("Assets", {"end": "2024-12-31", "val": bad, "accn": "a",
                                 "form": "10-K", "filed": "2025-01-01"}) is None


def test_malformed_dates_and_inverted_periods_are_rejected():
    base = {"val": 1, "accn": "a", "form": "10-K", "filed": "2025-01-01"}
    assert parse_fact("X", {**base, "end": "not-a-date"}) is None
    assert parse_fact("X", {**base, "start": "2025-02-01", "end": "2025-01-01"}) is None
    assert parse_fact("X", {**base, "end": "2024-12-31", "accn": ""}) is None


# --- year over year ----------------------------------------------------------


def test_yoy_withholds_percent_when_prior_is_negative():
    rows = [
        fact("2023-01-01", "2023-12-31", -50.0, "a", "10-K", "2024-02-01"),
        fact("2024-01-01", "2024-12-31", 20.0, "b", "10-K", "2025-02-01"),
    ]
    yoy = series({"NetIncomeLoss": {"USD": rows}}, "net_income")["points"][1]["yoy"]
    assert yoy["change"] == 70.0 and yoy["change_pct"] is None
    assert "not meaningful" in yoy["note"]


def test_yoy_absent_without_a_period_one_year_earlier():
    rows = [
        fact("2021-01-01", "2021-12-31", 1.0, "a", "10-K", "2022-02-01"),
        fact("2023-01-01", "2023-12-31", 2.0, "b", "10-K", "2024-02-01"),
    ]
    points = series({"NetIncomeLoss": {"USD": rows}}, "net_income")["points"]
    assert points[1]["yoy"] is None


def test_quarterly_yoy_compares_same_quarter_a_year_earlier():
    rows = [
        fact("2024-01-01", "2024-03-31", 10.0, "a", "10-Q", "2024-05-01"),
        fact("2024-04-01", "2024-06-30", 11.0, "b", "10-Q", "2024-08-01"),
        fact("2025-01-01", "2025-03-31", 12.0, "c", "10-Q", "2025-05-01"),
    ]
    points = series({"NetIncomeLoss": {"USD": rows}}, "net_income", "quarterly")["points"]
    assert points[-1]["yoy"]["prior_period_end"] == "2024-03-31"
    assert points[-1]["yoy"]["change_pct"] == pytest.approx(0.2)


def test_series_is_limited_to_recent_periods_but_yoy_uses_full_history():
    rows = [
        fact(f"{y}-01-01", f"{y}-12-31", float(y), f"a{y}", "10-K", f"{y + 1}-02-01")
        for y in range(2010, 2025)
    ]
    points = series({"NetIncomeLoss": {"USD": rows}}, "net_income")["points"]
    assert len(points) == 10 and points[0]["period_end"] == "2015-12-31"
    assert points[0]["yoy"]["prior_period_end"] == "2014-12-31"


def test_filing_link_points_at_the_chosen_filings_index():
    rows = [fact("2024-01-01", "2024-12-31", 1.0, "0000320193-25-000079", "10-K", "2025-02-01")]
    point = series({"NetIncomeLoss": {"USD": rows}}, "net_income")["points"][0]
    assert point["filing_url"] == (
        "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/"
        "0000320193-25-000079-index.htm"
    )


# --- derived measures --------------------------------------------------------


def _derived(tags, key, period="annual"):
    reduced = reduce_company_facts(company_facts(tags))
    by_key = {spec.key: build_series(reduced, spec, period) for spec in METRICS_BY_KEY.values()}
    spec = next(s for s in DERIVED if s.key == key)
    return build_derived(by_key, spec)


def test_margin_uses_same_period_same_filing_and_shows_components():
    rev = [fact("2024-01-01", "2024-12-31", 200.0, "k", "10-K", "2025-02-01")]
    gp = [fact("2024-01-01", "2024-12-31", 90.0, "k", "10-K", "2025-02-01")]
    out = _derived({"Revenues": {"USD": rev}, "GrossProfit": {"USD": gp}}, "gross_margin")
    point = out["points"][0]
    assert point["value"] == pytest.approx(0.45)
    assert point["components"] == {"gross_profit": 90.0, "revenue": 200.0}


def test_margin_blocked_when_components_come_from_different_filings():
    rev = [fact("2024-01-01", "2024-12-31", 200.0, "k1", "10-K", "2025-02-01")]
    gp = [fact("2024-01-01", "2024-12-31", 90.0, "k2", "10-K/A", "2025-06-01")]
    out = _derived({"Revenues": {"USD": rev}, "GrossProfit": {"USD": gp}}, "gross_margin")
    assert out["points"] == []
    assert out["periods_blocked_different_filing"] == 1
    assert "different filings" in out["missing_reason"]


def test_margin_blocked_for_zero_or_negative_revenue():
    rev = [fact("2024-01-01", "2024-12-31", 0.0, "k", "10-K", "2025-02-01")]
    ni = [fact("2024-01-01", "2024-12-31", -5.0, "k", "10-K", "2025-02-01")]
    out = _derived({"Revenues": {"USD": rev}, "NetIncomeLoss": {"USD": ni}}, "net_margin")
    assert out["points"] == [] and "zero or negative" in out["missing_reason"]


def test_free_cash_flow_is_plain_difference_with_yoy():
    ocf = [
        fact("2023-01-01", "2023-12-31", 100.0, "a", "10-K", "2024-02-01"),
        fact("2024-01-01", "2024-12-31", 130.0, "b", "10-K", "2025-02-01"),
    ]
    capex = [
        fact("2023-01-01", "2023-12-31", 20.0, "a", "10-K", "2024-02-01"),
        fact("2024-01-01", "2024-12-31", 30.0, "b", "10-K", "2025-02-01"),
    ]
    out = _derived({"NetCashProvidedByUsedInOperatingActivities": {"USD": ocf},
                    "PaymentsToAcquirePropertyPlantAndEquipment": {"USD": capex}},
                   "free_cash_flow")
    assert [p["value"] for p in out["points"]] == [80.0, 100.0]
    assert out["points"][1]["yoy"]["change_pct"] == pytest.approx(0.25)


def test_derived_missing_component_is_explained():
    ocf = [fact("2024-01-01", "2024-12-31", 130.0, "b", "10-K", "2025-02-01")]
    out = _derived({"NetCashProvidedByUsedInOperatingActivities": {"USD": ocf}},
                   "free_cash_flow")
    assert out["points"] == [] and "capital expenditures" in out["missing_reason"]


def test_leverage_ratio_matches_balance_sheet_date():
    assets = [fact(None, "2024-12-31", 400.0, "k", "10-K", "2025-02-01")]
    liabilities = [fact(None, "2024-12-31", 300.0, "k", "10-K", "2025-02-01")]
    out = _derived({"Assets": {"USD": assets}, "Liabilities": {"USD": liabilities}},
                   "liabilities_to_assets")
    assert out["points"][0]["value"] == pytest.approx(0.75)


def test_annual_only_reporter_is_not_described_as_year_to_date():
    rows = [fact("2024-01-01", "2024-12-31", 9.0, "k", "20-F", "2025-04-01")]
    out = series({"Revenues": {"USD": rows}}, "revenue", "quarterly")
    assert out["points"] == []
    assert "year-to-date" not in out["missing_reason"]
    assert out["missing_reason"].startswith("No quarterly values were found")


def test_ratio_change_is_in_points_without_a_percent_of_a_percent():
    rev = [
        fact("2023-01-01", "2023-12-31", 100.0, "a", "10-K", "2024-02-01"),
        fact("2024-01-01", "2024-12-31", 100.0, "b", "10-K", "2025-02-01"),
    ]
    gp = [
        fact("2023-01-01", "2023-12-31", -10.0, "a", "10-K", "2024-02-01"),
        fact("2024-01-01", "2024-12-31", 20.0, "b", "10-K", "2025-02-01"),
    ]
    out = _derived({"Revenues": {"USD": rev}, "GrossProfit": {"USD": gp}}, "gross_margin")
    yoy = out["points"][1]["yoy"]
    assert yoy["change"] == pytest.approx(0.3)
    assert yoy["change_pct"] is None and yoy["note"] is None
