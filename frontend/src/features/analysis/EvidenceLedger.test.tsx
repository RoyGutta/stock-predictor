import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EvidenceLedger } from "./EvidenceLedger";
import type { Observation, TrendInterpretation } from "../../types/market";

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    indicator: "RSI",
    stance: "bearish",
    value: 74,
    headline: "RSI is 74, in the conventional 'overbought' zone.",
    detail: "RSI compares the size of up-moves to down-moves on a 0-100 scale.",
    caveat: "'Overbought' does not mean 'about to fall'.",
    ...overrides,
  };
}

function interpretation(overrides: Partial<TrendInterpretation> = {}): TrendInterpretation {
  return {
    summary: "2 of 3 directional indicators lean bearish, with 1 neutral.",
    agreement_score: 0.333,
    agreement_label: "weak agreement",
    conflicts: [],
    bullish: [],
    bearish: [],
    neutral: [],
    disclaimer: "These are descriptions of past price movement, not predictions.",
    ...overrides,
  };
}

describe("EvidenceLedger", () => {
  it("renders the summary", () => {
    render(<EvidenceLedger interpretation={interpretation()} />);
    expect(screen.getByText(/directional indicators lean bearish/)).toBeInTheDocument();
  });

  it("shows both sides of the evidence at once", () => {
    render(
      <EvidenceLedger
        interpretation={interpretation({
          bullish: [observation({ indicator: "MACD", stance: "bullish", headline: "MACD is up." })],
          bearish: [observation()],
        })}
      />,
    );
    expect(screen.getByText("MACD is up.")).toBeInTheDocument();
    expect(screen.getByText(/overbought/)).toBeInTheDocument();
  });

  it("always renders each observation's caveat", () => {
    render(<EvidenceLedger interpretation={interpretation({ bearish: [observation()] })} />);
    // The caveat must not be hidden behind a disclosure — it is part of reading
    // the indicator, not fine print.
    expect(screen.getByText(/does not mean 'about to fall'/)).toBeInTheDocument();
  });

  it("surfaces conflicts rather than hiding them", () => {
    render(
      <EvidenceLedger
        interpretation={interpretation({
          conflicts: ["Momentum is turning up while the longer-term trend is still down."],
          bullish: [observation({ indicator: "MACD", stance: "bullish" })],
          bearish: [observation()],
        })}
      />,
    );
    expect(screen.getByText(/Where the evidence disagrees/i)).toBeInTheDocument();
    expect(screen.getByText(/Momentum is turning up/)).toBeInTheDocument();
  });

  it("omits the conflict section when evidence is one-sided", () => {
    render(<EvidenceLedger interpretation={interpretation({ bullish: [observation()] })} />);
    expect(screen.queryByText(/Where the evidence disagrees/i)).not.toBeInTheDocument();
  });

  it("labels the agreement meter as agreement, never as probability", () => {
    render(<EvidenceLedger interpretation={interpretation()} />);
    const meter = screen.getByRole("meter");
    expect(meter).toHaveAccessibleName(/agree with each other/i);
    expect(meter).toHaveAttribute("aria-valuenow", "33");
  });

  it("always renders the disclaimer", () => {
    render(<EvidenceLedger interpretation={interpretation()} />);
    expect(screen.getByText(/not predictions/)).toBeInTheDocument();
  });

  it("never renders a buy or sell verdict", () => {
    const { container } = render(
      <EvidenceLedger
        interpretation={interpretation({
          bullish: [observation({ stance: "bullish" })],
          bearish: [observation()],
          neutral: [observation({ indicator: "ATR", stance: "neutral" })],
        })}
      />,
    );
    const text = container.textContent?.toLowerCase() ?? "";
    for (const phrase of ["strong buy", "we recommend", "price target", "guaranteed"]) {
      expect(text).not.toContain(phrase);
    }
  });

  it("shows an empty message per column rather than collapsing it", () => {
    render(<EvidenceLedger interpretation={interpretation({ bearish: [observation()] })} />);
    expect(screen.getByText(/Nothing here points upward/)).toBeInTheDocument();
  });

  it("counts the observations in each column", () => {
    render(
      <EvidenceLedger
        interpretation={interpretation({
          bullish: [
            observation({ indicator: "MACD", stance: "bullish" }),
            observation({ indicator: "ADX", stance: "bullish" }),
          ],
        })}
      />,
    );
    const upColumn = screen.getByText("Points up").closest(".ledger__column");
    expect(upColumn).not.toBeNull();
    expect(within(upColumn as HTMLElement).getByText("2")).toBeInTheDocument();
  });

  it("renders neutral observations in their own section", () => {
    render(
      <EvidenceLedger
        interpretation={interpretation({
          neutral: [observation({ indicator: "ATR", stance: "neutral" })],
        })}
      />,
    );
    expect(screen.getByText(/No clear direction/i)).toBeInTheDocument();
  });
});
