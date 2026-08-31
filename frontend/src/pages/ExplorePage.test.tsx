import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import * as matchers from "vitest-axe/matchers";

import { ExplorePage } from "./ExplorePage";
import type { ExploreMatch, ExploreResponse } from "../types/market";

expect.extend(matchers);

const fetchExploreMatch = vi.hoisted(() => vi.fn());

vi.mock("../lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/api")>();
  return { ...original, fetchExploreMatch };
});

function match(overrides: Partial<ExploreMatch> = {}): ExploreMatch {
  return {
    ticker: "BND",
    name: "Vanguard Total Bond Market ETF",
    asset_class: "Bonds",
    breadth: "broad",
    category: "US bonds",
    tracks: "The broad US investment-grade bond market.",
    annualized_return: 0.031,
    annualized_volatility: 0.055,
    max_drawdown: -0.04,
    momentum_state: "mixed",
    correlation_to_benchmark: 0.21,
    bars: 251,
    score: 3,
    total: 3,
    criteria: [
      {
        name: "Volatility preference",
        met: true,
        detail: "Annualized volatility 5.5% -- lowest third of this list.",
      },
      {
        name: "Drawdown depth",
        met: true,
        detail: "Largest historical fall -4.0% -- lowest third of this list by depth.",
      },
      {
        name: "Diversification",
        met: true,
        detail: "This is a broad fund. You asked for broadly diversified funds.",
      },
    ],
    ...overrides,
  };
}

function response(): ExploreResponse {
  return {
    matches: [
      match(),
      match({
        ticker: "XLE",
        name: "Energy Select Sector SPDR",
        category: "Energy",
        breadth: "sector",
        score: 0,
        criteria: match().criteria.map((criterion) => ({ ...criterion, met: false })),
      }),
    ],
    unavailable: {},
    range: "5Y",
    frequency: "weekly",
    benchmark_ticker: "SPY",
    universe_note:
      "Searched a curated educational list of 20 large, liquid ETFs -- not the whole market.",
    available_interests: ["Energy", "Technology"],
    method: "Volatility checked against thirds of this universe's measured range.",
    disclaimer: "A preference match count, not a recommendation and not a prediction.",
  };
}

beforeEach(() => {
  fetchExploreMatch.mockReset();
  fetchExploreMatch.mockResolvedValue(response());
});

describe("ExplorePage", () => {
  it("loads with defaults on mount and shows every fund, losers included", async () => {
    render(<ExplorePage />);
    await waitFor(() => expect(fetchExploreMatch).toHaveBeenCalledTimes(1));
    expect((await screen.findAllByText("BND")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("XLE").length).toBeGreaterThan(0);
    expect(screen.getByText("0/3")).toBeInTheDocument();
  });

  it("shows the score as preferences matched, with every criterion visible", async () => {
    render(<ExplorePage />);
    const row = (await screen.findAllByText("BND"))[0].closest("li") as HTMLElement;
    expect(row).toHaveTextContent("3/3");
    expect(row).toHaveTextContent(/preferences matched/i);
    expect(row).toHaveTextContent("Volatility preference");
    expect(row).toHaveTextContent("Drawdown depth");
    expect(row).toHaveTextContent("Diversification");
  });

  it("exposes the measured detail for every criterion", async () => {
    const user = userEvent.setup();
    render(<ExplorePage />);
    const row = (await screen.findAllByText("BND"))[0].closest("li") as HTMLElement;
    await user.click(row.querySelector("summary") as HTMLElement);
    expect(row).toHaveTextContent(/annualized volatility 5\.5%/i);
    expect(row).toHaveTextContent(/lowest third/i);
  });

  it("re-fetches with the chosen preferences on submit", async () => {
    const user = userEvent.setup();
    render(<ExplorePage />);
    await screen.findAllByText("BND");

    await user.click(screen.getByRole("radio", { name: /calmer/i }));
    await user.click(screen.getByRole("radio", { name: /broadly diversified/i }));
    await user.click(screen.getByRole("checkbox", { name: "Energy" }));
    await user.click(screen.getByRole("button", { name: /match my preferences/i }));

    await waitFor(() => expect(fetchExploreMatch).toHaveBeenCalledTimes(2));
    const [preferences] = fetchExploreMatch.mock.calls[1];
    expect(preferences).toMatchObject({
      volatility: "lower",
      diversification: "broad",
      interests: ["Energy"],
    });
  });

  it("renders the universe disclosure and disclaimer verbatim", async () => {
    render(<ExplorePage />);
    expect(await screen.findByText(/curated educational list/i)).toBeInTheDocument();
    expect(
      screen.getByText(/not a recommendation and not a prediction/i),
    ).toBeInTheDocument();
  });

  it("labels the category strip with the actual window and bar frequency", async () => {
    render(<ExplorePage />);
    expect(
      await screen.findByRole("heading", {
        name: /historical 5Y performance by category/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/weekly bars/i).length).toBeGreaterThan(0);
  });

  it("surfaces fetch errors visibly", async () => {
    fetchExploreMatch.mockRejectedValue(new Error("boom"));
    render(<ExplorePage />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("contains no recommendation language", async () => {
    const { container } = render(<ExplorePage />);
    await screen.findAllByText("BND");
    const text = container.textContent?.toLowerCase() ?? "";
    for (const phrase of [
      "you should buy",
      "we recommend",
      "best fund",
      "best stock",
      "strong buy",
      "guaranteed",
      "will rise",
      "safe investment",
    ]) {
      expect(text).not.toContain(phrase);
    }
  });

  it("has no accessibility violations with results rendered", async () => {
    const { container } = render(<ExplorePage />);
    await screen.findAllByText("BND");
    expect(
      await axe(container, { rules: { "color-contrast": { enabled: false } } }),
    ).toHaveNoViolations();
  });
});
