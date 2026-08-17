import { Button, Callout, Card, Skeleton } from "../../components/ui";
import { formatPercentPlain, formatPrice } from "../../lib/format";
import type { SimulationResponse } from "../../types/market";
import "./simulation.css";

/** Percentile keys in ascending order, matching what the backend returns. */
const BANDS = ["p5", "p25", "p50", "p75", "p95"] as const;

interface DispersionBarProps {
  percentiles: Record<string, number>;
  startPrice: number;
  currency: string;
}

/**
 * The outcome range as a box plot.
 *
 * A box plot rather than a fan of simulated paths, deliberately. Drawing
 * hundreds of squiggly lines into the future is the single most common way
 * this chart gets misread as a forecast — each path looks like a prediction of
 * a specific route. A box says only "wide" or "narrow", which is the entire
 * claim the underlying resampling can actually support.
 *
 * Inline SVG rather than Recharts: this is five numbers on one axis, and
 * pulling in the chart library would cost ~330 kB for a shape drawn with four
 * rectangles.
 */
function DispersionBar({ percentiles, startPrice, currency }: DispersionBarProps) {
  const values = BANDS.map((key) => percentiles[key]);
  const [p5, p25, p50, p75, p95] = values;

  // Include today's price in the domain so the marker is always on-canvas,
  // even when every simulated path finished above or below it.
  const low = Math.min(p5, startPrice);
  const high = Math.max(p95, startPrice);
  const span = high - low || 1;
  const pad = span * 0.06;
  const domainLow = low - pad;
  const domainSpan = high - low + pad * 2;

  const x = (value: number) => ((value - domainLow) / domainSpan) * 100;

  const ticks: [string, number][] = [
    ["p5", p5],
    ["median", p50],
    ["p95", p95],
  ];

  return (
    <figure className="sim-dispersion">
      <svg
        className="sim-dispersion__svg"
        viewBox="0 0 100 34"
        preserveAspectRatio="none"
        role="img"
        aria-label={
          `Simulated outcome range. Middle 90% of paths finished between ` +
          `${formatPrice(p5, currency)} and ${formatPrice(p95, currency)}, ` +
          `median ${formatPrice(p50, currency)}, from a starting price of ` +
          `${formatPrice(startPrice, currency)}.`
        }
      >
        {/* p5–p95 whisker: the outer 90% span. */}
        <rect x={x(p5)} y={14} width={x(p95) - x(p5)} height={6} className="sim-dispersion__whisker" />
        {/* p25–p75 box: where half the paths landed. */}
        <rect x={x(p25)} y={9} width={x(p75) - x(p25)} height={16} className="sim-dispersion__box" />
        {/* Median. */}
        <rect x={x(p50) - 0.3} y={7} width={0.6} height={20} className="sim-dispersion__median" />
        {/* Today, for reference. */}
        <rect x={x(startPrice) - 0.2} y={2} width={0.4} height={30} className="sim-dispersion__start" />
      </svg>

      <figcaption className="sim-dispersion__axis" aria-hidden="true">
        {ticks.map(([label, value]) => (
          <span
            key={label}
            className="sim-dispersion__tick"
            // Labels are centred on their value, so one sitting at 0% or 100%
            // would hang half its width off the panel. Pulled inside; the bar
            // geometry above stays exact.
            style={{ left: `${Math.min(Math.max(x(value), 8), 92)}%` }}
          >
            <span className="sim-dispersion__tick-value numeric">{formatPrice(value, currency)}</span>
            <span className="sim-dispersion__tick-label">{label}</span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

interface SimulationPanelProps {
  data: SimulationResponse | null;
  loading: boolean;
  error: string | null;
  ticker: string;
  currency: string;
  started: boolean;
  onRun: () => void;
}

const TITLE = "How wide is the range of outcomes?";

/**
 * Scenario dispersion.
 *
 * Every label here is chosen to describe spread rather than direction. The
 * headline is the p5–p95 width, not the median — reading the median as "where
 * the price is going" is the failure mode this panel most has to design
 * against, so it is never the largest number on screen.
 */
export function SimulationPanel({
  data,
  loading,
  error,
  ticker,
  currency,
  started,
  onRun,
}: SimulationPanelProps) {
  if (!started) {
    return (
      <Card title={TITLE}>
        <div className="sim-intro">
          <p className="sim-intro__body">
            This resamples {ticker}&rsquo;s own past daily moves thousands of times to show how
            far apart the best and worst outcomes would be <em>if the future resembled that
            past</em>. It is a measure of uncertainty, not a prediction — it cannot tell you
            which way the price goes.
          </p>
          <Button variant="primary" onClick={onRun}>
            Run the simulation
          </Button>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card title={TITLE}>
        <Callout tone="note">{error}</Callout>
      </Card>
    );
  }

  if (loading || !data) {
    return (
      <Card title={TITLE}>
        <div style={{ display: "grid", gap: "var(--space-4)" }}>
          <Skeleton height={30} />
          <Skeleton height={80} />
        </div>
      </Card>
    );
  }

  const { percentiles, start_price: start } = data;
  const spreadFraction = (percentiles.p95 - percentiles.p5) / (start || 1);

  // Resampling inherits whatever drift the sample window had. After a strong
  // year the median path lands well above today's price, and a reader will
  // take that as a prediction unless it is named. This is the single most
  // misleading property of the method, so it is called out whenever it bites.
  const medianDrift = (percentiles.p50 - start) / (start || 1);
  const driftIsMaterial = Math.abs(medianDrift) >= 0.05;

  return (
    <Card title={TITLE} action={<span className="eyebrow">Dispersion, not a forecast</span>}>
      <p className="sim-headline">
        Across {data.simulations.toLocaleString()} simulated paths over{" "}
        {data.horizon_days} trading days, the middle 90% finished between{" "}
        <strong className="numeric">{formatPrice(percentiles.p5, currency)}</strong> and{" "}
        <strong className="numeric">{formatPrice(percentiles.p95, currency)}</strong> — a spread
        of about <strong className="numeric">{formatPercentPlain(spreadFraction)}</strong> of
        today&rsquo;s price.
      </p>

      <DispersionBar percentiles={percentiles} startPrice={start} currency={currency} />

      <dl className="sim-stats">
        <div>
          <dt>Today</dt>
          <dd className="numeric">{formatPrice(start, currency)}</dd>
        </div>
        <div>
          <dt>Median path</dt>
          <dd className="numeric">{formatPrice(percentiles.p50, currency)}</dd>
        </div>
        <div>
          <dt>Paths ending lower</dt>
          <dd className="numeric">{formatPercentPlain(data.probability_of_loss)}</dd>
        </div>
        <div>
          <dt>Drawn from</dt>
          <dd className="numeric">{data.observations} days</dd>
        </div>
      </dl>

      {driftIsMaterial && (
        <p className="sim-drift">
          The median path sits {formatPercentPlain(Math.abs(medianDrift))}{" "}
          {medianDrift > 0 ? "above" : "below"} today&rsquo;s price only because this stock{" "}
          {medianDrift > 0 ? "rose" : "fell"} over the window being resampled — that
          drift gets carried forward into every path. It is an echo of the past
          {" "}{data.observations} days, not a view about the next {data.horizon_days}. Read
          the <em>width</em> of the range above, not where its middle sits.
        </p>
      )}

      <p className="sim-note">
        &ldquo;Paths ending lower&rdquo; is a property of this resampled sample, not a
        real-world probability. It would change with a different window, and it assumes
        tomorrow&rsquo;s moves are drawn from the same distribution as the past
        {" "}{data.observations} days.
      </p>

      <Callout tone="accent">
        <div>
          <p className="sim-method">{data.method}</p>
          <p className="sim-method sim-method--warn">{data.disclaimer}</p>
        </div>
      </Callout>
    </Card>
  );
}
