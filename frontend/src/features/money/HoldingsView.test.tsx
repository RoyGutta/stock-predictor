import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import type { AxeMatchers } from "vitest-axe/matchers";
import * as matchers from "vitest-axe/matchers";

import { HoldingsView, PRICE_STATEMENT } from "./HoldingsView";
import { EMPTY_STATE, todayIso, type Account, type MoneyState } from "./model";
import type { Holding, PlanningState } from "./planning";

expect.extend(matchers);

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Assertion extends AxeMatchers {}
}

/** jsdom has no canvas, so contrast cannot be measured here (see a11y.test.tsx). */
const AXE_OPTIONS = { rules: { "color-contrast": { enabled: false } } };

const TODAY = todayIso();

function account(over: Partial<Account>): Account {
  return {
    id: "brk",
    name: "Brokerage",
    type: "brokerage",
    currency: "USD",
    institution: "",
    notes: "",
    opening_balance_cents: 500_000,
    opening_date: "2020-01-01",
    apr: null,
    minimum_payment_cents: null,
    planned_payment_cents: null,
    due_day: null,
    archived: false,
    ...over,
  };
}

function holding(over: Partial<Holding>): Holding {
  return {
    id: "h1",
    account_id: "brk",
    symbol: "AAA",
    name: "Alpha Fund",
    quantity: 30,
    cost_basis_cents: 250_000,
    acquired_date: null,
    price_cents: 10_000,
    price_date: TODAY,
    asset_class: "us_stock",
    sector: "Technology",
    ...over,
  };
}

const POPULATED: MoneyState = {
  ...EMPTY_STATE,
  accounts: [
    account({}),
    account({ id: "chk", name: "Checking", type: "checking" }),
    account({ id: "ira", name: "IRA", type: "retirement" }),
  ],
  planning: {
    ...EMPTY_STATE.planning,
    holdings: [
      holding({}),
      holding({
        id: "h2",
        symbol: "BND",
        name: "Bond Fund",
        asset_class: "bond",
        sector: "Bonds",
        quantity: 10,
        price_date: "2020-01-02",
      }),
      holding({ id: "h3", symbol: "ZZZ", price_cents: null, price_date: null }),
    ],
    profile: {
      ...EMPTY_STATE.planning.profile,
      excluded_sectors: ["Technology"],
    },
  },
};

function Harness({ initial }: { initial: MoneyState }) {
  const [state, setState] = useState(initial);
  const onPlanning = (fn: (p: PlanningState) => PlanningState) =>
    setState((s) => ({ ...s, planning: fn(s.planning) }));
  return (
    <>
      <HoldingsView state={state} onPlanning={onPlanning} />
      <output data-testid="count">{state.planning.holdings.length}</output>
    </>
  );
}

afterEach(() => vi.restoreAllMocks());

describe("HoldingsView", () => {
  it("has no axe violations when populated and when empty", async () => {
    const populated = render(<Harness initial={POPULATED} />);
    expect(await axe(populated.container, AXE_OPTIONS)).toHaveNoViolations();
    populated.unmount();
    const empty = render(<Harness initial={EMPTY_STATE} />);
    expect(await axe(empty.container, AXE_OPTIONS)).toHaveNoViolations();
  });

  it("states where prices come from and never calls the network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const user = userEvent.setup();
    render(<Harness initial={POPULATED} />);
    expect(screen.getByText(PRICE_STATEMENT)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add holding" }));
    await user.selectOptions(screen.getByLabelText("Reference mix"), "custom");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows value, gain, staleness and a missing price", () => {
    render(<Harness initial={POPULATED} />);
    const table = screen.getByRole("table", { name: "Your holdings" });
    const aaa = within(table).getByRole("row", { name: /AAA/ });
    expect(aaa).toHaveTextContent("$3,000.00");
    expect(aaa).toHaveTextContent("$500.00"); // gain
    const bnd = within(table).getByRole("row", { name: /BND/ });
    expect(bnd).toHaveTextContent(/out of date/);
    const zzz = within(table).getByRole("row", { name: /ZZZ/ });
    expect(zzz).toHaveTextContent("Needs a price");
  });

  it("reconciles against the account balance and reports concentration", () => {
    render(<Harness initial={POPULATED} />);
    // $5,000 balance vs $3,000 + $1,000 valued
    expect(
      screen.getByText(/Difference \$1,000\.00: unallocated/),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/concentration to review/).length,
    ).toBeGreaterThan(0);
    // AAA and the unpriced ZZZ are both in the excluded Technology sector.
    expect(screen.getAllByText(/a sector your profile lists/)).toHaveLength(2);
    expect(
      screen.getByText(/1 holding .*without a dated price/),
    ).toBeInTheDocument();
  });

  it("adds a holding only to investment accounts and saves it", async () => {
    const user = userEvent.setup();
    render(<Harness initial={POPULATED} />);
    await user.click(screen.getByRole("button", { name: "Add holding" }));
    const select = screen.getByLabelText("Account");
    const options = within(select)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual(["Brokerage", "IRA"]);
    await user.selectOptions(select, "ira");
    await user.type(screen.getByLabelText(/^Symbol/), "new");
    await user.type(screen.getByLabelText(/^Quantity/), "2.5");
    await user.type(screen.getByLabelText(/^Price per unit/), "40");
    await user.click(screen.getByRole("button", { name: "Save holding" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      /date the price applies/,
    );
    await user.type(screen.getByLabelText("Date of that price"), TODAY);
    await user.click(screen.getByRole("button", { name: "Save holding" }));
    expect(screen.getByTestId("count")).toHaveTextContent("4");
    const row = screen.getByRole("row", { name: /NEW/ });
    expect(row).toHaveTextContent("$100.00");
  });

  it("validates a custom reference mix", async () => {
    const user = userEvent.setup();
    render(<Harness initial={POPULATED} />);
    await user.selectOptions(screen.getByLabelText("Reference mix"), "custom");
    const bonds = screen.getByLabelText("Bonds (%)");
    await user.clear(bonds);
    await user.type(bonds, "30");
    expect(screen.getByText(/add up to 90%/)).toBeInTheDocument();
    await user.clear(bonds);
    await user.type(bonds, "40");
    expect(
      screen.getByRole("table", { name: /against the reference/ }),
    ).toBeInTheDocument();
  });

  it("saves the optional profile", async () => {
    const user = userEvent.setup();
    render(<Harness initial={EMPTY_STATE} />);
    await user.type(
      screen.getByLabelText(/Sectors you want to avoid/),
      "Tobacco, Weapons",
    );
    await user.selectOptions(
      screen.getByLabelText("Investing experience"),
      "some",
    );
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    expect(screen.getByText("Saved.")).toBeInTheDocument();
  });
});
