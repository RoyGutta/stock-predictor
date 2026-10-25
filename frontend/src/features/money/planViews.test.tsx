import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import * as matchers from "vitest-axe/matchers";

import { DebtPlanView } from "./DebtPlanView";
import {
  EMPTY_STATE,
  type Account,
  type MoneyState,
  type Transaction,
} from "./model";
import { EMPTY_PLANNING } from "./planning";
import { ScenarioView } from "./ScenarioView";

expect.extend(matchers);

/** Colour contrast needs a canvas jsdom lacks; checked in a real browser instead. */
const AXE_OPTIONS = { rules: { "color-contrast": { enabled: false } } };

async function expectNoViolations(container: HTMLElement) {
  const results = await axe(container, AXE_OPTIONS);
  expect(results.violations).toEqual([]);
}

function account(
  id: string,
  name: string,
  type: Account["type"],
  opening: number,
  extra: Partial<Account> = {},
): Account {
  return {
    id,
    name,
    type,
    currency: "USD",
    institution: "",
    notes: "",
    opening_balance_cents: opening,
    opening_date: "2026-01-01",
    apr: null,
    minimum_payment_cents: null,
    planned_payment_cents: null,
    due_day: null,
    archived: false,
    ...extra,
  };
}

function tx(
  id: string,
  kind: Transaction["kind"],
  amount: number,
  date: string,
  category: string,
): Transaction {
  return {
    id,
    date,
    kind,
    amount_cents: amount,
    account_id: "chk",
    to_account_id: null,
    interest_cents: 0,
    category,
    splits: [],
    description: "",
    notes: "",
    status: "settled",
  };
}

const state: MoneyState = {
  ...EMPTY_STATE,
  accounts: [
    account("chk", "Checking", "checking", 2_000_000),
    account("card", "Visa", "credit_card", 300_000, {
      apr: 24,
      minimum_payment_cents: 9_000,
    }),
    account("loan", "Car loan", "auto_loan", 900_000, {
      apr: 6,
      minimum_payment_cents: 20_000,
    }),
    account("med", "Medical bill", "other_liability", 50_000),
  ],
  transactions: ["01", "02", "03"].flatMap((m) => [
    tx(`i${m}`, "income", 500_000, `2026-${m}-01`, "Salary"),
    tx(`h${m}`, "expense", 150_000, `2026-${m}-03`, "Housing"),
  ]),
  planning: {
    ...EMPTY_PLANNING,
    profile: { ...EMPTY_PLANNING.profile, emergency_months_target: 3 },
  },
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 3, 15, 12));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DebtPlanView", () => {
  it("compares strategies, lists missing inputs, and has no axe violations", async () => {
    const { container } = render(<DebtPlanView state={state} />);
    expect(
      screen.getByRole("table", { name: "Strategies compared" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Medical bill: no interest rate \(APR\) or minimum payment recorded/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Total paid toward debts each month"),
    ).toHaveValue("290.00");
    await expectNoViolations(container);
  });

  it("reorders the custom list with keyboard-accessible buttons", async () => {
    const user = userEvent.setup();
    render(<DebtPlanView state={state} />);
    const list = screen.getByRole("list", { name: "Your payoff order" });
    expect(within(list).getAllByRole("listitem")[0]).toHaveTextContent(
      "1. Visa",
    );
    screen.getByRole("button", { name: "Move Visa down" }).focus();
    await user.keyboard("{Enter}");
    expect(within(list).getAllByRole("listitem")[0]).toHaveTextContent(
      "1. Car loan",
    );
    expect(
      screen.getByRole("button", { name: "Move Car loan up" }),
    ).toBeDisabled();
  });

  it("sizes a lump sum against the reserve", async () => {
    const user = userEvent.setup();
    render(<DebtPlanView state={state} />);
    await user.type(screen.getByLabelText("Lump sum to consider"), "100000");
    // Liquid 20,000.00 + 3 x 3,500.00 = 30,500.00; reserve 3 x 1,500.00 = 4,500.00; no recurring items.
    expect(screen.getByText("$26,000.00")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Paying $26,000.00 (the part of $100,000.00 above the reserve is left out)",
    );
  });

  it("explains an empty state accessibly", async () => {
    const { container } = render(<DebtPlanView state={EMPTY_STATE} />);
    expect(screen.getByText(/No open debts are recorded/)).toBeInTheDocument();
    await expectNoViolations(container);
  });
});

describe("ScenarioView", () => {
  it("shows current figures with sources and has no axe violations", async () => {
    const { container } = render(<ScenarioView state={state} />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("You entered")).toBeInTheDocument();
    expect(screen.getByText(/does not guarantee/)).toBeInTheDocument();
    await expectNoViolations(container);
  });

  it("describes a financed purchase without advising", async () => {
    const user = userEvent.setup();
    const { container } = render(<ScenarioView state={state} />);
    await user.type(screen.getByLabelText("Price"), "25000");
    await user.click(screen.getByLabelText("Financed with a loan"));
    await user.type(screen.getByLabelText("Amount financed"), "20000");
    await user.type(screen.getByLabelText("Loan APR (%)"), "7");
    await user.type(screen.getByLabelText("Term (months)"), "60");
    const verdict = screen.getByRole("status");
    // Liquid 30,500.00 - 5,000.00 down = 25,500.00 = 17.0 months of 1,500.00.
    expect(verdict).toHaveTextContent(
      "This leaves $25,500.00 in liquid funds, about 17.0 months of essential spending in reserve; your target is 3 months.",
    );
    expect(screen.getByText("$396.02")).toBeInTheDocument();
    await expectNoViolations(container);
  });
});
