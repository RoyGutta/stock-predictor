import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import App from "./App";
import type { Capabilities } from "./types/market";

/**
 * The demo disclosure must be impossible to miss and impossible to trigger by
 * accident: it renders only when the backend says prices are synthetic.
 */

const fetchCapabilities = vi.hoisted(() => vi.fn());
const fetchMarketStatus = vi.hoisted(() => vi.fn());

vi.mock("./lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./lib/api")>();
  return { ...original, fetchCapabilities, fetchMarketStatus };
});

function capabilities(overrides: Partial<Capabilities> = {}): Capabilities {
  return {
    movers: false,
    sectors: false,
    news: false,
    search: true,
    fundamentals: false,
    screener: false,
    notes: {},
    prices: true,
    intraday: true,
    price_source: "yfinance",
    adjustment: "split_and_dividend",
    demo: false,
    demo_note: null,
    ...overrides,
  };
}

describe("App demo disclosure", () => {
  it("shows the synthetic-data banner and footer wording when the backend is in demo mode", async () => {
    fetchMarketStatus.mockRejectedValue(new Error("not needed"));
    fetchCapabilities.mockResolvedValue(
      capabilities({ demo: true, demo_note: "Demo data: synthetic dataset." }),
    );
    render(<App />);
    const note = await screen.findByRole("note");
    expect(note).toHaveTextContent(/demo prices/i);
    expect(note).toHaveTextContent(/not live market data/i);
    // The synthetic disclosure covers prices only: SEC reports shown alongside
    // them are real, and the banner must not imply otherwise.
    expect(note).toHaveTextContent(/SEC filings and reported financials, where shown, are real/i);
    await waitFor(() =>
      expect(
        screen.getByText(/synthetic demonstration dataset rather than market data/i),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/companies' actual reports/i)).toBeInTheDocument();
  });

  it("renders no banner and the normal footer when prices are real", async () => {
    fetchMarketStatus.mockRejectedValue(new Error("not needed"));
    fetchCapabilities.mockResolvedValue(capabilities());
    render(<App />);
    await waitFor(() => expect(fetchCapabilities).toHaveBeenCalled());
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.getByText(/market data may be delayed or incomplete/i)).toBeInTheDocument();
  });
});
