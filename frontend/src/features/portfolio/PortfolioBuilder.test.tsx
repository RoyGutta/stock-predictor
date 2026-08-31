import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PortfolioBuilder } from "./PortfolioBuilder";
import type { PortfolioSimulationOut, PortfolioSimulationResponse } from "../../types/market";

const fetchPortfolioSimulation = vi.hoisted(() => vi.fn());

vi.mock("../../lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/api")>();
  return { ...original, fetchPortfolioSimulation };
});

function leg(overrides: Partial<PortfolioSimulationOut> = {}): PortfolioSimulationOut {
  return {
    bars: 250,
    start_date: "2024-01-02",
    end_date: "2024-12-30",
    initial_investment: 10_000,
    monthly_contribution: 500,
    contribution_count: 11,
    total_contributed: 15_500,
    ending_value: 17_200.5,
    cost_paid: 15.5,
    stats: {
      total_return: 0.11,
      annualized_return: 0.11,
      annualized_volatility: 0.18,
      sharpe_ratio: 0.7,
      max_drawdown: -0.12,
    },
    largest_end_weight: 0.62,
    dates: ["2024-01-02", "2024-12-30"],
    values: [10_000, 17_200.5],
    growth_index: [1.0, 1.11],
    ...overrides,
  };
}

function response(): PortfolioSimulationResponse {
  return {
    legs: [
      { ticker: "VOO", weight: 0.6, end_weight: 0.58 },
      { ticker: "AAPL", weight: 0.4, end_weight: 0.42 },
    ],
    portfolio: leg(),
    benchmark_ticker: "SPY",
    benchmark: leg({ ending_value: 16_900, stats: { ...leg().stats, total_return: 0.09 } }),
    excess_return: 0.02,
    invalid_tickers: {},
    cost_bps: 10,
    range: "5Y",
    source: "yfinance",
    method: "Hypothetical historical replay. time-weighted.",
    disclaimer: "Hypothetical historical simulation, not a projection and not advice.",
  };
}

beforeEach(() => {
  fetchPortfolioSimulation.mockReset();
});

describe("PortfolioBuilder", () => {
  it("renders the form with default holdings", () => {
    render(<PortfolioBuilder />);
    expect(screen.getByDisplayValue("VOO")).toBeInTheDocument();
    expect(screen.getByDisplayValue("AAPL")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /run the replay/i })).toBeEnabled();
  });

  it("blocks the run while weights do not sum to 100", async () => {
    const user = userEvent.setup();
    render(<PortfolioBuilder />);

    const weightInputs = screen.getAllByLabelText(/weight %/i);
    await user.clear(weightInputs[0]);
    await user.type(weightInputs[0], "80");

    expect(screen.getByRole("status")).toHaveTextContent(/must sum to 100%/i);
    expect(screen.getByRole("button", { name: /run the replay/i })).toBeDisabled();
    expect(fetchPortfolioSimulation).not.toHaveBeenCalled();
  });

  it("converts percents to fractions when running", async () => {
    const user = userEvent.setup();
    fetchPortfolioSimulation.mockResolvedValue(response());
    render(<PortfolioBuilder />);

    await user.click(screen.getByRole("button", { name: /run the replay/i }));

    await waitFor(() => expect(fetchPortfolioSimulation).toHaveBeenCalledTimes(1));
    const [holdings, options] = fetchPortfolioSimulation.mock.calls[0];
    expect(holdings).toEqual([
      { ticker: "VOO", weight: 0.6 },
      { ticker: "AAPL", weight: 0.4 },
    ]);
    expect(options).toMatchObject({ initial: 10_000, monthly: 0, range: "5Y" });
  });

  it("labels the results as a hypothetical historical simulation", async () => {
    const user = userEvent.setup();
    fetchPortfolioSimulation.mockResolvedValue(response());
    render(<PortfolioBuilder />);

    await user.click(screen.getByRole("button", { name: /run the replay/i }));

    expect(
      await screen.findByRole("heading", { name: /hypothetical historical simulation/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/not a projection and not advice/i)).toBeInTheDocument();
  });

  it("shows portfolio and benchmark side by side", async () => {
    const user = userEvent.setup();
    fetchPortfolioSimulation.mockResolvedValue(response());
    render(<PortfolioBuilder />);
    await user.click(screen.getByRole("button", { name: /run the replay/i }));

    const table = await screen.findByRole("table");
    expect(table).toHaveTextContent("Portfolio");
    expect(table).toHaveTextContent("SPY");
    expect(table).toHaveTextContent("Max drawdown");
  });

  it("shows weight drift for every leg", async () => {
    const user = userEvent.setup();
    fetchPortfolioSimulation.mockResolvedValue(response());
    render(<PortfolioBuilder />);
    await user.click(screen.getByRole("button", { name: /run the replay/i }));

    await screen.findByText(/where the weights ended up/i);
    // Target weight and drifted end weight are both visible.
    expect(screen.getByText(/60\.0% → 58\.0%/)).toBeInTheDocument();
  });

  it("renders an accessible growth chart with both series named", async () => {
    const user = userEvent.setup();
    fetchPortfolioSimulation.mockResolvedValue(response());
    render(<PortfolioBuilder />);
    await user.click(screen.getByRole("button", { name: /run the replay/i }));

    const chart = await screen.findByRole("img", { name: /growth of 1 dollar/i });
    expect(chart).toBeInTheDocument();
    expect(screen.getByText(/deposits are stripped out/i)).toBeInTheDocument();
  });

  it("surfaces API errors as a visible message", async () => {
    const user = userEvent.setup();
    fetchPortfolioSimulation.mockRejectedValue(new Error("boom"));
    render(<PortfolioBuilder />);
    await user.click(screen.getByRole("button", { name: /run the replay/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/something went wrong/i);
  });

  it("never contains recommendation language", async () => {
    const user = userEvent.setup();
    fetchPortfolioSimulation.mockResolvedValue(response());
    const { container } = render(<PortfolioBuilder />);
    await user.click(screen.getByRole("button", { name: /run the replay/i }));
    await screen.findByRole("table");

    const text = container.textContent?.toLowerCase() ?? "";
    const forbidden = [
      "you should buy",
      "we recommend",
      "guaranteed",
      "will rise",
      "safe investment",
    ];
    for (const phrase of forbidden) {
      expect(text).not.toContain(phrase);
    }
  });

  it("caps the number of holdings at eight", async () => {
    const user = userEvent.setup();
    render(<PortfolioBuilder />);
    const addButton = screen.getByRole("button", { name: /add holding/i });
    for (let i = 0; i < 8; i += 1) {
      if (!(addButton as HTMLButtonElement).disabled) await user.click(addButton);
    }
    expect(addButton).toBeDisabled();
    expect(screen.getAllByLabelText(/^ticker/i)).toHaveLength(8);
  });
});
