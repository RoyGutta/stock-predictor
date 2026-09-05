import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import * as matchers from "vitest-axe/matchers";

import { PatternsPanel } from "./PatternsPanel";
import type {
  PatternEvent,
  PatternOutcomes,
  PatternsResponse,
  PatternSummary,
} from "../../types/market";

expect.extend(matchers);

/**
 * The product commitments under test: occurrences are counted as occurrences
 * (never dressed up as wins), sample sizes are visible next to every statistic,
 * zero-sample windows show nothing rather than a fake zero, and no text
 * anywhere reads as advice or forecast.
 */

function outcome(overrides: Partial<PatternOutcomes> = {}): PatternOutcomes {
  return {
    window: 20,
    sample_size: 14,
    excluded: 0,
    mean: 0.021,
    median: 0.018,
    positive_share: 0.64,
    worst: -0.09,
    best: 0.12,
    small_sample: false,
    ...overrides,
  };
}

function summary(overrides: Partial<PatternSummary> = {}): PatternSummary {
  return {
    pattern: "golden_cross",
    label: "Golden cross",
    definition: "The 20-day average closed above the 50-day average.",
    caveat: "A crossover describes two moving averages, nothing more.",
    occurrences: 4,
    outcomes: [outcome({ window: 5 }), outcome(), outcome({ window: 60 })],
    ...overrides,
  };
}

function event(overrides: Partial<PatternEvent> = {}): PatternEvent {
  return {
    pattern: "golden_cross",
    label: "Golden cross",
    date: "2024-03-14",
    values: { fast: 187.2, slow: 185.9 },
    explanation: "The 20-day average closed above the 50-day average.",
    caveat: "A crossover describes two moving averages, nothing more.",
    ...overrides,
  };
}

function response(overrides: Partial<PatternsResponse> = {}): PatternsResponse {
  return {
    ticker: "AAPL",
    company_name: "Apple Inc.",
    range: "5Y",
    bars: 1255,
    start_date: "2019-09-03",
    end_date: "2024-08-30",
    events: [event()],
    summaries: [summary()],
    insufficient: false,
    note: "",
    method: "Every event is detected using only bars at or before its own date.",
    disclaimer: "These are descriptions of past market behavior, not signals and not forecasts.",
    ...overrides,
  };
}

const shown = { loading: false, error: null, started: true, onRun: () => {} };

describe("PatternsPanel", () => {
  it("stays opt-in until asked", () => {
    render(
      <PatternsPanel
        data={null}
        loading={false}
        error={null}
        ticker="AAPL"
        started={false}
        onRun={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /scan the history/i })).toBeInTheDocument();
  });

  it("says '4 occurrences', never anything like '4 successful predictions'", () => {
    const { container } = render(<PatternsPanel {...shown} ticker="AAPL" data={response()} />);
    expect(screen.getByText(/4 occurrences/)).toBeInTheDocument();
    const text = container.textContent?.toLowerCase() ?? "";
    for (const phrase of ["successful", "winning", "prediction", "signal fired"]) {
      expect(text).not.toContain(phrase);
    }
  });

  it("uses the singular for one occurrence", () => {
    render(
      <PatternsPanel
        {...shown}
        ticker="AAPL"
        data={response({ summaries: [summary({ occurrences: 1 })] })}
      />,
    );
    expect(screen.getByText(/1 occurrence$/)).toBeInTheDocument();
  });

  it("shows the sample size beside outcome statistics and flags small samples", async () => {
    const user = userEvent.setup();
    render(
      <PatternsPanel
        {...shown}
        ticker="AAPL"
        data={response({
          events: [],
          summaries: [
            summary({
              occurrences: 3,
              outcomes: [outcome({ window: 5, sample_size: 3, small_sample: true })],
            }),
          ],
        })}
      />,
    );
    await user.click(screen.getByText("Golden cross"));
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText(/small sample/i)).toBeInTheDocument();
  });

  it("counts events too recent to measure instead of guessing", async () => {
    const user = userEvent.setup();
    render(
      <PatternsPanel
        {...shown}
        ticker="AAPL"
        data={response({
          events: [],
          summaries: [
            summary({ outcomes: [outcome({ window: 60, sample_size: 2, excluded: 2, small_sample: true })] }),
          ],
        })}
      />,
    );
    await user.click(screen.getByText("Golden cross"));
    expect(screen.getByText(/2 too recent/)).toBeInTheDocument();
  });

  it("renders nothing statistical for zero-sample windows rather than fake zeros", async () => {
    const user = userEvent.setup();
    render(
      <PatternsPanel
        {...shown}
        ticker="AAPL"
        data={response({
          events: [],
          summaries: [
            summary({
              outcomes: [
                outcome({
                  window: 60,
                  sample_size: 0,
                  excluded: 4,
                  mean: null,
                  median: null,
                  positive_share: null,
                  worst: null,
                  best: null,
                  small_sample: true,
                }),
              ],
            }),
          ],
        })}
      />,
    );
    await user.click(screen.getByText("Golden cross"));
    expect(screen.getByText(/no occurrence has enough later history/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("reports insufficient history honestly", () => {
    render(
      <PatternsPanel
        {...shown}
        ticker="AAPL"
        data={response({
          insufficient: true,
          events: [],
          summaries: [],
          note: "Only 30 bars of history; at least 60 are needed. Try a longer range.",
        })}
      />,
    );
    expect(screen.getByText(/try a longer range/i)).toBeInTheDocument();
  });

  it("filters the timeline by pattern", async () => {
    const user = userEvent.setup();
    render(
      <PatternsPanel
        {...shown}
        ticker="AAPL"
        data={response({
          events: [
            event({ date: "2024-03-14" }),
            event({
              pattern: "rsi_oversold",
              label: "RSI oversold",
              date: "2024-05-02",
              explanation: "RSI closed below 30.",
            }),
          ],
          summaries: [
            summary({ occurrences: 1 }),
            summary({ pattern: "rsi_oversold", label: "RSI oversold", occurrences: 1 }),
          ],
        })}
      />,
    );
    expect(screen.getByText("2024-05-02")).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox"), "golden_cross");
    expect(screen.queryByText("2024-05-02")).not.toBeInTheDocument();
    expect(screen.getByText("2024-03-14")).toBeInTheDocument();
  });

  it("always renders the method and disclaimer", () => {
    render(<PatternsPanel {...shown} ticker="AAPL" data={response()} />);
    expect(screen.getByText(/at or before its own date/i)).toBeInTheDocument();
    expect(screen.getByText(/not signals and not forecasts/i)).toBeInTheDocument();
  });

  it("never renders advice or forecast language", () => {
    const { container } = render(<PatternsPanel {...shown} ticker="AAPL" data={response()} />);
    const text = container.textContent?.toLowerCase() ?? "";
    for (const phrase of ["you should", "we recommend", "will rise", "will fall", "buy now", "guaranteed"]) {
      expect(text).not.toContain(phrase);
    }
  });

  it("has no axe violations", async () => {
    const { container } = render(<PatternsPanel {...shown} ticker="AAPL" data={response()} />);
    expect(
      await axe(container, { rules: { "color-contrast": { enabled: false } } }),
    ).toHaveNoViolations();
  });
});
