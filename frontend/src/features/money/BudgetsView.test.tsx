import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import type { AxeMatchers } from "vitest-axe/matchers";
import * as matchers from "vitest-axe/matchers";

import { account, recurring, stateWith, tx } from "./budgetFixtures";
import { BudgetsView } from "./BudgetsView";
import type { MoneyState } from "./model";
import type { PlanningState } from "./planning";

expect.extend(matchers);

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Assertion extends AxeMatchers {}
}

/** Same reason as src/test/a11y.test.tsx: jsdom has no canvas for contrast. */
const AXE_OPTIONS = { rules: { "color-contrast": { enabled: false } } };

function sample(): MoneyState {
  const netflix = (date: string) =>
    tx("expense", 1_599, date, {
      description: "NETFLIX.COM",
      category: "Subscriptions",
    });
  const dining = (date: string, cents: number) =>
    tx("expense", cents, date, { category: "Dining" });
  return stateWith(
    [
      netflix("2025-12-15"),
      netflix("2026-01-15"),
      netflix("2026-02-15"),
      dining("2025-11-05", 10_000),
      dining("2025-12-05", 10_000),
      dining("2026-01-05", 10_000),
      dining("2026-02-05", 20_000),
      tx("expense", 20_000, "2026-03-02", { category: "Groceries" }),
      tx("income", 300_000, "2026-03-01", { category: "Salary" }),
    ],
    [account("chk", { name: "Everyday checking", opening_date: "2025-11-01" })],
    {
      budgets: [
        {
          id: "b1",
          category: "Groceries",
          limit_cents: 50_000,
          start_month: "2026-01",
        },
      ],
      recurring: [recurring({ id: "rent", next_date: "2026-03-15" })],
    },
  );
}

function Harness({
  initial,
  spy,
}: {
  initial: MoneyState;
  spy: (next: PlanningState) => void;
}) {
  const [state, setState] = useState(initial);
  return (
    <BudgetsView
      state={state}
      onPlanning={(fn) =>
        setState((s) => {
          const planning = fn(s.planning);
          spy(planning);
          return { ...s, planning };
        })
      }
    />
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 2, 10, 12));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("BudgetsView", () => {
  it("shows budget vs actual with both projections, upcoming items, candidates, and unusual changes", () => {
    render(<Harness initial={sample()} spy={vi.fn()} />);
    const table = screen.getByRole("table", { name: /budget and actual/i });
    const row = within(table).getByRole("row", { name: /Groceries/ });
    // $200 spent of $500 by Mar 10: pace = 200 / 10 x 31 = $620.
    expect(row).toHaveTextContent("$200.00");
    expect(row).toHaveTextContent("$300.00");
    expect(row).toHaveTextContent("40%");
    expect(row).toHaveTextContent("Under");
    expect(row).toHaveTextContent("$620.00");
    expect(
      screen.getByText(/through 2026-03-10 \(10 of 31 days\)/),
    ).toBeInTheDocument();
    expect(screen.getByText("2026-03-15")).toBeInTheDocument(); // rent due
    expect(screen.getByText("NETFLIX.COM")).toBeInTheDocument();
    expect(screen.getByText(/▲ Dining/)).toBeInTheDocument();
  });

  it("adds a budget through the form", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness initial={sample()} spy={spy} />);
    await user.click(screen.getByRole("button", { name: "Add budget" }));
    const form = screen.getByRole("form", { name: "Add a budget" });
    await user.selectOptions(within(form).getByLabelText("Category"), "Dining");
    await user.type(within(form).getByLabelText("Monthly limit"), "250");
    await user.click(within(form).getByRole("button", { name: "Save budget" }));
    expect(spy).toHaveBeenCalledTimes(1);
    const planning = spy.mock.calls[0][0] as PlanningState;
    expect(planning.budgets).toHaveLength(2);
    expect(planning.budgets[1]).toMatchObject({
      category: "Dining",
      limit_cents: 25_000,
      start_month: "2026-03",
    });
    expect(screen.getByRole("row", { name: /Dining/ })).toHaveTextContent(
      "$250.00",
    );
  });

  it("rejects an invalid limit without saving", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness initial={sample()} spy={spy} />);
    await user.click(screen.getByRole("button", { name: "Add budget" }));
    await user.type(screen.getByLabelText("Monthly limit"), "abc");
    await user.click(screen.getByRole("button", { name: "Save budget" }));
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/monthly limit/i);
  });

  it("creates a recurring item from a candidate only when the button is clicked", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness initial={sample()} spy={spy} />);
    expect(spy).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Track NETFLIX.COM as recurring" }),
    );
    expect(spy).toHaveBeenCalledTimes(1);
    const planning = spy.mock.calls[0][0] as PlanningState;
    expect(planning.recurring).toHaveLength(2);
    expect(planning.recurring[1]).toMatchObject({
      description: "NETFLIX.COM",
      amount_cents: 1_599,
      cadence: "monthly",
      next_date: "2026-03-15",
    });
    // Now tracked, so it is no longer offered.
    expect(
      screen.queryByRole("button", { name: "Track NETFLIX.COM as recurring" }),
    ).not.toBeInTheDocument();
  });

  it("toggles essential categories", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness initial={sample()} spy={spy} />);
    await user.click(screen.getByRole("checkbox", { name: "Dining" }));
    const planning = spy.mock.calls[0][0] as PlanningState;
    expect(planning.essential_categories).toContain("Dining");
  });

  it("has no detectable accessibility violations, including with forms open", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness initial={sample()} spy={vi.fn()} />);
    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
    await user.click(screen.getByRole("button", { name: "Add budget" }));
    await user.click(
      screen.getByRole("button", { name: "Add recurring item" }),
    );
    await user.selectOptions(screen.getByLabelText("Kind"), "transfer");
    expect(screen.getByLabelText("To account")).toBeInTheDocument();
    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });

  it("explains an empty state", async () => {
    const { container } = render(
      <Harness initial={stateWith([], [])} spy={vi.fn()} />,
    );
    expect(
      screen.getByText("No budgets apply to this month yet."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Not compared/)).toBeInTheDocument();
    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });
});
