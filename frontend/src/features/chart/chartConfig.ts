/**
 * Chart series configuration.
 *
 * Kept out of the component file so the legend chips and the plotted lines read
 * from one source — and so Fast Refresh keeps working, which it does not when a
 * module exports both components and values.
 */

export const SERIES_COLORS = {
  price: "var(--accent)",
  /* The three momentum windows, deliberately shading from light to dark as the
     window lengthens — so the slow average reads as the heavier, more stubborn
     line without needing the legend. */
  ma20: "#6f9bd1",
  ma50: "#b07fc7",
  ma100: "#d98452",
  ema: "#7fc7a8",
  bollinger: "var(--up)",
  volume: "var(--text-subtle)",
} as const;

export interface ChartOptions {
  /** The three fixed windows the momentum reading is built on. */
  showMA20: boolean;
  showMA50: boolean;
  showMA100: boolean;
  showEMA: boolean;
  showBollinger: boolean;
  showVolume: boolean;
  /** Window for EMA and Bollinger Bands. Changing it refetches. */
  period: number;
}

/**
 * All three moving averages on by default.
 *
 * They are the point of the chart now: the momentum panel judges this exact
 * stack, and a reader should be able to see what it is judging without first
 * having to find and tick three boxes.
 */
export const DEFAULT_CHART_OPTIONS: ChartOptions = {
  showMA20: true,
  showMA50: true,
  showMA100: true,
  showEMA: false,
  showBollinger: false,
  showVolume: true,
  period: 20,
};
