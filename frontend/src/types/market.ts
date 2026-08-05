/**
 * Types mirroring the backend's `app/schemas.py`.
 * Keep the two in sync when either changes.
 */

export const RANGES = ["1D", "5D", "1M", "3M", "6M", "1Y", "5Y", "MAX"] as const;

export type Range = (typeof RANGES)[number];

/** Ranges whose candles are intraday, so timestamps carry a time component. */
export const INTRADAY_RANGES: ReadonlySet<Range> = new Set<Range>(["1D", "5D"]);

/** Human labels for range buttons, which are otherwise cryptic to a beginner. */
export const RANGE_LABELS: Record<Range, string> = {
  "1D": "1 day",
  "5D": "5 days",
  "1M": "1 month",
  "3M": "3 months",
  "6M": "6 months",
  "1Y": "1 year",
  "5Y": "5 years",
  MAX: "All time",
};

export interface Candle {
  date: string;
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
}

export interface Quote {
  ticker: string;
  company_name: string;
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  change_points: number;
  change_percent: number;
  currency: string;
  range: Range;
  history: Candle[];
  as_of: string;
  source: string;
}

// --- analysis --------------------------------------------------------------

export type Stance = "bullish" | "bearish" | "neutral";

export interface Observation {
  indicator: string;
  stance: Stance;
  value: number | null;
  headline: string;
  detail: string;
  /** This indicator's known failure mode. The backend guarantees it is present. */
  caveat: string;
}

export interface TrendInterpretation {
  summary: string;
  /**
   * How much the indicators agree WITH EACH OTHER, 0–1.
   * Not a probability and not a confidence level for any prediction.
   */
  agreement_score: number;
  agreement_label: string;
  conflicts: string[];
  bullish: Observation[];
  bearish: Observation[];
  neutral: Observation[];
  disclaimer: string;
}

export interface IndicatorSeries {
  dates: string[];
  sma: (number | null)[];
  ema: (number | null)[];
  bollinger_upper: (number | null)[];
  bollinger_lower: (number | null)[];
  rsi: (number | null)[];
  macd: (number | null)[];
  macd_signal: (number | null)[];
  macd_histogram: (number | null)[];
  period: number;
}

export interface RiskMetrics {
  annualized_return: number | null;
  annualized_volatility: number | null;
  sharpe_ratio: number | null;
  sortino_ratio: number | null;
  max_drawdown: number | null;
  drawdown_peak_date: string | null;
  drawdown_trough_date: string | null;
  /** Null if the price never regained its previous peak within the range. */
  drawdown_recovery_date: string | null;
  value_at_risk_95: number | null;
  conditional_value_at_risk_95: number | null;
  observations: number;
  frequency: string;
  basis: string;
}

export interface Analysis {
  ticker: string;
  company_name: string;
  range: Range;
  as_of: string;
  source: string;
  bars_analyzed: number;
  interpretation: TrendInterpretation;
  series: IndicatorSeries;
  /** Null when the range holds too few bars for the statistics to be meaningful. */
  risk: RiskMetrics | null;
}
