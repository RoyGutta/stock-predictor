import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SimulationPanel } from "./SimulationPanel";
import type { SimulationResponse } from "../../types/market";

function simulation(overrides: Partial<SimulationResponse> = {}): SimulationResponse {
  return {
    ticker: "AAPL",
    company_name: "Apple Inc.",
    range: "1Y",
    start_price: 200,
    horizon_days: 252,
    simulations: 5000,
    percentiles: { p5: 120, p25: 170, p50: 205, p75: 250, p95: 330 },
    probability_of_loss: 0.46,
    observations: 250,
    method: "historical bootstrap (resampled log returns, with replacement)",
    disclaimer:
      "Not a forecast. Shows how wide the range of outcomes would be if future returns " +
      "resembled this asset's own past returns.",
    ...overrides,
  };
}

const idle = { data: null, loading: false, error: null };

describe("SimulationPanel", () => {
  it("stays opt-in until asked, since the request is expensive", () => {
    render(
      <SimulationPanel
        {...idle}
        ticker="AAPL"
        currency="USD"
        started={false}
        onRun={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /run the simulation/i })).toBeInTheDocument();
  });

  it("runs when the button is pressed", async () => {
    const onRun = vi.fn();
    render(
      <SimulationPanel {...idle} ticker="AAPL" currency="USD" started={false} onRun={onRun} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /run the simulation/i }));
    expect(onRun).toHaveBeenCalledOnce();
  });

  /**
   * The core safety property. A dispersion simulation is the easiest thing in
   * this project to misread as a forecast, so the rendered output is asserted
   * to never claim direction — not just the API payload.
   */
  it("never renders forecast or advice language", () => {
    const { container } = render(
      <SimulationPanel
        data={simulation()}
        loading={false}
        error={null}
        ticker="AAPL"
        currency="USD"
        started
        onRun={() => {}}
      />,
    );
    const text = container.textContent?.toLowerCase() ?? "";
    for (const phrase of [
      "will reach",
      "will rise",
      "will fall",
      "price target",
      "we predict",
      "expected price",
      "guaranteed",
      "should buy",
    ]) {
      expect(text).not.toContain(phrase);
    }
  });

  it("always renders the disclaimer that it is not a forecast", () => {
    render(
      <SimulationPanel
        data={simulation()}
        loading={false}
        error={null}
        ticker="AAPL"
        currency="USD"
        started
        onRun={() => {}}
      />,
    );
    /* Said twice on purpose — once in the header eyebrow and once in the
       payload disclaimer — so the caveat survives a reader skimming either. */
    expect(screen.getAllByText(/not a forecast/i).length).toBeGreaterThanOrEqual(2);
  });

  it("leads with the width of the range rather than the median", () => {
    /* Reading the median as "where the price is going" is the failure mode
       this panel designs against, so it must not be the headline. */
    render(
      <SimulationPanel
        data={simulation()}
        loading={false}
        error={null}
        ticker="AAPL"
        currency="USD"
        started
        onRun={() => {}}
      />,
    );
    expect(screen.getByText(/the middle 90% finished between/i)).toBeInTheDocument();
  });

  it("says the loss share is not a real-world probability", () => {
    render(
      <SimulationPanel
        data={simulation()}
        loading={false}
        error={null}
        ticker="AAPL"
        currency="USD"
        started
        onRun={() => {}}
      />,
    );
    expect(screen.getByText(/not a real-world probability/i)).toBeInTheDocument();
  });

  it("describes the chart for screen readers", () => {
    render(
      <SimulationPanel
        data={simulation()}
        loading={false}
        error={null}
        ticker="AAPL"
        currency="USD"
        started
        onRun={() => {}}
      />,
    );
    expect(screen.getByRole("img")).toHaveAccessibleName(/simulated outcome range/i);
  });

  it("keeps the start marker on canvas when every path finished higher", () => {
    /* Regression guard: the domain must include today's price, or the
       reference line is drawn off the edge of the plot. */
    const { container } = render(
      <SimulationPanel
        data={simulation({
          start_price: 10,
          percentiles: { p5: 100, p25: 150, p50: 200, p75: 250, p95: 300 },
        })}
        loading={false}
        error={null}
        ticker="AAPL"
        currency="USD"
        started
        onRun={() => {}}
      />,
    );
    const start = container.querySelector(".sim-dispersion__start");
    const x = Number(start?.getAttribute("x"));
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThanOrEqual(100);
  });

  it("names inherited drift when the median sits away from today's price", () => {
    /* Resampling carries the sample window's drift forward, so after a strong
       year the median lands well above today. A reader takes that as a
       prediction unless it is named — the likeliest misreading of this panel. */
    render(
      <SimulationPanel
        data={simulation({ start_price: 200, percentiles: { p5: 120, p25: 170, p50: 264, p75: 320, p95: 400 } })}
        loading={false}
        error={null}
        ticker="AAPL"
        currency="USD"
        started
        onRun={() => {}}
      />,
    );
    expect(screen.getByText(/drift gets carried forward/i)).toBeInTheDocument();
    expect(screen.getByText(/not a view about the next/i)).toBeInTheDocument();
  });

  it("omits the drift caveat when the median sits close to today's price", () => {
    render(
      <SimulationPanel
        data={simulation({ start_price: 200, percentiles: { p5: 120, p25: 170, p50: 201, p75: 250, p95: 330 } })}
        loading={false}
        error={null}
        ticker="AAPL"
        currency="USD"
        started
        onRun={() => {}}
      />,
    );
    expect(screen.queryByText(/drift gets carried forward/i)).not.toBeInTheDocument();
  });

  it("keeps axis labels inside the panel at the extremes", () => {
    const { container } = render(
      <SimulationPanel
        data={simulation()}
        loading={false}
        error={null}
        ticker="AAPL"
        currency="USD"
        started
        onRun={() => {}}
      />,
    );
    for (const tick of container.querySelectorAll<HTMLElement>(".sim-dispersion__tick")) {
      const left = Number.parseFloat(tick.style.left);
      expect(left).toBeGreaterThanOrEqual(8);
      expect(left).toBeLessThanOrEqual(92);
    }
  });

  it("shows an error without taking the panel down", () => {
    render(
      <SimulationPanel
        data={null}
        loading={false}
        error="Not enough history to resample."
        ticker="AAPL"
        currency="USD"
        started
        onRun={() => {}}
      />,
    );
    expect(screen.getByText(/not enough history/i)).toBeInTheDocument();
  });
});
