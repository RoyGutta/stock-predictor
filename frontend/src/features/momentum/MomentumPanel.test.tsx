import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MomentumPanel } from "./MomentumPanel";
import type { Momentum, MomentumStateName } from "../../types/market";

const CAVEAT =
  "This describes how the averages are stacked right now, not what happens next. " +
  "Moving averages are built from past prices, so this state turns only after a move " +
  "is underway. Run the backtest to see whether trading this rule would actually have " +
  "beaten simply holding this stock.";

function condition(met: boolean, label: string) {
  return { label, met, detail: "Last close 305.93 vs average 300.10." };
}

function momentum(state: MomentumStateName, score: number): Momentum {
  return {
    state,
    score,
    total: 4,
    headline: `${score} of 4 conditions hold.`,
    conditions: [
      condition(score > 0, "Price above the 20-day average"),
      condition(score > 1, "20-day above the 50-day"),
      condition(score > 2, "50-day above the 100-day"),
      condition(score > 3, "20-day average still rising"),
    ],
    caveat: CAVEAT,
    price: 305.93,
    fast: 300.1,
    medium: 290.4,
    slow: 275.2,
  };
}

describe("MomentumPanel", () => {
  it("states plainly when momentum is favourable", () => {
    render(<MomentumPanel momentum={momentum("bullish", 4)} ticker="AAPL" />);
    expect(screen.getByText(/momentum is favourable/i)).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("states plainly when momentum is against it", () => {
    render(<MomentumPanel momentum={momentum("bearish", 0)} ticker="AAPL" />);
    expect(screen.getByText(/momentum is against it/i)).toBeInTheDocument();
  });

  it("reports a partial stack as mixed rather than picking a side", () => {
    render(<MomentumPanel momentum={momentum("mixed", 2)} ticker="AAPL" />);
    expect(screen.getByText(/momentum is mixed/i)).toBeInTheDocument();
  });

  /**
   * The line this panel does not cross. It answers "is momentum behind this
   * right now" — a description of the present — and never "buy it", which is a
   * claim about the future that moving averages cannot support.
   */
  it("never tells the reader to buy or sell", () => {
    for (const state of ["bullish", "bearish", "mixed"] as const) {
      const { container, unmount } = render(
        <MomentumPanel momentum={momentum(state, state === "bullish" ? 4 : 0)} ticker="AAPL" />,
      );
      const text = container.textContent?.toLowerCase() ?? "";
      for (const phrase of [
        "you should buy",
        "time to buy",
        "safe to buy",
        "we recommend",
        "strong buy",
        "good entry",
        "guaranteed",
        "will rise",
      ]) {
        expect(text, `state=${state}`).not.toContain(phrase);
      }
      unmount();
    }
  });

  it("keeps the caveat visible on the strongest reading", () => {
    /* The bullish state is where a caveat matters most and is most likely to
       be dropped for looking discouraging. */
    render(<MomentumPanel momentum={momentum("bullish", 4)} ticker="AAPL" />);
    expect(screen.getByText(/not what happens next/i)).toBeInTheDocument();
    expect(screen.getByText(/run the backtest/i)).toBeInTheDocument();
  });

  it("shows every condition with the numbers behind it", () => {
    render(<MomentumPanel momentum={momentum("mixed", 2)} ticker="AAPL" />);
    expect(screen.getByText(/price above the 20-day average/i)).toBeInTheDocument();
    expect(screen.getByText(/50-day above the 100-day/i)).toBeInTheDocument();
    expect(screen.getAllByText(/last close 305.93 vs average/i)).toHaveLength(4);
  });

  it("does not convey met and unmet by colour alone", () => {
    /* The tick glyph is aria-hidden, so each condition carries its state in
       text for anyone not seeing the colour. */
    render(<MomentumPanel momentum={momentum("mixed", 2)} ticker="AAPL" />);
    expect(screen.getAllByText(/condition met/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/condition not met/i).length).toBeGreaterThan(0);
  });

  it("shows the three averages the reading is built on", () => {
    render(<MomentumPanel momentum={momentum("bullish", 4)} ticker="AAPL" />);
    for (const label of ["20-day", "50-day", "100-day"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("says history is too short rather than showing a zero score", () => {
    /* "Not enough data" is a different answer from "momentum is weak", and
       rendering 0/4 would state the wrong one. */
    render(
      <MomentumPanel
        momentum={{
          ...momentum("insufficient", 0),
          conditions: [],
          headline: "Not enough price history to read momentum.",
        }}
        ticker="AAPL"
      />,
    );
    expect(screen.getByText(/not enough history/i)).toBeInTheDocument();
    expect(screen.queryByText("conditions met")).not.toBeInTheDocument();
  });
});
