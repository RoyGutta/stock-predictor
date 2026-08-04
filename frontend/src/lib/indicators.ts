/**
 * Technical indicators.
 *
 * Pure functions over a price series — no React, no side effects — so they can
 * be unit tested directly and reused outside the chart.
 *
 * These describe *historical* price behaviour. They are not forecasts.
 */

/** A point that has at least a numeric price. */
export interface PricePoint {
  price: number;
}

/**
 * Simple Moving Average.
 * Returns `undefined` for the first `period - 1` points, where there is not yet
 * enough history to compute a value.
 */
export function sma<T extends PricePoint>(data: readonly T[], period: number): (number | undefined)[] {
  if (period < 1) throw new RangeError("SMA period must be >= 1");

  const out: (number | undefined)[] = new Array(data.length);
  let windowSum = 0;

  for (let i = 0; i < data.length; i += 1) {
    windowSum += data[i].price;
    if (i >= period) windowSum -= data[i - period].price;
    out[i] = i >= period - 1 ? windowSum / period : undefined;
  }
  return out;
}

/**
 * Exponential Moving Average, seeded with the SMA of the first `period` points.
 *
 * Seeding from the SMA (rather than from the first price) is the standard
 * convention and avoids the large startup bias you get otherwise.
 */
export function ema<T extends PricePoint>(data: readonly T[], period: number): (number | undefined)[] {
  if (period < 1) throw new RangeError("EMA period must be >= 1");

  const out: (number | undefined)[] = new Array(data.length);
  const k = 2 / (period + 1);
  let prev: number | undefined;

  for (let i = 0; i < data.length; i += 1) {
    if (i < period - 1) {
      out[i] = undefined;
      continue;
    }
    if (i === period - 1) {
      let seed = 0;
      for (let j = 0; j < period; j += 1) seed += data[j].price;
      prev = seed / period;
      out[i] = prev;
      continue;
    }
    prev = data[i].price * k + (prev as number) * (1 - k);
    out[i] = prev;
  }
  return out;
}

export interface BollingerBands {
  upper: (number | undefined)[];
  middle: (number | undefined)[];
  lower: (number | undefined)[];
}

/**
 * Bollinger Bands: an SMA with bands at ±`stdDevs` population standard
 * deviations of the same window.
 */
export function bollingerBands<T extends PricePoint>(
  data: readonly T[],
  period: number,
  stdDevs = 2,
): BollingerBands {
  if (period < 1) throw new RangeError("Bollinger period must be >= 1");

  const middle = sma(data, period);
  const upper: (number | undefined)[] = new Array(data.length);
  const lower: (number | undefined)[] = new Array(data.length);

  for (let i = 0; i < data.length; i += 1) {
    const mean = middle[i];
    if (mean === undefined) {
      upper[i] = undefined;
      lower[i] = undefined;
      continue;
    }
    let variance = 0;
    for (let j = i - period + 1; j <= i; j += 1) {
      variance += (data[j].price - mean) ** 2;
    }
    const sd = Math.sqrt(variance / period);
    upper[i] = mean + stdDevs * sd;
    lower[i] = mean - stdDevs * sd;
  }

  return { upper, middle, lower };
}

/**
 * Uniformly thin a series to at most `maxPoints`, always keeping the final
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
