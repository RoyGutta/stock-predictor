import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WatchlistPanel } from "./WatchlistPanel";
import type { WatchlistRow } from "./useWatchlistQuotes";
import type { Quote } from "../../types/market";

function quote(overrides: Partial<Quote> = {}): Quote {
  return {
    ticker: "MSFT",
    company_name: "Microsoft Corporation",
    price: 495.4,
    open: 490,
    high: 500,
    low: 488,
    volume: 20_000_000,
    change_points: 99.6,
    change_percent: 25.22,
    currency: "USD",
    range: "1M",
    history: [],
    as_of: "2026-08-17",
    source: "yfinance",
    ...overrides,
  };
}

function row(overrides: Partial<WatchlistRow> = {}): WatchlistRow {
  return { ticker: "MSFT", quote: quote(), error: null, ...overrides };
}

const handlers = {
  onSelect: () => {},
  onRemove: () => {},
  onClear: () => {},
  onRefresh: () => {},
};

describe("WatchlistPanel", () => {
  it("explains how to add something when empty", () => {
    render(
      <WatchlistPanel {...handlers} rows={[]} loading={false} updatedAt={null} tickers={[]} />,
    );
    expect(screen.getByText(/nothing here yet/i)).toBeInTheDocument();
  });

  it("names the window the change column covers", () => {
    /* A month's move shown unlabelled reads as today's, which for a large
       stock is both implausible and alarming. */
    render(
      <WatchlistPanel
        {...handlers}
        rows={[row()]}
        loading={false}
        updatedAt={new Date("2026-08-17T02:10:00Z")}
        tickers={["MSFT"]}
      />,
    );
    expect(screen.getByText(/1-month change/i)).toBeInTheDocument();
  });

  it("keeps a failed row visible and says why", () => {
    /* Dropping it would read as "we deleted your watchlist entry", which is
       worse than an inline error on a list curated by hand. */
    render(
      <WatchlistPanel
        {...handlers}
        rows={[row({ ticker: "ZZZZ", quote: null, error: "No market data found." })]}
        loading={false}
        updatedAt={null}
        tickers={["ZZZZ"]}
      />,
    );
    expect(screen.getByText("ZZZZ")).toBeInTheDocument();
    expect(screen.getByText(/no market data found/i)).toBeInTheDocument();
  });

  it("colours an exact zero change as neither gain nor loss", () => {
    const { container } = render(
      <WatchlistPanel
        {...handlers}
        rows={[row({ quote: quote({ change_percent: 0 }) })]}
        loading={false}
        updatedAt={null}
        tickers={["MSFT"]}
      />,
    );
    expect(container.querySelector(".wl-row__change--flat")).not.toBeNull();
    expect(container.querySelector(".wl-row__change--up")).toBeNull();
  });

  it("states that the list is stored only in this browser", () => {
    render(
      <WatchlistPanel
        {...handlers}
        rows={[row()]}
        loading={false}
        updatedAt={null}
        tickers={["MSFT"]}
      />,
    );
    expect(screen.getByText(/saved in this browser only/i)).toBeInTheDocument();
  });

  it("timestamps the prices and marks them as possibly delayed", () => {
    render(
      <WatchlistPanel
        {...handlers}
        rows={[row()]}
        loading={false}
        updatedAt={new Date("2026-08-17T02:10:00Z")}
        tickers={["MSFT"]}
      />,
    );
    expect(screen.getByText(/updated/i)).toBeInTheDocument();
    expect(screen.getByText(/may be\s+delayed/i)).toBeInTheDocument();
  });

  it("opens a ticker when its row is pressed", async () => {
    const onSelect = vi.fn();
    render(
      <WatchlistPanel
        {...handlers}
        onSelect={onSelect}
        rows={[row()]}
        loading={false}
        updatedAt={null}
        tickers={["MSFT"]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /open msft/i }));
    expect(onSelect).toHaveBeenCalledWith("MSFT");
  });

  it("removes a ticker from its own row", async () => {
    const onRemove = vi.fn();
    render(
      <WatchlistPanel
        {...handlers}
        onRemove={onRemove}
        rows={[row()]}
        loading={false}
        updatedAt={null}
        tickers={["MSFT"]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /remove msft/i }));
    expect(onRemove).toHaveBeenCalledWith("MSFT");
  });

  it("disables refresh while a pass is in flight", () => {
    render(
      <WatchlistPanel
        {...handlers}
        rows={[row()]}
        loading
        updatedAt={null}
        tickers={["MSFT"]}
      />,
    );
    expect(screen.getByRole("button", { name: /refreshing/i })).toBeDisabled();
  });
});
