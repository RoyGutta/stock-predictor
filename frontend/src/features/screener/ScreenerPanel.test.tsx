import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

import type { ScreenerResponse } from "../../types/screener";
import { SAVED_KEY, readSaved } from "./savedCriteria";
import { ScreenerPanel } from "./ScreenerPanel";
import { screenerParams } from "./screenerApi";

const AXE_OPTIONS = { rules: { "color-contrast": { enabled: false } } };

const FRAME_URL =
  "https://data.sec.gov/api/xbrl/frames/us-gaap/Revenues/USD/CY2025.json";

/** Hand-built, invented filers; not real companies. */
const FIXTURE: ScreenerResponse = {
  source: "U.S. Securities and Exchange Commission (EDGAR)",
  retrieved_at: "2026-10-24T12:00:00+00:00",
  stale: false,
  stale_reason: null,
  calendar_year: 2025,
  prior_calendar_year: 2024,
  frames: [
    {
      measure: "revenue",
      tag: "Revenues",
      period: "CY2025",
      url: FRAME_URL,
      available: true,
      companies: 2,
    },
  ],
  universe: 2,
  total_matches: 2,
  offset: 0,
  limit: 25,
  size_bands: [],
  notes: [],
  results: [
    {
      cik: 1,
      name: "Alpha Corp",
      edgar_url: "https://www.sec.gov/edgar/browse/?CIK=1",
      revenue_tag: "Revenues",
      period_end: "2025-12-31",
      revenue_accession: null,
      revenue: 1_000_000_000,
      revenue_prior: 800_000_000,
      revenue_growth_pct: 25,
      net_income: 100_000_000,
      net_margin_pct: 10,
      operating_cash_flow: 200_000_000,
      ocf_margin_pct: 20,
      capital_expenditures: 50_000_000,
      free_cash_flow: 150_000_000,
      total_assets: 2_000_000_000,
      total_liabilities: 1_000_000_000,
      liabilities_to_assets: 0.5,
      size_band: "1b_10b",
    },
    {
      cik: 4,
      name: "Delta Holdings",
      edgar_url: "https://www.sec.gov/edgar/browse/?CIK=4",
      revenue_tag: null,
      period_end: null,
      revenue_accession: null,
      revenue: null,
      revenue_prior: null,
      revenue_growth_pct: null,
      net_income: null,
      net_margin_pct: null,
      operating_cash_flow: 10_000_000,
      ocf_margin_pct: null,
      capital_expenditures: null,
      free_cash_flow: null,
      total_assets: 100_000_000,
      total_liabilities: 20_000_000,
      liabilities_to_assets: 0.2,
      size_band: null,
    },
  ],
};

const fetchMock = vi.fn();

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  fetchMock.mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify(FIXTURE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function lastUrl(): URL {
  const call = fetchMock.mock.calls.at(-1) as [string];
  return new URL(call[0], "http://localhost");
}

describe("ScreenerPanel", () => {
  it("shows the setup note and makes no request when disabled", async () => {
    const { container } = render(
      <ScreenerPanel
        enabled={false}
        note="Set SEC_USER_AGENT to enable this."
      />,
    );
    expect(
      screen.getByText("Set SEC_USER_AGENT to enable this."),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await axe(container, AXE_OPTIONS)).violations).toEqual([]);
  });

  it("renders rows, provenance, methodology, and EDGAR links", async () => {
    const { container } = render(<ScreenerPanel enabled />);
    const table = await screen.findByRole("table");
    expect(within(table).getByText("$1.00B")).toBeInTheDocument();
    expect(within(table).getByText("25.0%")).toBeInTheDocument();
    expect(within(table).getByText("$150.00M")).toBeInTheDocument();
    // Delta reported no revenue: dashes, never zeros.
    const delta = within(table).getByText("Delta Holdings").closest("tr");
    expect(delta).not.toBeNull();
    expect(
      within(delta as HTMLElement).getAllByText("—").length,
    ).toBeGreaterThan(4);
    const link = within(table).getByRole("link", {
      name: "Alpha Corp (EDGAR, opens in a new tab)",
    });
    expect(link).toHaveAttribute(
      "href",
      "https://www.sec.gov/edgar/browse/?CIK=1",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText(/calendar year 2025/)).toBeInTheDocument();
    expect(
      screen.getByText(/Retrieved from SEC 2026-10-24 12:00 UTC/),
    ).toBeInTheDocument();
    expect(screen.getByText(/not a recommendation/)).toBeInTheDocument();
    expect(screen.getByText(/no licensed price data/)).toBeInTheDocument();
    expect(screen.getByText(/calendar-align fiscal years/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "Revenues CY2025 (opens in a new tab)",
      }),
    ).toHaveAttribute("href", FRAME_URL);
    expect(screen.queryByText(/\b(buy|sell|best)\b/i)).toBeNull();
    expect((await axe(container, AXE_OPTIONS)).violations).toEqual([]);
  });

  it("toggles aria-sort and requests the new order", async () => {
    render(<ScreenerPanel enabled />);
    await screen.findByRole("table");
    const header = (name: RegExp) =>
      screen.getByRole("button", { name }).closest("th") as HTMLElement;

    expect(header(/^Revenue$/)).toHaveAttribute("aria-sort", "descending");
    expect(header(/Net margin/)).toHaveAttribute("aria-sort", "none");

    fireEvent.click(screen.getByRole("button", { name: /Net margin/ }));
    await waitFor(() =>
      expect(lastUrl().searchParams.get("sort")).toBe("net_margin_pct"),
    );
    expect(lastUrl().searchParams.get("order")).toBe("desc");
    expect(header(/Net margin/)).toHaveAttribute("aria-sort", "descending");
    expect(header(/^Revenue$/)).toHaveAttribute("aria-sort", "none");

    fireEvent.click(screen.getByRole("button", { name: /Net margin/ }));
    await waitFor(() =>
      expect(lastUrl().searchParams.get("order")).toBe("asc"),
    );
    expect(header(/Net margin/)).toHaveAttribute("aria-sort", "ascending");
  });

  it("saves named criteria to storage and applies them again", async () => {
    const { unmount } = render(<ScreenerPanel enabled />);
    await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText("Minimum revenue ($ millions)"), {
      target: { value: "500" },
    });
    fireEvent.click(screen.getByLabelText("Positive free cash flow only"));
    fireEvent.change(screen.getByLabelText("Save these criteria as"), {
      target: { value: "Large, cash generative" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save criteria" }));

    const stored = readSaved();
    expect(stored).toHaveLength(1);
    expect(stored[0].criteria.minRevenue).toBe(500_000_000);
    expect(stored[0].criteria.positiveFcf).toBe(true);
    expect(stored[0].criteria.minGrowth).toBeNull();
    expect(localStorage.getItem(SAVED_KEY)).toContain("Large, cash generative");
    unmount();

    render(<ScreenerPanel enabled />);
    await screen.findByRole("table");
    fireEvent.click(
      screen.getByRole("button", { name: /Apply Large, cash generative/ }),
    );
    await waitFor(() =>
      expect(lastUrl().searchParams.get("min_revenue")).toBe("500000000"),
    );
    expect(lastUrl().searchParams.get("positive_fcf")).toBe("true");
    expect(screen.getByLabelText("Minimum revenue ($ millions)")).toHaveValue(
      500,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Delete Large, cash generative/ }),
    );
    expect(readSaved()).toEqual([]);
  });

  it("drops malformed saved entries instead of failing", () => {
    localStorage.setItem(
      SAVED_KEY,
      JSON.stringify([
        {
          name: "ok",
          criteria: { minRevenue: 5, sizeBand: "huge", positiveFcf: "yes" },
        },
        { name: "", criteria: {} },
        "junk",
      ]),
    );
    const saved = readSaved();
    expect(saved).toHaveLength(1);
    expect(saved[0].criteria).toMatchObject({
      minRevenue: 5,
      sizeBand: null,
      positiveFcf: false,
    });
  });

  it("rejects contradictory growth bounds without a request", async () => {
    render(<ScreenerPanel enabled />);
    await screen.findByRole("table");
    const calls = fetchMock.mock.calls.length;
    fireEvent.change(screen.getByLabelText("Minimum revenue growth (%)"), {
      target: { value: "20" },
    });
    fireEvent.change(screen.getByLabelText("Maximum revenue growth (%)"), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run screen" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/above maximum growth/);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("shows the server's message when SEC is not configured", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ detail: "SEC_USER_AGENT is not set." }), {
          status: 503,
        }),
      ),
    );
    render(<ScreenerPanel enabled />);
    expect(
      await screen.findByText("SEC_USER_AGENT is not set."),
    ).toBeInTheDocument();
  });
});

describe("screenerParams", () => {
  it("omits unset criteria rather than sending zeros", () => {
    const params = screenerParams({
      minRevenue: null,
      minGrowth: 0,
      maxGrowth: null,
      minNetMargin: null,
      maxLiabilitiesToAssets: null,
      positiveFcf: false,
      name: "  ",
      sizeBand: null,
      sort: "revenue",
      order: "desc",
      limit: 25,
      offset: 0,
    });
    expect(params.get("min_growth")).toBe("0");
    expect(params.has("min_revenue")).toBe(false);
    expect(params.has("positive_fcf")).toBe(false);
    expect(params.has("name")).toBe(false);
  });
});
