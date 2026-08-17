/**
 * Automated accessibility checks.
 *
 * The UI was previously only checked by hand at each milestone, which does not
 * scale as the surface grows (ROADMAP "Next", item 1). These run axe over every
 * panel in the states a user actually encounters — populated, empty, failed —
 * because a violation usually hides in the states nobody screenshots.
 *
 * Two limits worth being explicit about, since a green suite here is easy to
 * mistake for "the UI is accessible":
 *
 * 1. **Colour contrast is not checked.** axe measures contrast by rasterising
 *    to a canvas, and jsdom has no canvas implementation — the rule does not
 *    error, it silently produces nothing. It is disabled below rather than
 *    left to no-op, so the gap is visible in the code instead of hiding behind
 *    a passing test. Contrast is verified in a real browser in both themes.
 * 2. **axe only catches machine-checkable violations.** It can tell that a
 *    control has a label; it cannot tell whether the label is meaningful.
 *    These supplement the hand check rather than replacing it.
 */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import type { AxeMatchers } from "vitest-axe/matchers";
import * as matchers from "vitest-axe/matchers";
import { expect as vitestExpect } from "vitest";

import { EvidenceLedger } from "../features/analysis/EvidenceLedger";
import { RiskPanel } from "../features/analysis/RiskPanel";
import { BacktestPanel } from "../features/backtest/BacktestPanel";
import { MomentumPanel } from "../features/momentum/MomentumPanel";
import { ProfilePanel } from "../features/profile/ProfilePanel";
import { CorrelationPanel } from "../features/simulation/CorrelationPanel";
import { SimulationPanel } from "../features/simulation/SimulationPanel";
import { WatchlistPanel } from "../features/watchlist/WatchlistPanel";
import { LearnPanel } from "../features/education/LearnPanel";
import { QuoteSummary, RangeSelector } from "../features/quote/QuotePanel";
import { SearchBox } from "../features/search/SearchBox";
import type {
  BacktestResponse,
  CorrelationResponse,
  Observation,
  Quote,
  RiskMetrics,
  SimulationResponse,
  TrendInterpretation,
} from "../types/market";

vitestExpect.extend(matchers);

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Assertion extends AxeMatchers {}
}

/**
 * Colour contrast needs a canvas to rasterise against, which jsdom does not
 * provide. Disabled explicitly so the limitation is stated rather than
 * silently producing no result; contrast is checked in a real browser.
 */
const AXE_OPTIONS = { rules: { "color-contrast": { enabled: false } } };

/** axe needs a real document root; jsdom's default body is enough. */
async function expectNoViolations(ui: React.ReactElement) {
  const { container } = render(ui);
  expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
}

// --- fixtures ---------------------------------------------------------------

const observation: Observation = {
  indicator: "RSI",
  stance: "bearish",
  value: 74,
  headline: "RSI is 74, in the conventional 'overbought' zone.",
  detail: "RSI compares the size of up-moves to down-moves on a 0-100 scale.",
  caveat: "'Overbought' does not mean 'about to fall'.",
};

const interpretation: TrendInterpretation = {
  summary: "2 of 3 directional indicators lean bearish, with 1 neutral.",
  agreement_score: 0.333,
  agreement_label: "weak agreement",
  conflicts: ["Momentum is turning up while the longer-term trend is still down."],
  bullish: [{ ...observation, indicator: "MACD", stance: "bullish" }],
  bearish: [observation],
  neutral: [{ ...observation, indicator: "ATR", stance: "neutral" }],
  disclaimer: "These are descriptions of past price movement, not predictions.",
};

const risk: RiskMetrics = {
  annualized_return: 0.32,
  annualized_volatility: 0.25,
  sharpe_ratio: 1.26,
  sortino_ratio: 1.85,
  max_drawdown: -0.138,
  drawdown_peak_date: "2026-02-01",
  drawdown_trough_date: "2026-04-08",
  drawdown_recovery_date: "2026-05-06",
  value_at_risk_95: -0.0203,
  conditional_value_at_risk_95: -0.0359,
  observations: 250,
  frequency: "daily",
  basis: "Computed from the price history in this range only.",
  benchmark: {
    benchmark_ticker: "SPY",
    beta: 0.72,
    r_squared: 0.138,
    alpha: 0.21,
    observations: 250,
  },
};

const quote: Quote = {
  ticker: "AAPL",
  company_name: "Apple Inc.",
  price: 305.93,
  open: 300,
  high: 310,
  low: 299,
  volume: 52_400_000,
  change_points: 5.93,
  change_percent: 1.97,
  currency: "USD",
  range: "1Y",
  history: [],
  as_of: "2026-08-17",
  source: "yfinance",
};

const simulation: SimulationResponse = {
  ticker: "AAPL",
  company_name: "Apple Inc.",
  range: "1Y",
  start_price: 305.93,
  horizon_days: 252,
  simulations: 5000,
  percentiles: { p5: 266, p25: 340, p50: 404, p75: 490, p95: 603 },
  probability_of_loss: 0.13,
  observations: 250,
  method: "historical bootstrap (resampled log returns, with replacement)",
  disclaimer: "Not a forecast.",
};

const correlation: CorrelationResponse = {
  tickers: ["AAPL", "MSFT"],
  range: "1Y",
  matrix: [
    [1, 0.42],
    [0.42, 1],
  ],
  observations: 250,
  resolved: { AAPL: "Apple Inc.", MSFT: "Microsoft Corporation" },
  unavailable: { ZZZZ: "No market data found." },
  note: "Correlation is computed on returns, not on price levels.",
};

const backtestMetrics = {
  strategy_key: "sma_crossover",
  strategy_name: "Price above moving average",
  parameter: 50,
  bars: 150,
  total_return: 0.12,
  annualized_return: 0.11,
  annualized_volatility: 0.2,
  sharpe_ratio: 0.6,
  max_drawdown: -0.18,
  trades: 7,
  win_rate: 0.43,
  exposure: 0.62,
  cost_bps: 10,
  cost_drag: 0.004,
};

const backtest: BacktestResponse = {
  ticker: "AAPL",
  company_name: "Apple Inc.",
  range: "1Y",
  bars: 251,
  split_date: "2025-06-02",
  train_fraction: 0.6,
  cost_bps: 10,
  strategies: [
    {
      strategy_key: "sma_crossover",
      strategy_name: "Price above moving average",
      description: "Hold the stock whenever its price is above its own moving average.",
      parameter_label: "moving average length",
      chosen_parameter: 50,
      parameters_tried: 4,
      in_sample: backtestMetrics,
      out_of_sample: backtestMetrics,
      benchmark_out_of_sample: backtestMetrics,
      excess_return: -0.106,
      beat_benchmark: false,
      degradation: -0.212,
      verdict: "Finished behind buy and hold.",
    },
  ],
  strategies_beating_benchmark: 0,
  method: "Walk-forward validation.",
  disclaimer: "Not a strategy recommendation.",
};

const noop = () => {};

// --- the checks -------------------------------------------------------------

describe("accessibility", () => {
  it("evidence ledger has no violations", async () => {
    await expectNoViolations(<EvidenceLedger interpretation={interpretation} />);
  });

  it("risk panel has no violations", async () => {
    await expectNoViolations(<RiskPanel risk={risk} />);
  });

  it("quote summary has no violations", async () => {
    await expectNoViolations(
      <QuoteSummary quote={quote} watched={false} onToggleWatch={noop} />,
    );
  });

  it("range selector has no violations", async () => {
    await expectNoViolations(<RangeSelector value="1Y" onChange={noop} />);
  });

  it("search box has no violations", async () => {
    await expectNoViolations(
      <SearchBox value="" onChange={noop} onSubmit={noop} loading={false} suggestionsEnabled />,
    );
  });

  it("learn panel has no violations", async () => {
    await expectNoViolations(<LearnPanel />);
  });

  it("simulation panel has no violations when populated", async () => {
    await expectNoViolations(
      <SimulationPanel
        data={simulation}
        loading={false}
        error={null}
        ticker="AAPL"
        currency="USD"
        started
        onRun={noop}
      />,
    );
  });

  it("simulation panel has no violations before it is run", async () => {
    await expectNoViolations(
      <SimulationPanel
        data={null}
        loading={false}
        error={null}
        ticker="AAPL"
        currency="USD"
        started={false}
        onRun={noop}
      />,
    );
  });

  it("momentum panel has no violations", async () => {
    await expectNoViolations(
      <MomentumPanel
        ticker="AAPL"
        momentum={{
          state: "bullish",
          score: 4,
          total: 4,
          headline: "All four conditions hold.",
          conditions: [
            { label: "Price above the 20-day average", met: true, detail: "305.93 vs 300.10." },
            { label: "20-day above the 50-day", met: true, detail: "300.10 vs 290.40." },
            { label: "50-day above the 100-day", met: false, detail: "290.40 vs 295.20." },
            { label: "20-day average still rising", met: true, detail: "+1.20% over 5 bars." },
          ],
          caveat: "This describes how the averages are stacked right now.",
          price: 305.93,
          fast: 300.1,
          medium: 290.4,
          slow: 275.2,
        }}
      />,
    );
  });

  it("company profile has no violations", async () => {
    await expectNoViolations(
      <ProfilePanel
        profile={{
          ticker: "AAPL",
          name: "Apple Inc.",
          sector: "Technology",
          industry: "Consumer Electronics",
          country: "US",
          exchange: "NASDAQ",
          market_cap: 3.4e12,
          beta: 1.09,
          last_dividend: 1.04,
          average_volume: 52_400_000,
          employees: 164_000,
          website: "https://www.apple.com",
          description: "Apple Inc. designs, manufactures and markets smartphones.",
          ceo: "Tim Cook",
          is_etf: false,
          source: "Financial Modeling Prep",
        }}
        loading={false}
        error={null}
        ticker="AAPL"
      />,
    );
  });

  it("correlation matrix has no violations", async () => {
    await expectNoViolations(
      <CorrelationPanel data={correlation} loading={false} error={null} />,
    );
  });

  it("backtest panel has no violations when populated", async () => {
    await expectNoViolations(
      <BacktestPanel
        data={backtest}
        loading={false}
        error={null}
        ticker="AAPL"
        started
        onRun={noop}
      />,
    );
  });

  it("watchlist has no violations when populated", async () => {
    await expectNoViolations(
      <WatchlistPanel
        rows={[{ ticker: "AAPL", quote, error: null }]}
        loading={false}
        updatedAt={new Date("2026-08-17T02:10:00Z")}
        tickers={["AAPL"]}
        momentum={new Map()}
        sortByMomentum={false}
        onToggleSort={noop}
        onSelect={noop}
        onRemove={noop}
        onClear={noop}
        onRefresh={noop}
      />,
    );
  });

  it("watchlist has no violations when empty", async () => {
    /* Empty states are the ones nobody screenshots, so they are where
       violations survive. */
    await expectNoViolations(
      <WatchlistPanel
        rows={[]}
        loading={false}
        updatedAt={null}
        tickers={[]}
        momentum={new Map()}
        sortByMomentum={false}
        onToggleSort={noop}
        onSelect={noop}
        onRemove={noop}
        onClear={noop}
        onRefresh={noop}
      />,
    );
  });

  it("watchlist has no violations when a row failed to load", async () => {
    await expectNoViolations(
      <WatchlistPanel
        rows={[{ ticker: "ZZZZ", quote: null, error: "No market data found." }]}
        loading={false}
        updatedAt={null}
        tickers={["ZZZZ"]}
        momentum={new Map()}
        sortByMomentum={false}
        onToggleSort={noop}
        onSelect={noop}
        onRemove={noop}
        onClear={noop}
        onRefresh={noop}
      />,
    );
  });

  it("error states have no violations", async () => {
    await expectNoViolations(
      <SimulationPanel
        data={null}
        loading={false}
        error="Not enough history to resample."
        ticker="AAPL"
        currency="USD"
        started
        onRun={noop}
      />,
    );
  });
});
