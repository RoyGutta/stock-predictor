import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TREASURY } from "../../test/treasuryFixture";
import { TreasuryPanel } from "./TreasuryPanel";
import {
  formatBpChange,
  formatSpread,
  formatYield,
  shapeText,
} from "./treasuryFormat";

const DATA = TREASURY;

describe("TreasuryPanel", () => {
  it("names the source, the observation date, and the retrieval time separately", () => {
    render(<TreasuryPanel data={DATA} loading={false} error={null} />);
    expect(
      screen.getByText(
        /U.S. Department of the Treasury, Daily Treasury Par Yield Curve Rates/,
      ),
    ).toBeInTheDocument();
    const source = screen.getByText(/Latest published observation/);
    expect(source).toHaveTextContent("Latest published observation: Fri, Oct 23, 2026");
    expect(screen.getByText(/1 day before today/)).toBeInTheDocument();
    expect(
      screen.getByText(/Retrieved from Treasury 2026-10-24 23:28 UTC/),
    ).toBeInTheDocument();
    expect(screen.getByText(/not live transaction prices/)).toBeInTheDocument();
  });

  it("states the shape with its definition and without forecasting", () => {
    render(<TreasuryPanel data={DATA} loading={false} error={null} />);
    expect(screen.getByText(/Upward sloping/)).toBeInTheDocument();
    expect(
      screen.getByText(/this application.s convention/),
    ).toBeInTheDocument();
    expect(screen.getByText(/not a forecast/)).toBeInTheDocument();
  });

  it("shows spreads in points and basis points with the one-month change", () => {
    render(<TreasuryPanel data={DATA} loading={false} error={null} />);
    expect(screen.getAllByText("0.31 pts (31 bp)").length).toBeGreaterThan(0);
    expect(
      screen.getByText("+5 bp since Wed, Sep 23, 2026"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("−14 bp since Wed, Sep 23, 2026"),
    ).toBeInTheDocument();
  });

  it("gives the chart a text alternative and an exact-values table", () => {
    render(<TreasuryPanel data={DATA} loading={false} error={null} />);
    expect(
      screen.getByRole("img", {
        name: /Treasury par yield curve on Fri, Oct 23, 2026: 1 Mo/,
      }),
    ).toBeInTheDocument();
    const table = screen.getByRole("table", {
      name: /Treasury par yields by maturity/,
    });
    const ten = within(table)
      .getByRole("rowheader", { name: "10 Yr" })
      .closest("tr")!;
    expect(ten).toHaveTextContent("5.00%");
    expect(ten).toHaveTextContent("−11 bp");
    expect(
      screen.getByRole("img", { name: /Spreads from/ }),
    ).toBeInTheDocument();
  });

  it("shows a missing maturity as not published, never as zero", () => {
    const curve = DATA.latest.curve.map((p) =>
      p.key === "BC_20YEAR"
        ? { ...p, value: null, change_pp: null, change_bp: null }
        : p,
    );
    render(
      <TreasuryPanel
        data={{ ...DATA, latest: { ...DATA.latest, curve } }}
        loading={false}
        error={null}
      />,
    );
    const row = screen.getByRole("rowheader", { name: "20 Yr" }).closest("tr")!;
    expect(row).toHaveTextContent("Not published");
    expect(row).not.toHaveTextContent("0.00%");
  });

  it("flags stale data and keeps the original retrieval time", () => {
    render(
      <TreasuryPanel
        data={{
          ...DATA,
          stale: true,
          stale_reason: "Could not reach U.S. Treasury.",
        }}
        loading={false}
        error={null}
      />,
    );
    expect(
      screen.getByText(/Treasury could not be reached just now/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/a newer observation may exist/),
    ).toBeInTheDocument();
  });

  it("says so plainly when the upstream fails, with no curve in its place", () => {
    render(
      <TreasuryPanel
        data={null}
        loading={false}
        error="U.S. Treasury did not respond."
      />,
    );
    expect(screen.getByText(/could not be loaded/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("reports a missing comparison instead of inventing one", () => {
    const latest = {
      ...DATA.latest,
      comparison_date: null,
      spreads: DATA.latest.spreads.map((s) => ({
        ...s,
        change_bp: null,
        change_pp: null,
      })),
    };
    render(
      <TreasuryPanel data={{ ...DATA, latest }} loading={false} error={null} />,
    );
    expect(screen.getAllByText("No comparison available")).toHaveLength(2);
    expect(
      screen.queryByRole("columnheader", { name: "Change" }),
    ).not.toBeInTheDocument();
  });
});

describe("treasury formatting", () => {
  it("keeps units explicit and missing values blank", () => {
    expect(formatYield(4.2)).toBe("4.20%");
    expect(formatYield(null)).toBe("—");
    expect(formatSpread(-0.14, -14)).toBe("−0.14 pts (−14 bp)");
    expect(formatSpread(null, null)).toBe("—");
    expect(formatBpChange(0)).toBe("0 bp");
    expect(shapeText("inverted", 0.5)).toMatch(/below the 3-month/);
    expect(shapeText(null, 0.5)).toMatch(/cannot be stated/);
  });
});
