import { memo, useCallback, useMemo } from "react";
import {
  Area,
  Brush,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from "recharts";

import { SERIES_COLORS, type ChartOptions } from "./chartConfig";
import { buildChartData, describeChart, type ChartPoint } from "../../lib/chart";
import { formatAxisTick, formatPrice, formatTimestamp, formatVolume } from "../../lib/format";
import type { Candle, IndicatorSeries, Range } from "../../types/market";
import { INTRADAY_RANGES } from "../../types/market";
import "./chart.css";

interface PriceChartProps {
  candles: Candle[];
  series: IndicatorSeries | null;
  range: Range;
  ticker: string;
  currency: string;
  options: ChartOptions;
}

function ChartTooltip({
  active,
  payload,
  label,
  intraday,
  currency,
  period,
}: TooltipContentProps<number, string> & {
  intraday: boolean;
  currency: string;
  period: number;
}) {
  if (!active || !payload?.length || label == null) return null;
  const point = payload[0].payload as ChartPoint | undefined;
  if (!point) return null;

  const rows: [string, string][] = [
    ["Close", formatPrice(point.price, currency)],
    ["Open", formatPrice(point.open, currency)],
    ["High", formatPrice(point.high, currency)],
    ["Low", formatPrice(point.low, currency)],
    ["Volume", formatVolume(point.volume)],
  ];
  if (point.sma != null) rows.push([`SMA ${period}`, formatPrice(point.sma, currency)]);
  if (point.ema != null) rows.push([`EMA ${period}`, formatPrice(point.ema, currency)]);
  if (point.rsi != null) rows.push(["RSI", point.rsi.toFixed(1)]);

  return (
    <div className="chart__tooltip">
      <strong className="chart__tooltip-date">{formatTimestamp(String(label), intraday)}</strong>
      {rows.map(([name, value]) => (
        <div key={name} className="chart__tooltip-row">
          <span>{name}</span>
          <span>{value}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * The price chart.
 *
 * Memoized because it is by far the most expensive thing on the page, and the
 * controls around it change state on every keystroke and toggle.
 */
export const PriceChart = memo(function PriceChart({
  candles,
  series,
  range,
  ticker,
  currency,
  options,
}: PriceChartProps) {
  const intraday = INTRADAY_RANGES.has(range);
  const data = useMemo(() => buildChartData(candles, series), [candles, series]);
  const description = useMemo(
    () => describeChart(ticker, range, data),
    [ticker, range, data],
  );

  const tickFormatter = useCallback(
    (value: string) => formatAxisTick(value, intraday),
    [intraday],
  );
  const priceFormatter = useCallback(
    (value: number) => formatPrice(value, currency).replace(/\.00$/, ""),
    [currency],
  );
  const renderTooltip = useCallback(
    (props: TooltipContentProps<number, string>) => (
      <ChartTooltip {...props} intraday={intraday} currency={currency} period={options.period} />
    ),
    [intraday, currency, options.period],
  );

  if (data.length === 0) return null;

  return (
    <div className="chart__frame" role="img" aria-label={description}>
      {/* minWidth/minHeight of 0 stop Recharts warning about a -1 measurement
          on the first frame, before the container has been laid out. */}
      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--grid)" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={tickFormatter}
            minTickGap={56}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            tick={{ fill: "var(--text-subtle)", fontSize: 11 }}
          />
          <YAxis
            yAxisId="price"
            domain={["auto", "auto"]}
            tickFormatter={priceFormatter}
            tickLine={false}
            axisLine={false}
            width={64}
            tick={{ fill: "var(--text-subtle)", fontSize: 11 }}
          />
          {/* Volume is context, not the subject. Scaling its axis to several
              times the peak keeps the bars in the lower quarter of the plot
              instead of competing with the price line. */}
          <YAxis
            yAxisId="volume"
            orientation="right"
            hide
            domain={[0, (dataMax: number) => dataMax * 4.5]}
          />
          <Tooltip content={renderTooltip} cursor={{ stroke: "var(--border-strong)" }} />

          {options.showVolume && (
            <Area
              yAxisId="volume"
              type="monotone"
              dataKey="volume"
              stroke="none"
              fill={SERIES_COLORS.volume}
              fillOpacity={0.14}
              isAnimationActive={false}
            />
          )}

          {options.showBollinger && (
            <>
              <Line
                yAxisId="price"
                type="monotone"
                dataKey="bollingerUpper"
                stroke={SERIES_COLORS.bollinger}
                strokeWidth={1}
                strokeOpacity={0.55}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
              <Line
                yAxisId="price"
                type="monotone"
                dataKey="bollingerLower"
                stroke={SERIES_COLORS.bollinger}
                strokeWidth={1}
                strokeOpacity={0.55}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            </>
          )}

          {options.showSMA && (
            <Line
              yAxisId="price"
              type="monotone"
              dataKey="sma"
              stroke={SERIES_COLORS.sma}
              strokeWidth={1.5}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          )}

          {options.showEMA && (
            <Line
              yAxisId="price"
              type="monotone"
              dataKey="ema"
              stroke={SERIES_COLORS.ema}
              strokeWidth={1.5}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          )}

          <Line
            yAxisId="price"
            type="monotone"
            dataKey="price"
            stroke={SERIES_COLORS.price}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />

          <Brush
            dataKey="date"
            height={24}
            travellerWidth={8}
            stroke="var(--border-strong)"
            fill="var(--surface-raised)"
            tickFormatter={tickFormatter}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
});
