import { describe, expect, it } from "vitest";

import type { MoneyState } from "../money/model";
import type { RecurringItem } from "../money/planning";
import { ask } from "./engine";
import { account, SAMPLE, TODAY, tx } from "./finleyFixture";
import { ALL_TOPICS } from "./topics";

const rent: RecurringItem = {
  id: "r1",
  description: "Rent",
  kind: "expense",
  amount_cents: 120_000,
  account_id: "Checking",
  to_account_id: null,
  category: "Housing",
  cadence: "monthly",
  next_date: "2026-11-01",
  end_date: null,
  certainty: "fixed",
  essential: true,
};

/** SAMPLE plus: October spending, two budgets, rent, a streaming charge, holdings. */
const PLANNED: MoneyState = {
  ...SAMPLE,
  accounts: [...SAMPLE.accounts, account("Brokerage", "brokerage", 1_000_000)],
  transactions: [
    ...SAMPLE.transactions,
    tx("o1", "expense", 45_000, "2026-10-03", "Groceries"),
    tx("o2", "expense", 9_000, "2026-10-04", "Dining"),
    tx("s1", "expense", 1_599, "2026-07-15", "Subscriptions", {
      description: "StreamCo",
    }),
    tx("s2", "expense", 1_599, "2026-08-15", "Subscriptions", {
      description: "StreamCo",
    }),
    tx("s3", "expense", 1_599, "2026-09-15", "Subscriptions", {
      description: "StreamCo",
    }),
  ],
  planning: {
    ...SAMPLE.planning,
    budgets: [
      {
        id: "b1",
        category: "Groceries",
        limit_cents: 40_000,
        start_month: "2026-01",
      },
      {
        id: "b2",
        category: "Dining",
        limit_cents: 10_000,
        start_month: "2026-01",
      },
    ],
    recurring: [rent],
    holdings: [
      {
        id: "h1",
        account_id: "Brokerage",
        symbol: "VTI",
        name: "Total market fund",
        quantity: 10,
        cost_basis_cents: 200_000,
        acquired_date: "2025-01-02",
        price_cents: 30_000,
        price_date: "2026-10-20",
        asset_class: "us_stock",
        sector: "Diversified",
      },
      {
        id: "h2",
        account_id: "Brokerage",
        symbol: "BND",
        name: "Bond fund",
        quantity: 10,
        cost_basis_cents: null,
        acquired_date: null,
        price_cents: null,
        price_date: null,
        asset_class: "bond",
        sector: "Bonds",
      },
    ],
  },
};

const answer = (q: string, state: MoneyState = PLANNED) =>
  ask(q, { state, today: TODAY }, ALL_TOPICS);

describe("planning topics", () => {
  it.each([
    ["Am I within my budgets?", "budgets"],
    ["What bills are coming up?", "bills"],
    ["Do I have subscriptions I am not tracking?", "subscriptions"],
    ["Did my spending change last month?", "unusual"],
    ["How are my investments spread out?", "holdings"],
    ["How much did I spend last month?", "spending_last_month"],
    ["Should I use the avalanche or snowball method?", "debt_strategy"],
    ["Which debt should I pay off first?", "debt_strategy"],
  ])("%s -> %s", (q, topic) => {
    expect(answer(q).topic).toBe(topic);
  });

  it("budgets: over and near, with amounts", () => {
    const a = answer("budget");
    expect(a.text).toBe(
      "Of 2 budget(s) this month, 1 is over the limit and 1 is at 85% or more.",
    );
    const groceries = a.figures.find((f) => f.label === "Groceries");
    expect(groceries?.value).toBe("$450.00 of $400.00");
    expect(groceries?.note).toBe("Over by $50.00.");
    expect(a.figures.find((f) => f.label === "Dining")?.note).toBe(
      "Near the limit: $10.00 left.",
    );
  });

  it("bills: lists rent due within 30 days", () => {
    const a = answer("upcoming bills");
    expect(a.text).toContain("1 bill(s) totalling $1,200.00");
    expect(a.figures[0].label).toBe("2026-11-01 · Rent");
  });

  it("subscriptions: finds the untracked monthly charge as a possibility", () => {
    const a = answer("subscriptions");
    expect(a.figures[0]).toMatchObject({ label: "StreamCo", value: "$15.99" });
    expect(a.text).toMatch(/not confirmed subscriptions/);
  });

  it("holdings: values only priced holdings and reports the rest", () => {
    const a = answer("portfolio");
    expect(a.figures[0]).toEqual({
      label: "Value of priced holdings",
      value: "$3,000.00",
    });
    expect(a.caveats.join(" ")).toMatch(/1 holding\(s\) have no dated price/);
    expect(a.basis).toMatch(/does not look up prices/);
  });

  it("debt strategy: simulates known debts and lists the one with missing inputs", () => {
    const a = answer("snowball");
    expect(a.figures[0].value).toBe("$30.00");
    expect(a.figures[1].value).toMatch(/^\d+ months, \$[\d,.]+ interest$/);
    expect(a.caveats[0]).toBe(
      "Loan is left out: missing interest rate and minimum payment.",
    );
  });

  it("empty planning sections say what to add instead of showing zeros", () => {
    for (const q of ["budget", "upcoming bills", "portfolio"]) {
      const a = answer(q, SAMPLE);
      expect(a.figures).toEqual([]);
      expect(a.text).toMatch(/You have no budgets|have not entered/);
    }
  });
});
