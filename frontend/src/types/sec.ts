/**
 * SEC EDGAR response types. Mirrors backend/app/schemas_sec.py.
 *
 * These describe figures a company reported about past periods, which is a
 * different kind of data from the price series in market.ts.
 */

export interface SecProvenance {
  source: string;
  /** UTC time SEC last served or confirmed this data to the server. */
  retrieved_at: string;
  /** True when SEC was unreachable and a cached copy was served. */
  stale: boolean;
  stale_reason: string | null;
}

export interface SecCompany {
  cik: number;
  cik_padded: string;
  name: string | null;
  tickers: string[];
  edgar_url: string;
}

export interface SecCompanyDetail extends SecCompany {
  entity_type: string | null;
  /** MMDD as SEC records it. */
  fiscal_year_end: string | null;
  industry: string | null;
}

export interface SecSearchResponse extends SecProvenance {
  query: string;
  results: SecCompany[];
}

export interface Filing {
  form: string;
  base_form: string;
  form_description: string;
  amendment: boolean;
  filing_date: string;
  report_date: string | null;
  accession_number: string;
  items: { code: string; description: string | null }[];
  description: string | null;
  document_url: string;
  index_url: string;
}

export interface FilingsResponse extends SecProvenance {
  company: SecCompanyDetail;
  filings: Filing[];
  coverage_note: string | null;
}

export interface YearOverYear {
  prior_period_end: string;
  prior_value: number;
  change: number;
  /** Null when the earlier value is zero or negative. */
  change_pct: number | null;
  note: string | null;
}

export interface FactPoint {
  /** Null for balance-sheet values, which describe a single date. */
  period_start: string | null;
  period_end: string;
  duration_days: number | null;
  value: number;
  tag: string;
  form: string;
  filed: string;
  accession_number: string;
  filing_url: string;
  amended: boolean;
  revised: boolean;
  first_reported_value: number | null;
  yoy: YearOverYear | null;
}

export interface MetricSeries {
  key: string;
  label: string;
  unit: string;
  kind: "duration" | "instant";
  definition: string;
  tags_considered: string[];
  points: FactPoint[];
  missing_reason: string | null;
  ignored_units: string[];
  /** Periods replaced by a later-filed period ending the same day. */
  period_conflicts?: string[];
}

export interface DerivedPoint {
  period_start: string | null;
  period_end: string;
  duration_days: number | null;
  value: number;
  components: Record<string, number>;
  form: string;
  filed: string;
  accession_number: string;
  filing_url: string;
  yoy: YearOverYear | null;
}

export interface DerivedSeries {
  key: string;
  label: string;
  /** "ratio" or a currency unit. */
  unit: string;
  definition: string;
  caveat: string;
  components: string[];
  points: DerivedPoint[];
  missing_reason: string | null;
  periods_blocked_different_filing: number;
}

export type FundamentalsPeriod = "annual" | "quarterly";

export interface FundamentalsResponse extends SecProvenance {
  company: SecCompany;
  period: FundamentalsPeriod;
  coverage: "us-gaap" | "ifrs" | "none";
  coverage_note: string | null;
  note: string;
  metrics: MetricSeries[];
  derived: DerivedSeries[];
  latest_filed: string | null;
  source_url: string | null;
}
