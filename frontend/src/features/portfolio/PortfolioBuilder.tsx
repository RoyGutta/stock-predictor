import { useCallback, useId, useRef, useState } from "react";

import { Button, Callout, Card, Skeleton } from "../../components/ui";
import { ApiError, fetchPortfolioSimulation, isAbort } from "../../lib/api";
import { formatPercentPlain, formatPrice, formatRatio } from "../../lib/format";
import type { PortfolioSimulationResponse, Range } from "../../types/market";
import "./portfolio.css";

/**
 * Hypothetical portfolio builder.
 *
 * Replays a fixed-weight purchase plan over real history, beside the identical
 * cash flows into a benchmark. Everything shown is a historical replay: the
 * headline label, the method, and the disclaimer all come from the API payload
 * so the wording cannot drift from what was actually computed.
 *
 * Return statistics come from the flow-adjusted series — the panel never
 * presents deposits as investment growth, and says so.
 */

interface LegDraft {
  id: number;
  ticker: string;
  /** Percent, 0–100, as typed. Converted to fractions on submit. */
  percent: string;
}

const MAX_LEGS = 8;
const WINDOWS: Range[] = ["1Y", "5Y", "MAX"];

let nextId = 1;

function newLeg(ticker = "", percent = ""): LegDraft {
  return { id: nextId++, ticker, percent };
}

function legsTotal(legs: LegDraft[]): number {
  return legs.reduce((sum, leg) => sum + (Number(leg.percent) || 0), 0);
}

/** Two growth-index lines in a fixed viewBox; no charting library needed. */
function GrowthChart({ data }: { data: PortfolioSimulationResponse }) {
  const portfolio = data.portfolio.growth_index;
  const benchmark = data.benchmark.growth_index;
  const all = [...portfolio, ...benchmark];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;

  const path = (series: number[]): string =>
    series
      .map((value, i) => {
        const x = (i / Math.max(series.length - 1, 1)) * 100;
        const y = 38 - ((value - min) / span) * 36;
        return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");

  const label =
    `Growth of 1 dollar, time-weighted. Portfolio finished at ` +
    `${portfolio[portfolio.length - 1]?.toFixed(2)}, ${data.benchmark_ticker} at ` +
    `${benchmark[benchmark.length - 1]?.toFixed(2)}.`;

  const baselineY = 38 - ((1 - min) / span) * 36;

  return (
    <figure className="pf-chart">
      <svg viewBox="0 0 100 40" className="pf-chart__svg" role="img" aria-label={label}>
        <line x1="0" y1={baselineY} x2="100" y2={baselineY} className="pf-chart__baseline" />
        <path d={path(benchmark)} className="pf-chart__line pf-chart__line--benchmark" />
        <path d={path(portfolio)} className="pf-chart__line pf-chart__line--portfolio" />
      </svg>
      <figcaption className="pf-chart__legend">
        <span className="pf-chart__key pf-chart__key--portfolio">Portfolio</span>
        <span className="pf-chart__key pf-chart__key--benchmark">{data.benchmark_ticker}</span>
        <span className="pf-chart__note">
          Time-weighted growth of $1 — deposits are stripped out before measuring.
        </span>
      </figcaption>
    </figure>
  );
}

function ResultStats({ data }: { data: PortfolioSimulationResponse }) {
  const ours = data.portfolio.stats;
  const theirs = data.benchmark.stats;
  const rows: [string, string, string][] = [
    ["Historical return", formatPercentPlain(ours.total_return), formatPercentPlain(theirs.total_return)],
    ["Annualized", formatPercentPlain(ours.annualized_return), formatPercentPlain(theirs.annualized_return)],
    ["Volatility", formatPercentPlain(ours.annualized_volatility), formatPercentPlain(theirs.annualized_volatility)],
    ["Sharpe", formatRatio(ours.sharpe_ratio), formatRatio(theirs.sharpe_ratio)],
    ["Max drawdown", formatPercentPlain(ours.max_drawdown), formatPercentPlain(theirs.max_drawdown)],
    ["Ending value", formatPrice(data.portfolio.ending_value), formatPrice(data.benchmark.ending_value)],
  ];

  return (
    <table className="pf-table">
      <caption className="visually-hidden">
        Hypothetical historical statistics for the portfolio and the benchmark
      </caption>
      <thead>
        <tr>
          <th scope="col">Historical statistic</th>
          <th scope="col">Portfolio</th>
          <th scope="col">{data.benchmark_ticker}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([name, portfolioValue, benchmarkValue]) => (
          <tr key={name}>
            <th scope="row">{name}</th>
            <td className="numeric">{portfolioValue}</td>
            <td className="numeric">{benchmarkValue}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function PortfolioBuilder() {
  const [legs, setLegs] = useState<LegDraft[]>([newLeg("VOO", "60"), newLeg("AAPL", "40")]);
  const [initial, setInitial] = useState("10000");
  const [monthly, setMonthly] = useState("0");
  const [window, setWindow] = useState<Range>("5Y");

  const [data, setData] = useState<PortfolioSimulationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const headingId = useId();

  const total = legsTotal(legs);
  const filled = legs.filter((leg) => leg.ticker.trim() && Number(leg.percent) > 0);
  const totalOff = Math.abs(total - 100) > 0.1;
  const canRun = filled.length > 0 && !totalOff && Number(initial) > 0 && !loading;

  const updateLeg = (id: number, patch: Partial<LegDraft>) =>
    setLegs((current) => current.map((leg) => (leg.id === id ? { ...leg, ...patch } : leg)));

  const splitEvenly = () =>
    setLegs((current) => {
      const active = current.filter((leg) => leg.ticker.trim());
      const share = active.length ? (100 / active.length).toFixed(1) : "0";
      return current.map((leg) => (leg.ticker.trim() ? { ...leg, percent: share } : leg));
    });

  const run = useCallback(() => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setLoading(true);
    setError(null);

    fetchPortfolioSimulation(
      filled.map((leg) => ({
        ticker: leg.ticker.trim().toUpperCase(),
        weight: Number(leg.percent) / 100,
      })),
      { range: window, initial: Number(initial), monthly: Number(monthly) || 0 },
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (isAbort(err) || controller.signal.aborted) return;
        setError(err instanceof ApiError ? err.message : "Something went wrong.");
        setData(null);
        setLoading(false);
      });
  }, [filled, window, initial, monthly]);

  return (
    <Card
      title="Build a hypothetical portfolio"
      action={<span className="eyebrow">Historical replay</span>}
    >
      <p className="pf-intro">
        Pick a mix, a starting amount, and an optional monthly contribution, and see what
        that exact plan would have done over past data — beside the same money going into{" "}
        an index fund. This is history, not a projection.
      </p>

      <form
        className="pf-form"
        aria-labelledby={headingId}
        onSubmit={(event) => {
          event.preventDefault();
          if (canRun) run();
        }}
      >
        <span id={headingId} className="visually-hidden">
          Hypothetical portfolio inputs
        </span>

        <div className="pf-legs">
          {legs.map((leg, index) => (
            <div key={leg.id} className="pf-leg">
              <label className="pf-leg__field">
                <span className="pf-leg__label">Ticker {index + 1}</span>
                <input
                  type="text"
                  value={leg.ticker}
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder="VOO"
                  onChange={(event) =>
                    updateLeg(leg.id, { ticker: event.target.value.toUpperCase() })
                  }
                />
              </label>
              <label className="pf-leg__field pf-leg__field--weight">
                <span className="pf-leg__label">Weight %</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="any"
                  value={leg.percent}
                  onChange={(event) => updateLeg(leg.id, { percent: event.target.value })}
                />
              </label>
              <Button
                variant="ghost"
                small
                aria-label={`Remove holding ${leg.ticker || index + 1}`}
                disabled={legs.length <= 1}
                onClick={() => setLegs((current) => current.filter((l) => l.id !== leg.id))}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>

        <div className="pf-legs-actions">
          <Button
            variant="ghost"
            small
            disabled={legs.length >= MAX_LEGS}
            onClick={() => setLegs((current) => [...current, newLeg()])}
          >
            Add holding
          </Button>
          <Button variant="ghost" small onClick={splitEvenly}>
            Split evenly
          </Button>
          <span className={`pf-total${totalOff ? " pf-total--off" : ""}`} role="status">
            Total {total.toFixed(1)}%{totalOff ? " — weights must sum to 100%" : ""}
          </span>
        </div>

        <div className="pf-params">
          <label className="pf-param">
            <span className="pf-leg__label">Starting amount ($)</span>
            <input
              type="number"
              min={1}
              step="any"
              value={initial}
              onChange={(event) => setInitial(event.target.value)}
            />
          </label>
          <label className="pf-param">
            <span className="pf-leg__label">Monthly contribution ($)</span>
            <input
              type="number"
              min={0}
              step="any"
              value={monthly}
              onChange={(event) => setMonthly(event.target.value)}
            />
          </label>
          <label className="pf-param">
            <span className="pf-leg__label">History window</span>
            <select value={window} onChange={(event) => setWindow(event.target.value as Range)}>
              {WINDOWS.map((option) => (
                <option key={option} value={option}>
                  {option === "MAX" ? "All available" : option}
                </option>
              ))}
            </select>
          </label>
          <Button variant="primary" type="submit" disabled={!canRun}>
            {loading ? "Simulating…" : "Run the replay"}
          </Button>
        </div>
      </form>

      {error && (
        <Callout tone="note" role="alert">
          {error}
        </Callout>
      )}

      {loading && (
        <div className="pf-loading">
          <Skeleton height={120} />
          <Skeleton height={160} />
        </div>
      )}

      {data && !loading && !error && (
        <div className="pf-results" aria-live="polite">
          <h3 className="pf-results__label">Hypothetical historical simulation</h3>
          <p className="pf-results__summary">
            {formatPrice(data.portfolio.total_contributed)} contributed across{" "}
            {data.portfolio.bars} shared price bars ({data.portfolio.start_date} to{" "}
            {data.portfolio.end_date}) would have ended at{" "}
            <strong className="numeric">{formatPrice(data.portfolio.ending_value)}</strong>,
            versus{" "}
            <strong className="numeric">{formatPrice(data.benchmark.ending_value)}</strong>{" "}
            for the same cash flows into {data.benchmark_ticker}.
          </p>

          {Object.keys(data.invalid_tickers).length > 0 && (
            <Callout tone="note">
              Skipped: {Object.keys(data.invalid_tickers).join(", ")} — not valid symbols.
            </Callout>
          )}

          <GrowthChart data={data} />
          <ResultStats data={data} />

          <div className="pf-drift">
            <h4 className="eyebrow">Where the weights ended up</h4>
            <ul className="pf-drift__list">
              {data.legs.map((leg) => (
                <li key={leg.ticker} className="pf-drift__row">
                  <span className="pf-drift__ticker">{leg.ticker}</span>
                  <span className="numeric">
                    {formatPercentPlain(leg.weight)} → {formatPercentPlain(leg.end_weight)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="pf-drift__note">
              Nothing is rebalanced, so weights drift toward whatever rose most —
              concentration ended at {formatPercentPlain(data.portfolio.largest_end_weight)}{" "}
              in a single holding. Costs of {formatPrice(data.portfolio.cost_paid)} were
              charged across {data.portfolio.contribution_count + 1} purchases.
            </p>
          </div>

          <Callout tone="accent">
            <div>
              <p className="pf-method">{data.method}</p>
              <p className="pf-method pf-method--warn">{data.disclaimer}</p>
            </div>
          </Callout>
        </div>
      )}
    </Card>
  );
}
