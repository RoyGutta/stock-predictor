import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import * as matchers from "vitest-axe/matchers";

import {
  account,
  goal,
  makeState,
  recurring,
  tx,
} from "../../test/planningFixtures";
import { ForecastView } from "./ForecastView";

expect.extend(matchers);
const AXE_OPTIONS = { rules: { "color-contrast": { enabled: false } } };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 24, 12)); // 2026-10-24 local
});
afterEach(() => vi.useRealTimers());

const state = makeState(
  [
    account("checking", "checking", 100_000),
    account("savings", "savings", 50_000),
  ],
  [tx("expense", 20_000, "checking", "2026-10-20", { status: "pending" })],
  {
    recurring: [
      recurring("pay", {
        kind: "income",
        amount_cents: 80_000,
        cadence: "biweekly",
        next_date: "2026-10-30",
        certainty: "estimated",
        description: "Paycheck",
      }),
      recurring("rent", {
        amount_cents: 120_000,
        next_date: "2026-11-01",
        description: "Rent",
      }),
      recurring("power", {
        amount_cents: 200_000,
        next_date: "2026-11-15",
        certainty: "estimated",
        description: "Utilities",
        end_date: "2026-11-15",
      }),
    ],
    goals: [goal("trip", { monthly_contribution_cents: 10_000 })],
  },
);

describe("ForecastView", () => {
  it("says it is a projection from the user's entries, not a prediction", () => {
    render(<ForecastView state={state} />);
    expect(
      screen.getByText(
        /deterministic projection from your own entries, not a prediction/,
      ),
    ).toBeInTheDocument();
  });

  it("shows the shortfall date prominently with the lowest balance", async () => {
    const { container } = render(<ForecastView state={state} />);
    expect(
      screen.getByText(/Projected shortfall on 2026-11-15/),
    ).toBeInTheDocument();
    // 1,500 + 800 - 1,200 + 800 - 2,000 = -100 on Nov 15
    expect(screen.getAllByText("-$100.00").length).toBeGreaterThan(0);
    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });

  it("keeps confirmed balances and pending items apart from the projection", () => {
    render(<ForecastView state={state} />);
    expect(
      screen.getByText("Liquid funds today (confirmed)"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("$1,500.00").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/1 pending transaction is not in the confirmed balance/),
    ).toHaveTextContent("-$200.00");
  });

  it("gives the chart a text alternative", () => {
    render(<ForecastView state={state} />);
    const chart = screen.getByRole("img", {
      name: /Projected liquid funds, 2026-10-24 to 2027-01-22/,
    });
    expect(chart).toHaveAccessibleName(/lowest -\$500\.00 on 2026-12-01/);
    expect(chart).toHaveAccessibleName(/Falls below zero on 2026-11-15/);
  });

  it("lists upcoming events with fixed and estimated labels", () => {
    render(<ForecastView state={state} />);
    const table = screen.getByRole("table", { name: /Projected events/ });
    const rent = within(table).getAllByText("Rent")[0].closest("tr")!;
    expect(within(rent).getByText("Fixed")).toBeInTheDocument();
    const power = within(table).getByText("Utilities").closest("tr")!;
    expect(within(power).getByText("Estimated")).toBeInTheDocument();
  });

  it("changes horizon, applies a threshold, and opts in to goal contributions", () => {
    render(<ForecastView state={state} />);
    fireEvent.change(screen.getByLabelText("Horizon"), {
      target: { value: "30" },
    });
    expect(
      screen.getByRole("table", {
        name: "Projected events, 2026-10-24 to 2026-11-23",
      }),
    ).toBeInTheDocument();
    fireEvent.change(
      screen.getByLabelText("Threshold for liquid funds (optional)"),
      { target: { value: "1000" } },
    );
    expect(
      screen.getByText(/below your threshold of \$1,000\.00 on/),
    ).toHaveTextContent("2026-11-15");
    expect(screen.queryByText("Contribution to trip")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByLabelText("Include planned goal contributions"),
    );
    expect(screen.getByText("Contribution to trip")).toBeInTheDocument();
  });

  it("asks for an account first when there are none", async () => {
    const { container } = render(<ForecastView state={makeState([])} />);
    expect(screen.getByText(/Add an account first/)).toBeInTheDocument();
    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });
});
