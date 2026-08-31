import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ComparePanel } from "./ComparePanel";
import type { CompareResponse, CompareRow } from "../../types/market";

const fetchCompare = vi.hoisted(() => vi.fn());
const fetchCorrelation = vi.hoisted(() => vi.fn());

vi.mock("../../lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/api")>();
  return { ...original, fetchCompare, fetchCorrelation };
});

function row(overrides: Partial<CompareRow> = {}): CompareRow {
  return {
    ticker: "VOO",
    company_name: "Vanguard S&P 500 ETF",
    price: 512.3,
    change_percent: 11.2,
    annualized_return: 0.112,
    annualized_volatility: 0.14,
    sharpe_ratio: 0.8,
    sortino_ratio: 1.1,
    max_drawdown: -0.09,
    momentum_state: "bullish",
    momentum_score: 4,
    momentum_total: 4,
    bars: 251,
    ...overrides,
  };
}

function response(): CompareResponse {
  return {
    rows: [
      row(),
      row({ ticker: "QQQ", company_name: "Invesco QQQ", sharpe_ratio: 0.9 }),
      row({
        ticker: "TINY",
        company_name: "Tiny Corp",
        annualized_return: null,
        annualized_volatility: null,
        sharpe_ratio: null,
        sortino_ratio: null,
        max_drawdown: null,
        momentum_state: "insufficient",
        momentum_score: 0,
        momentum_total: 4,
        bars: 10,
      }),
    ],
    range: "1Y",
    frequency: "daily",
    unavailable: {},
    source: "yfinance",
    note:
      "Differences describe how these securities behaved historically -- " +
      "not which one to pick.",
    disclaimer:
      "Historical characteristics over one window. None of them predict future behavior.",
  };
}

beforeEach(() => {
  fetchCompare.mockReset();
  fetchCorrelation.mockReset();
  fetchCorrelation.mockResolvedValue(null);
});

async function runCompare() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /^compare$/i }));
}

describe("ComparePanel", () => {
  it("requires at least two tickers before it will run", async () => {
    const user = userEvent.setup();
    render(<ComparePanel />);
    const input = screen.getByLabelText(/tickers/i);
    await user.clear(input);
    await user.type(input, "VOO");

    expect(screen.getByRole("status")).toHaveTextContent(/at least two/i);
    expect(screen.getByRole("button", { name: /^compare$/i })).toBeDisabled();
  });

  it("renders securities as columns and measures as rows", async () => {
    fetchCompare.mockResolvedValue(response());
    render(<ComparePanel />);
    await runCompare();

    const table = await screen.findByRole("table");
    expect(table).toHaveTextContent("VOO");
    expect(table).toHaveTextContent("QQQ");
    expect(table).toHaveTextContent("Max drawdown");
    expect(table).toHaveTextContent("Volatility");
  });

  it("renders missing statistics as an em dash, never as zero", async () => {
    fetchCompare.mockResolvedValue(response());
    render(<ComparePanel />);
    await runCompare();

    const table = await screen.findByRole("table");
    const tinyColumnCells = table.querySelectorAll("tbody tr td:nth-child(4)");
    const texts = [...tinyColumnCells].map((cell) => cell.textContent);
    // Sharpe, Sortino, drawdown, return for TINY are null -> em dash.
    expect(texts).toContain("—");
    expect(texts).not.toContain("0.00");
  });

  it("shows insufficient momentum as a dash rather than 0/4", async () => {
    fetchCompare.mockResolvedValue(response());
    render(<ComparePanel />);
    await runCompare();

    const table = await screen.findByRole("table");
    expect(table).not.toHaveTextContent("0/4");
  });

  it("deduplicates and caps tickers at six", async () => {
    const user = userEvent.setup();
    fetchCompare.mockResolvedValue(response());
    render(<ComparePanel />);
    const input = screen.getByLabelText(/tickers/i);
    await user.clear(input);
    await user.type(input, "A,B,C,D,E,F,G,H,A,B");
    await runCompare();

    await waitFor(() => expect(fetchCompare).toHaveBeenCalled());
    const [tickers] = fetchCompare.mock.calls[0];
    expect(tickers).toHaveLength(6);
    expect(new Set(tickers).size).toBe(6);
  });

  it("shows the note and disclaimer verbatim from the payload", async () => {
    fetchCompare.mockResolvedValue(response());
    render(<ComparePanel />);
    await runCompare();

    expect(await screen.findByText(/not which one to pick/i)).toBeInTheDocument();
    expect(screen.getByText(/none of them predict future behavior/i)).toBeInTheDocument();
  });

  it("surfaces errors visibly", async () => {
    fetchCompare.mockRejectedValue(new Error("boom"));
    render(<ComparePanel />);
    await runCompare();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("reports unavailable tickers instead of dropping them silently", async () => {
    const body = response();
    body.unavailable = { GONE: "No market data found for 'GONE'." };
    fetchCompare.mockResolvedValue(body);
    render(<ComparePanel />);
    await runCompare();

    expect(await screen.findByText(/not shown/i)).toBeInTheDocument();
    expect(screen.getByText(/GONE/)).toBeInTheDocument();
  });
});
