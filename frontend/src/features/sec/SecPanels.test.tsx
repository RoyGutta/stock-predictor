import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FILINGS, FUNDAMENTALS } from "../../test/secFixtures";
import type { Capabilities } from "../../types/market";
import { FilingsPanel } from "./FilingsPanel";
import { FundamentalsPanel } from "./FundamentalsPanel";
import { SecSection } from "./SecSection";
import { formatChangePct, formatReported, yoyText } from "./secFormat";

const ready = <T,>(data: T) => ({
  data,
  loading: false,
  error: null,
  status: null,
});

describe("FilingsPanel", () => {
  it("lists reports with dates, amendment flag, items, and links to sec.gov", () => {
    render(
      <FilingsPanel
        state={ready(FILINGS)}
        query="AAPL"
        onChooseCompany={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/U.S. Securities and Exchange Commission/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Retrieved from SEC 2026-10-18 16:52 UTC/),
    ).toBeInTheDocument();
    expect(screen.getByText("Amendment")).toBeInTheDocument();
    expect(
      screen.getByText(/Filed 2025-10-31 · period ended 2025-09-27/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Filed 2026-09-01 · event 2026-04-17/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/5.02 Departure or appointment/),
    ).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: /Open on SEC.gov/ });
    expect(links).toHaveLength(2);
    links.forEach((link) => {
      expect(link.getAttribute("href")).toMatch(/^https:\/\/www\.sec\.gov\//);
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    });
    expect(
      screen.getByText(/Fiscal year ends September 26/),
    ).toBeInTheDocument();
  });

  it("states a stale copy plainly", () => {
    const stale = {
      ...FILINGS,
      stale: true,
      stale_reason: "SEC EDGAR's rate limit was reached.",
    };
    render(
      <FilingsPanel
        state={ready(stale)}
        query="AAPL"
        onChooseCompany={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/SEC could not be reached just now/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/newer filings may be missing/),
    ).toBeInTheDocument();
  });

  it("offers a company-name search when SEC lists no filer under the ticker", () => {
    render(
      <FilingsPanel
        state={{
          data: null,
          loading: false,
          error: "No SEC filer matching 'VOO'.",
          status: 404,
        }}
        query="VOO"
        onChooseCompany={vi.fn()}
      />,
    );
    expect(
      screen.getByLabelText(/Find the company that files for VOO by name/),
    ).toBeInTheDocument();
  });

  it("does not offer a name search for an outage", () => {
    render(
      <FilingsPanel
        state={{
          data: null,
          loading: false,
          error: "Could not reach SEC EDGAR.",
          status: 502,
        }}
        query="AAPL"
        onChooseCompany={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText(/Find the company/)).not.toBeInTheDocument();
  });

  it("explains an empty filing list", () => {
    render(
      <FilingsPanel
        state={ready({ ...FILINGS, filings: [] })}
        query="SPY"
        onChooseCompany={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/No annual, quarterly, or current reports/),
    ).toBeInTheDocument();
  });
});

describe("FundamentalsPanel", () => {
  const renderPanel = (onPeriodChange = vi.fn()) =>
    render(
      <FundamentalsPanel
        state={ready(FUNDAMENTALS)}
        period="annual"
        onPeriodChange={onPeriodChange}
      />,
    );

  it("shows reported values, year-over-year change, and provenance", () => {
    renderPanel();
    expect(screen.getAllByText("$416.16B").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("+6.4% vs a year earlier").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(/Latest filing used: 2025-10-31/),
    ).toBeInTheDocument();
    expect(screen.getByText(/not the present/)).toBeInTheDocument();
  });

  it("explains a missing measure instead of showing zero", () => {
    renderPanel();
    expect(
      screen.getByText(/left blank rather than estimated/),
    ).toBeInTheDocument();
    const table = screen.getAllByRole("table")[0];
    const row = within(table)
      .getByRole("button", { name: "Total liabilities" })
      .closest("tr");
    expect(row).not.toHaveTextContent("$0");
  });

  it("renders a period with no value as an em dash, and marks revisions and losses", () => {
    renderPanel();
    const table = screen.getAllByRole("table")[0];
    const netRow = within(table)
      .getByRole("button", { name: "Net income" })
      .closest("tr")!;
    expect(netRow).toHaveTextContent("—");
    expect(netRow).toHaveTextContent("−$1.50B");
    expect(netRow).toHaveTextContent("Revised");
  });

  it("separates computed measures and shows their components on selection", () => {
    renderPanel();
    expect(
      screen.getByText(/Computed here from the reported lines above/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Net margin" }));
    const detail = screen.getByRole("region", {
      name: /Net margin: history and sources/,
    });
    expect(detail).toHaveTextContent("net income −$1.50B · revenue $416.16B");
    expect(detail).toHaveTextContent("Includes taxes, interest");
  });

  it("detail lists each period's filing and tag", () => {
    renderPanel();
    const detail = screen.getByRole("region", {
      name: /Revenue: history and sources/,
    });
    const link = within(detail).getAllByRole("link", {
      name: /10-K filed 2025-10-31/,
    })[0];
    expect(link.getAttribute("href")).toMatch(/-index\.htm$/);
    expect(detail).toHaveTextContent(
      "RevenueFromContractWithCustomerExcludingAssessedTax",
    );
    expect(within(detail).getByRole("img")).toHaveAccessibleName(
      /Revenue by period/,
    );
  });

  it("switches between annual and quarterly", () => {
    const onPeriodChange = vi.fn();
    renderPanel(onPeriodChange);
    fireEvent.click(screen.getByRole("button", { name: "Quarterly" }));
    expect(onPeriodChange).toHaveBeenCalledWith("quarterly");
  });

  it("explains a filer with no XBRL statements", () => {
    render(
      <FundamentalsPanel
        state={ready({
          ...FUNDAMENTALS,
          coverage: "none",
          coverage_note: "SEC has no XBRL financial statements for this filer.",
          metrics: [],
          derived: [],
        })}
        period="annual"
        onPeriodChange={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/no XBRL financial statements/),
    ).toBeInTheDocument();
  });
});

describe("SecSection", () => {
  it("explains how to enable SEC data when the server has no declared agent", () => {
    const caps: Capabilities = {
      movers: false,
      sectors: false,
      news: false,
      search: false,
      fundamentals: false,
      screener: false,
      prices: true,
      intraday: true,
      price_source: "demo",
      adjustment: "synthetic",
      demo: true,
      demo_note: null,
      sec_filings: false,
      notes: { sec_filings: "SEC filings need SEC_USER_AGENT." },
    };
    render(<SecSection ticker="AAPL" capabilities={caps} />);
    expect(
      screen.getByText("SEC filings need SEC_USER_AGENT."),
    ).toBeInTheDocument();
  });
});

describe("secFormat", () => {
  it("formats reported units without inventing values", () => {
    expect(formatReported(416161000000, "USD")).toBe("$416.16B");
    expect(formatReported(-1500000000, "USD")).toBe("−$1.50B");
    expect(formatReported(6.11, "USD/shares")).toBe("$6.11");
    expect(formatReported(0.4512, "ratio")).toBe("45.1%");
    expect(formatReported(null, "USD")).toBe("—");
    expect(formatChangePct(null)).toBe("—");
    expect(formatChangePct(-0.04)).toBe("−4.0%");
  });

  it("states a change without a percent when the prior value was a loss", () => {
    const point = {
      ...FUNDAMENTALS.metrics[1].points[0],
      yoy: {
        prior_period_end: "2024-09-28",
        prior_value: -5,
        change: 25000000,
        change_pct: null,
        note: "x",
      },
    };
    expect(yoyText(point, "USD")).toBe("+$25.00M vs a year earlier");
  });
});
