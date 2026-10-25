import { describe, expect, it } from "vitest";

import { recurring, stateWith, tx } from "./budgetFixtures";
import {
  activeBudgets,
  budgetReport,
  budgetStatus,
  monthPeriod,
  runRateProjection,
} from "./budgets";
import type { Budget } from "./planning";

const budget = (
  category: string,
  limit: number,
  start_month = "2026-01",
  id = category,
): Budget => ({ id, category, limit_cents: limit, start_month });

describe("budgetStatus", () => {
  it("uses 85% for near and strictly above the limit for over", () => {
    expect(budgetStatus(8_499, 10_000)).toBe("under");
    expect(budgetStatus(8_500, 10_000)).toBe("near");
    expect(budgetStatus(10_000, 10_000)).toBe("near");
    expect(budgetStatus(10_001, 10_000)).toBe("over");
    expect(budgetStatus(-500, 10_000)).toBe("under"); // net refunds
  });
});

describe("projections", () => {
  it("run rate = actual / days elapsed x days in month", () => {
    const p = monthPeriod("2026-03", "2026-03-10");
    expect(p).toMatchObject({ days_in_month: 31, days_elapsed: 10 });
    expect(runRateProjection(20_000, p)).toEqual({
      cents: 62_000,
      reason: null,
    });
    // February in a leap year has 29 days.
    const feb = monthPeriod("2028-02", "2028-02-10");
    expect(runRateProjection(10_000, feb).cents).toBe(29_000);
  });

  it("is null with a reason before the month starts, and equals actual after it ends", () => {
    const future = monthPeriod("2026-04", "2026-03-10");
    expect(future.through).toBeNull();
    expect(runRateProjection(0, future)).toEqual({
      cents: null,
      reason: "The month has not started yet.",
    });
    const past = monthPeriod("2026-02", "2026-03-10");
    expect(past).toMatchObject({ through: "2026-02-28", days_elapsed: 28 });
    expect(runRateProjection(12_345, past).cents).toBe(12_345);
  });
});

describe("activeBudgets", () => {
  it("uses the latest budget that has started for each category", () => {
    const list = [
      budget("Dining", 10_000, "2026-01", "a"),
      budget("Dining", 20_000, "2026-03", "b"),
      budget("Travel", 50_000, "2026-04", "c"),
    ];
    expect(activeBudgets(list, "2026-02").map((b) => b.id)).toEqual(["a"]);
    expect(activeBudgets(list, "2026-03").map((b) => b.id)).toEqual(["b"]);
  });
});

describe("budgetReport", () => {
  const state = stateWith([
    tx("income", 300_000, "2026-03-01", { category: "Salary" }),
    tx("expense", 12_000, "2026-03-02", { category: "Groceries" }),
    tx("expense", 9_000, "2026-03-09", { category: "Groceries" }),
    tx("refund", 1_000, "2026-03-10", { category: "Groceries" }),
    tx("expense", 7_000, "2026-03-20", { category: "Groceries" }), // after asOf
    tx("expense", 5_000, "2026-03-05", {
      category: "Groceries",
      status: "pending",
    }),
    tx("expense", 3_000, "2026-03-04", { category: "Dining" }),
    tx("expense", 1_599, "2026-03-03", { category: "Subscriptions" }),
  ]);
  const planning = {
    budgets: [budget("Groceries", 50_000), budget("Housing", 150_000)],
    recurring: [
      recurring({ id: "rent", next_date: "2026-03-15" }),
      recurring({
        id: "power",
        description: "Power",
        category: "Housing",
        amount_cents: 8_000,
        next_date: "2026-03-25",
        certainty: "estimated",
      }),
      recurring({
        id: "tv",
        description: "Streaming",
        category: "Subscriptions",
        amount_cents: 1_599,
        next_date: "2026-04-03",
      }),
    ],
    essential_categories: ["Housing"],
  };
  const report = budgetReport(
    { ...state, planning: { ...state.planning, ...planning } },
    { ...state.planning, ...planning },
    "2026-03",
    "2026-03-10",
  );

  it("counts settled spending through asOf only, refunds netted", () => {
    const groceries = report.rows.find((r) => r.category === "Groceries")!;
    expect(groceries.actual_cents).toBe(20_000);
    expect(groceries.remaining_cents).toBe(30_000);
    expect(groceries.percent_used).toBe(0.4);
    expect(groceries.status).toBe("under");
    expect(groceries.run_rate.cents).toBe(62_000);
    expect(groceries.scheduled.cents).toBe(20_000);
  });

  it("adds recurring expenses still due this month for the scheduled projection", () => {
    const housing = report.rows.find((r) => r.category === "Housing")!;
    expect(housing.actual_cents).toBe(0);
    expect(housing.run_rate.cents).toBe(0);
    expect(housing.scheduled_remaining_cents).toBe(158_000);
    expect(housing.scheduled.cents).toBe(158_000);
    expect(housing.scheduled_count).toBe(2);
    expect(housing.scheduled_estimated_count).toBe(1);
  });

  it("reports unbudgeted spending, income vs spending, and fixed vs variable", () => {
    expect(report.unbudgeted).toEqual([
      { category: "Dining", cents: 3_000 },
      { category: "Subscriptions", cents: 1_599 },
    ]);
    expect(report.unbudgeted_total_cents).toBe(4_599);
    expect(report.income_cents).toBe(300_000);
    expect(report.spending_cents).toBe(24_599);
    expect(report.net_cents).toBe(275_401);
    // Fixed: Housing (essential) and Subscriptions (fixed recurring item).
    expect(report.fixed_categories).toEqual(["Housing", "Subscriptions"]);
    expect(report.fixed_cents).toBe(1_599);
    expect(report.variable_cents).toBe(23_000);
    expect(report.total_limit_cents).toBe(200_000);
  });

  it("counts nothing as actual before the month starts", () => {
    const april = budgetReport(
      state,
      { ...state.planning, ...planning },
      "2026-04",
      "2026-03-10",
    );
    expect(april.spending_cents).toBe(0);
    const housing = april.rows.find((r) => r.category === "Housing")!;
    expect(housing.run_rate.cents).toBeNull();
    expect(housing.scheduled.cents).toBe(158_000);
  });
});
