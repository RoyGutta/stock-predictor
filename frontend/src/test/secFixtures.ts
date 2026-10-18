/**
 * SEC response fixtures for component tests. Shapes follow the recorded Apple
 * data used by the backend tests; the net-income loss and its revision are
 * hand-built so the loss and "revised" states render.
 */

import type {
  FactPoint,
  FilingsResponse,
  FundamentalsResponse,
} from "../types/sec";

const provenance = {
  source: "U.S. Securities and Exchange Commission (EDGAR)",
  retrieved_at: "2026-10-18T16:52:00+00:00",
  stale: false,
  stale_reason: null,
};

const company = {
  cik: 320193,
  cik_padded: "0000320193",
  name: "Apple Inc.",
  tickers: ["AAPL"],
  edgar_url: "https://www.sec.gov/edgar/browse/?CIK=320193",
};

const INDEX =
  "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/0000320193-25-000079-index.htm";

export const FILINGS: FilingsResponse = {
  ...provenance,
  company: {
    ...company,
    entity_type: "operating",
    fiscal_year_end: "0926",
    industry: "Electronic Computers",
  },
  coverage_note:
    "Shows reports from SEC's recent-filings index, which covers at least the last year.",
  filings: [
    {
      form: "8-K/A",
      base_form: "8-K",
      form_description: "Current report (material event)",
      amendment: true,
      filing_date: "2026-09-01",
      report_date: "2026-04-17",
      accession_number: "0001140361-26-035325",
      items: [
        {
          code: "5.02",
          description: "Departure or appointment of directors or officers",
        },
      ],
      description: "8-K/A",
      document_url:
        "https://www.sec.gov/Archives/edgar/data/320193/000114036126035325/ef20081427_8ka.htm",
      index_url:
        "https://www.sec.gov/Archives/edgar/data/320193/000114036126035325/0001140361-26-035325-index.htm",
    },
    {
      form: "10-K",
      base_form: "10-K",
      form_description: "Annual report",
      amendment: false,
      filing_date: "2025-10-31",
      report_date: "2025-09-27",
      accession_number: "0000320193-25-000079",
      items: [],
      description: "10-K",
      document_url:
        "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm",
      index_url: INDEX,
    },
  ],
};

function point(
  start: string,
  end: string,
  value: number,
  extra: Partial<FactPoint> = {},
): FactPoint {
  return {
    period_start: start,
    period_end: end,
    duration_days: 364,
    value,
    tag: "NetIncomeLoss",
    form: "10-K",
    filed: "2025-10-31",
    accession_number: "0000320193-25-000079",
    filing_url: INDEX,
    amended: false,
    revised: false,
    first_reported_value: null,
    yoy: null,
    ...extra,
  };
}

const REVENUE_TAG = "RevenueFromContractWithCustomerExcludingAssessedTax";

export const FUNDAMENTALS: FundamentalsResponse = {
  ...provenance,
  company,
  period: "annual",
  coverage: "us-gaap",
  coverage_note: null,
  note: "Figures are as reported in the company's own filings and describe the periods shown, not the present.",
  latest_filed: "2025-10-31",
  source_url: "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json",
  metrics: [
    {
      key: "revenue",
      label: "Revenue",
      unit: "USD",
      kind: "duration",
      definition: "Total revenue as reported.",
      tags_considered: [REVENUE_TAG],
      ignored_units: [],
      missing_reason: null,
      points: [
        point("2023-10-01", "2024-09-28", 391035000000, { tag: REVENUE_TAG }),
        point("2024-09-29", "2025-09-27", 416161000000, {
          tag: REVENUE_TAG,
          yoy: {
            prior_period_end: "2024-09-28",
            prior_value: 391035000000,
            change: 25126000000,
            change_pct: 0.064255,
            note: null,
          },
        }),
      ],
    },
    {
      key: "net_income",
      label: "Net income",
      unit: "USD",
      kind: "duration",
      definition:
        "Net income attributable to the parent company's shareholders.",
      tags_considered: ["NetIncomeLoss"],
      ignored_units: [],
      missing_reason: null,
      points: [
        point("2024-09-29", "2025-09-27", -1500000000, {
          revised: true,
          first_reported_value: -1400000000,
        }),
      ],
    },
    {
      key: "total_liabilities",
      label: "Total liabilities",
      unit: "USD",
      kind: "instant",
      definition: "Balance at period end.",
      tags_considered: ["Liabilities"],
      ignored_units: [],
      points: [],
      missing_reason:
        "Not reported under the US GAAP tag this view reads (Liabilities). It is left blank rather than estimated.",
    },
  ],
  derived: [
    {
      key: "net_margin",
      label: "Net margin",
      unit: "ratio",
      definition: "Net income divided by revenue for the same period.",
      caveat: "Includes taxes, interest, and non-operating items.",
      components: ["net_income", "revenue"],
      periods_blocked_different_filing: 0,
      missing_reason: null,
      points: [
        {
          period_start: "2024-09-29",
          period_end: "2025-09-27",
          duration_days: 364,
          value: -0.003604,
          components: { net_income: -1500000000, revenue: 416161000000 },
          form: "10-K",
          filed: "2025-10-31",
          accession_number: "0000320193-25-000079",
          filing_url: INDEX,
          yoy: null,
        },
      ],
    },
  ],
};
