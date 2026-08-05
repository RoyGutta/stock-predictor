import { Suspense, lazy } from "react";

import { Skeleton } from "../../components/ui";
import type { ChartOptions } from "./chartConfig";
import type { Candle, IndicatorSeries, Range } from "../../types/market";

/**
 * Recharts is ~350 kB and is the single largest thing in the bundle, but no
 * chart exists until a ticker is loaded. Splitting it here means the first
 * paint does not pay for it, and the chunk downloads while the API request for
 * that ticker is still in flight — so it is usually ready by the time the data
 * arrives.
 */
const PriceChart = lazy(() =>
  import("./PriceChart").then((module) => ({ default: module.PriceChart })),
);

interface LazyPriceChartProps {
  candles: Candle[];
  series: IndicatorSeries | null;
  range: Range;
  ticker: string;
  currency: string;
  options: ChartOptions;
}

export function LazyPriceChart(props: LazyPriceChartProps) {
  return (
    <Suspense
      fallback={
        <div className="chart__frame">
          <Skeleton height="100%" width="100%" />
        </div>
      }
    >
      <PriceChart {...props} />
    </Suspense>
  );
}
