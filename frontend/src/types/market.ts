/**
 * Types mirroring the backend's `app/schemas.py`.
 * Keep the two in sync when either changes.
 */

export const RANGES = ["1D", "5D", "1M", "3M", "6M", "1Y", "5Y", "MAX"] as const;

export type Range = (typeof RANGES)[number];

/** Ranges whose candles are intraday, so timestamps carry a time component. */
export const INTRADAY_RANGES: ReadonlySet<Range> = new Set<Range>(["1D", "5D"]);

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
