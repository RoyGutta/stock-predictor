/**
 * Response of GET /api/v1/sec/screener: reported fundamentals from SEC XBRL
 * frames. Every figure is as filed for a calendar-aligned year; unknown
 * figures are null, never 0. There are no price or valuation fields.
 */

export type ScreenerSortKey =
  | "revenue"
  | "revenue_growth_pct"
  | "net_income"
  | "net_margin_pct"
  | "operating_cash_flow"
  | "ocf_margin_pct"
  | "free_cash_flow"
  | "liabilities_to_assets"
  | "name";

export type SortOrder = "asc" | "desc";

export type SizeBandKey =
  "100b_plus" | "10b_100b" | "1b_10b" | "100m_1b" | "under_100m";

export interface ScreenerCriteria {
  minRevenue: number | null;
  minGrowth: number | null;
  maxGrowth: number | null;
  minNetMargin: number | null;
  maxLiabilitiesToAssets: number | null;
  positiveFcf: boolean;
  name: string;
  sizeBand: SizeBandKey | null;
}

export interface ScreenerQuery extends ScreenerCriteria {
  sort: ScreenerSortKey;
  order: SortOrder;
  limit: number;
  offset: number;
}

export interface ScreenerRow {
  cik: number;
  name: string | null;
  edgar_url: string;
  revenue_tag: string | null;
  period_end: string | null;
  revenue_accession: string | null;
  revenue: number | null;
  revenue_prior: number | null;
  revenue_growth_pct: number | null;
  net_income: number | null;
  net_margin_pct: number | null;
  operating_cash_flow: number | null;
  ocf_margin_pct: number | null;
  capital_expenditures: number | null;
  free_cash_flow: number | null;
  total_assets: number | null;
  total_liabilities: number | null;
  liabilities_to_assets: number | null;
  size_band: SizeBandKey | null;
}

export interface FrameUsed {
  measure: string;
  tag: string;
  period: string;
  url: string;
  available: boolean;
  companies: number;
}

export interface SizeBand {
  key: SizeBandKey;
  label: string;
  min_revenue: number;
}

export interface ScreenerResponse {
  source: string;
  retrieved_at: string | null;
  stale: boolean;
  stale_reason: string | null;
  calendar_year: number;
  prior_calendar_year: number;
  frames: FrameUsed[];
  universe: number;
  total_matches: number;
  offset: number;
  limit: number;
  size_bands: SizeBand[];
  notes: string[];
  results: ScreenerRow[];
}
