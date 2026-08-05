/**
 * Chart series configuration.
 *
 * Kept out of the component file so the legend chips and the plotted lines read
 * from one source — and so Fast Refresh keeps working, which it does not when a
 * module exports both components and values.
 */

export const SERIES_COLORS = {
  price: "var(--accent)",
  sma: "#6f9bd1",
  ema: "#b07fc7",
  bollinger: "var(--up)",
  volume: "var(--text-subtle)",
} as const;

export interface ChartOptions {
  showSMA: boolean;
  showEMA: boolean;
  showBollinger: boolean;
  showVolume: boolean;
  /** Window for SMA, EMA, and Bollinger Bands. Changing it refetches. */
  period: number;
}

export const DEFAULT_CHART_OPTIONS: ChartOptions = {
  showSMA: true,
  showEMA: false,
  showBollinger: false,
  showVolume: true,
  period: 20,
};
