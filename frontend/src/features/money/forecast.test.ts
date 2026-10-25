import { describe, expect, it } from "vitest";

import {
  account,
  goal,
  makeState,
  recurring,
  tx,
} from "../../test/planningFixtures";
import {
  addMonthsClamped,
  expandOccurrences,
  projectCashFlow,
} from "./forecast";

describe("addMonthsClamped", () => {
  it("clamps to the last day of shorter months", () => {
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonthsClamped("2026-03-31", 1)).toBe("2026-04-30");
    expect(addMonthsClamped("2026-11-15", 3)).toBe("2027-02-15");
  });
});

describe("expandOccurrences", () => {
  const item = (
    cadence: "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly",
    next: string,
    end: string | null = null,
  ) => ({
    cadence,
    next_date: next,
    end_date: end,
  });

  it("keeps a month-end anchor instead of drifting to the 28th", () => {
    expect(
      expandOccurrences(
        item("monthly", "2026-01-31"),
        "2026-01-01",
        "2026-05-31",
      ),
    ).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
    ]);
    expect(
      expandOccurrences(
        item("quarterly", "2026-11-30"),
        "2026-11-01",
        "2027-06-01",
      ),
    ).toEqual(["2026-11-30", "2027-02-28", "2027-05-30"]);
    expect(
      expandOccurrences(
        item("yearly", "2028-02-29"),
        "2028-01-01",
        "2030-12-31",
      ),
    ).toEqual(["2028-02-29", "2029-02-28", "2030-02-28"]);
  });

  it("steps weekly and biweekly by days and includes the end date", () => {
    expect(
      expandOccurrences(
        item("weekly", "2026-10-01", "2026-10-22"),
        "2026-10-01",
        "2026-12-31",
      ),
    ).toEqual(["2026-10-01", "2026-10-08", "2026-10-15", "2026-10-22"]);
    expect(
      expandOccurrences(
        item("biweekly", "2026-12-25"),
        "2026-12-01",
        "2027-01-31",
      ),
    ).toEqual(["2026-12-25", "2027-01-08", "2027-01-22"]);
  });

  it("skips occurrences before the window", () => {
    expect(
      expandOccurrences(
        item("weekly", "2026-10-01"),
        "2026-10-10",
        "2026-10-20",
      ),
    ).toEqual(["2026-10-15"]);
  });
});

describe("projectCashFlow", () => {
  const asOf = "2026-10-24";
  const accounts = [
    account("checking", "checking", 100_000),
    account("savings", "savings", 50_000),
    account("card", "credit_card", 100_000),
    account("brokerage", "brokerage", 900_000),
    account("old", "checking", 5_000, { archived: true }),
    account("euro", "checking", 5_000, { currency: "EUR" }),
  ];
  const planning = {
    recurring: [
      recurring("pay", {
        kind: "income" as const,
        amount_cents: 80_000,
        cadence: "biweekly" as const,
        next_date: "2026-10-30",
        certainty: "estimated" as const,
        description: "Paycheck",
      }),
      recurring("rent", {
        amount_cents: 120_000,
        next_date: "2026-11-01",
        description: "Rent",
      }),
      recurring("cardpay", {
        kind: "transfer" as const,
        amount_cents: 30_000,
        to_account_id: "card",
        next_date: "2026-11-05",
        description: "Card payment",
      }),
      recurring("power", {
        amount_cents: 170_000,
        next_date: "2026-11-15",
        certainty: "estimated" as const,
        description: "Utilities",
      }),
      recurring("ghost", {
        account_id: "old",
        description: "Archived account bill",
      }),
    ],
    goals: [goal("trip", { monthly_contribution_cents: 10_000 })],
  };
  const state = makeState(
    accounts,
    [tx("expense", 20_000, "checking", "2026-10-20", { status: "pending" })],
    planning,
  );
  const f = projectCashFlow(state, {
    asOf,
    horizonDays: 30,
    thresholdCents: 100_000,
  });

  it("starts from settled liquid balances and keeps pending separate", () => {
    expect(f.confirmed_liquid_cents).toBe(150_000);
    expect(f.pending.transactions).toHaveLength(1);
    expect(f.pending.liquid_effect_cents).toBe(-20_000);
    expect(f.daily[0]).toEqual({ date: asOf, liquid_cents: 150_000 });
  });

  it("applies events in date order with running liquid balances", () => {
    expect(f.end_date).toBe("2026-11-23");
    expect(
      f.events.map((e) => [e.date, e.description, e.liquid_after_cents]),
    ).toEqual([
      ["2026-10-30", "Paycheck", 230_000],
      ["2026-11-01", "Rent", 110_000],
      ["2026-11-05", "Card payment", 80_000],
      ["2026-11-13", "Paycheck", 160_000],
      ["2026-11-15", "Utilities", -10_000],
    ]);
    expect(f.money_left_cents).toBe(-10_000);
    expect(f.inflow_cents).toBe(160_000);
    expect(f.outflow_cents).toBe(320_000);
  });

  it("finds the lowest balance, the first shortfall, and the threshold date", () => {
    expect(f.lowest).toEqual({ cents: -10_000, date: "2026-11-15" });
    expect(f.first_below_zero).toBe("2026-11-15");
    expect(f.first_below_threshold).toBe("2026-11-05");
    expect(f.daily).toHaveLength(31);
  });

  it("labels each event fixed or estimated from the user's entry", () => {
    expect(f.events.map((e) => e.certainty)).toEqual([
      "estimated",
      "fixed",
      "fixed",
      "estimated",
      "estimated",
    ]);
    expect(f.fixed_count).toBe(2);
    expect(f.estimated_count).toBe(3);
  });

  it("projects each account, moving debt payments into the debt", () => {
    const byId = Object.fromEntries(f.accounts.map((a) => [a.account_id, a]));
    expect(byId.card.confirmed_cents).toBe(100_000);
    expect(byId.card.projected_end_cents).toBe(70_000);
    expect(byId.checking.projected_end_cents).toBe(-60_000);
    expect(byId.brokerage.liquid).toBe(false);
    expect(byId.brokerage.projected_end_cents).toBe(900_000);
  });

  it("lists archived and other-currency entries as skipped", () => {
    expect(f.skipped).toEqual([
      "old: archived",
      "euro: not in U.S. dollars (EUR)",
      "Archived account bill: its account is missing, archived, or not in U.S. dollars",
    ]);
  });

  it("applies goal contributions only when the user opts in", () => {
    expect(f.events.some((e) => e.source === "goal")).toBe(false);
    const withGoals = projectCashFlow(state, {
      asOf,
      horizonDays: 30,
      includeGoalContributions: true,
    });
    const contributions = withGoals.events.filter((e) => e.source === "goal");
    expect(contributions.map((e) => [e.date, e.liquid_delta_cents])).toEqual([
      ["2026-11-01", -10_000],
    ]);
    expect(withGoals.money_left_cents).toBe(-20_000);
    expect(withGoals.first_below_threshold).toBeNull(); // no threshold set
  });

  it("treats a contribution into a linked liquid account as staying in liquid funds", () => {
    const linked = makeState(accounts, [], {
      goals: [
        goal("fund", {
          monthly_contribution_cents: 10_000,
          linked_account_ids: ["savings"],
        }),
      ],
    });
    const out = projectCashFlow(linked, {
      asOf,
      horizonDays: 90,
      includeGoalContributions: true,
    });
    expect(out.events.map((e) => e.date)).toEqual([
      "2026-11-01",
      "2026-12-01",
      "2027-01-01",
    ]);
    expect(out.events.every((e) => e.liquid_delta_cents === 0)).toBe(true);
  });

  it("has no shortfall when the balance never drops below zero", () => {
    const calm = makeState([account("checking", "checking", 100_000)], [], {
      recurring: [recurring("sub", { amount_cents: 1_000 })],
    });
    const out = projectCashFlow(calm, { asOf, horizonDays: 365 });
    expect(out.first_below_zero).toBeNull();
    expect(out.events).toHaveLength(12);
    expect(out.money_left_cents).toBe(88_000);
    expect(out.lowest).toEqual({ cents: 88_000, date: "2027-10-01" });
  });
});
