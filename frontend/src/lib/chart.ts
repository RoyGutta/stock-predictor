/**
 * Chart data preparation.
 *
 * Rendering concerns only. All indicator math lives on the backend, which is
 * the single source of truth — MACD needs EMA and ADX needs ATR, so a second
 * copy here would inevitably drift from it.
 */

import type { Candle, IndicatorSeries } from "../types/market";

/** Ceiling on points handed to the chart; Recharts degrades past a few thousand. */
export const MAX_CHART_POINTS = 900;

export interface ChartPoint {
  date: string;
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  /** The three fixed momentum windows. */
  ma20: number | null;
  ma50: number | null;
  ma100: number | null;
  ema: number | null;
  bollingerUpper: number | null;
  bollingerLower: number | null;
  rsi: number | null;
}

/**
 * Uniformly thin a series to at most `maxPoints`, always keeping the last
 * point so the latest price is never dropped from the chart.
 */
export function downsample<T>(data: readonly T[], maxPoints: number): T[] {
  if (maxPoints < 2) throw new RangeError("maxPoints must be >= 2");
  if (data.length <= maxPoints) return [...data];

  const step = Math.ceil(data.length / maxPoints);
  const out: T[] = [];
  for (let i = 0; i < data.length; i += step) out.push(data[i]);

  const last = data[data.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/**
 * Join candles with their indicator series by position.
 *
 * The backend guarantees index alignment; if a series is short for any reason
 * the missing values become null (a gap in the line) rather than shifting
 * every subsequent point onto the wrong date.
 */
export function buildChartData(
  candles: readonly Candle[],
  series: IndicatorSeries | null,
): ChartPoint[] {
  const at = (values: (number | null)[] | undefined, i: number): number | null =>
    values?.[i] ?? null;

  const points: ChartPoint[] = candles.map((candle, i) => ({
    date: candle.date,
    price: candle.price,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    volume: candle.volume,
    ma20: at(series?.sma_20, i),
    ma50: at(series?.sma_50, i),
    ma100: at(series?.sma_100, i),
    ema: at(series?.ema, i),
    bollingerUpper: at(series?.bollinger_upper, i),
    bollingerLower: at(series?.bollinger_lower, i),
    rsi: at(series?.rsi, i),
  }));

  return downsample(points, MAX_CHART_POINTS);
}

/** Accessible text description of a chart, for screen readers. */
export function describeChart(
  ticker: string,
  range: string,
  points: readonly ChartPoint[],
): string {
  if (points.length === 0) return `No price data for ${ticker}.`;
  const first = points[0];
  const last = points[points.length - 1];
  const change = last.price - first.price;
  const direction = change >= 0 ? "up" : "down";
  const percent = first.price ? Math.abs((change / first.price) * 100).toFixed(1) : "0";

  return (
    `Price chart for ${ticker} over ${range}. ${points.length} data points, ` +
    `from ${first.price.toFixed(2)} to ${last.price.toFixed(2)}, ` +
    `${direction} ${percent} percent across the range.`
  );
}
