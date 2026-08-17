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

export interface BenchmarkComparison {
  benchmark_ticker: string;
  /** Historical sensitivity to the benchmark. 1.3 means it moved ~30% more. */
  beta: number | null;
  alpha: number | null;
  /** Share of movement the benchmark explains. Low means beta is weak evidence. */
  r_squared: number | null;
  observations: number;
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
  /** Null when the benchmark could not be fetched or did not overlap this range. */
  benchmark: BenchmarkComparison | null;
}

// --- scenario dispersion ---------------------------------------------------

export interface SimulationResponse {
  ticker: string;
  company_name: string;
  range: Range;
  start_price: number;
  horizon_days: number;
  simulations: number;
  /** Ending values at p5/p25/p50/p75/p95 of the simulated paths. */
  percentiles: Record<string, number>;
  /** Share of paths ending below the start price. Not a real-world probability. */
  probability_of_loss: number;
  observations: number;
  method: string;
  disclaimer: string;
}

export interface CorrelationResponse {
  tickers: string[];
  range: Range;
  /** Row-major, ordered to match `tickers`. */
  matrix: (number | null)[][];
  observations: number;
  resolved: Record<string, string>;
  /** Tickers that could not be loaded, with why. Excluded from the matrix. */
  unavailable: Record<string, string>;
  note: string;
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

// --- market-wide -----------------------------------------------------------

export interface Mover {
  ticker: string;
  name: string;
  price: number;
  change: number | null;
  change_percent: number | null;
  exchange: string | null;
  /** Trades under $5 — the SEC's penny-stock threshold. Higher manipulation risk. */
  low_priced: boolean;
}

export interface MoversResponse {
  gainers: Mover[];
  losers: Mover[];
  actives: Mover[];
  /** Per-list failures. A list that failed is empty and named here. */
  errors: Record<string, string>;
  source: string;
  disclaimer: string;
}

export interface SectorPerformance {
  sector: string;
  change_percent: number;
  as_of: string;
}

export type Session = "open" | "pre-market" | "after-hours" | "closed";

export interface MarketStatus {
  session: Session;
  reason: string;
  exchange: string;
  local_time: string;
  timezone: string;
  next_open: string;
  holiday_data_through: number | null;
}

export interface NewsArticle {
  headline: string;
  summary: string | null;
  source: string | null;
  url: string;
  published_at: string | null;
  image: string | null;
}

export interface NewsResponse {
  ticker: string;
  articles: NewsArticle[];
  source: string;
  disclaimer: string;
}

export interface SearchResult {
  ticker: string;
  name: string;
  type: string | null;
}

export interface CompanyProfile {
  ticker: string;
  name: string | null;
  sector: string | null;
  industry: string | null;
  country: string | null;
  exchange: string | null;
  market_cap: number | null;
  beta: number | null;
  last_dividend: number | null;
  average_volume: number | null;
  employees: number | null;
  website: string | null;
  description: string | null;
  ceo: string | null;
  is_etf: boolean;
  source: string;
}

export interface Capabilities {
  movers: boolean;
  sectors: boolean;
  news: boolean;
  search: boolean;
  fundamentals: boolean;
  screener: boolean;
  /** Why a capability is unavailable, keyed by capability name. */
  notes: Record<string, string>;
}

// --- backtesting -----------------------------------------------------------

export interface BacktestMetrics {
  strategy_key: string;
  strategy_name: string;
  parameter: number;
  bars: number;
  total_return: number;
  annualized_return: number;
  annualized_volatility: number | null;
  sharpe_ratio: number | null;
  max_drawdown: number;
  trades: number;
  win_rate: number | null;
  exposure: number;
  cost_bps: number;
  cost_drag: number;
}

export interface StrategyResult {
  strategy_key: string;
  strategy_name: string;
  description: string;
  parameter_label: string;
  chosen_parameter: number;
  parameters_tried: number;
  /** The earlier slice used to pick the parameter. NOT evidence of skill. */
  in_sample: BacktestMetrics;
  /** The held-out later slice. The only figure here that means anything. */
  out_of_sample: BacktestMetrics;
  benchmark_out_of_sample: BacktestMetrics;
  excess_return: number;
  beat_benchmark: boolean;
  /** Out-of-sample minus in-sample. Large negatives indicate over-fitting. */
  degradation: number;
  verdict: string;
}

export interface BacktestResponse {
  ticker: string;
  company_name: string;
  range: Range;
  bars: number;
  split_date: string;
  train_fraction: number;
  cost_bps: number;
  strategies: StrategyResult[];
  strategies_beating_benchmark: number;
  method: string;
  disclaimer: string;
}
