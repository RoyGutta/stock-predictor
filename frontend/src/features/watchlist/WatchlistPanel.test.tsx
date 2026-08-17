import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WatchlistPanel } from "./WatchlistPanel";
import type { WatchlistRow } from "./useWatchlistQuotes";
import type { MomentumRanking, Quote } from "../../types/market";

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

function ranking(
  ticker: string,
  state: MomentumRanking["state"],
  score: number,
): MomentumRanking {
  return {
    ticker,
    company_name: `${ticker} Inc.`,
    state,
    score,
    total: 4,
    price: 100,
    change_percent: 1.5,
    headline: `${score} of 4 conditions hold.`,
  };
}

const handlers = {
  momentum: new Map<string, MomentumRanking>(),
  sortByMomentum: false,
  onToggleSort: () => {},
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

  it("shows a momentum badge per row when the ranking has loaded", () => {
    render(
      <WatchlistPanel
        {...handlers}
        momentum={new Map([["MSFT", ranking("MSFT", "bullish", 4)]])}
        rows={[row()]}
        loading={false}
        updatedAt={null}
        tickers={["MSFT"]}
      />,
    );
    expect(screen.getByText("4/4")).toBeInTheDocument();
  });

  it("orders by momentum strength when sorting is on", () => {
    const rows = [row({ ticker: "WEAK" }), row({ ticker: "STRONG" })];
    render(
      <WatchlistPanel
        {...handlers}
        sortByMomentum
        momentum={
          new Map([
            ["WEAK", ranking("WEAK", "bearish", 0)],
            ["STRONG", ranking("STRONG", "bullish", 4)],
          ])
        }
        rows={rows}
        loading={false}
        updatedAt={null}
        tickers={["WEAK", "STRONG"]}
      />,
    );
    const tickers = screen.getAllByRole("button", { name: /open /i }).map((b) => b.textContent);
    expect(tickers[0]).toContain("STRONG");
  });

  it("sorts a ticker with no reading last rather than as weak momentum", () => {
    /* "Not enough history" is a different answer from "momentum is against
       it", and ranking them together would misorder the list. */
    render(
      <WatchlistPanel
        {...handlers}
        sortByMomentum
        momentum={
          new Map([
            ["NEW", ranking("NEW", "insufficient", 0)],
            ["BEAR", ranking("BEAR", "bearish", 0)],
          ])
        }
        rows={[row({ ticker: "NEW" }), row({ ticker: "BEAR" })]}
        loading={false}
        updatedAt={null}
        tickers={["NEW", "BEAR"]}
      />,
    );
    const tickers = screen.getAllByRole("button", { name: /open /i }).map((b) => b.textContent);
    expect(tickers[tickers.length - 1]).toContain("NEW");
  });

  it("keeps the original order when sorting is off", () => {
    render(
      <WatchlistPanel
        {...handlers}
        momentum={
          new Map([
            ["WEAK", ranking("WEAK", "bearish", 0)],
            ["STRONG", ranking("STRONG", "bullish", 4)],
          ])
        }
        rows={[row({ ticker: "WEAK" }), row({ ticker: "STRONG" })]}
        loading={false}
        updatedAt={null}
        tickers={["WEAK", "STRONG"]}
      />,
    );
    const tickers = screen.getAllByRole("button", { name: /open /i }).map((b) => b.textContent);
    expect(tickers[0]).toContain("WEAK");
  });

  it("says the momentum column is not a list to buy from", () => {
    render(
      <WatchlistPanel
        {...handlers}
        rows={[row()]}
        loading={false}
        updatedAt={null}
        tickers={["MSFT"]}
      />,
    );
    expect(screen.getByText(/not a list to buy from/i)).toBeInTheDocument();
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
