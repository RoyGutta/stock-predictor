/**
 * U.S. Treasury yield-curve response. Mirrors backend/app/schemas_treasury.py.
 * Yields are percent; spreads and changes are percentage points with whole
 * basis points alongside. Missing values are null, never zero.
 */

export interface CurvePoint {
  key: string;
  label: string;
  months: number;
  value: number | null;
  prior_value: number | null;
  change_pp: number | null;
  change_bp: number | null;
}

export interface SpreadValue {
  key: string;
  label: string;
  long: string;
  short: string;
  value_pp: number | null;
  value_bp: number | null;
  prior_value_pp: number | null;
  change_pp: number | null;
  change_bp: number | null;
}

export type CurveShape = "upward" | "flat" | "inverted";

export interface YieldCurveResponse {
  source: string;
  source_url: string;
  methodology: string;
  units: string;
  /** UTC time Treasury served the data used. */
  retrieved_at: string;
  stale: boolean;
  stale_reason: string | null;
  /** Calendar days from the observation date to today in New York. */
  observation_age_days: number;
  upward_threshold_pp: number;
  latest: {
    /** Treasury observation date: a business day, not necessarily today. */
    date: string;
    comparison_date: string | null;
    curve: CurvePoint[];
    spreads: SpreadValue[];
    shape: CurveShape | null;
    missing_core_maturities: string[];
  };
  history: {
    date: string;
    yields: Record<string, number | null>;
    spread_10y_2y: number | null;
    spread_10y_3m: number | null;
  }[];
  notes: string[];
}
