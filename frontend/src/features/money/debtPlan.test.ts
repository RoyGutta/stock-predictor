import { describe, expect, it } from "vitest";

import {
  compareResults,
  customOrder,
  debtsFromState,
  liquidityCheck,
  liquidityInputs,
  planDebts,
  type PlanDebt,
} from "./debtPlan";
import { payoff } from "./ledger";
import { EMPTY_STATE, type Account, type MoneyState } from "./model";
import { EMPTY_PLANNING, type RecurringItem } from "./planning";
import { addMonths, expandRecurring } from "./planInputs";

function debt(
  id: string,
  balance: number,
  apr: number | null,
  minimum: number | null,
): PlanDebt {
  return { id, name: id, balance_cents: balance, apr, minimum_cents: minimum };
}

function account(
  id: string,
  type: Account["type"],
  opening: number,
  extra: Partial<Account> = {},
): Account {
  return {
    id,
    name: id,
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

function recurring(extra: Partial<RecurringItem>): RecurringItem {
  return {
    id: "r1",
    description: "Rent",
    kind: "expense",
    amount_cents: 100_000,
    account_id: "chk",
    to_account_id: null,
    category: "Housing",
    cadence: "monthly",
    next_date: "2026-05-01",
    end_date: null,
    certainty: "fixed",
    essential: true,
    ...extra,
  };
}

describe("planDebts: single debt", () => {
  it("matches ledger.payoff at the minimum and with extra", () => {
    const d = debt("loan", 1_000_000, 6, 11_103);
    for (const budget of [11_103, 20_000]) {
      const plan = planDebts([d], budget);
      const expected = payoff(1_000_000, 6, budget);
      for (const s of ["avalanche", "snowball", "custom"] as const) {
        expect(plan.results[s].feasible).toBe(true);
        expect(plan.results[s].months).toBe(expected.months);
        expect(plan.results[s].total_interest_cents).toBe(
          expected.total_interest_cents,
        );
      }
    }
    expect(planDebts([d], 11_103).results.avalanche.months).toBe(120);
  });
});

describe("planDebts: strategies", () => {
  // A: large, expensive. B: small, cheap.
  const debts = [debt("A", 500_000, 24, 10_000), debt("B", 100_000, 5, 2_500)];

  it("avalanche costs no more interest than snowball here, and less", () => {
    const plan = planDebts(debts, 30_000);
    const a = plan.results.avalanche;
    const s = plan.results.snowball;
    expect(a.order).toEqual(["A", "B"]);
    expect(s.order).toEqual(["B", "A"]);
    expect(a.feasible && s.feasible).toBe(true);
    expect(a.total_interest_cents!).toBeLessThan(s.total_interest_cents!);
    const cmp = compareResults(a, s);
    expect(cmp.interest_difference_cents).toBe(
      s.total_interest_cents! - a.total_interest_cents!,
    );
    expect(cmp.interest_difference_cents!).toBeGreaterThan(0);
  });

  it("snowball pays the small debt off first", () => {
    const s = planDebts(debts, 30_000).results.snowball;
    expect(s.payoff_month.B!).toBeLessThan(s.payoff_month.A!);
    const a = planDebts(debts, 30_000).results.avalanche;
    expect(a.payoff_month.A!).toBeLessThan(a.payoff_month.B!);
  });

  it("rolls a paid-off debt's minimum into the next target", () => {
    const s = planDebts(debts, 30_000).results.snowball;
    const paidMonth = s.payoff_month.B!;
    const next = s.schedule[paidMonth]; // the month after B is paid
    const rowA = next.rows.find((r) => r.id === "A")!;
    expect(next.rows.find((r) => r.id === "B")).toBeUndefined();
    // The whole budget, including B's freed 25.00 minimum, now goes to A.
    expect(rowA.payment_cents).toBe(30_000);
    // Each month spends exactly the budget until the last.
    for (const m of s.schedule.slice(0, -1)) {
      expect(m.rows.reduce((t, r) => t + r.payment_cents, 0)).toBe(30_000);
    }
  });

  it("ties: avalanche breaks APR ties by smaller balance, snowball balance ties by higher APR", () => {
    const tied = [
      debt("big", 300_000, 20, 5_000),
      debt("small", 100_000, 20, 5_000),
      debt("cheap", 100_000, 10, 5_000),
    ];
    const plan = planDebts(tied, 20_000);
    expect(plan.results.avalanche.order).toEqual(["small", "big", "cheap"]);
    expect(plan.results.snowball.order).toEqual(["small", "cheap", "big"]);
  });

  it("custom order follows the user and appends unplaced debts in avalanche order", () => {
    const known = debts as Parameters<typeof customOrder>[0];
    expect(customOrder(known, ["B"])).toEqual(["B", "A"]);
    expect(customOrder(known, ["zzz", "B", "B"])).toEqual(["B", "A"]);
    const plan = planDebts(debts, 30_000, ["B", "A"]);
    expect(plan.results.custom.total_interest_cents).toBe(
      plan.results.snowball.total_interest_cents,
    );
  });
});

describe("planDebts: infeasible and missing inputs", () => {
  it("reports a budget below the sum of minimums", () => {
    const plan = planDebts(
      [debt("A", 500_000, 24, 10_000), debt("B", 100_000, 5, 2_500)],
      12_000,
    );
    const r = plan.results.avalanche;
    expect(r.feasible).toBe(false);
    expect(r.months).toBeNull();
    expect(r.total_interest_cents).toBeNull();
    expect(r.reason).toContain(
      "$5.00 less than the $125.00 sum of minimum payments",
    );
    expect(plan.sum_minimums_cents).toBe(12_500);
  });

  it("reports a minimum that does not cover interest when no extra reaches it", () => {
    // 1,000.00 at 24% accrues 20.00 in month 1; minimum 15.00.
    const plan = planDebts([debt("Card", 100_000, 24, 1_500)], 1_500);
    expect(plan.results.avalanche.feasible).toBe(false);
    expect(plan.results.avalanche.reason).toContain(
      "Card: the minimum payment of $15.00 does not exceed the first month's interest of $20.00",
    );
    // The same debt is payable once extra money reaches it.
    expect(
      planDebts([debt("Card", 100_000, 24, 1_500)], 5_000).results.avalanche
        .feasible,
    ).toBe(true);
  });

  it("excludes debts missing APR or minimum and lists them, never assuming 0", () => {
    const plan = planDebts(
      [
        debt("A", 500_000, 24, 10_000),
        debt("NoRate", 200_000, null, 5_000),
        debt("NoMin", 50_000, 18, null),
      ],
      20_000,
    );
    expect(plan.included.map((d) => d.id)).toEqual(["A"]);
    expect(plan.missing).toEqual([
      { id: "NoRate", name: "NoRate", missing: ["interest rate (APR)"] },
      { id: "NoMin", name: "NoMin", missing: ["minimum payment"] },
    ]);
    expect(plan.results.avalanche.payoff_month).not.toHaveProperty("NoRate");
    expect(plan.results.avalanche.months).toBe(
      payoff(500_000, 24, 20_000).months,
    );
  });

  it("compare gives null differences when either side is infeasible", () => {
    const bad = planDebts([debt("A", 500_000, 24, 10_000)], 5_000).results
      .avalanche;
    const good = planDebts([debt("A", 500_000, 24, 10_000)], 20_000).results
      .avalanche;
    expect(compareResults(good, bad)).toEqual({
      months_difference: null,
      interest_difference_cents: null,
    });
  });
});

describe("liquidityCheck", () => {
  const base = {
    liquid_cents: 1_000_000,
    essential_monthly_cents: 200_000,
    obligations_30d_cents: 50_000,
    emergency_months_target: 3,
  };

  it("keeps the reserve and the next 30 days of obligations", () => {
    const r = liquidityCheck(base, 500_000);
    expect(r.reserve_cents).toBe(600_000);
    expect(r.available_cents).toBe(350_000);
    expect(r.usable_cents).toBe(350_000);
    expect(liquidityCheck(base, 100_000).usable_cents).toBe(100_000);
    expect(r.available_cents!).toBeLessThan(base.liquid_cents);
  });

  it("is zero, not negative, when funds are already below the reserve", () => {
    expect(
      liquidityCheck({ ...base, liquid_cents: 400_000 }).available_cents,
    ).toBe(0);
  });

  it("refuses to size anything without a target or measured essential spending", () => {
    for (const input of [
      { ...base, emergency_months_target: null },
      { ...base, essential_monthly_cents: null },
      { ...base, essential_monthly_cents: 0 },
    ]) {
      const r = liquidityCheck(input, 100_000);
      expect(r.available_cents).toBeNull();
      expect(r.usable_cents).toBeNull();
      expect(r.reason).toBeTruthy();
    }
  });
});

describe("inputs from state", () => {
  const state: MoneyState = {
    ...EMPTY_STATE,
    accounts: [
      account("chk", "checking", 1_000_000),
      account("card", "credit_card", 200_000, {
        apr: 20,
        minimum_payment_cents: 5_000,
        planned_payment_cents: 10_000,
      }),
      account("loan", "auto_loan", 300_000, {
        apr: 6,
        minimum_payment_cents: 9_000,
      }),
      account("done", "personal_loan", 0, {
        apr: 9,
        minimum_payment_cents: 1_000,
      }),
    ],
    transactions: [
      {
        id: "t1",
        date: "2026-03-05",
        kind: "expense",
        amount_cents: 150_000,
        account_id: "chk",
        to_account_id: null,
        interest_cents: 0,
        category: "Housing",
        splits: [],
        description: "",
        notes: "",
        status: "settled",
      },
      {
        id: "t2",
        date: "2026-03-09",
        kind: "expense",
        amount_cents: 40_000,
        account_id: "chk",
        to_account_id: null,
        interest_cents: 0,
        category: "Dining",
        splits: [],
        description: "",
        notes: "",
        status: "settled",
      },
    ],
    planning: {
      ...EMPTY_PLANNING,
      recurring: [
        recurring({}),
        recurring({
          id: "r2",
          kind: "income",
          amount_cents: 500_000,
          category: "Salary",
        }),
        recurring({
          id: "r3",
          amount_cents: 2_000,
          account_id: "card",
          next_date: "2026-04-20",
        }),
      ],
      profile: { ...EMPTY_PLANNING.profile, emergency_months_target: 2 },
    },
  };

  it("builds plan debts and the default budget (planned, else minimum)", () => {
    const r = debtsFromState(state, "2026-04-15");
    expect(r.debts.map((d) => d.id)).toEqual(["card", "loan"]);
    expect(r.default_budget_cents).toBe(10_000 + 9_000);
    expect(r.paid_off).toEqual(["done"]);
  });

  it("measures essential spending over tracked months and 30-day obligations from liquid funds", () => {
    const li = liquidityInputs(state, "2026-04-15");
    // Tracked complete months: Jan, Feb, Mar. Essential (Housing) = 1,500.00 / 3.
    expect(li.months_used).toBe(3);
    expect(li.essential_monthly_cents).toBe(50_000);
    // Rent on 05-01 is within 30 days; the card charge does not touch liquid funds; income is not counted.
    expect(li.obligations_30d_cents).toBe(100_000);
    expect(li.emergency_months_target).toBe(2);
  });
});

describe("expandRecurring", () => {
  it("clamps month ends without drifting, and respects end dates", () => {
    const item = recurring({ next_date: "2026-01-31", end_date: "2026-04-30" });
    expect(
      expandRecurring([item], "2026-01-01", "2026-12-31").map((o) => o.date),
    ).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
  });

  it("skips occurrences before the window and steps weekly cadences by days", () => {
    const item = recurring({ cadence: "biweekly", next_date: "2026-01-02" });
    expect(
      expandRecurring([item], "2026-01-10", "2026-02-10").map((o) => o.date),
    ).toEqual(["2026-01-16", "2026-01-30"]);
  });
});
