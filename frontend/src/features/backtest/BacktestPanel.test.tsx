import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BacktestPanel } from "./BacktestPanel";
import type { BacktestMetrics, BacktestResponse, StrategyResult } from "../../types/market";

/**
 * Component tests for the backtest panel.
 *
 * Two display defects shipped here and were caught by eye rather than by a
 * test (LEARNINGS L-8): a 0.0% return coloured green because the check was
 * `>= 0`, and a meaningless "picked none = 0 from 1 tried" line on the
 * parameterless benchmark row. Both are pinned below so they cannot return.
 */

function metrics(overrides: Partial<BacktestMetrics> = {}): BacktestMetrics {
  return {
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
    ...overrides,
  };
}

function strategy(overrides: Partial<StrategyResult> = {}): StrategyResult {
  return {
    strategy_key: "sma_crossover",
    strategy_name: "Price above moving average",
    description: "Hold the stock whenever its price is above its own moving average.",
    parameter_label: "moving average length",
    chosen_parameter: 50,
    parameters_tried: 4,
    in_sample: metrics({ total_return: 0.48 }),
    out_of_sample: metrics({ total_return: 0.268 }),
    benchmark_out_of_sample: metrics({ total_return: 0.374 }),
    excess_return: -0.106,
    beat_benchmark: false,
    degradation: -0.212,
    verdict: "Over this out-of-sample window the rule finished 10.6 percentage points behind.",
    ...overrides,
  };
}

function response(overrides: Partial<BacktestResponse> = {}): BacktestResponse {
  return {
    ticker: "AAPL",
    company_name: "Apple Inc.",
    range: "1Y",
    bars: 251,
    split_date: "2025-06-02",
    train_fraction: 0.6,
    cost_bps: 10,
    strategies: [strategy()],
    strategies_beating_benchmark: 0,
    method: "Walk-forward validation.",
    disclaimer: "This is a historical exercise, not a strategy recommendation.",
    ...overrides,
  };
}

const shown = { loading: false, error: null, started: true, onRun: () => {} };

describe("BacktestPanel", () => {
  it("colours a zero out-of-sample return as neither gain nor loss", () => {
    /* L-8: a 0.0% return means the rule never traded and sat in cash.
       Rendering it green contradicted the headline directly above it. */
    const { container } = render(
      <BacktestPanel
        {...shown}
        ticker="AAPL"
        data={response({
          strategies: [
            strategy({ out_of_sample: metrics({ total_return: 0, trades: 0 }) }),
          ],
        })}
      />,
    );
    const value = container.querySelector(".bt-journey__stage--result .bt-journey__value");
    expect(value?.className).not.toContain("positive");
    expect(value?.className).not.toContain("negative");
  });

  it("explains a rule that never traded instead of leaving a bare zero", () => {
    render(
      <BacktestPanel
        {...shown}
        ticker="AAPL"
        data={response({
          strategies: [strategy({ out_of_sample: metrics({ total_return: 0, trades: 0 }) })],
        })}
      />,
    );
    expect(screen.getByText(/never triggered/i)).toBeInTheDocument();
    expect(screen.getByText(/that is a result, not a missing value/i)).toBeInTheDocument();
  });

  it("omits parameter-selection text on the parameterless benchmark row", () => {
    /* L-8: the benchmark showed "picked none = 0 from 1 tried", which is
       nonsense for a rule that has no parameters. */
    render(
      <BacktestPanel
        {...shown}
        ticker="AAPL"
        data={response({
          strategies: [
            strategy({
              strategy_key: "buy_and_hold",
              strategy_name: "Buy and hold",
              parameter_label: "none",
              chosen_parameter: 0,
              parameters_tried: 1,
            }),
          ],
        })}
      />,
    );
    expect(screen.queryByText(/picked none/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/from 1 tried/i)).not.toBeInTheDocument();
  });

  it("marks the benchmark as the yardstick rather than a competitor", () => {
    const { container } = render(
      <BacktestPanel
        {...shown}
        ticker="AAPL"
        data={response({
          strategies: [strategy({ strategy_key: "buy_and_hold", strategy_name: "Buy and hold" })],
        })}
      />,
    );
    expect(screen.getByText("benchmark")).toBeInTheDocument();
    // The benchmark competes with nothing, so it carries no ahead/behind chip.
    expect(container.querySelector(".bt-row__verdict-chip")).toBeNull();
  });

  it("shows in-sample and out-of-sample side by side", () => {
    /* The gap between them is the lesson, so both must be visible at once. */
    render(<BacktestPanel {...shown} ticker="AAPL" data={response()} />);
    expect(screen.getByText(/tuned on this/i)).toBeInTheDocument();
    expect(screen.getByText(/then tested on unseen data/i)).toBeInTheDocument();
  });

  it("flags over-fitting when performance collapsed out of sample", () => {
    render(<BacktestPanel {...shown} ticker="AAPL" data={response()} />);
    expect(screen.getByText(/what over-fitting looks like/i)).toBeInTheDocument();
  });

  it("reports how many rules beat the benchmark, including none", () => {
    render(<BacktestPanel {...shown} ticker="AAPL" data={response()} />);
    expect(screen.getByText("0 of 0")).toBeInTheDocument();
  });

  it("never renders advice language", () => {
    const { container } = render(<BacktestPanel {...shown} ticker="AAPL" data={response()} />);
    const text = container.textContent?.toLowerCase() ?? "";
    for (const phrase of ["you should", "we recommend", "guaranteed", "price target"]) {
      expect(text).not.toContain(phrase);
    }
  });

  it("always renders the disclaimer", () => {
    render(<BacktestPanel {...shown} ticker="AAPL" data={response()} />);
    expect(screen.getByText(/not a strategy recommendation/i)).toBeInTheDocument();
  });

  it("stays opt-in until asked", () => {
    render(
      <BacktestPanel
        data={null}
        loading={false}
        error={null}
        ticker="AAPL"
        started={false}
        onRun={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /run the test/i })).toBeInTheDocument();
  });
});
