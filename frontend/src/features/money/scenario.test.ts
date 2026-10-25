import { describe, expect, it } from "vitest";

import {
  EMPTY_STATE,
  type Account,
  type MoneyState,
  type Transaction,
} from "./model";
import { EMPTY_PLANNING, type Goal, type RecurringItem } from "./planning";
import {
  amortizedPayment,
  runScenario,
  validateScenario,
  type ScenarioInput,
  type ScenarioResult,
} from "./scenario";

const AS_OF = "2026-04-15";

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

let seq = 0;
function tx(
  kind: Transaction["kind"],
  amount: number,
  date: string,
  category: string,
): Transaction {
  seq += 1;
  return {
    id: `t${seq}`,
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

function goal(extra: Partial<Goal>): Goal {
  return {
    id: "g1",
    name: "Car fund",
    kind: "purchase",
    target_cents: 1_200_000,
    funded_cents: 0,
    linked_account_ids: [],
    target_date: "2026-10-15",
    priority: 1,
    monthly_contribution_cents: null,
    description: "",
    ...extra,
  };
}

const rent: RecurringItem = {
  id: "r1",
  description: "Rent",
  kind: "expense",
  amount_cents: 150_000,
  account_id: "chk",
  to_account_id: null,
  category: "Housing",
  cadence: "monthly",
  next_date: "2026-05-01",
  end_date: null,
  certainty: "fixed",
  essential: true,
};

// Jan-Mar: income 5,000.00, Housing 1,500.00, Dining 500.00 each month.
// Liquid today: 12,000.00 + 3 x 3,000.00 = 21,000.00.
const months = ["2026-01", "2026-02", "2026-03"];
const state: MoneyState = {
  ...EMPTY_STATE,
  accounts: [
    account("chk", "checking", 1_200_000),
    account("card", "credit_card", 100_000, {
      apr: 22,
      minimum_payment_cents: 25_000,
    }),
  ],
  transactions: months.flatMap((m) => [
    tx("income", 500_000, `${m}-01`, "Salary"),
    tx("expense", 150_000, `${m}-03`, "Housing"),
    tx("expense", 50_000, `${m}-10`, "Dining"),
  ]),
  planning: {
    ...EMPTY_PLANNING,
    recurring: [rent],
    goals: [goal({}), goal({ id: "g2", name: "Someday", target_date: null })],
    profile: { ...EMPTY_PLANNING.profile, emergency_months_target: 3 },
  },
};

const NONE: ScenarioInput = {
  purchase: null,
  recurring_change: null,
  income_change: null,
};
const row = (r: ScenarioResult, key: string) =>
  r.rows.find((x) => x.key === key)!;

describe("amortizedPayment", () => {
  it("equals the standard formula P r / (1 - (1 + r)^-n)", () => {
    const r = 0.07 / 12;
    const expected = Math.round((2_000_000 * r) / (1 - Math.pow(1 + r, -60)));
    expect(amortizedPayment(2_000_000, 7, 60)).toBe(expected);
    expect(amortizedPayment(2_000_000, 7, 60)).toBe(39_602); // $396.02
    expect(amortizedPayment(1_000_000, 6, 120)).toBe(11_102);
    expect(amortizedPayment(120_000, 0, 12)).toBe(10_000);
  });
});

describe("runScenario", () => {
  it("states the current position with no change", () => {
    const r = runScenario(state, AS_OF, NONE);
    expect(r.problems).toEqual([]);
    expect(row(r, "liquid").current).toBe(2_100_000);
    expect(row(r, "liquid").proposed).toBe(2_100_000);
    expect(row(r, "essential").current).toBe(150_000);
    expect(row(r, "surplus").current).toBe(300_000);
    expect(row(r, "reserve_target").source).toBe("user-entered");
    expect(row(r, "reserve_target_cents").current).toBe(450_000);
    expect(r.months_used).toBe(3);
  });

  it("reserve months before and after a cash purchase", () => {
    const r = runScenario(state, AS_OF, {
      ...NONE,
      purchase: {
        amount_cents: 600_000,
        date: "2026-04-20",
        account_id: "chk",
        financing: null,
      },
    });
    expect(r.cash_outlay_cents).toBe(600_000);
    expect(row(r, "liquid").proposed).toBe(1_500_000);
    expect(row(r, "reserve_months").current).toBe(14);
    expect(row(r, "reserve_months").proposed).toBe(10);
    expect(r.verdict).toContain(
      "about 10.0 months of essential spending in reserve; your target is 3 months",
    );
    // 90-day low: rent on 05-01, 06-01, 07-01 (no recurring income is set up),
    // after the purchase on 04-20.
    expect(r.low_point.current).toEqual({
      cents: 1_650_000,
      date: "2026-07-01",
    });
    expect(r.low_point.proposed).toEqual({
      cents: 1_050_000,
      date: "2026-07-01",
    });
  });

  it("a financed purchase takes only the down payment from liquid funds and adds the loan payment", () => {
    const r = runScenario(state, AS_OF, {
      ...NONE,
      purchase: {
        amount_cents: 2_500_000,
        date: "2026-04-20",
        account_id: null,
        financing: { financed_cents: 2_000_000, apr: 7, term_months: 60 },
      },
    });
    expect(r.financed_payment_cents).toBe(39_602);
    expect(r.cash_outlay_cents).toBe(500_000);
    expect(row(r, "surplus").proposed).toBe(300_000 - 39_602);
    expect(row(r, "dti").current).toBeCloseTo(25_000 / 500_000);
    expect(row(r, "dti").proposed).toBeCloseTo((25_000 + 39_602) / 500_000);
    expect(row(r, "loan_payment").source).toBe("calculated");
  });

  it("flags when dated goals need more than the surplus left by the change", () => {
    const fine = runScenario(state, AS_OF, NONE);
    expect(fine.goals).toHaveLength(1);
    expect(fine.goals[0].months_left).toBe(6);
    expect(fine.goals_required_cents).toBe(200_000);
    expect(fine.goals_without_date).toEqual(["Someday"]);
    expect(fine.verdict).toContain("within the $3,000.00 surplus");

    const tight = runScenario(state, AS_OF, {
      ...NONE,
      recurring_change: { monthly_cents: 150_000, start_date: "2026-05-01" },
    });
    expect(row(tight, "surplus").proposed).toBe(150_000);
    expect(tight.verdict).toContain("more than the $1,500.00 surplus");
  });

  it("applies an income change to surplus, debt-to-income, and the projection", () => {
    const r = runScenario(state, AS_OF, {
      ...NONE,
      income_change: { monthly_cents: -100_000, start_date: "2026-05-01" },
    });
    expect(row(r, "surplus").proposed).toBe(200_000);
    expect(row(r, "dti").proposed).toBeCloseTo(25_000 / 400_000);
    // Three monthly income reductions alongside three rent payments.
    expect(r.low_point.proposed).toEqual({
      cents: 1_350_000,
      date: "2026-07-01",
    });
  });

  it("does not compute reserve months without a complete tracked month", () => {
    const fresh = {
      ...state,
      transactions: [],
      accounts: state.accounts.map((a) => ({
        ...a,
        opening_date: "2026-04-01",
      })),
    };
    const r = runScenario(fresh, AS_OF, NONE);
    expect(row(r, "essential").current).toBeNull();
    expect(row(r, "reserve_months").current).toBeNull();
    expect(row(r, "surplus").current).toBeNull();
    expect(r.verdict).toContain("could not be measured");
  });

  it("validates entered values and ignores the change until they are valid", () => {
    const input: ScenarioInput = {
      ...NONE,
      purchase: {
        amount_cents: 100_000,
        date: "2026-04-20",
        account_id: null,
        financing: { financed_cents: 200_000, apr: 5, term_months: 12 },
      },
    };
    expect(validateScenario(input)).toEqual([
      "The financed amount must be above zero and no more than the price.",
    ]);
    const r = runScenario(state, AS_OF, input);
    expect(r.problems).toHaveLength(1);
    expect(row(r, "liquid").proposed).toBe(2_100_000);
  });
});
